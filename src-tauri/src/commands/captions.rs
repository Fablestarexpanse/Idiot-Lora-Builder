use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Get the caption file path for an image (same name, .txt extension).
fn caption_path_for(image_path: &str) -> PathBuf {
    let path = PathBuf::from(image_path);
    path.with_extension("txt")
}

/// Case-insensitive tag comparison (Unicode-aware, consistent across commands).
fn tag_eq(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

#[derive(Debug, Deserialize)]
pub struct ReadCaptionPayload {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct CaptionData {
    pub exists: bool,
    pub raw: String,
    pub tags: Vec<String>,
}

/// Reads the caption file for an image. Returns tags parsed from comma-separated format.
#[tauri::command]
pub fn read_caption(payload: ReadCaptionPayload) -> Result<CaptionData, String> {
    let caption_path = caption_path_for(&payload.path);

    let raw = match fs::read_to_string(&caption_path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CaptionData {
                exists: false,
                raw: String::new(),
                tags: Vec::new(),
            });
        }
        Err(e) => return Err(e.to_string()),
    };
    let tags = parse_tags(&raw);

    Ok(CaptionData {
        exists: true,
        raw: raw.trim().to_string(),
        tags,
    })
}

#[derive(Debug, Deserialize)]
pub struct WriteCaptionPayload {
    pub path: String,
    pub tags: Vec<String>,
}

/// Writes tags to the caption file for an image (comma-separated).
#[tauri::command]
pub fn write_caption(payload: WriteCaptionPayload) -> Result<(), String> {
    let caption_path = caption_path_for(&payload.path);
    let content = payload.tags.join(", ");
    fs::write(&caption_path, &content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Parse comma-separated tags from raw caption text.
fn parse_tags(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct AddTagPayload {
    pub path: String,
    pub tag: String,
}

/// Adds a tag to the caption file if not already present.
#[tauri::command]
pub fn add_tag(payload: AddTagPayload) -> Result<Vec<String>, String> {
    let caption_path = caption_path_for(&payload.path);
    let mut tags = match fs::read_to_string(&caption_path) {
        Ok(raw) => parse_tags(&raw),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.to_string()),
    };

    let tag = payload.tag.trim().to_string();
    if !tag.is_empty() && !tags.iter().any(|t| tag_eq(t, &tag)) {
        tags.push(tag);
        let content = tags.join(", ");
        fs::write(&caption_path, &content).map_err(|e| e.to_string())?;
    }

    Ok(tags)
}

#[derive(Debug, Deserialize)]
pub struct RemoveTagPayload {
    pub path: String,
    pub tag: String,
}

/// Removes a tag from the caption file.
#[tauri::command]
pub fn remove_tag(payload: RemoveTagPayload) -> Result<Vec<String>, String> {
    let caption_path = caption_path_for(&payload.path);
    let raw = match fs::read_to_string(&caption_path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut tags = parse_tags(&raw);
    let before = tags.len();
    let tag = payload.tag.trim();
    tags.retain(|t| !tag_eq(t, tag));

    // Skip the rewrite when nothing matched.
    if tags.len() != before {
        let content = tags.join(", ");
        fs::write(&caption_path, &content).map_err(|e| e.to_string())?;
    }

    Ok(tags)
}

#[derive(Debug, Deserialize)]
pub struct ReorderTagsPayload {
    pub path: String,
    pub tags: Vec<String>,
}

/// Replaces all tags with the given ordered list.
#[tauri::command]
pub fn reorder_tags(payload: ReorderTagsPayload) -> Result<(), String> {
    let caption_path = caption_path_for(&payload.path);
    let content = payload.tags.join(", ");
    fs::write(&caption_path, &content).map_err(|e| e.to_string())?;
    Ok(())
}

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

fn is_image_path(p: &Path) -> bool {
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    ext.as_ref()
        .map(|e| IMAGE_EXT.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
pub struct ClearAllCaptionsPayload {
    pub root_path: String,
}

#[derive(Debug, Serialize)]
pub struct ClearAllCaptionsResult {
    pub cleared_count: usize,
    pub errors: Vec<String>,
}

/// Clears all existing caption files in the project (writes empty content to each
/// image's .txt that already exists; never creates new caption files).
/// Uses the same walk as the project so paths match.
#[tauri::command]
pub fn clear_all_captions(payload: ClearAllCaptionsPayload) -> Result<ClearAllCaptionsResult, String> {
    let root = PathBuf::from(&payload.root_path);
    if !root.is_dir() {
        return Err("Project folder does not exist".to_string());
    }
    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    let mut cleared = 0usize;
    let mut errors = Vec::new();
    for entry in WalkDir::new(&canonical)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let p = entry.path();
        if !p.is_file() || !is_image_path(p) {
            continue;
        }
        let caption_path = p.with_extension("txt");
        // Only clear caption files that already exist; don't create junk .txt files.
        if !caption_path.is_file() {
            continue;
        }
        match fs::write(&caption_path, "") {
            Ok(()) => cleared += 1,
            Err(e) => errors.push(format!("Failed to clear {}: {}", caption_path.display(), e)),
        }
    }
    Ok(ClearAllCaptionsResult {
        cleared_count: cleared,
        errors,
    })
}

#[derive(Debug, Deserialize)]
pub struct GetCaptionsBatchPayload {
    pub paths: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CaptionsBatchResult {
    pub captions: HashMap<String, CaptionData>,
}

/// Read captions for multiple images in parallel
#[tauri::command]
pub async fn get_captions_batch(payload: GetCaptionsBatchPayload) -> Result<CaptionsBatchResult, String> {
    tauri::async_runtime::spawn_blocking(move || get_captions_batch_sync(payload))
        .await
        .map_err(|e| e.to_string())?
}

fn get_captions_batch_sync(payload: GetCaptionsBatchPayload) -> Result<CaptionsBatchResult, String> {
    let captions: HashMap<String, CaptionData> = payload
        .paths
        .par_iter()
        .map(|path_str| {
            let caption_path = caption_path_for(path_str);

            let caption_data = match fs::read_to_string(&caption_path) {
                Ok(raw) => {
                    let tags = parse_tags(&raw);
                    CaptionData {
                        exists: true,
                        raw: raw.trim().to_string(),
                        tags,
                    }
                }
                Err(_) => CaptionData {
                    exists: false,
                    raw: String::new(),
                    tags: Vec::new(),
                },
            };

            (path_str.clone(), caption_data)
        })
        .collect();

    Ok(CaptionsBatchResult { captions })
}
