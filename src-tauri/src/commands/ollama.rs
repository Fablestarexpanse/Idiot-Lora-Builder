//! Ollama provider: OpenAI-compatible API at http://localhost:11434/v1.
//! Listing models uses GET /api/tags (base URL without /v1).
//! Generation reuses lm_studio commands with Ollama base URL and model.

use serde::Deserialize;

use super::common::ConnectionStatus;
use super::lm_studio::HTTP_CLIENT;

const DEFAULT_OLLAMA_BASE_URL: &str = "http://localhost:11434/v1";

#[derive(Debug, Deserialize)]
pub struct TestOllamaConnectionPayload {
    #[serde(default = "default_ollama_base_url")]
    pub base_url: String,
}

fn default_ollama_base_url() -> String {
    DEFAULT_OLLAMA_BASE_URL.to_string()
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Option<Vec<OllamaModelInfo>>,
}

#[derive(Debug, Deserialize)]
struct OllamaModelInfo {
    name: String,
}

/// Test connection to Ollama and list available models (including vision models like llava).
/// base_url should be the OpenAI-compatible endpoint (e.g. http://localhost:11434/v1).
/// We call /api/tags on the host (base_url with /v1 stripped).
#[tauri::command]
pub async fn test_ollama_connection(
    payload: TestOllamaConnectionPayload,
) -> Result<ConnectionStatus, String> {
    let base = payload.base_url.trim_end_matches('/');
    let tags_url = if base.ends_with("/v1") {
        format!("{}/api/tags", base.trim_end_matches("/v1").trim_end_matches('/'))
    } else {
        format!("{}/api/tags", base)
    };

    let response = match HTTP_CLIENT
        .get(&tags_url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
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
            error: Some(format!("Ollama returned status: {}", response.status())),
        });
    }

    let tags_response: OllamaTagsResponse = match response.json().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(ConnectionStatus {
                connected: false,
                models: Vec::new(),
                error: Some(format!("Failed to parse tags response: {}", e)),
            });
        }
    };
    let models: Vec<String> = tags_response
        .models
        .unwrap_or_default()
        .into_iter()
        .map(|m| m.name)
        .collect();

    Ok(ConnectionStatus {
        connected: true,
        models,
        error: None,
    })
}
