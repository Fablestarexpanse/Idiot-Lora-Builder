//! Built-in AI model management: downloads the llama.cpp server runtime and
//! GGUF vision models (plus the YuNet face-detection ONNX) into app-local data
//! with progress events, resumable transfers, and cancellation.

use futures::StreamExt;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

use super::lm_studio::HTTP_CLIENT;

pub const DOWNLOAD_PROGRESS_EVENT: &str = "builtin-download-progress";

/// Pinned llama.cpp release used for the bundled server runtime.
const LLAMA_CPP_TAG: &str = "b10361";

static DOWNLOAD_CANCELLED: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));
/// Serializes downloads — one setup flow at a time.
static DOWNLOAD_ACTIVE: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComponentKind {
    /// Zip archive containing llama-server.exe + DLLs; extracted after download.
    ServerZip,
    /// Single file stored as-is (GGUF weights, ONNX models).
    File,
}

pub struct Component {
    /// Stable identifier, also used in progress events.
    pub id: &'static str,
    pub url: String,
    /// Final on-disk location relative to the builtin dir.
    pub rel_path: String,
    /// Approximate size in bytes (UI hint; the server's Content-Length wins).
    pub approx_bytes: u64,
    pub kind: ComponentKind,
}

const MB: u64 = 1_000_000;

fn server_component(backend: &str) -> Result<Component, String> {
    let variant = match backend {
        "vulkan" => "vulkan",
        "cpu" => "cpu",
        other => return Err(format!("Unknown server backend: {other}")),
    };
    let zip_name = format!("llama-{LLAMA_CPP_TAG}-bin-win-{variant}-x64.zip");
    Ok(Component {
        id: "llama-server",
        url: format!(
            "https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_CPP_TAG}/{zip_name}"
        ),
        rel_path: format!("bin/{variant}/llama-server.exe"),
        approx_bytes: 100 * MB,
        kind: ComponentKind::ServerZip,
    })
}

/// GGUF weights for a model choice. HF `resolve` URLs redirect to the CDN.
pub fn model_components(model_id: &str) -> Result<Vec<Component>, String> {
    let (repo, model_file, model_bytes, mmproj_file, mmproj_bytes) = match model_id {
        "qwen3-vl-8b" => (
            "Qwen/Qwen3-VL-8B-Instruct-GGUF",
            "Qwen3VL-8B-Instruct-Q4_K_M.gguf",
            5_030 * MB,
            "mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf",
            752 * MB,
        ),
        "qwen3-vl-4b" => (
            "Qwen/Qwen3-VL-4B-Instruct-GGUF",
            "Qwen3VL-4B-Instruct-Q4_K_M.gguf",
            2_500 * MB,
            "mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf",
            454 * MB,
        ),
        other => return Err(format!("Unknown model: {other}")),
    };
    Ok(vec![
        Component {
            id: "model",
            url: format!("https://huggingface.co/{repo}/resolve/main/{model_file}"),
            rel_path: format!("models/{model_file}"),
            approx_bytes: model_bytes,
            kind: ComponentKind::File,
        },
        Component {
            id: "mmproj",
            url: format!("https://huggingface.co/{repo}/resolve/main/{mmproj_file}"),
            rel_path: format!("models/{mmproj_file}"),
            approx_bytes: mmproj_bytes,
            kind: ComponentKind::File,
        },
    ])
}

pub fn yunet_component() -> Component {
    Component {
        id: "yunet",
        url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx".to_string(),
        rel_path: "models/yunet_face.onnx".to_string(),
        approx_bytes: 345_000,
        kind: ComponentKind::File,
    }
}

/// Root directory for all builtin runtime assets, under app-local data.
pub fn builtin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("builtin");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

pub fn component_path(app: &AppHandle, c: &Component) -> Result<PathBuf, String> {
    Ok(builtin_dir(app)?.join(&c.rel_path))
}

fn components_for(model_id: &str, backend: &str) -> Result<Vec<Component>, String> {
    let mut list = vec![server_component(backend)?];
    list.extend(model_components(model_id)?);
    Ok(list)
}

#[derive(Debug, Serialize)]
pub struct ComponentStatus {
    pub id: String,
    pub installed: bool,
    pub approx_bytes: u64,
    /// Bytes already present in a partial download (resumable).
    pub partial_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct BuiltinStatus {
    pub ready: bool,
    pub components: Vec<ComponentStatus>,
    pub missing_bytes: u64,
    pub downloading: bool,
}

/// Reports which components of the chosen model + backend are installed.
#[tauri::command]
pub fn get_builtin_status(
    app: AppHandle,
    model_id: String,
    backend: String,
) -> Result<BuiltinStatus, String> {
    let comps = components_for(&model_id, &backend)?;
    let mut statuses = Vec::new();
    let mut missing = 0u64;
    for c in &comps {
        let dest = component_path(&app, c)?;
        let installed = dest.is_file();
        let partial_bytes = if installed {
            0
        } else {
            fs::metadata(part_path_for(&app, c).unwrap_or_default())
                .map(|m| m.len())
                .unwrap_or(0)
        };
        if !installed {
            missing += c.approx_bytes.saturating_sub(partial_bytes);
        }
        statuses.push(ComponentStatus {
            id: c.id.to_string(),
            installed,
            approx_bytes: c.approx_bytes,
            partial_bytes,
        });
    }
    Ok(BuiltinStatus {
        ready: statuses.iter().all(|s| s.installed),
        components: statuses,
        missing_bytes: missing,
        downloading: DOWNLOAD_ACTIVE.load(Ordering::SeqCst),
    })
}

#[derive(Debug, Clone, Serialize)]
struct DownloadProgress {
    component: String,
    /// "downloading" | "extracting" | "done" | "error" | "cancelled"
    phase: String,
    received: u64,
    total: u64,
    overall_received: u64,
    overall_total: u64,
    error: Option<String>,
}

fn emit_progress(app: &AppHandle, p: &DownloadProgress) {
    let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, p.clone());
}

fn part_path_for(app: &AppHandle, c: &Component) -> Result<PathBuf, String> {
    Ok(builtin_dir(app)?.join(format!("{}.part", c.rel_path.replace('/', "_"))))
}

/// Downloads all missing components for the model + backend, emitting progress.
/// Resumes partial downloads via HTTP Range. Zip components are extracted after
/// download and the archive removed.
#[tauri::command]
pub async fn download_builtin(
    app: AppHandle,
    model_id: String,
    backend: String,
) -> Result<(), String> {
    if DOWNLOAD_ACTIVE.swap(true, Ordering::SeqCst) {
        return Err("A download is already in progress".to_string());
    }
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
    let result = download_builtin_inner(&app, &model_id, &backend).await;
    DOWNLOAD_ACTIVE.store(false, Ordering::SeqCst);
    result
}

async fn download_builtin_inner(
    app: &AppHandle,
    model_id: &str,
    backend: &str,
) -> Result<(), String> {
    let comps = components_for(model_id, backend)?;
    let missing: Vec<&Component> = {
        let mut v = Vec::new();
        for c in &comps {
            if !component_path(app, c)?.is_file() {
                v.push(c);
            }
        }
        v
    };
    let overall_total: u64 = missing.iter().map(|c| c.approx_bytes).sum();
    let mut overall_received = 0u64;

    for c in missing {
        let received = download_component(app, c, overall_received, overall_total)
            .await
            .map_err(|e| {
                log::error!("download_builtin: {} failed: {e}", c.id);
                e
            })?;
        log::info!("download_builtin: component {} complete ({received} bytes)", c.id);
        overall_received += received;
    }

    emit_progress(
        app,
        &DownloadProgress {
            component: "all".into(),
            phase: "done".into(),
            received: overall_total,
            total: overall_total,
            overall_received: overall_total,
            overall_total,
            error: None,
        },
    );
    Ok(())
}

/// Downloads one component to its .part file (resuming if present), then
/// finalizes (rename, or extract for zips). Returns bytes counted toward the
/// overall progress for this component.
async fn download_component(
    app: &AppHandle,
    c: &Component,
    overall_received_base: u64,
    overall_total: u64,
) -> Result<u64, String> {
    let part_path = part_path_for(app, c)?;
    if let Some(parent) = part_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut existing = fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);

    let mut request = HTTP_CLIENT.get(&c.url);
    if existing > 0 {
        request = request.header("Range", format!("bytes={existing}-"));
    }
    let response = request.send().await.map_err(|e| format!("{}: {e}", c.id))?;
    let status = response.status();
    if !status.is_success() {
        let err = format!("{}: server returned {status}", c.id);
        emit_error(app, c, &err, overall_received_base, overall_total);
        return Err(err);
    }
    // Server ignored the Range header — start over.
    if existing > 0 && status != reqwest::StatusCode::PARTIAL_CONTENT {
        existing = 0;
    }
    let remote_len = response.content_length().unwrap_or(0);
    let total = existing + remote_len;
    let total = if total > 0 { total } else { c.approx_bytes };

    let mut file = if existing > 0 {
        fs::OpenOptions::new()
            .append(true)
            .open(&part_path)
            .map_err(|e| e.to_string())?
    } else {
        fs::File::create(&part_path).map_err(|e| e.to_string())?
    };

    let mut received = existing;
    let mut last_emit = std::time::Instant::now();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
            emit_progress(
                app,
                &DownloadProgress {
                    component: c.id.into(),
                    phase: "cancelled".into(),
                    received,
                    total,
                    overall_received: overall_received_base + received,
                    overall_total,
                    error: None,
                },
            );
            return Err("cancelled".to_string());
        }
        let chunk = chunk.map_err(|e| format!("{}: {e}", c.id))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if last_emit.elapsed().as_millis() >= 150 {
            last_emit = std::time::Instant::now();
            emit_progress(
                app,
                &DownloadProgress {
                    component: c.id.into(),
                    phase: "downloading".into(),
                    received,
                    total,
                    overall_received: overall_received_base + received,
                    overall_total,
                    error: None,
                },
            );
        }
    }
    drop(file);

    let dest = component_path(app, c)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    match c.kind {
        ComponentKind::File => {
            fs::rename(&part_path, &dest).map_err(|e| e.to_string())?;
        }
        ComponentKind::ServerZip => {
            emit_progress(
                app,
                &DownloadProgress {
                    component: c.id.into(),
                    phase: "extracting".into(),
                    received,
                    total,
                    overall_received: overall_received_base + received,
                    overall_total,
                    error: None,
                },
            );
            let bin_dir = dest
                .parent()
                .ok_or("Invalid server path")?
                .to_path_buf();
            let part = part_path.clone();
            // Zip extraction is blocking CPU/IO work.
            tauri::async_runtime::spawn_blocking(move || extract_server_zip(&part, &bin_dir))
                .await
                .map_err(|e| e.to_string())??;
            let _ = fs::remove_file(&part_path);
            if !dest.is_file() {
                return Err("Archive did not contain llama-server.exe".to_string());
            }
        }
    }
    Ok(received)
}

fn emit_error(app: &AppHandle, c: &Component, err: &str, overall_received: u64, overall_total: u64) {
    log::error!("download_builtin: component {} failed: {err}", c.id);
    emit_progress(
        app,
        &DownloadProgress {
            component: c.id.into(),
            phase: "error".into(),
            received: 0,
            total: 0,
            overall_received,
            overall_total,
            error: Some(err.to_string()),
        },
    );
}

/// Extracts every file from the llama.cpp release zip flat into `bin_dir`
/// (the archive ships llama-server.exe plus its DLLs, sometimes under a folder).
fn extract_server_zip(zip_path: &Path, bin_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    fs::create_dir_all(bin_dir).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        // Flatten: keep only the file name, dropping any internal folders.
        let name = match Path::new(entry.name()).file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Runtime needs only executables and DLLs (skips headers, .lib, docs).
        let lower = name.to_lowercase();
        if !lower.ends_with(".exe") && !lower.ends_with(".dll") {
            continue;
        }
        let out_path = bin_dir.join(&name);
        let mut out = fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Requests cancellation of the in-flight download (partial files are kept for resume).
#[tauri::command]
pub fn cancel_builtin_download() {
    DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);
}

/// Deletes downloaded model weights (not the server runtime) to free disk space.
#[tauri::command]
pub fn delete_builtin_model(app: AppHandle, model_id: String) -> Result<(), String> {
    for c in model_components(&model_id)? {
        let dest = component_path(&app, &c)?;
        if dest.is_file() {
            fs::remove_file(&dest).map_err(|e| e.to_string())?;
        }
        if let Ok(part) = part_path_for(&app, &c) {
            let _ = fs::remove_file(part);
        }
    }
    Ok(())
}

/// ONNX Runtime version paired with the `ort` crate release we build against.
const ONNXRUNTIME_VERSION: &str = "1.28.0";

/// Ensures onnxruntime.dll is present (downloaded from the official Microsoft
/// release, ~79 MB zip), extracting the DLLs into bin/onnxruntime/. Returns the
/// path to onnxruntime.dll. Required because `ort` uses load-dynamic linking.
pub async fn ensure_onnxruntime(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = builtin_dir(app)?.join("bin/onnxruntime");
    let dll = dir.join("onnxruntime.dll");
    if dll.is_file() {
        return Ok(dll);
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let url = format!(
        "https://github.com/microsoft/onnxruntime/releases/download/v{v}/onnxruntime-win-x64-{v}.zip",
        v = ONNXRUNTIME_VERSION
    );
    let zip_path = dir.join("onnxruntime.zip.part");
    let bytes = HTTP_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    fs::write(&zip_path, &bytes).map_err(|e| e.to_string())?;

    let dir_clone = dir.clone();
    let zip_clone = zip_path.clone();
    tauri::async_runtime::spawn_blocking(move || extract_server_zip(&zip_clone, &dir_clone))
        .await
        .map_err(|e| e.to_string())??;
    let _ = fs::remove_file(&zip_path);

    if !dll.is_file() {
        return Err("onnxruntime.dll missing from downloaded archive".to_string());
    }
    Ok(dll)
}

/// Ensures the YuNet face-detection model is present, downloading it if needed
/// (~340 KB). Returns its path. Called lazily by the crop tool.
pub async fn ensure_yunet(app: &AppHandle) -> Result<PathBuf, String> {
    let c = yunet_component();
    let dest = component_path(app, &c)?;
    if dest.is_file() {
        return Ok(dest);
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = HTTP_CLIENT
        .get(&c.url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let tmp = dest.with_extension("onnx.tmp");
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    Ok(dest)
}
