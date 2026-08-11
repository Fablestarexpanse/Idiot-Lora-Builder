//! Lifecycle management for the bundled llama.cpp server (built-in captioner).
//! Spawns llama-server as a child process on a free localhost port, waits for
//! the model to load, and exposes an OpenAI-compatible base URL that the
//! existing LM Studio caption commands can talk to.

use once_cell::sync::Lazy;
use serde::Serialize;
use std::fs;
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

use super::lm_studio::HTTP_CLIENT;
use super::models::{builtin_dir, component_path};

/// How long to wait for llama-server to load the model before giving up.
const STARTUP_TIMEOUT_SECS: u64 = 240;

struct ServerHandle {
    child: Child,
    port: u16,
    model_id: String,
    backend: String,
}

static SERVER: Lazy<Mutex<Option<ServerHandle>>> = Lazy::new(|| Mutex::new(None));

fn lock_server() -> std::sync::MutexGuard<'static, Option<ServerHandle>> {
    SERVER.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug, Serialize)]
pub struct BuiltinServerStatus {
    pub running: bool,
    pub model_id: Option<String>,
    pub backend: Option<String>,
    pub base_url: Option<String>,
}

fn base_url_for(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn free_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| e.to_string())
}

fn model_file_paths(app: &AppHandle, model_id: &str) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    // Reuse the registry in models.rs via its component definitions.
    let comps = super::models::model_components(model_id)?;
    let mut model = None;
    let mut mmproj = None;
    for c in comps {
        let p = component_path(app, &c)?;
        match c.id {
            "model" => model = Some(p),
            "mmproj" => mmproj = Some(p),
            _ => {}
        }
    }
    let model = model.ok_or("Model file not registered")?;
    let mmproj = mmproj.ok_or("mmproj file not registered")?;
    if !model.is_file() || !mmproj.is_file() {
        return Err("Model files are not downloaded yet".to_string());
    }
    Ok((model, mmproj))
}

/// Ensures llama-server is running with the requested model and backend.
/// Returns the OpenAI-compatible base URL (pass it to the existing caption
/// commands). Fast no-op when the right server is already up and healthy.
#[tauri::command]
pub async fn ensure_builtin_server(
    app: AppHandle,
    model_id: String,
    backend: String,
) -> Result<String, String> {
    // Fast path: already running with the same config and healthy.
    let existing_port = {
        let mut guard = lock_server();
        match guard.as_mut() {
            Some(h) if h.model_id == model_id && h.backend == backend => {
                // Reap if the process died.
                match h.child.try_wait() {
                    Ok(None) => Some(h.port),
                    _ => {
                        *guard = None;
                        None
                    }
                }
            }
            Some(_) => {
                // Different model/backend requested: stop the old server.
                if let Some(mut h) = guard.take() {
                    let _ = h.child.kill();
                    let _ = h.child.wait();
                }
                None
            }
            None => None,
        }
    };
    if let Some(port) = existing_port {
        if health_ok(port).await {
            return Ok(base_url_for(port));
        }
        // Unhealthy: tear down and restart below.
        stop_running();
    }

    let exe = builtin_dir(&app)?.join(format!("bin/{backend}/llama-server.exe"));
    if !exe.is_file() {
        return Err("The built-in caption server is not downloaded yet".to_string());
    }
    let (model_path, mmproj_path) = model_file_paths(&app, &model_id)?;
    let port = free_port()?;

    let log_path = builtin_dir(&app)?.join("llama-server.log");
    let log_file = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let log_file_err = log_file.try_clone().map_err(|e| e.to_string())?;

    let gpu_layers = if backend == "cpu" { "0" } else { "99" };
    let mut cmd = Command::new(&exe);
    cmd.arg("--model")
        .arg(&model_path)
        .arg("--mmproj")
        .arg(&mmproj_path)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--n-gpu-layers")
        .arg(gpu_layers)
        .arg("--ctx-size")
        .arg("8192")
        .arg("--jinja")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Failed to start llama-server: {e}"))?;

    // Wait for the model to finish loading (/health returns 200 when ready).
    let deadline = Instant::now() + Duration::from_secs(STARTUP_TIMEOUT_SECS);
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let tail = log_tail(&log_path, 2000);
            return Err(format!(
                "llama-server exited during startup ({status}). Log tail:\n{tail}"
            ));
        }
        if health_ok(port).await {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "llama-server did not become ready within {STARTUP_TIMEOUT_SECS}s. \
                 If you are on the Vulkan backend without a capable GPU, try the CPU backend."
            ));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    *lock_server() = Some(ServerHandle {
        child,
        port,
        model_id,
        backend,
    });
    Ok(base_url_for(port))
}

async fn health_ok(port: u16) -> bool {
    let url = format!("{}/health", base_url_for(port));
    matches!(
        HTTP_CLIENT
            .get(&url)
            .timeout(Duration::from_secs(2))
            .send()
            .await,
        Ok(resp) if resp.status().is_success()
    )
}

fn log_tail(path: &std::path::Path, max_bytes: usize) -> String {
    match fs::read_to_string(path) {
        Ok(s) => {
            let start = s.len().saturating_sub(max_bytes);
            s[start..].to_string()
        }
        Err(_) => "(no log)".to_string(),
    }
}

fn stop_running() {
    let mut guard = lock_server();
    if let Some(mut h) = guard.take() {
        let _ = h.child.kill();
        let _ = h.child.wait();
    }
}

/// Stops the built-in caption server (frees VRAM/RAM).
#[tauri::command]
pub fn stop_builtin_server() {
    stop_running();
}

/// Current state of the built-in caption server.
#[tauri::command]
pub fn get_builtin_server_status() -> BuiltinServerStatus {
    let mut guard = lock_server();
    if let Some(h) = guard.as_mut() {
        if matches!(h.child.try_wait(), Ok(None)) {
            return BuiltinServerStatus {
                running: true,
                model_id: Some(h.model_id.clone()),
                backend: Some(h.backend.clone()),
                base_url: Some(base_url_for(h.port)),
            };
        }
        *guard = None;
    }
    BuiltinServerStatus {
        running: false,
        model_id: None,
        backend: None,
        base_url: None,
    }
}

/// Kills the child process on app shutdown. Called from the run loop in lib.rs.
pub fn shutdown() {
    stop_running();
}

/// Ensures the YuNet face-detection model is downloaded; returns its path.
/// Thin command wrapper so the frontend can pre-warm it from the crop tool.
#[tauri::command]
pub async fn ensure_face_model(app: AppHandle) -> Result<String, String> {
    let path = super::models::ensure_yunet(&app).await?;
    Ok(path.to_string_lossy().into_owned())
}
