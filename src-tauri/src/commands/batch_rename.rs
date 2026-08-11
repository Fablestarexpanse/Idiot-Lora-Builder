//! Batch rename image files (and their .txt caption files) with a prefix and sequential index.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use tauri::Emitter;

fn caption_path_for(image_path: &Path) -> PathBuf {
    image_path.with_extension("txt")
}

/// Normalize a relative path to forward slashes so metadata map keys compare
/// consistently regardless of which separator the caller used.
fn normalize_rel(path: &str) -> String {
    path.replace('\\', "/")
}

#[derive(Debug, Deserialize)]
pub struct BatchRenamePayload {
    pub root_path: String,
    /// Relative paths of images to rename (from project root).
    pub relative_paths: Vec<String>,
    /// Prefix for new filenames (e.g. "img" -> img_0001.png).
    pub prefix: String,
    /// Starting index (1-based).
    pub start_index: u32,
    /// Zero-pad index to this many digits (e.g. 4 -> 0001, 0002).
    pub zero_pad: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchRenameResult {
    pub success: bool,
    pub renamed_count: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchRenameProgress {
    pub current: u32,
    pub total: u32,
    pub current_file: String,
}

fn load_json_map(path: &Path) -> Result<HashMap<String, String>, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(HashMap::new());
        }
        Err(e) => return Err(format!("Failed to read {}: {}", path.display(), e)),
    };
    let data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
    if let Some(obj) = data.as_object() {
        if let Some(map_val) = obj.get("ratings").or_else(|| obj.get("statuses")) {
            if let Some(map) = map_val.as_object() {
                let mut result = HashMap::new();
                for (k, v) in map {
                    if let Some(s) = v.as_str() {
                        result.insert(normalize_rel(k), s.to_string());
                    }
                }
                return Ok(result);
            }
        }
    }
    Ok(HashMap::new())
}

fn save_json_map(path: &Path, map: &HashMap<String, String>, key: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("No parent directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let mut obj = serde_json::Map::new();
    let mut inner = serde_json::Map::new();
    for (k, v) in map {
        inner.insert(k.clone(), serde_json::Value::String(v.clone()));
    }
    obj.insert(key.to_string(), serde_json::Value::Object(inner));

    let content = serde_json::to_string_pretty(&obj).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

/// Renames image files and their caption files with prefix + zero-padded index.
/// Also updates ratings and crop_status files to maintain metadata.
/// Rejects any relative_path that resolves outside the project root (path traversal safety).
#[tauri::command]
pub async fn batch_rename(
    payload: BatchRenamePayload,
    window: tauri::Window,
) -> Result<BatchRenameResult, String> {
    tauri::async_runtime::spawn_blocking(move || batch_rename_sync(payload, window))
        .await
        .map_err(|e| e.to_string())?
}

fn batch_rename_sync(
    payload: BatchRenamePayload,
    window: tauri::Window,
) -> Result<BatchRenameResult, String> {
    let root = PathBuf::from(&payload.root_path);
    if !root.exists() || !root.is_dir() {
        return Err("Root path does not exist or is not a directory".to_string());
    }

    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;

    let prefix = payload.prefix.trim();
    if prefix.is_empty() {
        return Err("Prefix cannot be empty".to_string());
    }

    let zero_pad = payload.zero_pad.max(1).min(12);
    let mut index = payload.start_index;
    let mut errors = Vec::new();
    let mut renamed = 0u32;

    // Load ratings and crop status files. A corrupt file aborts the whole batch
    // before any renames, so it can't be silently overwritten with partial data.
    let ratings_path = root.join(".lora-studio").join("ratings.json");
    let crop_status_path = root.join(".lora-studio").join("crop_status.json");
    let mut ratings = load_json_map(&ratings_path)?;
    let mut crop_statuses = load_json_map(&crop_status_path)?;

    // Pre-flight collision check: compute every target name up front and fail
    // cleanly (before any rename) if a target collides with another target or
    // with an existing file that is not itself a rename source.
    {
        let mut sources: HashSet<PathBuf> = HashSet::new();
        for relative_path in &payload.relative_paths {
            let rel_normalized = relative_path.replace('/', std::path::MAIN_SEPARATOR_STR);
            let old_path = root.join(&rel_normalized);
            sources.insert(caption_path_for(&old_path));
            sources.insert(old_path);
        }

        let mut targets_seen: HashSet<PathBuf> = HashSet::new();
        let mut preflight_index = payload.start_index;
        for relative_path in &payload.relative_paths {
            let rel_normalized = relative_path.replace('/', std::path::MAIN_SEPARATOR_STR);
            let old_path = root.join(&rel_normalized);

            let ext = old_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png")
                .to_string();
            let new_name = format!(
                "{}_{:0width$}.{}",
                prefix,
                preflight_index,
                ext,
                width = zero_pad as usize
            );
            let parent = old_path.parent().unwrap_or(&root);
            let new_path = parent.join(&new_name);
            let caption_new = new_path.with_extension("txt");
            preflight_index += 1;

            if !targets_seen.insert(new_path.clone()) {
                return Err(format!(
                    "Rename would produce duplicate target name: {}",
                    new_name
                ));
            }
            if new_path != old_path && new_path.exists() && !sources.contains(&new_path) {
                return Err(format!(
                    "Target already exists and is not part of the rename: {}",
                    new_name
                ));
            }
            if caption_new != caption_path_for(&old_path)
                && caption_new.exists()
                && !sources.contains(&caption_new)
            {
                return Err(format!(
                    "Caption target already exists and is not part of the rename: {}",
                    caption_new.display()
                ));
            }
        }
    }

    // Track path mappings for updating metadata
    let mut path_mappings: Vec<(String, String)> = Vec::new();

    let total = payload.relative_paths.len() as u32;
    let mut current = 0u32;

    for relative_path in &payload.relative_paths {
        current += 1;

        // Emit progress event
        let _ = window.emit(
            "batch-rename-progress",
            BatchRenameProgress {
                current,
                total,
                current_file: relative_path.clone(),
            },
        );
        let rel_normalized = relative_path.replace('/', std::path::MAIN_SEPARATOR_STR);
        let old_path = root.join(&rel_normalized);

        if !old_path.exists() || !old_path.is_file() {
            errors.push(format!("Not found: {}", relative_path));
            index += 1;
            continue;
        }

        // Path traversal safety: resolved path must be under project root
        let old_canonical = match old_path.canonicalize() {
            Ok(p) => p,
            Err(e) => {
                errors.push(format!("Invalid path {}: {}", relative_path, e));
                index += 1;
                continue;
            }
        };
        if old_canonical.strip_prefix(&canonical_root).is_err() {
            errors.push(format!("Path outside project: {}", relative_path));
            index += 1;
            continue;
        }

        let ext = old_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png")
            .to_string();
        let new_name = format!("{}_{:0width$}.{}", prefix, index, ext, width = zero_pad as usize);
        let parent = old_path.parent().unwrap_or(&root);
        let new_path = parent.join(&new_name);

        if new_path == old_path {
            index += 1;
            renamed += 1;
            continue;
        }

        if new_path.exists() {
            errors.push(format!("Target already exists: {}", new_name));
            index += 1;
            continue;
        }

        if let Err(e) = fs::rename(&old_path, &new_path) {
            errors.push(format!("Rename {}: {}", relative_path, e));
            index += 1;
            continue;
        }

        let caption_old = caption_path_for(&old_path);
        let caption_new = new_path.with_extension("txt");
        let mut ok = true;
        if caption_old.exists() {
            if caption_new.exists() {
                errors.push(format!("Caption target exists: {}", new_name));
                if let Err(re) = fs::rename(&new_path, &old_path) {
                    errors.push(format!(
                        "Rollback failed for {}: {} (image is now named {} but its caption was not renamed — files are in an inconsistent state)",
                        relative_path, re, new_name
                    ));
                }
                ok = false;
            } else if fs::rename(&caption_old, &caption_new).is_err() {
                errors.push(format!("Failed to rename caption for: {}", relative_path));
                if let Err(re) = fs::rename(&new_path, &old_path) {
                    errors.push(format!(
                        "Rollback failed for {}: {} (image is now named {} but its caption was not renamed — files are in an inconsistent state)",
                        relative_path, re, new_name
                    ));
                }
                ok = false;
            }
        }
        if ok {
            renamed += 1;
            // Track the path mapping for metadata updates (normalized to '/')
            let new_relative = new_path.strip_prefix(&root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| new_name.clone());
            path_mappings.push((normalize_rel(relative_path), normalize_rel(&new_relative)));
        }
        index += 1;
    }

    // Update ratings file with new paths
    if !path_mappings.is_empty() {
        let mut updated_ratings = HashMap::new();
        for (old_path, new_path) in &path_mappings {
            if let Some(rating) = ratings.remove(old_path) {
                updated_ratings.insert(new_path.clone(), rating);
            }
        }
        // Keep any ratings for files that weren't renamed
        for (k, v) in ratings {
            updated_ratings.insert(k, v);
        }

        if let Err(e) = save_json_map(&ratings_path, &updated_ratings, "ratings") {
            errors.push(format!("Failed to update ratings file: {}", e));
        }

        // Update crop_status file with new paths
        let mut updated_crop_statuses = HashMap::new();
        for (old_path, new_path) in &path_mappings {
            if let Some(status) = crop_statuses.remove(old_path) {
                updated_crop_statuses.insert(new_path.clone(), status);
            }
        }
        // Keep any statuses for files that weren't renamed
        for (k, v) in crop_statuses {
            updated_crop_statuses.insert(k, v);
        }

        if let Err(e) = save_json_map(&crop_status_path, &updated_crop_statuses, "statuses") {
            errors.push(format!("Failed to update crop_status file: {}", e));
        }
    }

    Ok(BatchRenameResult {
        success: errors.is_empty(),
        renamed_count: renamed,
        errors,
    })
}
