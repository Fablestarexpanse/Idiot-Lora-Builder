//! LM Studio provider: OpenAI-compatible vision captioning at http://localhost:1234.
//! Owns the shared HTTP client and single/batch caption generation commands.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures::stream::{self, StreamExt};
use image::imageops::FilterType;
use image::ImageFormat;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Cursor;
use std::path::PathBuf;

use super::common::ConnectionStatus;

const DEFAULT_BASE_URL: &str = "http://localhost:1234";

/// Shared HTTP client (connection pooling) for all local-provider requests.
/// Also used by the Ollama commands.
pub(crate) static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(reqwest::Client::new);

/// Require a parseable http(s) base URL before issuing requests.
fn validate_base_url(base_url: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(base_url.trim())
        .map_err(|_| format!("Invalid base URL: {}", base_url))?;
    match url.scheme() {
        "http" | "https" => Ok(()),
        s => Err(format!(
            "Unsupported URL scheme '{}': base URL must use http or https",
            s
        )),
    }
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct LmStudioSettings {
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub model: Option<String>,
}

fn default_base_url() -> String {
    DEFAULT_BASE_URL.to_string()
}

#[derive(Debug, Deserialize)]
pub struct TestConnectionPayload {
    #[serde(default = "default_base_url")]
    pub base_url: String,
}

/// Test connection to LM Studio and list available models.
#[tauri::command]
pub async fn test_lm_studio_connection(
    payload: TestConnectionPayload,
) -> Result<ConnectionStatus, String> {
    if let Err(e) = validate_base_url(&payload.base_url) {
        return Ok(ConnectionStatus {
            connected: false,
            models: Vec::new(),
            error: Some(e),
        });
    }

    let url = format!("{}/v1/models", payload.base_url.trim_end_matches('/'));

    let response = match HTTP_CLIENT.get(&url).timeout(std::time::Duration::from_secs(5)).send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(ConnectionStatus {
                connected: false,
                models: Vec::new(),
                error: Some(format!("Connection failed: {}", e)),
            });
        }
    };

    if !response.status().is_success() {
        return Ok(ConnectionStatus {
            connected: false,
            models: Vec::new(),
            error: Some(format!("Server returned status: {}", response.status())),
        });
    }

    #[derive(Deserialize)]
    struct ModelsResponse {
        data: Vec<ModelInfo>,
    }

    #[derive(Deserialize)]
    struct ModelInfo {
        id: String,
    }

    let models_response: ModelsResponse = match response.json().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(ConnectionStatus {
                connected: false,
                models: Vec::new(),
                error: Some(format!("Failed to parse models response: {}", e)),
            });
        }
    };
    let models: Vec<String> = models_response.data.into_iter().map(|m| m.id).collect();

    Ok(ConnectionStatus {
        connected: true,
        models,
        error: None,
    })
}

#[derive(Debug, Deserialize)]
pub struct GenerateCaptionPayload {
    pub image_path: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub model: Option<String>,
    pub prompt: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    /// Request timeout in seconds (default 120, max 600).
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u32,
    /// If set, resize image so longest side is at most this (reduces payload and inference time).
    #[serde(default)]
    pub max_image_dimension: Option<u32>,
}

fn default_max_tokens() -> u32 {
    1024
}

/// OpenAI-style `message.content` may be a string, null, or an array of parts (e.g. text + image).
fn flatten_message_content(content: &Option<Value>) -> String {
    match content {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => {
            let mut out = String::new();
            for p in parts {
                let Some(obj) = p.as_object() else {
                    continue;
                };
                if obj.get("type").and_then(|t| t.as_str()) != Some("text") {
                    continue;
                }
                let Some(text) = obj.get("text").and_then(|x| x.as_str()) else {
                    continue;
                };
                if !out.is_empty() && !out.ends_with(char::is_whitespace) {
                    out.push(' ');
                }
                out.push_str(text);
            }
            out
        }
        _ => String::new(),
    }
}

/// Reasoning / "thinking" models often put the entire completion in `reasoning_content` while
/// `content` stays empty until the budget runs out (`finish_reason: length`). Try to salvage a
/// caption from the reasoning trace (draft paragraphs), else return trimmed reasoning.
fn extract_caption_from_reasoning(reasoning: &str) -> String {
    let s = reasoning.trim();
    if s.is_empty() {
        return String::new();
    }

    // Prefer text after common "draft output" markers (last match ≈ latest draft).
    let markers = [
        "**Drafting - Attempt 1:**",
        "Attempt 1:**",
        "*Attempt 1:*",
        "**Drafting",
        "*Draft 1:*",
        "Draft 1:",
        "*   *Draft",
        "Iteration 1:**",
    ];
    let mut best_from_marker = String::new();
    for m in markers {
        if let Some(idx) = s.rfind(m) {
            let after = s[idx + m.len()..]
                .trim_start()
                .trim_start_matches(|c: char| c == ':' || c == '*' || c == ' ' || c == '\n');
            let para = after
                .split("\n\n")
                .next()
                .unwrap_or(after)
                .trim();
            if para.len() > best_from_marker.len() && para.len() > 24 {
                best_from_marker = para.to_string();
            }
        }
    }
    if !best_from_marker.is_empty() {
        return best_from_marker;
    }

    let paras: Vec<&str> = s
        .split("\n\n")
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();

    for p in paras.iter().rev() {
        if p.len() < 40 {
            continue;
        }
        let lower = p.to_lowercase();
        if lower.starts_with("the user wants") {
            continue;
        }
        if lower.starts_with("**key elements") || lower.starts_with("*   **key") {
            continue;
        }
        if lower.starts_with("1.  **") || lower.starts_with("1. **") || lower.starts_with("2.  **") {
            continue;
        }
        if lower.starts_with("**1.") {
            continue;
        }
        return (*p).to_string();
    }

    s.to_string()
}

fn caption_from_chat_message(content: &Option<Value>, reasoning: &Option<String>) -> String {
    let main = flatten_message_content(content);
    let main = main.trim();
    if !main.is_empty() {
        return main.to_string();
    }
    let Some(ref r) = reasoning else {
        return String::new();
    };
    extract_caption_from_reasoning(r)
}

const DEFAULT_TIMEOUT_SECS: u32 = 120;
const MAX_TIMEOUT_SECS: u32 = 600;

fn default_timeout_secs() -> u32 {
    DEFAULT_TIMEOUT_SECS
}

#[derive(Debug, Serialize)]
pub struct CaptionResult {
    pub success: bool,
    pub caption: String,
    pub error: Option<String>,
}

/// Generate a caption for a single image using LM Studio vision model.
#[tauri::command]
pub async fn generate_caption_lm_studio(
    payload: GenerateCaptionPayload,
) -> Result<CaptionResult, String> {
    let path = PathBuf::from(&payload.image_path);
    if !path.exists() || !path.is_file() {
        return Ok(CaptionResult {
            success: false,
            caption: String::new(),
            error: Some("Image file not found".to_string()),
        });
    }

    if let Err(e) = validate_base_url(&payload.base_url) {
        return Ok(CaptionResult {
            success: false,
            caption: String::new(),
            error: Some(e),
        });
    }

    // Decode image so we can normalize to JPEG (LM Studio vision often only accepts JPEG).
    // Optionally resize to reduce payload and inference time.
    // Decode/resize/re-encode is CPU-heavy — keep it off the async runtime.
    let max_image_dimension = payload.max_image_dimension;
    let data_url = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let img = image::open(&path).map_err(|e| e.to_string())?;
        let (w, h) = (img.width(), img.height());

        let img = if let Some(max_dim) = max_image_dimension.filter(|&d| d > 0) {
            let longest = w.max(h);
            if longest > max_dim {
                let scale = max_dim as f32 / longest as f32;
                let new_w = (w as f32 * scale).round() as u32;
                let new_h = (h as f32 * scale).round() as u32;
                let new_w = new_w.max(1);
                let new_h = new_h.max(1);
                img.resize(new_w, new_h, FilterType::Triangle)
            } else {
                img
            }
        } else {
            img
        };

        let mut buf = Vec::new();
        img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Jpeg)
            .map_err(|e| e.to_string())?;
        let base64_image = BASE64.encode(&buf);
        Ok(format!("data:image/jpeg;base64,{}", base64_image))
    })
    .await
    .map_err(|e| e.to_string())??;

    // Build request body (OpenAI-compatible format)
    let request_body = serde_json::json!({
        "model": payload.model.unwrap_or_else(|| "default".to_string()),
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": payload.prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": data_url
                        }
                    }
                ]
            }
        ],
        "max_tokens": payload.max_tokens,
        "temperature": 0.7,
        "stream": false
    });

    let url = format!(
        "{}/v1/chat/completions",
        payload.base_url.trim_end_matches('/')
    );

    let timeout_secs = payload.timeout_secs.min(MAX_TIMEOUT_SECS).max(1);
    let do_request = || {
        HTTP_CLIENT
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request_body)
            .timeout(std::time::Duration::from_secs(timeout_secs as u64))
            .send()
    };

    let response = match do_request().await {
        Ok(r) => r,
        Err(e) => {
            if !e.is_timeout() {
                return Ok(CaptionResult {
                    success: false,
                    caption: String::new(),
                    error: Some(format!("Request failed: {}", e)),
                });
            }
            // Retry once on timeout
            match do_request().await {
                Ok(r) => r,
                Err(_) => {
                    return Ok(CaptionResult {
                        success: false,
                        caption: String::new(),
                        error: Some(format!(
                            "Request timed out after {} seconds (tried 2 times). Try a larger timeout in settings or use smaller images.",
                            timeout_secs
                        )),
                    });
                }
            }
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Ok(CaptionResult {
            success: false,
            caption: String::new(),
            error: Some(format!("Server error {}: {}", status, body)),
        });
    }

    #[derive(Deserialize)]
    struct ChatResponse {
        choices: Vec<Choice>,
    }

    #[derive(Deserialize)]
    struct Choice {
        message: Message,
    }

    #[derive(Deserialize)]
    struct Message {
        #[serde(default)]
        content: Option<Value>,
        #[serde(default)]
        reasoning_content: Option<String>,
    }

    let chat_response: ChatResponse = match response.json().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(CaptionResult {
                success: false,
                caption: String::new(),
                error: Some(format!("Failed to parse response: {}", e)),
            });
        }
    };

    let caption = chat_response
        .choices
        .first()
        .map(|c| {
            caption_from_chat_message(&c.message.content, &c.message.reasoning_content)
        })
        .unwrap_or_default();

    if caption.is_empty() {
        return Ok(CaptionResult {
            success: false,
            caption: String::new(),
            error: Some(
                "Empty caption from model. Reasoning/thinking models often fill `reasoning_content` first — raise max completion tokens, or use a non-reasoning vision model."
                    .to_string(),
            ),
        });
    }

    Ok(CaptionResult {
        success: true,
        caption,
        error: None,
    })
}

fn default_batch_concurrency() -> u32 {
    1
}

#[derive(Debug, Deserialize)]
pub struct BatchCaptionPayload {
    pub image_paths: Vec<String>,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub model: Option<String>,
    pub prompt: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    /// Request timeout in seconds per image (default 120, max 600).
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u32,
    /// If set, resize each image so longest side is at most this.
    #[serde(default)]
    pub max_image_dimension: Option<u32>,
    /// Max concurrent requests (1 = sequential, 2–3 recommended).
    #[serde(default = "default_batch_concurrency")]
    pub concurrency: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct BatchCaptionResult {
    pub path: String,
    pub success: bool,
    pub caption: String,
    pub error: Option<String>,
}

/// Generate captions for multiple images with bounded concurrency.
/// Results are returned in the same order as image_paths.
#[tauri::command]
pub async fn generate_captions_batch(
    payload: BatchCaptionPayload,
) -> Result<Vec<BatchCaptionResult>, String> {
    let concurrency = payload.concurrency.max(1).min(8) as usize;

    let base_url = payload.base_url.clone();
    let model = payload.model.clone();
    let prompt = payload.prompt.clone();
    let max_tokens = payload.max_tokens;
    let timeout_secs = payload.timeout_secs;
    let max_image_dimension = payload.max_image_dimension;

    let futures = payload
        .image_paths
        .into_iter()
        .enumerate()
        .map(|(index, path)| {
            let base_url = base_url.clone();
            let model = model.clone();
            let prompt = prompt.clone();
            let single_payload = GenerateCaptionPayload {
                image_path: path.clone(),
                base_url,
                model,
                prompt,
                max_tokens,
                timeout_secs,
                max_image_dimension,
            };
            async move {
                let result = generate_caption_lm_studio(single_payload).await;
                (index, path, result)
            }
        });

    let mut completed: Vec<(usize, String, Result<CaptionResult, String>)> = stream::iter(futures)
        .buffer_unordered(concurrency)
        .collect()
        .await;

    completed.sort_by_key(|(i, _, _)| *i);

    let results: Vec<BatchCaptionResult> = completed
        .into_iter()
        .map(|(_, path, result)| {
            match result {
                Ok(r) => BatchCaptionResult {
                    path,
                    success: r.success,
                    caption: r.caption,
                    error: r.error,
                },
                Err(e) => BatchCaptionResult {
                    path,
                    success: false,
                    caption: String::new(),
                    error: Some(e),
                },
            }
        })
        .collect();

    Ok(results)
}
