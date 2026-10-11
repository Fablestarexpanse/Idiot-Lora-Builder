//! Reversible dataset exclusions. Journal intent before any filesystem mutation.
use super::common::{
    caption_path_for, is_image_path, load_json_file, normalize_rel_key, save_json_file_atomic,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
pub(super) static FILE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
pub const EXCLUDED: &str = "excluded_by_look";
pub fn excluded_entry(entry: &walkdir::DirEntry) -> bool {
    !entry.file_type().is_dir()
        || !matches!(
            entry.file_name().to_string_lossy().to_lowercase().as_str(),
            "excluded_by_look" | ".lora-studio"
        )
}
pub fn root(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
    if !p.is_dir() {
        return Err("Dataset folder is missing".into());
    }
    if p.join(".lora-studio").exists()
        && !p
            .join(".lora-studio")
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(&p)
    {
        return Err("Dataset metadata folder is outside the dataset".into());
    }
    Ok(p)
}
pub fn relative(root: &Path, key: &str) -> Result<PathBuf, String> {
    let normalized = normalize_rel_key(key);
    let p = Path::new(&normalized);
    if normalized.is_empty()
        || p.components().any(|c| !matches!(c, Component::Normal(_)))
        || normalized.contains(':')
    {
        return Err("Expected a dataset-relative path".into());
    }
    if normalized.split('/').any(|part| {
        part.eq_ignore_ascii_case(EXCLUDED) || part.eq_ignore_ascii_case(".lora-studio")
    }) {
        return Err("Excluded files cannot be scanned or moved again".into());
    }
    let joined = root.join(p);
    let real = joined
        .canonicalize()
        .map_err(|e| format!("Missing file {key}: {e}"))?;
    if !real.starts_with(root) || !real.is_file() || !is_image_path(&real) {
        return Err("Image is outside the dataset or unsupported".into());
    }
    Ok(real)
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Stamp {
    pub size: u64,
    pub modified: u128,
}
pub fn stamp(p: &Path) -> Result<Stamp, String> {
    let m = fs::metadata(p).map_err(|e| e.to_string())?;
    Ok(Stamp {
        size: m.len(),
        modified: m
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos(),
    })
}
fn digest(p: &Path) -> Result<String, String> {
    let mut file = fs::File::open(p).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(hex::encode(hash.finalize()))
}
#[derive(Clone, Serialize, Deserialize)]
struct MoveFile {
    source: String,
    dest: String,
    hash: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Pair {
    image: MoveFile,
    caption: Option<MoveFile>,
}
#[derive(Default, Serialize, Deserialize)]
struct Journal {
    batches: Vec<Vec<Pair>>,
}
#[derive(Debug, Serialize)]
pub struct MoveResult {
    pub moved: Vec<String>,
    pub errors: Vec<String>,
    pub can_undo: bool,
}
fn journal_path(root: &Path) -> PathBuf {
    root.join(".lora-studio/look-exclusions.json")
}
fn safe_journal_path(root: &Path, key: &str) -> Result<PathBuf, String> {
    let key = normalize_rel_key(key);
    let p = Path::new(&key);
    if p.components().any(|c| !matches!(c, Component::Normal(_))) || key.contains(':') {
        return Err("Invalid exclusion journal path".into());
    }
    let full = root.join(p);
    let mut parent = full.parent();
    while let Some(dir) = parent {
        if dir.exists() {
            if !dir
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(root)
            {
                return Err("Exclusion path escapes the dataset".into());
            }
            break;
        }
        parent = dir.parent();
    }
    if full.exists()
        && !full
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(root)
    {
        return Err("Exclusion file escapes the dataset".into());
    }
    Ok(full)
}
// Same-volume move with atomic no-clobber destination creation. Never copy/delete fallback.
fn move_no_replace(source: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::hard_link(source, dest).map_err(|e| format!("Cannot move {}: {e}", source.display()))?;
    if let Err(e) = fs::remove_file(source) {
        let _ = fs::remove_file(dest);
        return Err(e.to_string());
    }
    Ok(())
}
fn make_file(root: &Path, source: &Path, dest: &Path) -> Result<MoveFile, String> {
    Ok(MoveFile {
        source: normalize_rel_key(
            source
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_str()
                .ok_or("Invalid path")?,
        ),
        dest: normalize_rel_key(
            dest.strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_str()
                .ok_or("Invalid path")?,
        ),
        hash: digest(source)?,
    })
}
pub fn can_undo(root: &Path) -> Result<bool, String> {
    let journal: Journal = load_json_file(&journal_path(root))?;
    Ok(journal.batches.iter().flatten().any(|p| {
        root.join(&p.image.dest).is_file()
            || p.caption
                .as_ref()
                .is_some_and(|c| root.join(&c.dest).is_file())
    }))
}
pub fn exclude(root: &Path, keys: &[String], protected: &[String]) -> Result<MoveResult, String> {
    let _lock = FILE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut journal: Journal = load_json_file(&journal_path(root))?;
    let batch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos()
        .to_string();
    let dest_root = safe_journal_path(root, &format!("{EXCLUDED}/{batch}/placeholder"))?
        .parent()
        .unwrap()
        .to_path_buf();
    let mut pairs = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut errors = Vec::new();
    for key in keys {
        let attempt = (|| -> Result<Pair, String> {
            let source = relative(root, key)?;
            if !seen.insert(source.clone()) {
                return Err("Duplicate image in selection".into());
            }
            if protected
                .iter()
                .any(|p| Path::new(p).canonicalize().ok().as_ref() == Some(&source))
            {
                return Err("Baseline images cannot be excluded".into());
            }
            let rel = source.strip_prefix(root).map_err(|e| e.to_string())?;
            let dest = dest_root.join(rel);
            let cap = caption_path_for(&source);
            let caption = if cap.exists() {
                if !cap
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    .starts_with(root)
                {
                    return Err("Caption is outside the dataset".into());
                }
                // One stem can belong to multiple image extensions; don't steal a shared caption.
                for sibling in fs::read_dir(source.parent().unwrap()).map_err(|e| e.to_string())? {
                    let sibling = sibling.map_err(|e| e.to_string())?.path();
                    if sibling != source
                        && is_image_path(&sibling)
                        && caption_path_for(&sibling) == cap
                    {
                        return Err(
                            "Caption is shared by multiple image files; resolve their names first"
                                .into(),
                        );
                    }
                }
                Some(make_file(root, &cap, &caption_path_for(&dest))?)
            } else {
                None
            };
            Ok(Pair {
                image: make_file(root, &source, &dest)?,
                caption,
            })
        })();
        match attempt {
            Ok(pair) => pairs.push(pair),
            Err(e) => errors.push(format!("{key}: {e}")),
        }
    }
    if pairs.is_empty() {
        return Ok(MoveResult {
            moved: Vec::new(),
            errors,
            can_undo: can_undo(root)?,
        });
    }
    journal.batches.push(pairs.clone());
    save_json_file_atomic(&journal_path(root), &journal)?;
    let mut moved = Vec::new();
    for pair in pairs {
        let source = safe_journal_path(root, &pair.image.source)?;
        let dest = safe_journal_path(root, &pair.image.dest)?;
        let result = (|| -> Result<(), String> {
            if digest(&source)? != pair.image.hash {
                return Err("Image changed before move; rescan".into());
            }
            move_no_replace(&source, &dest)?;
            if let Some(cap) = &pair.caption {
                let cs = safe_journal_path(root, &cap.source)?;
                let cd = safe_journal_path(root, &cap.dest)?;
                let cap_result = (|| {
                    if digest(&cs)? != cap.hash {
                        return Err("Caption changed before move".into());
                    }
                    move_no_replace(&cs, &cd)
                })();
                if let Err(e) = cap_result {
                    let rollback = move_no_replace(&dest, &source);
                    return Err(format!(
                        "{e}; image rollback: {}",
                        if rollback.is_ok() {
                            "restored"
                        } else {
                            "failed; use Undo exclusion"
                        }
                    ));
                }
            }
            Ok(())
        })();
        match result {
            Ok(()) => moved.push(pair.image.source.clone()),
            Err(e) => errors.push(format!("{}: {e}", pair.image.source)),
        }
    }
    Ok(MoveResult {
        moved,
        errors,
        can_undo: can_undo(root)?,
    })
}
pub fn undo(root: &Path) -> Result<MoveResult, String> {
    let _lock = FILE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut journal: Journal = load_json_file(&journal_path(root))?;
    let mut moved = Vec::new();
    let mut errors = Vec::new();
    let Some(index) = journal.batches.iter().rposition(|batch| {
        batch.iter().any(|p| {
            root.join(&p.image.dest).is_file()
                || p.caption
                    .as_ref()
                    .is_some_and(|c| root.join(&c.dest).is_file())
        })
    }) else {
        return Ok(MoveResult {
            moved,
            errors,
            can_undo: false,
        });
    };
    let batch = journal.batches[index].clone();
    let mut remaining = Vec::new();
    for pair in batch {
        let result = (|| -> Result<(), String> {
            for file in std::iter::once(&pair.image).chain(pair.caption.iter()) {
                if !file.dest.starts_with(&format!("{EXCLUDED}/"))
                    || file.source.starts_with(&format!("{EXCLUDED}/"))
                {
                    return Err("Invalid move journal".into());
                }
                let from = safe_journal_path(root, &file.dest)?;
                let to = safe_journal_path(root, &file.source)?;
                if from.exists() {
                    if to.exists() && (!to.is_file() || digest(&to)? != file.hash) {
                        return Err("Original path is occupied; restore refused".into());
                    }
                    if digest(&from)? != file.hash {
                        return Err("Excluded file changed; restore refused".into());
                    }
                } else if !to.is_file() || digest(&to)? != file.hash {
                    return Err("A moved file is missing or changed".into());
                }
            }
            for file in std::iter::once(&pair.image).chain(pair.caption.iter()) {
                let from = safe_journal_path(root, &file.dest)?;
                let to = safe_journal_path(root, &file.source)?;
                if from.exists() {
                    if to.exists() {
                        /* Recover an interrupted hard-link move; both files were hash-checked above. */
                        fs::remove_file(&from).map_err(|e| e.to_string())?;
                    } else {
                        move_no_replace(&from, &to)?;
                    }
                }
            }
            Ok(())
        })();
        match result {
            Ok(()) => moved.push(pair.image.source.clone()),
            Err(e) => {
                errors.push(format!("{}: {e}", pair.image.source));
                remaining.push(pair);
            }
        }
    }
    journal.batches[index] = remaining;
    save_json_file_atomic(&journal_path(root), &journal)?;
    Ok(MoveResult {
        moved,
        errors,
        can_undo: can_undo(root)?,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paired_move_restore_and_collision() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path().canonicalize().unwrap();
        fs::create_dir_all(r.join("nested")).unwrap();
        fs::write(r.join("nested/a.png"), b"image").unwrap();
        fs::write(r.join("nested/a.txt"), b"caption").unwrap();
        let result = exclude(&r, &["nested/a.png".into()], &[]).unwrap();
        assert_eq!(result.moved.len(), 1);
        assert!(!r.join("nested/a.png").exists());
        assert!(!r.join("nested/a.txt").exists());
        fs::write(r.join("nested/a.png"), b"new image").unwrap();
        assert!(undo(&r).unwrap().moved.is_empty());
        assert_eq!(fs::read(r.join("nested/a.png")).unwrap(), b"new image");
        fs::remove_file(r.join("nested/a.png")).unwrap();
        assert_eq!(undo(&r).unwrap().moved.len(), 1);
        assert_eq!(fs::read(r.join("nested/a.txt")).unwrap(), b"caption");
    }
    #[test]
    fn refuses_traversal_baselines_and_corrupt_journal() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path().canonicalize().unwrap();
        fs::write(r.join("a.png"), b"image").unwrap();
        assert!(relative(&r, "../a.png").is_err());
        assert!(relative(&r, "C:/a.png").is_err());
        assert!(relative(&r, "excluded_by_look/a.png").is_err());
        assert!(exclude(
            &r,
            &["a.png".into()],
            &[r.join("a.png").to_string_lossy().into()]
        )
        .unwrap()
        .moved
        .is_empty());
        fs::create_dir_all(r.join(".lora-studio")).unwrap();
        fs::write(journal_path(&r), b"broken").unwrap();
        assert!(exclude(&r, &["a.png".into()], &[]).is_err());
        assert!(r.join("a.png").exists());
    }
    #[test]
    fn interrupted_link_move_recovers() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path().canonicalize().unwrap();
        fs::write(r.join("a.png"), b"image").unwrap();
        fs::write(r.join("a.txt"), b"caption").unwrap();
        let dest = r.join("excluded_by_look/interrupted/a.png");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        let pair = Pair {
            image: make_file(&r, &r.join("a.png"), &dest).unwrap(),
            caption: Some(make_file(&r, &r.join("a.txt"), &dest.with_extension("txt")).unwrap()),
        };
        save_json_file_atomic(
            &journal_path(&r),
            &Journal {
                batches: vec![vec![pair]],
            },
        )
        .unwrap();
        move_no_replace(&r.join("a.png"), &dest).unwrap();
        fs::hard_link(r.join("a.txt"), dest.with_extension("txt")).unwrap();
        let restored = undo(&r).unwrap();
        assert_eq!(restored.moved, vec!["a.png"]);
        assert!(restored.errors.is_empty());
        assert!(r.join("a.png").is_file());
        assert!(r.join("a.txt").is_file());
        assert!(!dest.with_extension("txt").exists());
    }
    #[test]
    fn shared_caption_is_not_taken() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path().canonicalize().unwrap();
        for (name, data) in [("a.jpg", "one"), ("a.png", "two"), ("a.txt", "shared")] {
            fs::write(r.join(name), data).unwrap();
        }
        let result = exclude(&r, &["a.jpg".into()], &[]).unwrap();
        assert!(result.moved.is_empty());
        assert!(result.errors[0].contains("shared"));
        assert!(r.join("a.txt").exists());
    }
}
