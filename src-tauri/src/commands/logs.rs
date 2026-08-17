//! Log-file helpers: open the app log directory in the system file manager.

use tauri::Manager;

/// Opens the app's log directory (where tauri-plugin-log writes
/// idiot-lora-builder.log) in the platform file manager.
#[tauri::command]
pub fn open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    // The dir may not exist yet if nothing has been logged.
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer.exe");
        c.arg(&dir);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&dir);
        c
    };
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&dir);
        c
    };

    // Spawn detached; we don't care about the exit status.
    cmd.spawn().map_err(|e| format!("Failed to open log folder: {e}"))?;
    Ok(())
}
