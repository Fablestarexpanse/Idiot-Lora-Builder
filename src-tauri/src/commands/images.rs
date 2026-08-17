//! Image operations: thumbnail generation/caching, previews, crop/multi-crop,
//! batch resize, and image deletion (with caption sidecar handling).

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

use super::common::caption_path_for;

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

// ============ Original commands preserved for backward compat ============

// ---- Shared crop pipeline helpers (used by crop_image, multi_crop, batch_resize) ----

/// Read the EXIF Orientation tag (1..=8) from a file; 1 (normal) on any failure.
fn read_exif_orientation(path: &Path) -> u32 {
    (|| {
        let file = fs::File::open(path).ok()?;
        let mut reader = BufReader::new(file);
        let exif = Reader::new().read_from_container(&mut reader).ok()?;
        exif.get_field(Tag::Orientation, In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
    })()
    .unwrap_or(1)
}

/// Apply the standard 8-case EXIF orientation transform so crops operate in
/// display space rather than sensor space (phone photos are often stored rotated).
fn apply_exif_orientation(img: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

/// Open an image and apply its EXIF orientation (for crop paths; the thumbnail
/// pipeline intentionally does not go through here).
fn open_oriented(path: &Path) -> Result<DynamicImage, String> {
    let img = image::open(path).map_err(|e| e.to_string())?;
    Ok(apply_exif_orientation(img, read_exif_orientation(path)))
}

/// Resize to a square training size with Lanczos3, but never upscale: if the
/// longest side already fits within `output_size`, the image is returned as-is.
fn resize_for_output(img: DynamicImage, output_size: Option<u32>) -> DynamicImage {
    if let Some(sz) = output_size.filter(|&s| (64..=2048).contains(&s)) {
        let longest = img.width().max(img.height());
        if longest > sz {
            return img.resize(sz, sz, FilterType::Lanczos3);
        }
    }
    img
}

/// Crop (clamped to image bounds), then flip/rotate, then optional no-upscale
/// resize. Keeps the image in its native color type so alpha is preserved.
/// Returns None when the clamped crop region has zero size.
#[allow(clippy::too_many_arguments)]
fn process_crop(
    img: &DynamicImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    flip_x: bool,
    flip_y: bool,
    rotate_degrees: i32,
    output_size: Option<u32>,
) -> Option<DynamicImage> {
    let (w, h) = (img.width(), img.height());
    let x = x.min(w.saturating_sub(1));
    let y = y.min(h.saturating_sub(1));
    let cw = width.min(w.saturating_sub(x));
    let ch = height.min(h.saturating_sub(y));
    if cw == 0 || ch == 0 {
        return None;
    }

    // Crop first (in image coordinates), then apply flip/rotate to the cropped result
    let mut out = img.crop_imm(x, y, cw, ch);

    if flip_x {
        out = out.fliph();
    }
    if flip_y {
        out = out.flipv();
    }

    let rot = ((rotate_degrees % 360 + 360) % 360) / 90;
    for _ in 0..rot {
        out = out.rotate90();
    }

    Some(resize_for_output(out, output_size))
}

/// Write a processed image. JPEG is encoded explicitly at quality 92 (and
/// converted to RGB only there, since JPEG cannot carry alpha); every other
/// format keeps the native color type via `write_to`.
fn write_cropped(img: &DynamicImage, out_path: &Path, format: ImageFormat) -> Result<(), String> {
    let file = std::fs::File::create(out_path).map_err(|e| e.to_string())?;
    let mut writer = std::io::BufWriter::new(file);
    if format == ImageFormat::Jpeg {
        let rgb = img.to_rgb8();
        let mut enc = JpegEncoder::new_with_quality(&mut writer, 92);
        enc.encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| e.to_string())
    } else {
        img.write_to(&mut writer, format).map_err(|e| e.to_string())
    }
}

/// Find a non-existing output path by trying `name_for(start)`, `name_for(start+1)`, ...
fn unique_output_path(
    parent: &Path,
    start: u32,
    mut name_for: impl FnMut(u32) -> String,
) -> Result<PathBuf, String> {
    let mut n = start;
    loop {
        let candidate = parent.join(name_for(n));
        if !candidate.exists() {
            return Ok(candidate);
        }
        n += 1;
        if n > 9999 {
            return Err("Could not create unique filename for new image".to_string());
        }
    }
}

/// Copy the source image's caption sidecar (trimmed) to the output image, if present.
fn copy_caption_sidecar(src_image: &Path, dst_image: &Path) {
    let caption_path = caption_path_for(src_image);
    if caption_path.exists() {
        if let Ok(content) = fs::read_to_string(&caption_path) {
            let _ = fs::write(caption_path_for(dst_image), content.trim());
        }
    }
}

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

    let img = open_oriented(&path)?;

    let out_img = process_crop(
        &img,
        payload.x,
        payload.y,
        payload.width,
        payload.height,
        payload.flip_x,
        payload.flip_y,
        payload.rotate_degrees,
        payload.output_size,
    )
    .ok_or_else(|| "Crop region has zero size".to_string())?;

    let format = ImageFormat::from_path(&path).unwrap_or(ImageFormat::Png);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let out_path: PathBuf = if payload.save_as_new {
        let parent = path.parent().unwrap_or_else(|| path.as_path());
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
        unique_output_path(parent, 1, |n| format!("{}_{}_crop.{}", stem, n, ext))?
    } else {
        path.clone()
    };

    write_cropped(&out_img, &out_path, format)?;

    // When saving as new, copy the source caption to the new image so LoRA workflow keeps tags
    if payload.save_as_new {
        copy_caption_sidecar(&path, &out_path);
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
            BatchResizeMode::Resize => img.resize(target, target, FilterType::Lanczos3),
            BatchResizeMode::CenterCrop => {
                // Crop the FULL center square (side = min(w, h)), then resize to target.
                let crop_size = w.min(h);
                let x = (w - crop_size) / 2;
                let y = (h - crop_size) / 2;
                let cropped = img.crop_imm(x, y, crop_size, crop_size);
                if crop_size == target {
                    cropped
                } else {
                    cropped.resize(target, target, FilterType::Lanczos3)
                }
            }
            BatchResizeMode::Fit => {
                let longest = w.max(h);
                if longest <= target {
                    img
                } else {
                    let scale = target as f32 / longest as f32;
                    let new_w = (w as f32 * scale).round() as u32;
                    let new_h = (h as f32 * scale).round() as u32;
                    img.resize(new_w, new_h, FilterType::Lanczos3)
                }
            }
        };

        let format = ImageFormat::from_path(&path).unwrap_or(ImageFormat::Png);
        if write_cropped(&out_img_dyn, &out_img, format).is_err() {
            skipped += 1;
            continue;
        }

        // Copy caption if exists
        let caption_path = caption_path_for(&path);
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

/// Delete a single image file and its caption .txt from disk (shared by the
/// single and batch delete commands).
fn delete_image_file(image_path: &str) -> Result<(), String> {
    let path = PathBuf::from(image_path);
    if !path.exists() || !path.is_file() {
        return Err("Image file not found".to_string());
    }
    // NOTE: the image's crop_status.json entry is not pruned here — this function
    // only receives the absolute image path, not the project root needed to locate
    // the `.lora-studio/crop_status.json` sidecar. Stale entries are harmless
    // (lookups are keyed by existing images) and get dropped on clear-all.
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    let txt_path = caption_path_for(&path);
    if txt_path.exists() && txt_path.is_file() {
        let _ = std::fs::remove_file(&txt_path);
    }
    Ok(())
}

/// Delete an image file and its caption .txt from disk.
#[tauri::command]
pub fn delete_image(image_path: String) -> Result<(), String> {
    delete_image_file(&image_path)
}

#[derive(Debug, Deserialize)]
pub struct DeleteImagesPayload {
    pub paths: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DeleteImagesResult {
    pub deleted_count: usize,
    pub errors: Vec<String>,
}

/// Delete multiple images (and their caption .txt sidecars) from disk.
/// Per-path failures are collected as error strings; the command itself only
/// fails on task-join errors.
#[tauri::command]
pub async fn delete_images(payload: DeleteImagesPayload) -> Result<DeleteImagesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut deleted_count = 0usize;
        let mut errors = Vec::new();
        for path in &payload.paths {
            match delete_image_file(path) {
                Ok(()) => deleted_count += 1,
                Err(e) => errors.push(format!("{path}: {e}")),
            }
        }
        DeleteImagesResult {
            deleted_count,
            errors,
        }
    })
    .await
    .map_err(|e| e.to_string())
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

    let img = open_oriented(&path)?;
    let format = ImageFormat::from_path(&path).unwrap_or(ImageFormat::Png);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let parent = path.parent().unwrap_or_else(|| path.as_path());
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");

    let mut output_paths = Vec::new();

    for crop in &payload.crops {
        let out_img = match process_crop(
            &img,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            payload.flip_x,
            payload.flip_y,
            payload.rotate_degrees,
            payload.output_size,
        ) {
            Some(i) => i,
            None => continue, // skip invalid crops
        };

        // Never clobber existing files: {stem}{suffix}.{ext}, then {stem}{suffix}_1.{ext}, ...
        let out_path = unique_output_path(parent, 0, |n| {
            if n == 0 {
                format!("{}{}.{}", stem, crop.suffix, ext)
            } else {
                format!("{}{}_{}.{}", stem, crop.suffix, n, ext)
            }
        })?;

        write_cropped(&out_img, &out_path, format)?;

        // Copy caption to new file with suffix
        copy_caption_sidecar(&path, &out_path);

        output_paths.push(out_path.to_string_lossy().into_owned());
    }

    if output_paths.is_empty() {
        return Err("No valid crops processed".to_string());
    }

    Ok(output_paths)
}


#[cfg(test)]
mod tests {
    use super::*;

    // ---- clamp_thumb_edge ----

    #[test]
    fn clamp_thumb_edge_default_when_none() {
        assert_eq!(clamp_thumb_edge(None), THUMB_SIZE);
    }

    #[test]
    fn clamp_thumb_edge_clamps_low_and_high() {
        assert_eq!(clamp_thumb_edge(Some(1)), 32);
        assert_eq!(clamp_thumb_edge(Some(0)), 32);
        assert_eq!(clamp_thumb_edge(Some(999_999)), THUMB_MAX_EDGE);
    }

    #[test]
    fn clamp_thumb_edge_passes_through_valid_sizes() {
        assert_eq!(clamp_thumb_edge(Some(256)), 256);
        assert_eq!(clamp_thumb_edge(Some(32)), 32);
        assert_eq!(clamp_thumb_edge(Some(THUMB_MAX_EDGE)), THUMB_MAX_EDGE);
    }

    // ---- jpeg_quality_for_size ----

    #[test]
    fn jpeg_quality_small_vs_large() {
        assert_eq!(jpeg_quality_for_size(64), JPEG_QUALITY_SMALL);
        assert_eq!(jpeg_quality_for_size(JPEG_QUALITY_THRESHOLD), JPEG_QUALITY_SMALL);
        assert_eq!(jpeg_quality_for_size(JPEG_QUALITY_THRESHOLD + 1), JPEG_QUALITY_LARGE);
        assert_eq!(jpeg_quality_for_size(1536), JPEG_QUALITY_LARGE);
    }

    // ---- resize_for_output (no-upscale guard) ----

    fn test_img(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgb8(image::RgbImage::new(w, h))
    }

    #[test]
    fn resize_never_upscales() {
        // 100x80 with output_size 512: already fits, returned unchanged.
        let out = resize_for_output(test_img(100, 80), Some(512));
        assert_eq!((out.width(), out.height()), (100, 80));
    }

    #[test]
    fn resize_downscales_longest_side_to_target() {
        // 1024x512 with output_size 512: longest side shrinks to 512, aspect kept.
        let out = resize_for_output(test_img(1024, 512), Some(512));
        assert_eq!((out.width(), out.height()), (512, 256));
    }

    #[test]
    fn resize_none_is_noop() {
        let out = resize_for_output(test_img(3000, 2000), None);
        assert_eq!((out.width(), out.height()), (3000, 2000));
    }

    #[test]
    fn resize_out_of_range_size_is_ignored() {
        // Sizes outside 64..=2048 are ignored (no resize).
        let out = resize_for_output(test_img(3000, 2000), Some(63));
        assert_eq!((out.width(), out.height()), (3000, 2000));
        let out = resize_for_output(test_img(3000, 2000), Some(4096));
        assert_eq!((out.width(), out.height()), (3000, 2000));
    }

    #[test]
    fn resize_exact_fit_is_unchanged() {
        let out = resize_for_output(test_img(512, 512), Some(512));
        assert_eq!((out.width(), out.height()), (512, 512));
    }

    // ---- process_crop (pure: crop clamp + zero-size guard) ----

    #[test]
    fn process_crop_zero_size_region_is_none() {
        let img = test_img(100, 100);
        assert!(process_crop(&img, 0, 0, 0, 10, false, false, 0, None).is_none());
        assert!(process_crop(&img, 0, 0, 10, 0, false, false, 0, None).is_none());
    }

    #[test]
    fn process_crop_clamps_to_bounds() {
        let img = test_img(100, 100);
        // Region extends past the right/bottom edge: clamped, not an error.
        let out = process_crop(&img, 90, 90, 50, 50, false, false, 0, None).unwrap();
        assert_eq!((out.width(), out.height()), (10, 10));
    }

    #[test]
    fn process_crop_rotation_swaps_dimensions() {
        let img = test_img(100, 50);
        let out = process_crop(&img, 0, 0, 100, 50, false, false, 90, None).unwrap();
        assert_eq!((out.width(), out.height()), (50, 100));
        // Negative rotation normalizes (-90 == 270).
        let out = process_crop(&img, 0, 0, 100, 50, false, false, -90, None).unwrap();
        assert_eq!((out.width(), out.height()), (50, 100));
    }

    #[test]
    fn process_crop_no_upscale_via_output_size() {
        let img = test_img(200, 200);
        // Crop 100x100, request output 512: must NOT upscale.
        let out = process_crop(&img, 0, 0, 100, 100, false, false, 0, Some(512)).unwrap();
        assert_eq!((out.width(), out.height()), (100, 100));
    }
}
