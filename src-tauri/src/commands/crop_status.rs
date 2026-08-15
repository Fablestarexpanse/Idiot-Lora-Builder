//! Per-project crop status tracking (cropped / uncropped per image) stored in a
//! `.lora-studio/crop_status.json` sidecar file.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use super::common::{backup_file_best_effort, load_json_file, save_json_file_atomic};

const CROP_STATUS_FILE: &str = ".lora-studio/crop_status.json";

/// Serializes all load-modify-save sections on the crop status file so rapid
/// concurrent commands cannot drop each other's updates.
static CROP_STATUS_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CropStatusData {
    pub statuses: HashMap<String, String>,
}

fn crop_status_path(root_path: &str) -> PathBuf {
    PathBuf::from(root_path).join(CROP_STATUS_FILE)
}

/// Load crop statuses from the sidecar (missing file yields the empty default;
/// a present-but-unparsable file is an error). Crate-visible so `open_project`
/// can populate `ImageEntry.crop_status`.
pub(crate) fn load_crop_statuses(root_path: &str) -> Result<CropStatusData, String> {
    load_json_file(&crop_status_path(root_path))
}

/// Save crop statuses (write to a temp file, then rename over the target).
fn save_crop_statuses(root_path: &str, data: &CropStatusData) -> Result<(), String> {
    save_json_file_atomic(&crop_status_path(root_path), data)
}

#[derive(Debug, Deserialize)]
pub struct SetCropStatusPayload {
    pub root_path: String,
    pub relative_path: String,
    pub status: String,
}

#[tauri::command]
pub fn set_crop_status(payload: SetCropStatusPayload) -> Result<(), String> {
    let _guard = CROP_STATUS_LOCK.lock().map_err(|e| e.to_string())?;
    let mut data = load_crop_statuses(&payload.root_path)?;
    if payload.status == "uncropped" {
        data.statuses.remove(&payload.relative_path);
    } else {
        data.statuses
            .insert(payload.relative_path, payload.status);
    }
    save_crop_statuses(&payload.root_path, &data)
}

#[derive(Debug, Deserialize)]
pub struct GetCropStatusesPayload {
    pub root_path: String,
}

#[tauri::command]
pub fn get_crop_statuses(
    payload: GetCropStatusesPayload,
) -> Result<HashMap<String, String>, String> {
    let data = load_crop_statuses(&payload.root_path)?;
    Ok(data.statuses)
}

#[tauri::command]
pub fn clear_all_crop_statuses(payload: GetCropStatusesPayload) -> Result<usize, String> {
    let _guard = CROP_STATUS_LOCK.lock().map_err(|e| e.to_string())?;
    let data = load_crop_statuses(&payload.root_path)?;
    let count = data.statuses.len();
    // Best-effort backup of the existing file before overwriting it.
    let path = crop_status_path(&payload.root_path);
    backup_file_best_effort(&path, "crop_status.bak.json");
    let empty = CropStatusData::default();
    save_crop_statuses(&payload.root_path, &empty)?;
    Ok(count)
}
