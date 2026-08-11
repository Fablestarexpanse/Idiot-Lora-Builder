use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// Serializes all load-modify-save sections on the ratings file so rapid
/// concurrent commands cannot drop each other's updates.
static RATINGS_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// Image rating status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ImageRating {
    #[default]
    None,
    Good,
    Bad,
    NeedsEdit,
}

impl ImageRating {
    pub fn as_str(&self) -> &'static str {
        match self {
            ImageRating::None => "none",
            ImageRating::Good => "good",
            ImageRating::Bad => "bad",
            ImageRating::NeedsEdit => "needs_edit",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "good" => ImageRating::Good,
            "bad" => ImageRating::Bad,
            "needs_edit" => ImageRating::NeedsEdit,
            _ => ImageRating::None,
        }
    }
}

/// Ratings storage file (saved per project).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RatingsData {
    /// Map of relative image path -> rating
    pub ratings: HashMap<String, String>,
}

/// Get the ratings file path for a project root.
fn ratings_file_path(root: &str) -> PathBuf {
    PathBuf::from(root).join(".lora-studio").join("ratings.json")
}

/// Load ratings from file. A missing file yields the empty default; a file
/// that exists but cannot be read or parsed is an error (so a corrupt file
/// is never silently replaced by an empty one on the next save).
pub fn try_load_ratings(root: &str) -> Result<RatingsData, String> {
    let path = ratings_file_path(root);
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RatingsData::default());
        }
        Err(e) => return Err(format!("Failed to read {}: {}", path.display(), e)),
    };
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

/// Infallible loader kept for read-only callers outside this module
/// (project listing, export). Those paths never save the ratings file, so
/// falling back to the default on error cannot cause data loss there.
pub fn load_ratings(root: &str) -> RatingsData {
    try_load_ratings(root).unwrap_or_default()
}

/// Save ratings to file (write to a temp file, then rename over the target).
fn save_ratings(root: &str, data: &RatingsData) -> Result<(), String> {
    let path = ratings_file_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Get rating for a specific image.
#[allow(dead_code)]
pub fn get_rating(root: &str, relative_path: &str) -> Result<ImageRating, String> {
    let data = try_load_ratings(root)?;
    Ok(data
        .ratings
        .get(relative_path)
        .map(|s| ImageRating::from_str(s))
        .unwrap_or(ImageRating::None))
}

#[derive(Debug, Deserialize)]
pub struct SetRatingPayload {
    pub root_path: String,
    pub relative_path: String,
    pub rating: String,
}

/// Set rating for an image.
#[tauri::command]
pub fn set_rating(payload: SetRatingPayload) -> Result<(), String> {
    let _guard = RATINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let mut data = try_load_ratings(&payload.root_path)?;

    let rating = ImageRating::from_str(&payload.rating);
    if rating == ImageRating::None {
        data.ratings.remove(&payload.relative_path);
    } else {
        data.ratings.insert(payload.relative_path, rating.as_str().to_string());
    }

    save_ratings(&payload.root_path, &data)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct GetRatingsPayload {
    pub root_path: String,
}

/// Get all ratings for a project.
#[tauri::command]
pub fn get_ratings(payload: GetRatingsPayload) -> Result<HashMap<String, String>, String> {
    let data = try_load_ratings(&payload.root_path)?;
    Ok(data.ratings)
}

/// Clear all ratings for a project.
#[tauri::command]
pub fn clear_all_ratings(payload: GetRatingsPayload) -> Result<usize, String> {
    let _guard = RATINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let path = ratings_file_path(&payload.root_path);
    if !path.exists() {
        return Ok(0);
    }
    let data = try_load_ratings(&payload.root_path)?;
    let count = data.ratings.len();
    // Best-effort backup of the existing file before overwriting it.
    let backup_path = path.with_file_name("ratings.bak.json");
    let _ = fs::copy(&path, &backup_path);
    let empty = RatingsData::default();
    save_ratings(&payload.root_path, &empty)?;
    Ok(count)
}

#[derive(Debug, Deserialize)]
pub struct RatingChange {
    pub relative_path: String,
    pub rating: String,
}

#[derive(Debug, Deserialize)]
pub struct SetRatingsBatchPayload {
    pub root_path: String,
    pub changes: Vec<RatingChange>,
}

/// Set ratings for multiple images in a single operation (reduces file I/O)
#[tauri::command]
pub fn set_ratings_batch(payload: SetRatingsBatchPayload) -> Result<(), String> {
    let _guard = RATINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let mut data = try_load_ratings(&payload.root_path)?;

    for change in &payload.changes {
        let rating = ImageRating::from_str(&change.rating);
        if rating == ImageRating::None {
            data.ratings.remove(&change.relative_path);
        } else {
            data.ratings.insert(change.relative_path.clone(), rating.as_str().to_string());
        }
    }

    save_ratings(&payload.root_path, &data)?;
    Ok(())
}
