//! Shared helpers used across command modules: image/caption path utilities,
//! relative-path key normalization, and atomic JSON sidecar persistence.

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Extensions recognized as project images (lowercase).
pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

/// Whether a path has one of the recognized image extensions (case-insensitive).
pub fn is_image_path(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    ext.as_ref()
        .map(|e| IMAGE_EXTENSIONS.contains(&e.as_str()))
        .unwrap_or(false)
}

/// Get the caption file path for an image (same name, .txt extension).
pub fn caption_path_for(image_path: &Path) -> PathBuf {
    image_path.with_extension("txt")
}

/// Normalize a relative path to forward slashes so metadata map keys compare
/// consistently regardless of which separator the caller used.
pub fn normalize_rel_key(path: &str) -> String {
    path.replace('\\', "/")
}

/// Connection test result shared by the local caption providers (LM Studio, Ollama).
#[derive(Debug, Serialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub models: Vec<String>,
    pub error: Option<String>,
}

/// Load a JSON sidecar file. A missing file yields the type's default; a file
/// that exists but cannot be read or parsed is an error (so a corrupt file is
/// never silently replaced by an empty one on the next save).
pub fn load_json_file<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(T::default()),
        Err(e) => return Err(format!("Failed to read {}: {}", path.display(), e)),
    };
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

/// Save a value as pretty JSON (write to a temp file, then rename over the target).
/// Creates the parent directory when missing.
pub fn save_json_file_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

/// Best-effort backup: copy `path` to a sibling file named `bak_name` (errors ignored).
pub fn backup_file_best_effort(path: &Path, bak_name: &str) {
    if path.is_file() {
        let _ = fs::copy(path, path.with_file_name(bak_name));
    }
}
