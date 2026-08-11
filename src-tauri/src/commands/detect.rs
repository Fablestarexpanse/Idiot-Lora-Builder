//! Face/region detection for crop centering (currently a placeholder region),
//! with an mtime-keyed result cache.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use once_cell::sync::Lazy;

#[derive(Debug, Clone, Serialize)]
pub struct FaceRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub confidence: f32,
}

const DETECTION_CACHE_MAX_ENTRIES: usize = 512;

// Cache for detection results to avoid reprocessing.
// Keyed by (path, mtime) so edits to an image invalidate its entry.
static DETECTION_CACHE: Lazy<Mutex<std::collections::HashMap<(String, u64), Vec<FaceRegion>>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

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
pub async fn detect_faces(payload: DetectFacesPayload) -> Result<Vec<FaceRegion>, String> {
    // Image header read + (future) detection are blocking — keep them off the async runtime.
    tauri::async_runtime::spawn_blocking(move || detect_faces_sync(payload))
        .await
        .map_err(|e| e.to_string())?
}

fn detect_faces_sync(payload: DetectFacesPayload) -> Result<Vec<FaceRegion>, String> {
    let cache_key = (payload.path.clone(), file_mtime_millis(&payload.path));

    // Check cache first (recover from poisoning: cached data is never left half-written)
    {
        let cache = DETECTION_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    // Read only the header to get dimensions (no full decode needed)
    let (width, height) = image::image_dimensions(&payload.path)
        .map_err(|e| format!("Failed to open image: {}", e))?;

    // PLACEHOLDER IMPLEMENTATION - Working demonstration of the feature
    //
    // The YuNet ONNX model has been downloaded to src-tauri/models/yunet_face.onnx
    // Real face detection requires:
    // 1. ort crate v2.0 API (complex tensor conversion, still being debugged)
    // 2. Proper ONNX Runtime setup with model loading
    // 3. Image preprocessing (resize to 320x320, normalize)
    // 4. Output tensor parsing
    //
    // For now, this returns a centered region that demonstrates:
    // ✓ The UI works (mode selector, loading state, overlays)
    // ✓ Caching works
    // ✓ Crop centers on the detected region
    // ✓ Multiple faces can be shown (green overlays)
    //
    // The infrastructure is complete - just needs the ONNX Runtime API debugging.

    let face_width = (width as f32 * 0.4) as u32;
    let face_height = (height as f32 * 0.5) as u32;
    let face_x = (width - face_width) / 2;
    let face_y = (height - face_height) / 2;

    // NOTE: This is NOT real face detection. It is a hardcoded placeholder region
    // centered in the image (40% x 50% of the dimensions) with a fabricated confidence,
    // kept only so the surrounding UI/caching/crop plumbing can be exercised.
    let result = vec![FaceRegion {
        x: face_x,
        y: face_y,
        width: face_width,
        height: face_height,
        confidence: 0.95,
    }];

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
        cache.insert(cache_key, result.clone());
    }

    Ok(result)
}
