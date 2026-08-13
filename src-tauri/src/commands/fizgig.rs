//! Handoff to Fizgig (external LoRA training workbench): launches the user's
//! local Fizgig install so they can train on a dataset prepared here.

use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use super::common::is_image_path;

#[derive(Debug, Deserialize)]
pub struct ClearStagingImagesPayload {
    /// The dedicated export/staging folder to clean (top level only).
    pub folder: String,
}

/// Removes image files and .txt caption sidecars from the top level of a
/// dedicated staging folder, so a re-export never leaves stale images from
/// previously included entries. Non-image/non-txt files and subfolders are
/// left untouched. The folder not existing is fine (fresh export creates it).
#[tauri::command]
pub fn clear_staging_images(payload: ClearStagingImagesPayload) -> Result<usize, String> {
    let dir = PathBuf::from(&payload.folder);
    if !dir.is_dir() {
        return Ok(0);
    }
    let mut removed = 0usize;
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_txt = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("txt"));
        if is_image_path(&path) || is_txt {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[derive(Debug, Deserialize)]
pub struct LaunchFizgigPayload {
    /// Root folder of the Fizgig install (must contain run_fizgig.bat).
    pub fizgig_path: String,
}

/// Launches Fizgig via its own run_fizgig.bat in a visible console window
/// (it runs a local server the user may want to see). Returns once spawned.
#[tauri::command]
pub fn launch_fizgig(payload: LaunchFizgigPayload) -> Result<(), String> {
    let dir = PathBuf::from(&payload.fizgig_path);
    if !dir.is_dir() {
        return Err("Fizgig folder not found — check the path in Settings".to_string());
    }
    let bat = dir.join("run_fizgig.bat");
    if !bat.is_file() {
        return Err(
            "run_fizgig.bat not found in the configured Fizgig folder — point Settings at the Fizgig install root".to_string(),
        );
    }

    // Run the bat via cmd in its own new console window (CREATE_NEW_CONSOLE)
    // so Fizgig's server output stays visible and it survives our exit.
    // Deliberately NOT using `start`: its title-vs-command parsing breaks on
    // quoted paths with spaces and fails silently inside the detached cmd.
    let mut cmd = Command::new("cmd");
    cmd.arg("/C").arg(bat.as_os_str()).current_dir(&dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd.spawn()
        .map_err(|e| format!("Failed to launch Fizgig: {e}"))?;
    Ok(())
}
