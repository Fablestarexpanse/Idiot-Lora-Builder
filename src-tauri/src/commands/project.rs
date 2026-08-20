//! Project scanning: open a dataset folder, list images with caption/rating
//! metadata, find duplicates by content hash, and load image dimensions.

use image::ImageReader;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use super::common::{caption_path_for, is_image_path, normalize_rel_key};
use super::crop_status::load_crop_statuses;
use super::ratings::{load_ratings, ImageRating};

const PROGRESS_EVENT: &str = "project-load-progress";

/// Parse comma-separated tags from raw caption text.
fn parse_tags(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct OpenProjectPayload {
    pub root_path: String,
    #[serde(default = "default_false")]
    pub include_dimensions: bool,
}

fn default_false() -> bool {
    false
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageEntry {
    pub id: String,
    pub path: String,
    pub relative_path: String,
    pub filename: String,
    pub has_caption: bool,
    pub tags: Vec<String>,
    pub rating: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crop_status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ProjectLoadProgress {
    count: usize,
}

/// Opens a project at the given root path. Scans recursively for image files.
/// Emits progress events as images are discovered.
/// Async + spawn_blocking so large scans never block the main thread; per-image work
/// (caption read, metadata, optional dimensions) runs in parallel via rayon.
#[tauri::command]
pub async fn open_project(app: AppHandle, payload: OpenProjectPayload) -> Result<Vec<ImageEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || open_project_sync(app, payload))
        .await
        .map_err(|e| e.to_string())?
}

fn open_project_sync(app: AppHandle, payload: OpenProjectPayload) -> Result<Vec<ImageEntry>, String> {
    let root = PathBuf::from(&payload.root_path);
    if !root.is_dir() {
        return Err("Folder does not exist or is not a folder".to_string());
    }

    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let ratings_data = load_ratings(&payload.root_path);
    // Load once; a missing sidecar yields the empty default. A corrupt file only
    // degrades to "no statuses" for display here — writers still refuse to clobber it.
    let crop_status_data = load_crop_statuses(&payload.root_path).unwrap_or_default();

    // Phase 1: fast sequential walk to collect image paths (directory traversal
    // doesn't parallelize well; the per-file work below is what's expensive).
    let image_paths: Vec<PathBuf> = WalkDir::new(&canonical_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_image_path(e.path()))
        .map(|e| e.into_path())
        .collect();

    // Phase 2: parallel per-image metadata (caption read, file size, optional dimensions)
    let progress = std::sync::atomic::AtomicUsize::new(0);
    let mut entries: Vec<ImageEntry> = image_paths
        .par_iter()
        .filter_map(|path_buf| {
            let path_str = path_buf.to_str()?.to_string();
            let relative = path_buf
                .strip_prefix(&canonical_root)
                .unwrap_or_else(|_| path_buf.as_path());
            let relative_path = normalize_rel_key(relative.to_str()?);
            let filename = path_buf
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            // Read caption file if it exists (single syscall — no exists() pre-check)
            let (has_caption, tags) = match fs::read_to_string(caption_path_for(path_buf)) {
                Ok(raw) => (true, parse_tags(&raw)),
                Err(_) => (false, Vec::new()),
            };

            let rating = ratings_data
                .ratings
                .get(&relative_path)
                .map(|s| ImageRating::from_str(s))
                .unwrap_or(ImageRating::None);

            // Read image dimensions (header only, fast) - optional for performance
            let (width, height) = if payload.include_dimensions {
                ImageReader::open(path_buf)
                    .ok()
                    .and_then(|r| r.into_dimensions().ok())
                    .unwrap_or((0u32, 0u32))
            } else {
                (0u32, 0u32)
            };

            let file_size = fs::metadata(path_buf).ok().map(|m| m.len()).filter(|&n| n > 0);

            let crop_status = crop_status_data.statuses.get(&relative_path).cloned();

            let done = progress.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            if done % 25 == 0 {
                let _ = app.emit(PROGRESS_EVENT, ProjectLoadProgress { count: done });
            }

            Some(ImageEntry {
                id: path_str.clone(),
                path: path_str,
                relative_path,
                filename,
                has_caption,
                tags,
                rating: rating.as_str().to_string(),
                width: if width > 0 { Some(width) } else { None },
                height: if height > 0 { Some(height) } else { None },
                file_size,
                crop_status,
            })
        })
        .collect();

    // Emit final count
    let _ = app.emit(PROGRESS_EVENT, ProjectLoadProgress { count: entries.len() });

    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

#[derive(Debug, Deserialize)]
pub struct FindDuplicatesPayload {
    pub root_path: String,
}

#[derive(Debug, Serialize)]
pub struct FindDuplicatesResult {
    pub groups: Vec<Vec<String>>,
}

/// Find duplicate images by file content hash (SHA-256). Returns groups of relative paths.
#[tauri::command]
pub async fn find_duplicates(payload: FindDuplicatesPayload) -> Result<FindDuplicatesResult, String> {
    tauri::async_runtime::spawn_blocking(move || find_duplicates_sync(payload))
        .await
        .map_err(|e| e.to_string())?
}

fn find_duplicates_sync(payload: FindDuplicatesPayload) -> Result<FindDuplicatesResult, String> {
    let root = PathBuf::from(&payload.root_path);
    if !root.exists() || !root.is_dir() {
        return Err("Folder does not exist".to_string());
    }
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;

    // Collect all image paths first. Walk from canonical so strip_prefix(canonical)
    // below always succeeds and the keys match how open_project stores relative_path.
    let image_paths: Vec<PathBuf> = WalkDir::new(&canonical_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|entry| {
            let path = entry.path();
            path.is_file() && is_image_path(path)
        })
        .map(|entry| entry.path().to_path_buf())
        .collect();

    // Parallel hash computation
    let hash_to_paths: Mutex<HashMap<String, Vec<String>>> = Mutex::new(HashMap::new());
    
    image_paths.par_iter().for_each(|path| {
        // Hash the file
        if let Ok(mut file) = fs::File::open(path) {
            let mut hasher = Sha256::new();
            let mut buf = [0u8; 8192];
            loop {
                match file.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => hasher.update(&buf[..n]),
                    Err(_) => return,
                }
            }
            let hash_hex = hex::encode(hasher.finalize());

            // Get relative path
            let relative = path
                .strip_prefix(&canonical_root)
                .unwrap_or(path);
            let rel_str = relative
                .to_str()
                .map(normalize_rel_key)
                .unwrap_or_default();
            
            if !rel_str.is_empty() {
                let mut map = hash_to_paths.lock().unwrap();
                map.entry(hash_hex)
                    .or_default()
                    .push(rel_str);
            }
        }
    });

    let hash_to_paths = hash_to_paths.into_inner().unwrap();
    let groups: Vec<Vec<String>> = hash_to_paths
        .into_values()
        .filter(|v| v.len() > 1)
        .collect();

    Ok(FindDuplicatesResult { groups })
}

#[derive(Debug, Deserialize)]
pub struct LoadImageDimensionsPayload {
    pub paths: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ImageDimensions {
    pub path: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Load image dimensions in parallel for a batch of images
#[tauri::command]
pub async fn load_image_dimensions(payload: LoadImageDimensionsPayload) -> Result<Vec<ImageDimensions>, String> {
    tauri::async_runtime::spawn_blocking(move || load_image_dimensions_sync(payload))
        .await
        .map_err(|e| e.to_string())?
}

fn load_image_dimensions_sync(payload: LoadImageDimensionsPayload) -> Result<Vec<ImageDimensions>, String> {
    let results: Vec<ImageDimensions> = payload
        .paths
        .par_iter()
        .map(|path_str| {
            let path = PathBuf::from(path_str);
            let (width, height) = ImageReader::open(&path)
                .ok()
                .and_then(|r| r.into_dimensions().ok())
                .unwrap_or((0u32, 0u32));
            
            ImageDimensions {
                path: path_str.clone(),
                width: if width > 0 { Some(width) } else { None },
                height: if height > 0 { Some(height) } else { None },
            }
        })
        .collect();

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};
    use std::path::Path;

    /// Writes a small image whose pixels vary with `seed`, so distinct seeds
    /// produce visibly distinct images (and distinct content hashes).
    fn write_image(path: &Path, seed: u8) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let img = ImageBuffer::from_fn(16, 16, |x, y| {
            Rgb([
                (x as u8).wrapping_mul(seed).wrapping_add(seed),
                (y as u8).wrapping_mul(seed),
                seed,
            ])
        });
        img.save(path).unwrap();
    }

    fn find_dupes(root: &str) -> Vec<Vec<String>> {
        find_duplicates_sync(FindDuplicatesPayload {
            root_path: root.to_string(),
        })
        .unwrap()
        .groups
    }

    fn assert_all_relative(keys: &[String]) {
        for key in keys {
            assert!(!Path::new(key).is_absolute(), "absolute key leaked: {key}");
            assert!(!key.contains(".."), "unresolved key leaked: {key}");
        }
    }

    #[test]
    fn duplicate_keys_stay_relative_for_a_non_canonical_root() {
        // Regression: the walk started at the raw root while strip_prefix used
        // the canonicalized one, so any root that isn't already canonical made
        // strip_prefix fail and fall back to the absolute path. On Windows
        // canonicalize() always returns a \\?\ path, so this failed *every*
        // time there; "dir/../dir" reproduces the same code path portably.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("ds");
        fs::create_dir_all(&root).unwrap();
        write_image(&root.join("a.png"), 3);
        fs::copy(root.join("a.png"), root.join("b.png")).unwrap();

        let non_canonical = root.join("..").join("ds");
        let groups = find_dupes(non_canonical.to_str().unwrap());

        assert_eq!(groups.len(), 1, "the two identical files should group");
        let mut keys = groups[0].clone();
        keys.sort();
        assert_eq!(keys, vec!["a.png".to_string(), "b.png".to_string()]);
        assert_all_relative(&keys);
    }

    #[test]
    fn duplicate_keys_are_relative_for_a_canonical_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        write_image(&root.join("top.png"), 5);
        write_image(&root.join("sub").join("copy.png"), 5);

        let groups = find_dupes(root.to_str().unwrap());
        assert_eq!(groups.len(), 1, "identical files in different folders group");
        let mut keys = groups[0].clone();
        keys.sort();
        assert_eq!(keys, vec!["sub/copy.png".to_string(), "top.png".to_string()],
                   "nested keys keep their folder and use forward slashes");
        assert_all_relative(&keys);
    }

    #[test]
    fn distinct_images_do_not_group() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        write_image(&root.join("a.png"), 1);
        write_image(&root.join("b.png"), 200);

        assert!(find_dupes(root.to_str().unwrap()).is_empty());
    }
}
