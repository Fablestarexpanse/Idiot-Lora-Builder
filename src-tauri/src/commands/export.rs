//! Export dataset: copy images + .txt captions to a folder or ZIP.
//! Supports filtering by relative paths and "only captioned"; optional trigger word and sequential naming.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::common::{caption_path_for as caption_path, is_image_path as is_image, normalize_rel_key};
use super::ratings::{load_ratings, ImageRating, RatingsData};

// ============ Export to folder or ZIP ============

#[derive(Debug, Deserialize)]
pub struct ExportOptions {
    pub source_path: String,
    pub dest_path: String,
    #[serde(default)]
    pub as_zip: bool,
    #[serde(default)]
    pub only_captioned: bool,
    #[serde(default)]
    pub relative_paths: Option<Vec<String>>,
    #[serde(default)]
    pub trigger_word: Option<String>,
    #[serde(default)]
    pub sequential_naming: bool,
    /// kohya sd-scripts layout: when both `repeat_count` and `concept_name` are set,
    /// exported files go inside a `<repeat_count>_<concept_name>` folder.
    #[serde(default)]
    pub repeat_count: Option<u32>,
    #[serde(default)]
    pub concept_name: Option<String>,
    /// Optional dataset.toml content (composed by the frontend), written verbatim
    /// as `dataset.toml` next to the export output after a successful export.
    #[serde(default)]
    pub dataset_toml: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub success: bool,
    pub exported_count: usize,
    pub skipped_count: usize,
    pub error: Option<String>,
    /// Per-file error details (new, additive; frontend may ignore).
    pub errors: Vec<String>,
    pub output_path: String,
}

/// Normalize relative path: forward slashes, trim leading slashes.
fn normalize_rel(s: &str) -> String {
    normalize_rel_key(s).trim_start_matches('/').to_string()
}

/// Normalize for case-insensitive path comparison (e.g. Windows).
fn normalize_key_for_lookup(s: &str) -> String {
    normalize_rel(s).to_lowercase()
}

/// Pick a unique output file name, appending `_2`, `_3`, ... before the extension on collision.
/// Tracks names case-insensitively (Windows filesystems are case-insensitive).
fn unique_name(name: &str, used: &mut HashSet<String>) -> String {
    if used.insert(name.to_lowercase()) {
        return name.to_string();
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), Some(e.to_string())),
        None => (name.to_string(), None),
    };
    let mut n = 2usize;
    loop {
        let candidate = match &ext {
            Some(e) => format!("{}_{}.{}", stem, n, e),
            None => format!("{}_{}", stem, n),
        };
        if used.insert(candidate.to_lowercase()) {
            return candidate;
        }
        n += 1;
    }
}

/// Strip characters that are illegal in folder names (also removes path
/// separators so a concept name can never escape the destination folder).
fn sanitize_folder_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| {
            !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()
        })
        .collect();
    // Trailing dots/spaces are invalid on Windows; stripping leading dots also
    // collapses ".." (traversal) to nothing.
    cleaned.trim().trim_matches('.').trim().to_string()
}

/// kohya sd-scripts concept folder name ("<repeats>_<concept>") when both
/// options are set and the sanitized concept name is non-empty.
fn concept_folder(opt: &ExportOptions) -> Option<String> {
    match (opt.repeat_count, opt.concept_name.as_deref()) {
        (Some(n), Some(name)) => {
            let clean = sanitize_folder_component(name);
            if clean.is_empty() {
                None
            } else {
                Some(format!("{}_{}", n, clean))
            }
        }
        _ => None,
    }
}

#[tauri::command]
pub async fn export_dataset(options: ExportOptions) -> Result<ExportResult, String> {
    // All work below is blocking (filesystem walk, copies, zip deflate) — keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || export_dataset_sync(options))
        .await
        .map_err(|e| e.to_string())?
}

fn export_dataset_sync(options: ExportOptions) -> Result<ExportResult, String> {
    let source = PathBuf::from(&options.source_path);
    if !source.is_dir() {
        return Err("Source folder does not exist".to_string());
    }
    let canonical_source = source.canonicalize().map_err(|e| e.to_string())?;

    let mut images: Vec<PathBuf> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    if let Some(ref relative_paths) = options.relative_paths {
        // Use frontend paths directly: join each to canonical source, then canonicalize and
        // require the result to stay inside the source root (rejects "../" traversal).
        for rel in relative_paths {
            let normalized = normalize_rel(rel);
            if normalized.is_empty() {
                continue;
            }
            let full = canonical_source.join(&normalized);
            let canonical_full = match full.canonicalize() {
                Ok(c) => c,
                Err(_) => continue, // missing file: silently skip (matches previous behavior)
            };
            if canonical_full.strip_prefix(&canonical_source).is_err() {
                errors.push(format!("Skipped path outside source folder: {}", rel));
                continue;
            }
            if canonical_full.is_file() && is_image(&canonical_full) {
                if options.only_captioned && !caption_path(&canonical_full).exists() {
                    continue;
                }
                images.push(canonical_full);
            }
        }
    } else {
        // No filter: walk entire source and add all (subject to only_captioned)
        for entry in WalkDir::new(&canonical_source).follow_links(false).into_iter().filter_map(Result::ok) {
            let p = entry.path();
            if !p.is_file() || !is_image(p) {
                continue;
            }
            if options.only_captioned && !caption_path(p).exists() {
                continue;
            }
            images.push(p.to_path_buf());
        }
    }

    images.sort();

    if options.as_zip {
        export_zip(&images, &options, errors)
    } else {
        export_folder(&images, &options, errors)
    }
}

fn apply_trigger(content: &str, trigger: Option<&String>) -> String {
    let content = content.trim();
    match trigger {
        Some(t) if !t.trim().is_empty() => {
            let t = t.trim();
            if content.is_empty() {
                // Avoid producing "trigger, " with a dangling separator.
                return t.to_string();
            }
            // Avoid double-prepending on re-export: skip if the first tag is already the trigger.
            let first_tag = content.split(',').next().unwrap_or("").trim();
            if first_tag.eq_ignore_ascii_case(t) {
                return content.to_string();
            }
            format!("{}, {}", t, content)
        }
        _ => content.to_string(),
    }
}

fn output_name(img: &Path, index: usize, sequential: bool, used: &mut HashSet<String>) -> String {
    let ext = img.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let name = if sequential {
        format!("{:04}.{}", index + 1, ext)
    } else {
        img.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "image.png".to_string())
    };
    unique_name(&name, used)
}

fn finish_result(
    exported: usize,
    skipped: usize,
    errors: Vec<String>,
    output_path: &str,
) -> ExportResult {
    let success = errors.is_empty();
    let error = if success {
        None
    } else {
        log::warn!(
            "export finished with {} error(s) -> {}: {}",
            errors.len(),
            output_path,
            errors.join("; ")
        );
        Some(format!("{} file(s) failed to export", errors.len()))
    };
    ExportResult {
        success,
        exported_count: exported,
        skipped_count: skipped,
        error,
        errors,
        output_path: output_path.to_string(),
    }
}

fn export_folder(
    images: &[PathBuf],
    opt: &ExportOptions,
    mut errors: Vec<String>,
) -> Result<ExportResult, String> {
    let dest_root = PathBuf::from(&opt.dest_path);
    // kohya layout: files go into <dest>/<repeats>_<concept>/ when configured.
    let dest = match concept_folder(opt) {
        Some(folder) => dest_root.join(folder),
        None => dest_root.clone(),
    };
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let mut exported = 0usize;
    let mut skipped = 0usize;
    let mut used_names: HashSet<String> = HashSet::new();

    for (i, img) in images.iter().enumerate() {
        let name = output_name(img, i, opt.sequential_naming, &mut used_names);

        let dest_img = dest.join(&name);
        if let Err(e) = fs::copy(img, &dest_img) {
            errors.push(format!("Failed to copy {}: {}", img.display(), e));
            skipped += 1;
            continue;
        }

        let base = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(&name);
        let dest_txt = dest.join(format!("{}.txt", base));
        let cap_src = caption_path(img);
        if cap_src.exists() {
            match fs::read_to_string(&cap_src) {
                Ok(content) => {
                    let out = apply_trigger(&content, opt.trigger_word.as_ref());
                    if let Err(e) = fs::write(&dest_txt, out) {
                        errors.push(format!("Failed to write caption {}: {}", dest_txt.display(), e));
                    }
                }
                Err(e) => {
                    errors.push(format!("Failed to read caption {}: {}", cap_src.display(), e));
                }
            }
        }
        exported += 1;
    }

    // dataset.toml goes next to the concept folder (at the export root), so
    // kohya can be pointed at <dest>/dataset.toml directly.
    if let Some(toml) = opt.dataset_toml.as_deref() {
        let toml_path = dest_root.join("dataset.toml");
        if let Err(e) = fs::write(&toml_path, toml) {
            errors.push(format!("Failed to write dataset.toml: {}", e));
        }
    }

    Ok(finish_result(exported, skipped, errors, &opt.dest_path))
}

fn export_zip(
    images: &[PathBuf],
    opt: &ExportOptions,
    mut errors: Vec<String>,
) -> Result<ExportResult, String> {
    use std::io::Write;

    let file = fs::File::create(&opt.dest_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut exported = 0usize;
    let mut skipped = 0usize;
    let mut used_names: HashSet<String> = HashSet::new();
    // kohya layout: entries go under "<repeats>_<concept>/" inside the zip.
    let entry_prefix = concept_folder(opt)
        .map(|f| format!("{}/", f))
        .unwrap_or_default();

    for (i, img) in images.iter().enumerate() {
        let name = output_name(img, i, opt.sequential_naming, &mut used_names);

        let data = match fs::read(img) {
            Ok(d) => d,
            Err(e) => {
                errors.push(format!("Failed to read {}: {}", img.display(), e));
                skipped += 1;
                continue;
            }
        };
        zip.start_file(format!("{}{}", entry_prefix, name), opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(&data).map_err(|e| e.to_string())?;

        let base = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(&name);
        let txt_name = format!("{}{}.txt", entry_prefix, base);
        let cap_src = caption_path(img);
        if cap_src.exists() {
            match fs::read_to_string(&cap_src) {
                Ok(content) => {
                    let out = apply_trigger(&content, opt.trigger_word.as_ref());
                    zip.start_file(&txt_name, opts).map_err(|e| e.to_string())?;
                    zip.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
                }
                Err(e) => {
                    errors.push(format!("Failed to read caption {}: {}", cap_src.display(), e));
                }
            }
        }
        exported += 1;
    }

    // dataset.toml sits at the zip root, beside the concept folder.
    if let Some(toml) = opt.dataset_toml.as_deref() {
        zip.start_file("dataset.toml", opts).map_err(|e| e.to_string())?;
        zip.write_all(toml.as_bytes()).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| e.to_string())?;

    Ok(finish_result(exported, skipped, errors, &opt.dest_path))
}

// ============ Export by rating (good / bad / needs_edit subfolders) ============

#[derive(Debug, Deserialize)]
pub struct ExportByRatingOptions {
    pub source_path: String,
    pub dest_path: String,
    #[serde(default)]
    pub trigger_word: Option<String>,
    #[serde(default)]
    pub sequential_naming: bool,
}

fn rating_key(r: ImageRating) -> Option<&'static str> {
    match r {
        ImageRating::Good => Some("good"),
        ImageRating::Bad => Some("bad"),
        ImageRating::NeedsEdit => Some("needs_edit"),
        ImageRating::None => None,
    }
}

/// Build a lowercase-normalized lookup index once: normalized rating key -> rating value.
/// Keys stored as absolute paths (when strip_prefix failed at project-open time) are also
/// indexed by their path relative to the project root.
fn build_rating_index(ratings: &RatingsData, project_root: &str) -> HashMap<String, String> {
    let root_norm = normalize_key_for_lookup(project_root);
    let mut index: HashMap<String, String> = HashMap::new();
    for (k, v) in &ratings.ratings {
        let k_norm = normalize_key_for_lookup(k);
        if !root_norm.is_empty() && k_norm.len() > root_norm.len() && k_norm.starts_with(&root_norm) {
            let suffix = k_norm[root_norm.len()..].trim_start_matches(|c| c == '/' || c == '\\');
            if !suffix.is_empty() {
                index.entry(suffix.to_string()).or_insert_with(|| v.clone());
            }
        }
        index.entry(k_norm).or_insert_with(|| v.clone());
    }
    index
}

#[tauri::command]
pub async fn export_by_rating(options: ExportByRatingOptions) -> Result<ExportResult, String> {
    // All work below is blocking (filesystem walk, copies) — keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || export_by_rating_sync(options))
        .await
        .map_err(|e| e.to_string())?
}

fn export_by_rating_sync(options: ExportByRatingOptions) -> Result<ExportResult, String> {
    let root = PathBuf::from(&options.source_path);
    if !root.is_dir() {
        return Err("Source folder does not exist".to_string());
    }

    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    let project_root = canonical.to_string_lossy().into_owned();
    let ratings = load_ratings(&project_root);
    let rating_index = build_rating_index(&ratings, &project_root);

    let mut by_rating: HashMap<&'static str, Vec<PathBuf>> = [
        ("good", Vec::new()),
        ("bad", Vec::new()),
        ("needs_edit", Vec::new()),
    ]
    .into_iter()
    .collect();

    // Walk from canonical so strip_prefix(canonical) always succeeds and matches how project stores relative_path.
    for entry in WalkDir::new(&canonical).follow_links(false).into_iter().filter_map(Result::ok) {
        let p = entry.path();
        if !p.is_file() || !is_image(p) {
            continue;
        }
        let rel = match p.strip_prefix(&canonical) {
            Ok(r) => normalize_rel_key(&r.to_string_lossy()),
            Err(_) => continue,
        };
        let rel_key = normalize_rel(&rel);
        if rel_key.is_empty() {
            continue;
        }

        let rating_str = rating_index
            .get(&normalize_key_for_lookup(&rel_key))
            .cloned()
            .unwrap_or_else(|| "none".to_string());
        let rating = ImageRating::from_str(&rating_str);
        if let Some(key) = rating_key(rating) {
            by_rating.entry(key).or_default().push(p.to_path_buf());
        }
    }

    let dest = PathBuf::from(&options.dest_path);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let mut total_exported = 0usize;
    let mut total_skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (subdir, list) in by_rating.iter_mut() {
        list.sort();
        let sub = dest.join(*subdir);
        fs::create_dir_all(&sub).map_err(|e| e.to_string())?;

        let mut used_names: HashSet<String> = HashSet::new();

        for (i, img) in list.iter().enumerate() {
            let name = output_name(img, i, options.sequential_naming, &mut used_names);

            let dest_img = sub.join(&name);
            if let Err(e) = fs::copy(img, &dest_img) {
                errors.push(format!("Failed to copy {}: {}", img.display(), e));
                total_skipped += 1;
                continue;
            }

            let base = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(&name);
            let dest_txt = sub.join(format!("{}.txt", base));
            let cap_src = caption_path(img);
            if cap_src.exists() {
                match fs::read_to_string(&cap_src) {
                    Ok(content) => {
                        let out = apply_trigger(&content, options.trigger_word.as_ref());
                        if let Err(e) = fs::write(&dest_txt, out) {
                            errors.push(format!("Failed to write caption {}: {}", dest_txt.display(), e));
                        }
                    }
                    Err(e) => {
                        errors.push(format!("Failed to read caption {}: {}", cap_src.display(), e));
                    }
                }
            }
            total_exported += 1;
        }
    }

    Ok(finish_result(total_exported, total_skipped, errors, &options.dest_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- normalize_rel: traversal attempts and separator handling ----

    #[test]
    fn normalize_rel_strips_leading_slashes() {
        assert_eq!(normalize_rel("/foo/bar.png"), "foo/bar.png");
        assert_eq!(normalize_rel("///foo.png"), "foo.png");
    }

    #[test]
    fn normalize_rel_converts_backslashes() {
        assert_eq!(normalize_rel("sub\\dir\\img.png"), "sub/dir/img.png");
        assert_eq!(normalize_rel("\\leading\\img.png"), "leading/img.png");
    }

    #[test]
    fn normalize_rel_keeps_dotdot_for_canonicalize_check() {
        // Traversal is rejected later by the canonicalize + strip_prefix guard;
        // normalize_rel itself only normalizes separators.
        assert_eq!(normalize_rel("../escape.png"), "../escape.png");
        assert_eq!(normalize_rel("..\\escape.png"), "../escape.png");
        assert_eq!(normalize_rel("a/../../b.png"), "a/../../b.png");
    }

    #[test]
    fn normalize_rel_empty_and_root() {
        assert_eq!(normalize_rel(""), "");
        assert_eq!(normalize_rel("/"), "");
    }

    // ---- unique_name ----

    #[test]
    fn unique_name_no_collision_returns_original() {
        let mut used = HashSet::new();
        assert_eq!(unique_name("a.png", &mut used), "a.png");
        assert_eq!(unique_name("b.png", &mut used), "b.png");
    }

    #[test]
    fn unique_name_appends_counter_on_collision() {
        let mut used = HashSet::new();
        assert_eq!(unique_name("a.png", &mut used), "a.png");
        assert_eq!(unique_name("a.png", &mut used), "a_2.png");
        assert_eq!(unique_name("a.png", &mut used), "a_3.png");
    }

    #[test]
    fn unique_name_is_case_insensitive() {
        let mut used = HashSet::new();
        assert_eq!(unique_name("Img.PNG", &mut used), "Img.PNG");
        // Same name in different case collides (Windows semantics).
        assert_eq!(unique_name("img.png", &mut used), "img_2.png");
    }

    #[test]
    fn unique_name_without_extension() {
        let mut used = HashSet::new();
        assert_eq!(unique_name("noext", &mut used), "noext");
        assert_eq!(unique_name("noext", &mut used), "noext_2");
    }

    // ---- apply_trigger ----

    #[test]
    fn apply_trigger_empty_caption_yields_bare_trigger() {
        assert_eq!(apply_trigger("", Some(&"trig".to_string())), "trig");
        assert_eq!(apply_trigger("   ", Some(&"trig".to_string())), "trig");
    }

    #[test]
    fn apply_trigger_prepends_with_separator() {
        assert_eq!(
            apply_trigger("a girl, smiling", Some(&"trig".to_string())),
            "trig, a girl, smiling"
        );
    }

    #[test]
    fn apply_trigger_no_double_prepend() {
        assert_eq!(
            apply_trigger("trig, a girl", Some(&"trig".to_string())),
            "trig, a girl"
        );
        // Case-insensitive first-tag match.
        assert_eq!(
            apply_trigger("TRIG, a girl", Some(&"trig".to_string())),
            "TRIG, a girl"
        );
    }

    #[test]
    fn apply_trigger_none_or_blank_trigger_is_noop() {
        assert_eq!(apply_trigger("a girl", None), "a girl");
        assert_eq!(apply_trigger("a girl", Some(&"  ".to_string())), "a girl");
    }

    // ---- concept folder sanitization ----

    fn opts_with_concept(repeat: Option<u32>, name: Option<&str>) -> ExportOptions {
        ExportOptions {
            source_path: String::new(),
            dest_path: String::new(),
            as_zip: false,
            only_captioned: false,
            relative_paths: None,
            trigger_word: None,
            sequential_naming: false,
            repeat_count: repeat,
            concept_name: name.map(|s| s.to_string()),
            dataset_toml: None,
        }
    }

    #[test]
    fn sanitize_folder_component_strips_illegal_chars() {
        assert_eq!(sanitize_folder_component("my:concept*?"), "myconcept");
        assert_eq!(sanitize_folder_component("a/b\\c"), "abc");
        assert_eq!(sanitize_folder_component("nor<mal>|\"x\""), "normalx");
    }

    #[test]
    fn sanitize_folder_component_kills_traversal() {
        assert_eq!(sanitize_folder_component(".."), "");
        assert_eq!(sanitize_folder_component("../evil"), "evil");
        assert_eq!(sanitize_folder_component("..\\evil"), "evil");
    }

    #[test]
    fn sanitize_folder_component_trims_dots_and_spaces() {
        assert_eq!(sanitize_folder_component("  concept.  "), "concept");
        assert_eq!(sanitize_folder_component("con cept"), "con cept");
    }

    #[test]
    fn concept_folder_requires_both_fields() {
        assert_eq!(concept_folder(&opts_with_concept(None, None)), None);
        assert_eq!(concept_folder(&opts_with_concept(Some(10), None)), None);
        assert_eq!(concept_folder(&opts_with_concept(None, Some("cat"))), None);
        assert_eq!(
            concept_folder(&opts_with_concept(Some(10), Some("cat"))),
            Some("10_cat".to_string())
        );
    }

    #[test]
    fn concept_folder_empty_after_sanitize_is_none() {
        assert_eq!(concept_folder(&opts_with_concept(Some(5), Some("..\\/"))), None);
        assert_eq!(concept_folder(&opts_with_concept(Some(5), Some("   "))), None);
    }
}
