//! Handoff to Fizgig (external LoRA training workbench): launches the user's
//! local Fizgig install so they can train on a dataset prepared here.

use serde::Deserialize;
use std::path::PathBuf;
use std::process::Command;

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

    // `start` detaches into its own console window so Fizgig outlives us and
    // its server output stays visible to the user.
    Command::new("cmd")
        .arg("/C")
        .arg("start")
        .arg("Fizgig")
        .arg("/D")
        .arg(&dir)
        .arg(bat.as_os_str())
        .spawn()
        .map_err(|e| format!("Failed to launch Fizgig: {e}"))?;
    Ok(())
}
