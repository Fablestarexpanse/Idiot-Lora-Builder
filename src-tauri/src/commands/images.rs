use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use exif::{In, Reader, Tag};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::DynamicImage;
use image::ImageFormat;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};
use std::fs;
use std::io::{BufReader, Cursor};
use std::path::Path;
use std::path::PathBuf;

use once_cell::sync::Lazy;

const THUMB_SIZE: u32 = 256;
/// Upper bound for requested edge length (HiDPI grid cells + crisp factor on the front end).
const THUMB_MAX_EDGE: u32 = 1536;
/// Adaptive quality thresholds — lower quality for small grid thumbs, higher for large/preview.
const JPEG_QUALITY_SMALL: u8 = 75;
const JPEG_QUALITY_LARGE: u8 = 82;
const JPEG_QUALITY_THRESHOLD: u32 = 384;
const CACHE_DIR_NAME: &str = "lora-dataset-studio-thumbnails";

/// In-memory LRU-style cache mapping (path, size) → cache file path.
/// Avoids repeated stat + hash for recently accessed thumbnails.
const MEM_CACHE_MAX: usize = 2048;

static THUMB_PATH_CACHE: Lazy<Mutex<HashMap<(String, u32), PathBuf>>> =
    Lazy::new(|| Mutex::new(HashMap::with_capacity(512)));

/// Per-(path, size) locks so concurrent requests (grid batch prefetch + per-cell fallback)
/// generate a given thumbnail exactly once instead of racing on the same file.
static THUMB_INFLIGHT: Lazy<Mutex<HashMap<(String, u32), Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn jpeg_quality_for_size(edge: u32) -> u8 {
    if edge <= JPEG_QUALITY_THRESHOLD {
        JPEG_QUALITY_SMALL
    } else {
        JPEG_QUALITY_LARGE
    }
}

fn clamp_thumb_edge(requested: Option<u32>) -> u32 {
    let s = requested.unwrap_or(THUMB_SIZE);
    s.clamp(32, THUMB_MAX_EDGE)
}

/// EXIF-compressed preview inside the metadata TIFF (common on camera JPEGs). Decoding this tiny
/// JPEG avoids reading/decoding the full-resolution image — same idea as Lightroom/Camera Raw
/// embedded previews.
fn exif_jpeg_interchange_bytes(exif: &exif::Exif, ifd: In) -> Option<&[u8]> {
    let offset = exif
        .get_field(Tag::JPEGInterchangeFormat, ifd)
        .and_then(|f| f.value.get_uint(0))? as usize;
    let len = exif
        .get_field(Tag::JPEGInterchangeFormatLength, ifd)
        .and_then(|f| f.value.get_uint(0))? as usize;
    let buf = exif.buf();
    let end = offset.checked_add(len)?;
    if end > buf.len() {
        return None;
    }
    let slice = &buf[offset..end];
    if slice.len() < 4 || !slice.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    Some(slice)
}

fn try_decode_exif_embedded_preview(path: &Path) -> Option<DynamicImage> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let exif = Reader::new().read_from_container(&mut reader).ok()?;
    for ifd in [In::THUMBNAIL, In::PRIMARY] {
        if let Some(jpeg_bytes) = exif_jpeg_interchange_bytes(&exif, ifd) {
            if let Ok(img) = image::load_from_memory_with_format(jpeg_bytes, ImageFormat::Jpeg) {
                if img.width() >= 8 && img.height() >= 8 {
                    return Some(img);
                }
            }
        }
    }
    None
}

/// Prefer EXIF embedded JPEG when present; otherwise full decode (PNG/WebP/GIF, JPEG without thumb).
fn load_source_for_grid_thumbnail(path: &Path) -> Result<DynamicImage, String> {
    if let Some(img) = try_decode_exif_embedded_preview(path) {
        return Ok(img);
    }
    image::open(path).map_err(|e| e.to_string())
}

/// Fast downscale (nearest-area style) suitable for proxies; much cheaper than Lanczos on huge sources.
/// Uses adaptive JPEG quality — lower for small grid thumbs, higher for larger sizes.
fn encode_grid_thumbnail_jpeg(img: DynamicImage, edge: u32) -> Result<Vec<u8>, String> {
    let thumb = img.thumbnail(edge, edge);
    let rgb = thumb.to_rgb8();
    let quality = jpeg_quality_for_size(edge);
    let mut buf = Vec::with_capacity(32_768);
    let mut enc = JpegEncoder::new_with_quality(&mut buf, quality);
    enc.encode(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )
    .map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Write via temp file + rename so a concurrent reader never sees a partially written JPEG.
fn write_thumb_atomic(cache_path: &Path, buf: &[u8]) {
    let tmp = cache_path.with_extension("jpg.tmp");
    if fs::write(&tmp, buf).is_ok() {
        let _ = fs::rename(&tmp, cache_path);
    }
}

/// Ensures the thumbnail file exists on disk, generating it at most once even when the
/// grid batch prefetch and a per-cell request race for the same image. Returns the cache path.
fn ensure_thumbnail_file(path_str: &str, size: u32) -> Result<PathBuf, String> {
    let path = PathBuf::from(path_str);
    if !path.is_file() {
        return Err("File not found".to_string());
    }

    // In-memory cache: skip stat + hash for hot entries
    let mem_key = (path_str.to_string(), size);
    {
        let cache = THUMB_PATH_CACHE.lock().unwrap();
        if let Some(cached) = cache.get(&mem_key) {
            if cached.exists() {
                return Ok(cached.clone());
            }
        }
    }

    let cache_dir = thumbnail_cache_dir()?;
    let key = thumbnail_cache_key(&path, size)?;
    let cache_path = cache_dir.join(format!("{}.jpg", key));

    if !cache_path.is_file() {
        let lock = {
            let mut inflight = THUMB_INFLIGHT.lock().unwrap();
            inflight.entry(mem_key.clone()).or_default().clone()
        };
        let guard = lock.lock().unwrap();
        let result: Result<(), String> = (|| {
            // Another request may have generated it while we waited for the lock
            if cache_path.is_file() {
                return Ok(());
            }
            let img = load_source_for_grid_thumbnail(&path)?;
            let buf = encode_grid_thumbnail_jpeg(img, size)?;
            write_thumb_atomic(&cache_path, &buf);
            Ok(())
        })();
        drop(guard);
        THUMB_INFLIGHT.lock().unwrap().remove(&mem_key);
        result?;
    }

    let mut cache = THUMB_PATH_CACHE.lock().unwrap();
    if cache.len() >= MEM_CACHE_MAX {
        // Simple eviction: clear half when full
        let keys: Vec<_> = cache.keys().take(MEM_CACHE_MAX / 2).cloned().collect();
        for k in keys {
            cache.remove(&k);
        }
    }
    cache.insert(mem_key, cache_path.clone());
    Ok(cache_path)
}

/// Cache dir under temp. Creates on first use.
fn thumbnail_cache_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(CACHE_DIR_NAME);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// Cache key from path and mtime so cache invalidates when file changes.
/// Uses SipHash (std DefaultHasher) — 10x faster than SHA-256 for this use case.
fn thumbnail_cache_key(path: &std::path::Path, size: u32) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let mtime = meta
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "mtime error".to_string())?
        .as_nanos();
    let path_str = path.to_string_lossy();
    let mut hasher = DefaultHasher::new();
    path_str.as_ref().hash(&mut hasher);
    mtime.hash(&mut hasher);
    size.hash(&mut hasher);
    let h = hasher.finish();
    Ok(format!("{:016x}", h))
}

// ============ Path-based thumbnail commands (asset protocol) ============

/// Ensures a thumbnail exists on disk and returns the cache file path.
/// The frontend converts this to an asset:// URL via `convertFileSrc()`,
/// letting the browser load images natively with hardware decoding and parallel fetch.
/// Async so decode/encode runs off the main thread and never blocks the UI or other IPC.
#[tauri::command]
pub async fn ensure_thumbnail(payload: GetThumbnailPayload) -> Result<String, String> {
    let size = clamp_thumb_edge(payload.size);
    tauri::async_runtime::spawn_blocking(move || {
        ensure_thumbnail_file(&payload.path, size)
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Deserialize)]
pub struct EnsureThumbnailsBatchPayload {
    pub paths: Vec<String>,
    #[serde(default)]
    pub size: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct ThumbnailPathResult {
    pub path: String,
    pub cache_path: Option<String>,
    pub error: Option<String>,
}

/// Generate/ensure thumbnails for multiple images in parallel. Returns cache file paths.
/// Async + spawn_blocking so the rayon fan-out never blocks the main thread.
#[tauri::command]
pub async fn ensure_thumbnails_batch(payload: EnsureThumbnailsBatchPayload) -> Result<Vec<ThumbnailPathResult>, String> {
    let size = clamp_thumb_edge(payload.size);
    tauri::async_runtime::spawn_blocking(move || {
        payload
            .paths
            .par_iter()
            .map(|path_str| match ensure_thumbnail_file(path_str, size) {
                Ok(cache_path) => ThumbnailPathResult {
                    path: path_str.clone(),
                    cache_path: Some(cache_path.to_string_lossy().into_owned()),
                    error: None,
                },
                Err(e) => ThumbnailPathResult {
                    path: path_str.clone(),
                    cache_path: None,
                    error: Some(e),
                },
            })
            .collect()
    })
    .await
    .map_err(|e: tauri::Error| e.to_string())
}

/// Returns the thumbnail cache directory path (for asset protocol scope configuration).
#[tauri::command]
pub fn get_thumbnail_cache_dir() -> Result<String, String> {
    let dir = thumbnail_cache_dir()?;
    Ok(dir.to_string_lossy().into_owned())
}

// ============ Original commands preserved for backward compat ============

#[derive(Debug, Deserialize)]
pub struct CropImagePayload {
    pub image_path: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub flip_x: bool,
    #[serde(default)]
    pub flip_y: bool,
    #[serde(default)]
    pub rotate_degrees: i32,
    /// If true, save cropped image to a new file (keeps original). Returns new path.
    #[serde(default)]
    pub save_as_new: bool,
    /// If set, resize output to this size (square) for LoRA/training (e.g. 512 or 1024).
    #[serde(default)]
    pub output_size: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct GetThumbnailPayload {
    pub path: String,
    #[serde(default)]
    pub size: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct GetImageDataUrlPayload {
    pub path: String,
    /// Max length of the longest side (for preview); 0 = full size.
    #[serde(default)]
    pub max_side: Option<u32>,
}

/// Load image from path and return as data URL (for preview/crop so webview doesn't need asset protocol).
#[tauri::command]
pub async fn get_image_data_url(payload: GetImageDataUrlPayload) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || get_image_data_url_sync(payload))
        .await
        .map_err(|e| e.to_string())?
}

fn get_image_data_url_sync(payload: GetImageDataUrlPayload) -> Result<String, String> {
    let path = PathBuf::from(&payload.path);
    if !path.exists() || !path.is_file() {
        return Err("File not found".to_string());
    }

    let mut img = image::open(&path).map_err(|e| e.to_string())?;
    let max_side = payload.max_side.unwrap_or(0);
    if max_side > 0 {
        let (w, h) = (img.width(), img.height());
        let longest = w.max(h);
        if longest > max_side {
            let scale = max_side as f32 / longest as f32;
            let new_w = (w as f32 * scale).round() as u32;
            let new_h = (h as f32 * scale).round() as u32;
            img = img.resize(new_w, new_h, FilterType::Triangle);
        }
    }

    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;
    let b64 = BASE64.encode(&buf);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

/// Crop (and optionally flip/rotate) an image. Overwrites the file unless save_as_new is true.
/// Returns Some(new_path) when save_as_new is true, None otherwise.
#[tauri::command]
pub async fn crop_image(payload: CropImagePayload) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || crop_image_sync(payload))
        .await
        .map_err(|e| e.to_string())?
}

fn crop_image_sync(payload: CropImagePayload) -> Result<Option<String>, String> {
    let path = PathBuf::from(&payload.image_path);
    if !path.exists() || !path.is_file() {
        return Err("Image file not found".to_string());
    }

    let img = image::open(&path).map_err(|e| e.to_string())?;

    let (w, h) = (img.width(), img.height());
    let x = payload.x.min(w.saturating_sub(1));
    let y = payload.y.min(h.saturating_sub(1));
    let cw = payload.width.min(w.saturating_sub(x));
    let ch = payload.height.min(h.saturating_sub(y));

    if cw == 0 || ch == 0 {
        return Err("Crop region has zero size".to_string());
    }

    // Crop first (in original image coordinates), then apply flip/rotate to the cropped result
    let cropped_sub = img.crop_imm(x, y, cw, ch);
    let mut out_img = image::DynamicImage::from(cropped_sub.to_rgb8());

    if payload.flip_x {
        out_img = out_img.fliph();
    }
    if payload.flip_y {
        out_img = out_img.flipv();
    }

    let rot = ((payload.rotate_degrees % 360 + 360) % 360) / 90;
    for _ in 0..rot {
        out_img = out_img.rotate90();
    }

    // Optional: resize to training size (square) for LoRA
    if let Some(sz) = payload.output_size.filter(|&s| s >= 64 && s <= 2048) {
        out_img = out_img.resize(sz, sz, FilterType::Triangle);
    }

    let format = ImageFormat::from_path(&path).unwrap_or(ImageFormat::Png);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let out_path: PathBuf = if payload.save_as_new {
        let parent = path.parent().unwrap_or_else(|| path.as_path());
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
        let mut n = 1u32;
        loop {
            let name = format!("{}_{}_crop.{}", stem, n, ext);
            let candidate = parent.join(&name);
            if !candidate.exists() {
                break candidate;
            }
            n += 1;
            if n > 9999 {
                return Err("Could not create unique filename for new image".to_string());
            }
        }
    } else {
        path.clone()
    };

    let mut file = std::io::BufWriter::new(
        std::fs::File::create(&out_path).map_err(|e| e.to_string())?,
    );
    out_img
        .write_to(&mut file, format)
        .map_err(|e| e.to_string())?;

    // When saving as new, copy the source caption to the new image so LoRA workflow keeps tags
    if payload.save_as_new {
        let caption_path = path.with_extension("txt");
        if caption_path.exists() {
            if let Ok(content) = fs::read_to_string(&caption_path) {
                let out_txt = out_path.with_extension("txt");
                let _ = fs::write(out_txt, content.trim());
            }
        }
    }

    Ok(if payload.save_as_new {
        Some(out_path.to_string_lossy().into_owned())
    } else {
        None
    })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BatchResizeMode {
    Resize,
    CenterCrop,
    Fit,
}

#[derive(Debug, serde::Deserialize)]
pub struct BatchResizePayload {
    pub image_paths: Vec<String>,
    pub target_size: u32,
    pub mode: BatchResizeMode,
    pub output_folder: String,
}

#[derive(Debug, serde::Serialize)]
pub struct BatchResizeResult {
    pub processed_count: usize,
    pub skipped_count: usize,
    pub output_paths: Vec<String>,
    pub error: Option<String>,
}

/// Batch resize/preprocess images to target size. Outputs to specified folder, copies captions.
#[tauri::command]
pub async fn batch_resize(payload: BatchResizePayload) -> Result<BatchResizeResult, String> {
    tauri::async_runtime::spawn_blocking(move || batch_resize_sync(payload))
        .await
        .map_err(|e| e.to_string())?
}

fn batch_resize_sync(payload: BatchResizePayload) -> Result<BatchResizeResult, String> {
    if payload.target_size < 64 || payload.target_size > 2048 {
        return Err("Target size must be between 64 and 2048".to_string());
    }
    let target = payload.target_size;

    let out_dir = PathBuf::from(&payload.output_folder);
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let mut processed = 0usize;
    let mut skipped = 0usize;
    let mut output_paths = Vec::new();

    for (i, img_path_str) in payload.image_paths.iter().enumerate() {
        let path = PathBuf::from(img_path_str);
        if !path.exists() || !path.is_file() {
            skipped += 1;
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let new_name = format!("{:04}.{}", i + 1, ext);
        let out_img = out_dir.join(&new_name);
        let base = new_name.rsplit_once('.').map(|n| n.0).unwrap_or(&new_name);
        let out_txt = out_dir.join(format!("{}.txt", base));

        let img = match image::open(&path) {
            Ok(i) => i,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        let (w, h) = (img.width(), img.height());
        let out_img_dyn: image::DynamicImage = match &payload.mode {
            BatchResizeMode::Resize => img.resize(target, target, FilterType::Triangle),
            BatchResizeMode::CenterCrop => {
                let min_side = w.min(h);
                let crop_size = min_side.min(target);
                let x = (w - crop_size) / 2;
                let y = (h - crop_size) / 2;
                let cropped = img.crop_imm(x, y, crop_size, crop_size);
                let cropped_dyn = image::DynamicImage::from(cropped.to_rgb8());
                cropped_dyn.resize(target, target, FilterType::Triangle)
            }
            BatchResizeMode::Fit => {
                let longest = w.max(h);
                if longest <= target {
                    img
                } else {
                    let scale = target as f32 / longest as f32;
                    let new_w = (w as f32 * scale).round() as u32;
                    let new_h = (h as f32 * scale).round() as u32;
                    img.resize(new_w, new_h, FilterType::Triangle)
                }
            }
        };

        let format = ImageFormat::from_path(&path).unwrap_or(ImageFormat::Png);
        let mut out_file = fs::File::create(&out_img).map_err(|e| e.to_string())?;
        if out_img_dyn.write_to(&mut out_file, format).is_err() {
            skipped += 1;
            continue;
        }

        // Copy caption if exists
        let caption_path = path.with_extension("txt");
        if caption_path.exists() {
            if let Ok(content) = fs::read_to_string(&caption_path) {
                let _ = fs::write(&out_txt, content.trim());
            }
        }

        output_paths.push(out_img.to_string_lossy().into_owned());
        processed += 1;
    }

    Ok(BatchResizeResult {
        processed_count: processed,
        skipped_count: skipped,
        output_paths,
        error: None,
    })
}

/// Delete an image file and its caption .txt from disk.
#[tauri::command]
pub fn delete_image(image_path: String) -> Result<(), String> {
    let path = PathBuf::from(&image_path);
    if !path.exists() || !path.is_file() {
        return Err("Image file not found".to_string());
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    let txt_path = path.with_extension("txt");
    if txt_path.exists() && txt_path.is_file() {
        let _ = std::fs::remove_file(&txt_path);
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub suffix: String, // "_full", "_med", "_close"
}

#[derive(Debug, Deserialize)]
pub struct MultiCropPayload {
    pub image_path: String,
    pub crops: Vec<CropRect>,
    #[serde(default)]
    pub flip_x: bool,
    #[serde(default)]
    pub flip_y: bool,
    #[serde(default)]
    pub rotate_degrees: i32,
    #[serde(default)]
    pub output_size: Option<u32>,
}

/// Crop an image multiple times with different regions, saving each with a suffix.
/// Returns Vec of output paths.
#[tauri::command]
pub async fn multi_crop(payload: MultiCropPayload) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || multi_crop_sync(payload))
        .await
        .map_err(|e| e.to_string())?
}

fn multi_crop_sync(payload: MultiCropPayload) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&payload.image_path);
    if !path.exists() || !path.is_file() {
        return Err("Image file not found".to_string());
    }

    let img = image::open(&path).map_err(|e| e.to_string())?;
    let (img_w, img_h) = (img.width(), img.height());
    let format = ImageFormat::from_path(&path).unwrap_or(ImageFormat::Png);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let parent = path.parent().unwrap_or_else(|| path.as_path());
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");

    let mut output_paths = Vec::new();

    for crop in &payload.crops {
        let x = crop.x.min(img_w.saturating_sub(1));
        let y = crop.y.min(img_h.saturating_sub(1));
        let cw = crop.width.min(img_w.saturating_sub(x));
        let ch = crop.height.min(img_h.saturating_sub(y));

        if cw == 0 || ch == 0 {
            continue; // skip invalid crops
        }

        let cropped_sub = img.crop_imm(x, y, cw, ch);
        let mut out_img = image::DynamicImage::from(cropped_sub.to_rgb8());

        if payload.flip_x {
            out_img = out_img.fliph();
        }
        if payload.flip_y {
            out_img = out_img.flipv();
        }

        let rot = ((payload.rotate_degrees % 360 + 360) % 360) / 90;
        for _ in 0..rot {
            out_img = out_img.rotate90();
        }

        if let Some(sz) = payload.output_size.filter(|&s| s >= 64 && s <= 2048) {
            out_img = out_img.resize(sz, sz, FilterType::Triangle);
        }

        let out_name = format!("{}{}.{}", stem, crop.suffix, ext);
        let out_path = parent.join(&out_name);

        let mut file = std::io::BufWriter::new(
            std::fs::File::create(&out_path).map_err(|e| e.to_string())?,
        );
        out_img
            .write_to(&mut file, format)
            .map_err(|e| e.to_string())?;

        // Copy caption to new file with suffix
        let caption_path = path.with_extension("txt");
        if caption_path.exists() {
            if let Ok(content) = fs::read_to_string(&caption_path) {
                let out_txt = out_path.with_extension("txt");
                let _ = fs::write(out_txt, content.trim());
            }
        }

        output_paths.push(out_path.to_string_lossy().into_owned());
    }

    if output_paths.is_empty() {
        return Err("No valid crops processed".to_string());
    }

    Ok(output_paths)
}

