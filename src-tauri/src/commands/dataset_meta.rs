//! Reads a `metadata.json` left in a dataset folder by the tool that generated
//! it, so we can offer its settings instead of making the user retype them.
//!
//! Today that means [Dataset Deviser](https://github.com/EnragedAntelope/dataset-deviser),
//! which writes the trigger word it built the dataset around. Nothing here is
//! required for such a folder to open — its `.lora-studio/ratings.json` is
//! already read by the normal project scan; this is purely a convenience.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Generator name we recognise in `metadata.json`.
const DEVISER: &str = "dataset-deviser";

/// The subset of a generator's metadata worth surfacing. Everything is optional:
/// this file belongs to another program and may gain or lose keys at any time.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct DatasetMeta {
    #[serde(default)]
    pub generator: Option<String>,
    #[serde(default)]
    pub trigger: Option<String>,
    #[serde(default)]
    pub character_name: Option<String>,
    #[serde(default)]
    pub dataset_type: Option<String>,
    #[serde(default)]
    pub caption_style: Option<String>,
}

impl DatasetMeta {
    /// Whether this looks like a dataset we know how to read. Prefers the
    /// explicit `generator` key; falls back to the shape of the file, so
    /// datasets exported before that key existed are still recognised.
    fn is_recognised(&self) -> bool {
        if self.generator.as_deref() == Some(DEVISER) {
            return true;
        }
        self.trigger.is_some() && self.dataset_type.is_some()
    }

    fn trimmed(mut self) -> Self {
        // A generator that recorded an empty trigger has nothing to offer;
        // normalise it to None so callers only test for presence.
        self.trigger = self.trigger.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        self
    }
}

fn metadata_path(root: &Path) -> PathBuf {
    root.join("metadata.json")
}

#[derive(Debug, Deserialize)]
pub struct ReadDatasetMetadataPayload {
    pub root_path: String,
}

/// Reads `<root>/metadata.json`, returning None when there isn't one we
/// recognise.
///
/// Note this is deliberately the opposite of the `load_json_file` rule used for
/// `ratings.json` and `crop_status.json`: those are the user's own data, so a
/// file that exists but won't parse is an error rather than being silently
/// replaced with a default. This file is a read-only hint from another program
/// — a malformed one must never stop a folder from opening, so it degrades to
/// None like a missing file.
#[tauri::command]
pub async fn read_dataset_metadata(
    payload: ReadDatasetMetadataPayload,
) -> Result<Option<DatasetMeta>, String> {
    let root = PathBuf::from(&payload.root_path);
    tauri::async_runtime::spawn_blocking(move || read_dataset_meta(&root))
        .await
        .map_err(|e| e.to_string())
}

fn read_dataset_meta(root: &Path) -> Option<DatasetMeta> {
    let raw = fs::read_to_string(metadata_path(root)).ok()?;
    let meta: DatasetMeta = serde_json::from_str(&raw).ok()?;
    let meta = meta.trimmed();
    meta.is_recognised().then_some(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_meta(dir: &Path, json: &str) {
        fs::write(dir.join("metadata.json"), json).unwrap();
    }

    #[test]
    fn reads_a_deviser_export() {
        let dir = tempfile::tempdir().unwrap();
        write_meta(
            dir.path(),
            r#"{"generator":"dataset-deviser","generator_version":"0.16.0",
                "trigger":"sysnootles","character_name":"Sy Snootles",
                "dataset_type":"character","caption_style":"prose"}"#,
        );
        let meta = read_dataset_meta(dir.path()).expect("should be recognised");
        assert_eq!(meta.trigger.as_deref(), Some("sysnootles"));
        assert_eq!(meta.character_name.as_deref(), Some("Sy Snootles"));
        assert_eq!(meta.dataset_type.as_deref(), Some("character"));
    }

    #[test]
    fn unknown_keys_are_ignored() {
        // The other tool owns this file and adds keys over time; gaining one
        // must never stop us reading the rest.
        let dir = tempfile::tempdir().unwrap();
        write_meta(
            dir.path(),
            r#"{"generator":"dataset-deviser","trigger":"sks",
                "something_new":{"nested":[1,2,3]},"source_folders":["a","b"]}"#,
        );
        assert_eq!(
            read_dataset_meta(dir.path()).unwrap().trigger.as_deref(),
            Some("sks")
        );
    }

    #[test]
    fn recognises_an_older_export_without_the_generator_key() {
        let dir = tempfile::tempdir().unwrap();
        write_meta(
            dir.path(),
            r#"{"trigger":"sks","dataset_type":"concept","created":"2026-08-20"}"#,
        );
        assert!(read_dataset_meta(dir.path()).is_some());
    }

    #[test]
    fn ignores_an_unrelated_metadata_json() {
        // Plenty of folders have a metadata.json that means something else.
        let dir = tempfile::tempdir().unwrap();
        write_meta(dir.path(), r#"{"name":"some other thing","version":2}"#);
        assert_eq!(read_dataset_meta(dir.path()), None);
    }

    #[test]
    fn an_empty_trigger_is_not_offered() {
        let dir = tempfile::tempdir().unwrap();
        write_meta(
            dir.path(),
            r#"{"generator":"dataset-deviser","trigger":"   ","dataset_type":"style"}"#,
        );
        assert_eq!(read_dataset_meta(dir.path()).unwrap().trigger, None);
    }

    #[test]
    fn a_missing_file_is_none_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_dataset_meta(dir.path()), None);
    }

    #[test]
    fn malformed_json_degrades_to_none_and_never_blocks_opening() {
        let dir = tempfile::tempdir().unwrap();
        write_meta(dir.path(), "{ this is not json");
        assert_eq!(read_dataset_meta(dir.path()), None);
    }
}
