//! Native CPU implementation of buffalo_l SCRFD + ArcFace inference.
//! Workflow inspired by Fizgig; model preprocessing follows InsightFace's MIT code.
use image::{imageops, RgbImage};
use ort::{session::Session, value::Tensor};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub struct FaceModels {
    detector: Session,
    recognizer: Session,
}
#[derive(Clone)]
struct Face {
    bbox: [f32; 4],
    points: [[f32; 2]; 5],
    score: f32,
}
pub struct Embedding {
    pub vector: Option<Vec<f32>>,
    pub face_count: usize,
}

pub async fn ensure_models(app: &AppHandle) -> Result<PathBuf, String> {
    // Reuse the standard InsightFace cache when Fizgig already installed the models.
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let cached = PathBuf::from(home).join(".insightface/models/buffalo_l");
        if ["det_10g.onnx", "w600k_r50.onnx"]
            .iter()
            .all(|f| cached.join(f).is_file())
        {
            return Ok(cached);
        }
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("builtin/models/buffalo_l");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if ["det_10g.onnx", "w600k_r50.onnx"]
        .iter()
        .all(|f| dir.join(f).is_file())
    {
        return Ok(dir);
    }
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?
        .get("https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip")
        .send()
        .await
        .map_err(|e| format!("Face model download failed: {e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let target = dir.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut archive =
            zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
        for name in ["det_10g.onnx", "w600k_r50.onnx"] {
            let mut entry = archive
                .by_name(name)
                .map_err(|e| format!("Missing {name}: {e}"))?;
            let tmp = target.join(format!("{name}.part"));
            let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            std::fs::rename(tmp, target.join(name)).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(dir)
}
impl FaceModels {
    pub fn load(dir: &Path, runtime: &Path) -> Result<Self, String> {
        super::detect::init_ort_once(runtime)?;
        let load = |name: &str| {
            Session::builder()
                .map_err(|e| e.to_string())?
                .with_intra_threads(2)
                .map_err(|e| e.to_string())?
                .commit_from_file(dir.join(name))
                .map_err(|e| format!("Could not load {name}: {e}"))
        };
        Ok(Self {
            detector: load("det_10g.onnx")?,
            recognizer: load("w600k_r50.onnx")?,
        })
    }
    pub fn embed(&mut self, path: &Path) -> Result<Embedding, String> {
        let img = image::open(path)
            .map_err(|e| format!("Cannot read image: {e}"))?
            .to_rgb8();
        let faces = self.detect(&img)?;
        let count = faces.len();
        // Same as Fizgig: score the largest face. Multi-face rows require manual review.
        let Some(face) = faces.into_iter().max_by(|a, b| area(a).total_cmp(&area(b))) else {
            return Ok(Embedding {
                vector: None,
                face_count: 0,
            });
        };
        let crop = align(&img, &face.points)?;
        let mut pixels = vec![0f32; 3 * 112 * 112];
        for (x, y, p) in crop.enumerate_pixels() {
            for c in 0..3 {
                pixels[c * 112 * 112 + y as usize * 112 + x as usize] =
                    (p[c] as f32 - 127.5) / 127.5;
            }
        }
        let input =
            Tensor::from_array(([1usize, 3, 112, 112], pixels)).map_err(|e| e.to_string())?;
        let output = self
            .recognizer
            .run(ort::inputs![input])
            .map_err(|e| format!("ArcFace inference failed: {e}"))?;
        let (_, values) = output[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| e.to_string())?;
        let norm = values.iter().map(|v| v * v).sum::<f32>().sqrt();
        if values.len() != 512 || !norm.is_finite() || norm < 1e-8 {
            return Err("Invalid ArcFace embedding".into());
        }
        Ok(Embedding {
            vector: Some(values.iter().map(|v| v / norm).collect()),
            face_count: count,
        })
    }
    fn detect(&mut self, img: &RgbImage) -> Result<Vec<Face>, String> {
        let (w, h) = img.dimensions();
        if w == 0 || h == 0 {
            return Err("Empty image".into());
        }
        let scale = 640.0 / w.max(h) as f32;
        let rw = (w as f32 * scale) as u32;
        let rh = (h as f32 * scale) as u32;
        let resized = imageops::resize(img, rw.max(1), rh.max(1), imageops::FilterType::Triangle);
        // InsightFace: top-left letterbox, RGB NCHW, (pixel-127.5)/128.
        let mut pixels = vec![-127.5 / 128.0; 3 * 640 * 640];
        for (x, y, p) in resized.enumerate_pixels() {
            for c in 0..3 {
                pixels[c * 640 * 640 + y as usize * 640 + x as usize] =
                    (p[c] as f32 - 127.5) / 128.0;
            }
        }
        let input =
            Tensor::from_array(([1usize, 3, 640, 640], pixels)).map_err(|e| e.to_string())?;
        let out = self
            .detector
            .run(ort::inputs![input])
            .map_err(|e| format!("Face detection failed: {e}"))?;
        if out.len() != 9 {
            return Err("Unexpected buffalo_l detector outputs".into());
        }
        let mut candidates = Vec::new();
        for (level, stride) in [8usize, 16, 32].iter().enumerate() {
            let (_, scores) = out[level]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            let (_, boxes) = out[level + 3]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            let (_, points) = out[level + 6]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            let columns = 640 / stride;
            if scores.len() != columns * columns * 2
                || boxes.len() != scores.len() * 4
                || points.len() != scores.len() * 10
            {
                return Err("Unexpected SCRFD output dimensions".into());
            }
            for (i, &score) in scores.iter().enumerate() {
                if score < 0.5 {
                    continue;
                }
                let cx = ((i / 2) % columns * stride) as f32;
                let cy = ((i / 2) / columns * stride) as f32;
                let s = *stride as f32;
                let b = &boxes[i * 4..i * 4 + 4];
                let mut landmarks = [[0.0; 2]; 5];
                for j in 0..5 {
                    landmarks[j] = [
                        (cx + points[i * 10 + j * 2] * s) / scale,
                        (cy + points[i * 10 + j * 2 + 1] * s) / scale,
                    ];
                }
                candidates.push(Face {
                    bbox: [
                        (cx - b[0] * s) / scale,
                        (cy - b[1] * s) / scale,
                        (cx + b[2] * s) / scale,
                        (cy + b[3] * s) / scale,
                    ],
                    points: landmarks,
                    score,
                });
            }
        }
        candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
        let mut kept: Vec<Face> = Vec::new();
        for face in candidates {
            if kept.iter().all(|other| iou(&face, other) < 0.4) {
                kept.push(face);
            }
        }
        Ok(kept)
    }
}
fn area(f: &Face) -> f32 {
    (f.bbox[2] - f.bbox[0]).max(0.0) * (f.bbox[3] - f.bbox[1]).max(0.0)
}
fn iou(a: &Face, b: &Face) -> f32 {
    let intersection = (a.bbox[2].min(b.bbox[2]) - a.bbox[0].max(b.bbox[0]) + 1.0).max(0.0)
        * (a.bbox[3].min(b.bbox[3]) - a.bbox[1].max(b.bbox[1]) + 1.0).max(0.0);
    let aa = (a.bbox[2] - a.bbox[0] + 1.0) * (a.bbox[3] - a.bbox[1] + 1.0);
    let bb = (b.bbox[2] - b.bbox[0] + 1.0) * (b.bbox[3] - b.bbox[1] + 1.0);
    intersection / (aa + bb - intersection).max(1e-8)
}
const TARGET: [[f32; 2]; 5] = [
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
];
// Least-squares similarity transform (rotation + uniform scale, no reflection).
fn transform(points: &[[f32; 2]; 5]) -> Result<[f32; 4], String> {
    let mut sx = 0.0;
    let mut sy = 0.0;
    let mut dx = 0.0;
    let mut dy = 0.0;
    for i in 0..5 {
        sx += points[i][0] / 5.0;
        sy += points[i][1] / 5.0;
        dx += TARGET[i][0] / 5.0;
        dy += TARGET[i][1] / 5.0;
    }
    let mut denominator = 0.0;
    let mut a = 0.0;
    let mut b = 0.0;
    for i in 0..5 {
        let x = points[i][0] - sx;
        let y = points[i][1] - sy;
        let u = TARGET[i][0] - dx;
        let v = TARGET[i][1] - dy;
        denominator += x * x + y * y;
        a += x * u + y * v;
        b += x * v - y * u;
    }
    if denominator < 1e-6 {
        return Err("Face landmarks cannot be aligned".into());
    }
    a /= denominator;
    b /= denominator;
    if !a.is_finite() || !b.is_finite() || a * a + b * b < 1e-8 {
        return Err("Invalid face alignment".into());
    }
    Ok([a, b, dx - a * sx + b * sy, dy - b * sx - a * sy])
}
fn align(img: &RgbImage, points: &[[f32; 2]; 5]) -> Result<RgbImage, String> {
    let [a, b, tx, ty] = transform(points)?;
    let det = a * a + b * b;
    let mut crop = RgbImage::new(112, 112);
    for (x, y, p) in crop.enumerate_pixels_mut() {
        let u = x as f32 - tx;
        let v = y as f32 - ty;
        let sx = (a * u + b * v) / det;
        let sy = (-b * u + a * v) / det;
        let ix = sx.floor() as i32;
        let iy = sy.floor() as i32;
        let fx = sx - ix as f32;
        let fy = sy - iy as f32;
        for c in 0..3 {
            let mut value = 0.0;
            for (ox, oy, weight) in [
                (0, 0, (1.0 - fx) * (1.0 - fy)),
                (1, 0, fx * (1.0 - fy)),
                (0, 1, (1.0 - fx) * fy),
                (1, 1, fx * fy),
            ] {
                let px = ix + ox;
                let py = iy + oy;
                if px >= 0 && py >= 0 && px < img.width() as i32 && py < img.height() as i32 {
                    value += img.get_pixel(px as u32, py as u32)[c] as f32 * weight;
                }
            }
            p[c] = value.round().clamp(0.0, 255.0) as u8;
        }
    }
    Ok(crop)
}
pub fn similarity(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b)
        .map(|(x, y)| x * y)
        .sum::<f32>()
        .clamp(-1.0, 1.0)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn alignment_recovers_identity_and_rotation() {
        let t = transform(&TARGET).unwrap();
        assert!((t[0] - 1.0).abs() < 1e-5);
        assert!(t[1].abs() < 1e-5);
        let src = TARGET.map(|[x, y]| [-2.0 * y + 20.0, 2.0 * x + 10.0]);
        let t = transform(&src).unwrap();
        for i in 0..5 {
            let [x, y] = src[i];
            assert!((t[0] * x - t[1] * y + t[2] - TARGET[i][0]).abs() < 0.001);
            assert!((t[1] * x + t[0] * y + t[3] - TARGET[i][1]).abs() < 0.001);
        }
    }
    #[test]
    fn similarity_identical_orthogonal_and_opposite() {
        assert_eq!(similarity(&[1., 0.], &[1., 0.]), 1.);
        assert_eq!(similarity(&[1., 0.], &[0., 1.]), 0.);
        assert_eq!(similarity(&[1., 0.], &[-1., 0.]), -1.);
    }
    #[test]
    #[ignore = "requires downloaded buffalo_l, runtime, and real test faces"]
    fn real_face_inference() {
        let dir = PathBuf::from(std::env::var("ILB_FACE_MODELS").unwrap());
        let runtime = PathBuf::from(std::env::var("ILB_ORT_DLL").unwrap());
        let face = PathBuf::from(std::env::var("ILB_TEST_FACE").unwrap());
        let other = PathBuf::from(std::env::var("ILB_TEST_OTHER_FACE").unwrap());
        let mut models = FaceModels::load(&dir, &runtime).unwrap();
        let a = models.embed(&face).unwrap().vector.unwrap();
        let b = models.embed(&face).unwrap().vector.unwrap();
        let c = models.embed(&other).unwrap().vector.unwrap();
        let same = similarity(&a, &b);
        let different = similarity(&a, &c);
        println!("same={same}, different={different}");
        assert!(same > 0.99);
        assert!(different < same - 0.2);
    }
}
