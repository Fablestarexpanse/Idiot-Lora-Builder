//! Face detection for crop centering using the YuNet 2023mar ONNX model
//! (via ONNX Runtime), with an mtime-keyed result cache.

use once_cell::sync::Lazy;
use ort::session::Session;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
pub struct FaceRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub confidence: f32,
}

const DETECTION_CACHE_MAX_ENTRIES: usize = 512;
/// Minimum score = sqrt(cls * obj) for a candidate box to survive.
const SCORE_THRESHOLD: f32 = 0.6;
/// IoU threshold for greedy non-maximum suppression.
const NMS_IOU_THRESHOLD: f32 = 0.3;
/// Maximum number of faces returned per image.
const MAX_FACES: usize = 50;
/// Longest input side fed to the model (dims are rounded to multiples of 32).
const MAX_INPUT_SIDE: u32 = 640;

// Cache for detection results to avoid reprocessing.
// Keyed by (path, mtime) so edits to an image invalidate its entry.
static DETECTION_CACHE: Lazy<Mutex<std::collections::HashMap<(String, u64), Vec<FaceRegion>>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

// Lazily-initialized YuNet session, created once per app run. `run` takes
// `&mut self`, so the session lives behind a Mutex (also serializes inference).
static YUNET_SESSION: Lazy<Mutex<Option<Session>>> = Lazy::new(|| Mutex::new(None));

/// One-time ort runtime registration from the downloaded onnxruntime.dll.
/// Validates the path first — handing a bad path to init_from can hang.
static ORT_INIT: Lazy<Mutex<Option<Result<(), String>>>> = Lazy::new(|| Mutex::new(None));

fn init_ort_once(dylib_path: &Path) -> Result<(), String> {
    let mut guard = ORT_INIT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(prev) = guard.as_ref() {
        return prev.clone();
    }
    let result = (|| {
        if !dylib_path.is_file() {
            return Err(format!("onnxruntime.dll not found at {}", dylib_path.display()));
        }
        // commit() returns bool: false just means the env was already committed.
        ort::init_from(dylib_path)
            .map_err(|e| e.to_string())?
            .commit();
        Ok(())
    })();
    *guard = Some(result.clone());
    result
}

/// File mtime in milliseconds since epoch (0 when unavailable).
fn file_mtime_millis(path: &str) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Deserialize)]
pub struct DetectFacesPayload {
    pub path: String,
}

#[tauri::command]
pub async fn detect_faces(
    app: AppHandle,
    payload: DetectFacesPayload,
) -> Result<Vec<FaceRegion>, String> {
    let cache_key = (payload.path.clone(), file_mtime_millis(&payload.path));

    // Check cache first (recover from poisoning: cached data is never left half-written)
    {
        let cache = DETECTION_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    // Any failure (offline model download, ort init, inference) degrades to
    // "no faces" — the crop tool handles an empty result gracefully.
    let model_path = match super::models::ensure_yunet(&app).await {
        Ok(p) => p,
        Err(e) => {
            log::warn!("detect_faces: YuNet model unavailable: {e}");
            return Ok(Vec::new());
        }
    };

    // ort is built with load-dynamic: onnxruntime.dll is downloaded on demand
    // and registered once per app run before any session is created.
    let dylib_path = match super::models::ensure_onnxruntime(&app).await {
        Ok(p) => p,
        Err(e) => {
            log::warn!("detect_faces: onnxruntime unavailable: {e}");
            return Ok(Vec::new());
        }
    };
    if let Err(e) = init_ort_once(&dylib_path) {
        log::error!("detect_faces: ort init failed: {e}");
        return Ok(Vec::new());
    }

    // Image decode + inference are blocking — keep them off the async runtime.
    let path = payload.path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        detect_faces_sync(&path, &model_path)
    })
    .await
    .map_err(|e| e.to_string())?;

    let faces = match result {
        Ok(faces) => faces,
        Err(e) => {
            log::warn!("detect_faces: detection failed for {}: {e}", payload.path);
            return Ok(Vec::new());
        }
    };

    // Cache the result (with simple eviction: drop half the entries when the cap is hit)
    {
        let mut cache = DETECTION_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if cache.len() > DETECTION_CACHE_MAX_ENTRIES {
            let to_remove: Vec<(String, u64)> =
                cache.keys().take(cache.len() / 2).cloned().collect();
            for k in to_remove {
                cache.remove(&k);
            }
        }
        cache.insert(cache_key, faces.clone());
    }

    Ok(faces)
}

/// Candidate box in original-image pixel space (x/y = top-left corner).
struct Candidate {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    score: f32,
}

fn detect_faces_sync(image_path: &str, model_path: &PathBuf) -> Result<Vec<FaceRegion>, String> {
    let img = image::open(image_path)
        .map_err(|e| format!("Failed to open image: {e}"))?
        .to_rgb8();
    let (orig_w, orig_h) = img.dimensions();
    if orig_w == 0 || orig_h == 0 {
        return Err("Empty image".to_string());
    }

    // Working size: cap the longest side at MAX_INPUT_SIDE, round each
    // dimension to a multiple of 32 (the model is fully convolutional).
    let ratio = (MAX_INPUT_SIDE as f32 / orig_w.max(orig_h) as f32).min(1.0);
    let round32 = |v: f32| -> u32 { (((v / 32.0).round().max(1.0)) as u32) * 32 };
    let in_w = round32(orig_w as f32 * ratio);
    let in_h = round32(orig_h as f32 * ratio);
    // Per-axis factors mapping model-input coordinates back to original pixels.
    let scale_x = orig_w as f32 / in_w as f32;
    let scale_y = orig_h as f32 / in_h as f32;

    let resized = image::imageops::resize(&img, in_w, in_h, image::imageops::FilterType::Triangle);

    // NCHW [1, 3, H, W], BGR channel order, raw 0-255 floats (no normalization).
    let (w, h) = (in_w as usize, in_h as usize);
    let mut input = vec![0f32; 3 * h * w];
    for (x, y, pixel) in resized.enumerate_pixels() {
        let (x, y) = (x as usize, y as usize);
        let [r, g, b] = pixel.0;
        input[y * w + x] = b as f32; // channel 0: B
        input[h * w + y * w + x] = g as f32; // channel 1: G
        input[2 * h * w + y * w + x] = r as f32; // channel 2: R
    }

    let candidates = run_yunet(model_path, input, in_w, in_h, scale_x, scale_y)?;
    let kept = nms(candidates);

    let mut faces: Vec<FaceRegion> = kept
        .into_iter()
        .filter_map(|c| {
            // Clamp to image bounds; drop degenerate boxes.
            let x0 = c.x.max(0.0).min(orig_w as f32 - 1.0);
            let y0 = c.y.max(0.0).min(orig_h as f32 - 1.0);
            let x1 = (c.x + c.w).max(0.0).min(orig_w as f32);
            let y1 = (c.y + c.h).max(0.0).min(orig_h as f32);
            let (bw, bh) = (x1 - x0, y1 - y0);
            if bw < 1.0 || bh < 1.0 {
                return None;
            }
            Some(FaceRegion {
                x: x0 as u32,
                y: y0 as u32,
                width: bw as u32,
                height: bh as u32,
                confidence: c.score,
            })
        })
        .collect();
    faces.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(faces)
}

/// Runs the model and decodes the anchor-free YuNet 2023mar heads into
/// candidate boxes in original-image space (matching OpenCV's FaceDetectorYN
/// post-processing).
fn run_yunet(
    model_path: &Path,
    input: Vec<f32>,
    in_w: u32,
    in_h: u32,
    scale_x: f32,
    scale_y: f32,
) -> Result<Vec<Candidate>, String> {
    let mut guard = YUNET_SESSION.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        let session = Session::builder()
            .map_err(|e| format!("ort init failed: {e}"))?
            .commit_from_file(model_path)
            .map_err(|e| format!("YuNet model load failed: {e}"))?;
        *guard = Some(session);
    }
    let session = guard.as_mut().expect("session initialized above");

    let tensor = ort::value::Tensor::from_array((
        [1usize, 3, in_h as usize, in_w as usize],
        input,
    ))
    .map_err(|e| format!("input tensor: {e}"))?;
    let outputs = session
        .run(ort::inputs!["input" => tensor])
        .map_err(|e| format!("inference failed: {e}"))?;

    let mut candidates = Vec::new();
    for stride in [8u32, 16, 32] {
        let cols = (in_w / stride) as usize;
        let rows = (in_h / stride) as usize;
        let n = cols * rows;

        let extract = |name: String| -> Result<&[f32], String> {
            let (_, data) = outputs[name.as_str()]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("output {name}: {e}"))?;
            Ok(data)
        };
        let cls = extract(format!("cls_{stride}"))?;
        let obj = extract(format!("obj_{stride}"))?;
        let bbox = extract(format!("bbox_{stride}"))?;
        if cls.len() < n || obj.len() < n || bbox.len() < 4 * n {
            return Err(format!(
                "unexpected output shape at stride {stride} (cls {}, obj {}, bbox {})",
                cls.len(),
                obj.len(),
                bbox.len()
            ));
        }

        for i in 0..n {
            let score = (cls[i].clamp(0.0, 1.0) * obj[i].clamp(0.0, 1.0)).sqrt();
            if score < SCORE_THRESHOLD {
                continue;
            }
            let s = stride as f32;
            let cx_cell = (i % cols) as f32;
            let cy_cell = (i / cols) as f32;
            let b = &bbox[i * 4..i * 4 + 4];
            let center_x = (cx_cell + b[0]) * s;
            let center_y = (cy_cell + b[1]) * s;
            let bw = b[2].exp() * s;
            let bh = b[3].exp() * s;
            candidates.push(Candidate {
                x: (center_x - bw / 2.0) * scale_x,
                y: (center_y - bh / 2.0) * scale_y,
                w: bw * scale_x,
                h: bh * scale_y,
                score: score.clamp(0.0, 1.0),
            });
        }
    }
    Ok(candidates)
}

/// Greedy non-maximum suppression: highest score first, drop overlaps.
fn nms(mut candidates: Vec<Candidate>) -> Vec<Candidate> {
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut kept: Vec<Candidate> = Vec::new();
    for c in candidates {
        if kept.len() >= MAX_FACES {
            break;
        }
        if kept.iter().all(|k| iou(k, &c) < NMS_IOU_THRESHOLD) {
            kept.push(c);
        }
    }
    kept
}

fn iou(a: &Candidate, b: &Candidate) -> f32 {
    let x0 = a.x.max(b.x);
    let y0 = a.y.max(b.y);
    let x1 = (a.x + a.w).min(b.x + b.w);
    let y1 = (a.y + a.h).min(b.y + b.h);
    let inter = (x1 - x0).max(0.0) * (y1 - y0).max(0.0);
    let union = a.w * a.h + b.w * b.h - inter;
    if union <= 0.0 {
        0.0
    } else {
        inter / union
    }
}
