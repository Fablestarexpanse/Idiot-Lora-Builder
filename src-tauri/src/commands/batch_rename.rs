//! Batch rename image files (and their .txt caption files) with a prefix and sequential index.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use tauri::Emitter;

use super::common::{caption_path_for, load_json_file, normalize_rel_key, save_json_file_atomic};

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
    // Missing file -> Value::Null (the Default) -> empty map below.
    let data: serde_json::Value = load_json_file(path)?;
    if let Some(obj) = data.as_object() {
        if let Some(map_val) = obj.get("ratings").or_else(|| obj.get("statuses")) {
            if let Some(map) = map_val.as_object() {
                let mut result = HashMap::new();
                for (k, v) in map {
                    if let Some(s) = v.as_str() {
                        result.insert(normalize_rel_key(k), s.to_string());
                    }
                }
                return Ok(result);
            }
        }
    }
    Ok(HashMap::new())
}

fn save_json_map(path: &Path, map: &HashMap<String, String>, key: &str) -> Result<(), String> {
    let mut obj = serde_json::Map::new();
    let mut inner = serde_json::Map::new();
    for (k, v) in map {
        inner.insert(k.clone(), serde_json::Value::String(v.clone()));
    }
    obj.insert(key.to_string(), serde_json::Value::Object(inner));

    save_json_file_atomic(path, &serde_json::Value::Object(obj))
}

/// Pre-flight collision check: compute every target name up front and fail
/// cleanly (before any rename) if a target collides with another target or
/// with an existing file that is not itself a rename source.
fn preflight_collision_check(
    root: &Path,
    relative_paths: &[String],
    prefix: &str,
    start_index: u32,
    zero_pad: u32,
) -> Result<(), String> {
    let mut sources: HashSet<PathBuf> = HashSet::new();
    for relative_path in relative_paths {
        let rel_normalized = relative_path.replace('/', std::path::MAIN_SEPARATOR_STR);
        let old_path = root.join(&rel_normalized);
        sources.insert(caption_path_for(&old_path));
        sources.insert(old_path);
    }

    let mut targets_seen: HashSet<PathBuf> = HashSet::new();
    let mut preflight_index = start_index;
    for relative_path in relative_paths {
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
        let parent = old_path.parent().unwrap_or(root);
        let new_path = parent.join(&new_name);
        let caption_new = caption_path_for(&new_path);
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
    Ok(())
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

    // Pre-flight collision check: fail cleanly before any rename happens.
    preflight_collision_check(&root, &payload.relative_paths, prefix, payload.start_index, zero_pad)?;

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
        let caption_new = caption_path_for(&new_path);
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
                .map(|p| normalize_rel_key(&p.to_string_lossy()))
                .unwrap_or_else(|_| new_name.clone());
            path_mappings.push((normalize_rel_key(relative_path), normalize_rel_key(&new_relative)));
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
            log::error!("batch_rename: failed to update ratings file: {e}");
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
            log::error!("batch_rename: failed to update crop_status file: {e}");
            errors.push(format!("Failed to update crop_status file: {}", e));
        }
    }

    Ok(BatchRenameResult {
        success: errors.is_empty(),
        renamed_count: renamed,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, b"x").unwrap();
    }

    // ---- preflight_collision_check ----

    #[test]
    fn preflight_ok_for_clean_rename() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("a.png"));
        touch(&dir.path().join("b.png"));
        let rels = vec!["a.png".to_string(), "b.png".to_string()];
        assert!(preflight_collision_check(dir.path(), &rels, "img", 1, 4).is_ok());
    }

    #[test]
    fn preflight_same_source_twice_gets_distinct_targets() {
        let dir = tempfile::tempdir().unwrap();
        // Sequential indices give each list entry a distinct target name, so
        // even a repeated source passes the duplicate-target guard (the guard
        // itself is defensive against future naming-scheme changes).
        touch(&dir.path().join("a.png"));
        let rels = vec!["a.png".to_string(), "a.png".to_string()];
        assert!(preflight_collision_check(dir.path(), &rels, "img", 1, 4).is_ok());
    }

    #[test]
    fn preflight_rejects_existing_unrelated_target() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("a.png"));
        // img_0001.png exists and is NOT part of the rename set.
        touch(&dir.path().join("img_0001.png"));
        let rels = vec!["a.png".to_string()];
        let err = preflight_collision_check(dir.path(), &rels, "img", 1, 4).unwrap_err();
        assert!(err.contains("Target already exists"), "unexpected: {err}");
    }

    #[test]
    fn preflight_allows_target_that_is_also_a_source() {
        let dir = tempfile::tempdir().unwrap();
        // img_0001.png exists but is itself being renamed (it is in the set).
        touch(&dir.path().join("img_0001.png"));
        touch(&dir.path().join("a.png"));
        let rels = vec!["img_0001.png".to_string(), "a.png".to_string()];
        assert!(preflight_collision_check(dir.path(), &rels, "img", 1, 4).is_ok());
    }

    #[test]
    fn preflight_rejects_existing_unrelated_caption_target() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("a.png"));
        // The caption target img_0001.txt exists and belongs to no source.
        touch(&dir.path().join("img_0001.txt"));
        let rels = vec!["a.png".to_string()];
        let err = preflight_collision_check(dir.path(), &rels, "img", 1, 4).unwrap_err();
        assert!(err.contains("Caption target already exists"), "unexpected: {err}");
    }

    #[test]
    fn preflight_noop_rename_is_ok() {
        let dir = tempfile::tempdir().unwrap();
        // File already has its target name: new_path == old_path, no error.
        touch(&dir.path().join("img_0001.png"));
        let rels = vec!["img_0001.png".to_string()];
        assert!(preflight_collision_check(dir.path(), &rels, "img", 1, 4).is_ok());
    }

    #[test]
    fn preflight_handles_subfolder_paths() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("sub").join("a.png"));
        touch(&dir.path().join("sub").join("img_0002.png"));
        // Target img_0002.png in "sub" exists and is not a source -> error.
        let rels = vec!["sub/a.png".to_string(), "sub/b.png".to_string()];
        let err = preflight_collision_check(dir.path(), &rels, "img", 1, 4).unwrap_err();
        assert!(err.contains("Target already exists"), "unexpected: {err}");
    }

    // ---- normalize_rel_key (metadata map keys) ----

    #[test]
    fn normalize_rel_key_unifies_separators() {
        assert_eq!(normalize_rel_key("sub\\a.png"), "sub/a.png");
        assert_eq!(normalize_rel_key("sub/a.png"), "sub/a.png");
        assert_eq!(normalize_rel_key("a.png"), "a.png");
    }

    // ---- load_json_map ----

    #[test]
    fn load_json_map_missing_file_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let map = load_json_map(&dir.path().join("nope.json")).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn load_json_map_corrupt_file_is_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ratings.json");
        fs::write(&path, "not json at all").unwrap();
        assert!(load_json_map(&path).is_err());
    }

    #[test]
    fn load_json_map_reads_ratings_and_statuses_keys() {
        let dir = tempfile::tempdir().unwrap();
        let ratings = dir.path().join("ratings.json");
        fs::write(&ratings, r#"{"ratings":{"sub\\a.png":"good"}}"#).unwrap();
        let map = load_json_map(&ratings).unwrap();
        // Keys are normalized to forward slashes on load.
        assert_eq!(map.get("sub/a.png").map(String::as_str), Some("good"));

        let statuses = dir.path().join("crop_status.json");
        fs::write(&statuses, r#"{"statuses":{"b.png":"cropped"}}"#).unwrap();
        let map = load_json_map(&statuses).unwrap();
        assert_eq!(map.get("b.png").map(String::as_str), Some("cropped"));
    }
}
