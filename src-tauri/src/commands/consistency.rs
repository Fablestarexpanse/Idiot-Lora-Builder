//! Dataset look-consistency scans and persisted results.
use super::{
    common::{load_json_file, save_json_file_atomic},
    consistency_files::{self, Stamp},
    face_embedding::{self, Embedding, FaceModels},
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter};
static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static MODELS: Lazy<Mutex<Option<FaceModels>>> = Lazy::new(|| Mutex::new(None));
static CACHE: Lazy<Mutex<HashMap<String, (Stamp, Option<Vec<f32>>, usize)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
struct BusyGuard;
impl Drop for BusyGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Baseline {
    pub path: String,
    pub stamp: Stamp,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Score {
    pub relative_path: String,
    pub similarity: Option<f32>,
    pub face_count: usize,
    pub error: Option<String>,
    pub stamp: Stamp,
    pub baseline: bool,
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Scan {
    pub baselines: Vec<Baseline>,
    pub scores: Vec<Score>,
    pub suggested_cutoff: Option<f32>,
    pub can_undo: bool,
    pub model: String,
}
#[derive(Deserialize)]
pub struct ScanPayload {
    pub root_path: String,
    pub baseline_paths: Vec<String>,
    pub relative_paths: Vec<String>,
}
#[derive(Deserialize)]
pub struct RootPayload {
    pub root_path: String,
}
#[derive(Deserialize)]
pub struct MovePayload {
    pub root_path: String,
    pub relative_paths: Vec<String>,
}
#[derive(Clone, Serialize)]
struct Progress {
    current: usize,
    total: usize,
    phase: String,
}
fn saved_path(root: &Path) -> PathBuf {
    root.join(".lora-studio/look-consistency.json")
}
fn canonical_baseline(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Baseline is missing: {e}"))?;
    if !path.is_file() || !super::common::is_image_path(&path) {
        return Err("Baseline must be an image file".into());
    }
    Ok(path)
}
fn embedding(models: &mut FaceModels, path: &Path) -> Result<Embedding, String> {
    let key = path.to_string_lossy().to_string();
    let fingerprint = consistency_files::stamp(path)?;
    {
        let cache = CACHE.lock().map_err(|e| e.to_string())?;
        if let Some((stamp, vector, face_count)) = cache.get(&key) {
            if *stamp == fingerprint {
                return Ok(Embedding {
                    vector: vector.clone(),
                    face_count: *face_count,
                });
            }
        }
    }
    let result = models.embed(path)?;
    if consistency_files::stamp(path)? != fingerprint {
        return Err("Image changed during analysis; scan again".into());
    }
    let mut cache = CACHE.lock().map_err(|e| e.to_string())?;
    if cache.len() >= 10000 {
        cache.clear();
    }
    cache.insert(key, (fingerprint, result.vector.clone(), result.face_count));
    Ok(result)
}
// Match Fizgig exactly: upper-middle median and index-based quartiles, not interpolated percentiles.
pub fn cutoff(scores: &[Score]) -> Option<f32> {
    let mut values: Vec<f32> = scores
        .iter()
        .filter_map(|s| s.similarity)
        .filter(|v| v.is_finite())
        .collect();
    if values.len() < 4 {
        return None;
    }
    values.sort_by(f32::total_cmp);
    let n = values.len();
    Some((values[n / 2] - 1.5 * (values[3 * n / 4] - values[n / 4])).max(0.25))
}
fn fresh_scan(root: &Path) -> Result<Scan, String> {
    let mut scan: Scan = load_json_file(&saved_path(root))?;
    if scan.model != "buffalo_l/arcface-v1"
        || scan.baselines.len() != 3
        || scan.baselines.iter().any(|b| {
            canonical_baseline(&b.path)
                .and_then(|p| consistency_files::stamp(&p))
                .ok()
                .as_ref()
                != Some(&b.stamp)
        })
    {
        scan = Scan::default();
    }
    scan.scores.retain(|s| {
        consistency_files::relative(root, &s.relative_path)
            .and_then(|p| consistency_files::stamp(&p))
            .ok()
            .as_ref()
            == Some(&s.stamp)
    });
    scan.suggested_cutoff = cutoff(&scan.scores);
    scan.can_undo = consistency_files::can_undo(root)?;
    Ok(scan)
}
#[tauri::command]
pub async fn load_consistency(payload: RootPayload) -> Result<Scan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = consistency_files::root(&payload.root_path)?;
        fresh_scan(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_consistency_scan() {
    CANCEL.store(true, Ordering::SeqCst);
}
#[tauri::command]
pub async fn scan_consistency(app: AppHandle, payload: ScanPayload) -> Result<Scan, String> {
    if BUSY
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("A consistency operation is already running".into());
    }
    let guard = BusyGuard;
    CANCEL.store(false, Ordering::SeqCst);
    if payload.baseline_paths.len() != 3 {
        return Err("Choose exactly three baseline images".into());
    }
    let root = consistency_files::root(&payload.root_path)?;
    // Refuse to overwrite a malformed sidecar.
    let _: Scan = load_json_file(&saved_path(&root))?;
    let baselines: Vec<PathBuf> = payload
        .baseline_paths
        .iter()
        .map(|p| canonical_baseline(p))
        .collect::<Result<_, _>>()?;
    if baselines.iter().collect::<HashSet<_>>().len() != 3 {
        return Err("Choose three different baseline files".into());
    }
    let mut seen = HashSet::new();
    let paths: Vec<(String, PathBuf)> = payload
        .relative_paths
        .iter()
        .map(|key| {
            let p = consistency_files::relative(&root, key)?;
            let key = super::common::normalize_rel_key(
                p.strip_prefix(&root)
                    .map_err(|e| e.to_string())?
                    .to_str()
                    .ok_or("Invalid filename")?,
            );
            Ok((key, p))
        })
        .collect::<Result<Vec<_>, String>>()?
        .into_iter()
        .filter(|(_, p)| seen.insert(p.clone()))
        .collect();
    if paths.is_empty() {
        return Err("No dataset images to scan".into());
    }
    let _ = app.emit(
        "consistency-progress",
        Progress {
            current: 0,
            total: paths.len(),
            phase: "Preparing face models. First use downloads buffalo_l (about 300 MB).".into(),
        },
    );
    let dir = face_embedding::ensure_models(&app).await?;
    let runtime = super::models::ensure_onnxruntime(&app).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Scan, String> {
        let _guard = guard;
        let mut models = MODELS.lock().map_err(|e| e.to_string())?;
        if models.is_none() {
            *models = Some(FaceModels::load(&dir, &runtime)?);
        }
        let models = models.as_mut().unwrap();
        let mut baseline_vectors = Vec::new();
        let mut refs = Vec::new();
        for path in &baselines {
            if CANCEL.load(Ordering::SeqCst) {
                return Err("Scan cancelled".into());
            }
            let before = consistency_files::stamp(path)?;
            let emb = embedding(models, path)?;
            if emb.face_count != 1 {
                return Err(format!(
                    "Baseline {} must contain exactly one detectable face",
                    path.file_name().unwrap_or_default().to_string_lossy()
                ));
            }
            baseline_vectors.push(emb.vector.ok_or("Baseline has no detectable face")?);
            refs.push(Baseline {
                path: path.to_string_lossy().to_string(),
                stamp: before,
            });
        }
        let mut scores = Vec::new();
        let total = paths.len();
        for (i, (key, path)) in paths.into_iter().enumerate() {
            if CANCEL.load(Ordering::SeqCst) {
                return Err("Scan cancelled".into());
            }
            let fingerprint = consistency_files::stamp(&path)?;
            let baseline = baselines.contains(&path);
            let (similarity, face_count, error) = match embedding(models, &path) {
                Ok(e) => {
                    let sim = e.vector.as_ref().map(|v| {
                        baseline_vectors
                            .iter()
                            .map(|b| face_embedding::similarity(v, b))
                            .sum::<f32>()
                            / 3.0
                    });
                    (sim, e.face_count, None)
                }
                Err(e) => (None, 0, Some(e)),
            };
            scores.push(Score {
                relative_path: key,
                similarity,
                face_count,
                error,
                stamp: fingerprint,
                baseline,
            });
            let _ = app.emit(
                "consistency-progress",
                Progress {
                    current: i + 1,
                    total,
                    phase: "Comparing faces to your baselines".into(),
                },
            );
        }
        if CANCEL.load(Ordering::SeqCst) {
            return Err("Scan cancelled".into());
        }
        for b in &refs {
            if consistency_files::stamp(Path::new(&b.path))? != b.stamp {
                return Err("A baseline changed during the scan; scan again".into());
            }
        }
        let suggested_cutoff = cutoff(&scores);
        let scan = Scan {
            baselines: refs,
            scores,
            suggested_cutoff,
            can_undo: consistency_files::can_undo(&root)?,
            model: "buffalo_l/arcface-v1".into(),
        };
        save_json_file_atomic(&saved_path(&root), &scan)?;
        Ok(scan)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn exclude_consistency(
    payload: MovePayload,
) -> Result<consistency_files::MoveResult, String> {
    if BUSY
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("A consistency operation is already running".into());
    }
    let guard = BusyGuard;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let root = consistency_files::root(&payload.root_path)?;
        let scan = fresh_scan(&root)?;
        if scan.baselines.len() != 3 {
            return Err("Baselines changed or no saved scan; scan again before moving".into());
        }
        let valid: HashSet<_> = scan
            .scores
            .iter()
            .map(|s| s.relative_path.as_str())
            .collect();
        if payload
            .relative_paths
            .iter()
            .any(|p| !valid.contains(p.as_str()))
        {
            return Err("An image changed or is missing; scan again before moving".into());
        }
        let protected = scan
            .baselines
            .iter()
            .map(|b| b.path.clone())
            .collect::<Vec<_>>();
        consistency_files::exclude(&root, &payload.relative_paths, &protected)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn undo_consistency_exclusion(
    payload: RootPayload,
) -> Result<consistency_files::MoveResult, String> {
    if BUSY
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("A consistency operation is already running".into());
    }
    let guard = BusyGuard;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        consistency_files::undo(&consistency_files::root(&payload.root_path)?)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn score(v: Option<f32>) -> Score {
        Score {
            relative_path: "a.png".into(),
            similarity: v,
            face_count: 1,
            error: None,
            stamp: Stamp::default(),
            baseline: false,
        }
    }
    #[test]
    fn fizgig_cutoff_requires_four_faces_and_uses_floor() {
        assert_eq!(cutoff(&vec![score(Some(0.2)); 3]), None);
        assert_eq!(
            cutoff(&[
                score(Some(0.1)),
                score(Some(0.3)),
                score(Some(0.4)),
                score(Some(0.5)),
                score(None)
            ]),
            Some(0.25)
        );
        let values = [0.1, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76];
        let got = cutoff(&values.map(|v| score(Some(v)))).unwrap();
        assert!((got - 0.67).abs() < 1e-5);
    }
    #[test]
    fn changed_image_invalidates_saved_score() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path().canonicalize().unwrap();
        let mut scan = Scan {
            model: "buffalo_l/arcface-v1".into(),
            ..Default::default()
        };
        for n in 0..3 {
            let p = r.join(format!("base{n}.png"));
            std::fs::write(&p, "baseline").unwrap();
            scan.baselines.push(Baseline {
                path: p.to_string_lossy().into(),
                stamp: consistency_files::stamp(&p).unwrap(),
            });
        }
        let p = r.join("a.png");
        std::fs::write(&p, "image").unwrap();
        let mut s = score(Some(0.5));
        s.stamp = consistency_files::stamp(&p).unwrap();
        scan.scores.push(s);
        save_json_file_atomic(&saved_path(&r), &scan).unwrap();
        assert_eq!(fresh_scan(&r).unwrap().scores.len(), 1);
        std::fs::write(p, "changed image").unwrap();
        assert!(fresh_scan(&r).unwrap().scores.is_empty());
    }
}
