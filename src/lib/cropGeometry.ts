// Pure crop-geometry math for the crop tool. Everything here works in
// ORIGINAL image coordinates (the space the crop rect is stored in);
// display-space mapping (flips) stays in CropModal.

import type { BucketSize } from "@/lib/buckets";

export interface RectSize {
  w: number;
  h: number;
}

export interface RectPos {
  x: number;
  y: number;
}

export interface Rect extends RectPos, RectSize {}

/** Matches the shape of FaceRegion from detect_faces (confidence not needed). */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolutionVerdict {
  /** "ok" = crop covers the bucket dims; "upscale" = trainer would upscale. */
  verdict: "ok" | "upscale";
  /** Factor the trainer would scale the crop by to cover the bucket (>1 = upscale). */
  scale: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Largest rect of exactly the given ratio (w/h) that fits an imgW x imgH
 * image. Exact up to integer rounding; always at least 1x1 and never larger
 * than the image.
 */
export function largestRectForRatio(
  imgW: number,
  imgH: number,
  ratio: number
): RectSize {
  const safeW = Math.max(1, Math.floor(imgW));
  const safeH = Math.max(1, Math.floor(imgH));
  if (!Number.isFinite(ratio) || ratio <= 0) return { w: safeW, h: safeH };
  let w = safeW;
  let h = w / ratio;
  if (h > safeH) {
    h = safeH;
    w = h * ratio;
  }
  return {
    w: clamp(Math.round(w), 1, safeW),
    h: clamp(Math.round(h), 1, safeH),
  };
}

/**
 * Position a w x h rect centered on (anchorX, anchorY), clamped so it stays
 * inside the imgW x imgH bounds. If the rect is as large as the image on an
 * axis, that axis pins to 0.
 */
export function anchorRect(
  imgW: number,
  imgH: number,
  w: number,
  h: number,
  anchorX: number,
  anchorY: number
): RectPos {
  return {
    x: clamp(Math.round(anchorX - w / 2), 0, Math.max(0, imgW - w)),
    y: clamp(Math.round(anchorY - h / 2), 0, Math.max(0, imgH - h)),
  };
}

/**
 * The bucket whose ratio is closest to w/h. Ties on ratio distance break
 * toward the bucket whose pixel count is closest to the crop's pixel count.
 * Returns null for an empty bucket list or degenerate crop.
 */
export function nearestBucket(
  buckets: BucketSize[],
  w: number,
  h: number
): BucketSize | null {
  if (buckets.length === 0 || w <= 0 || h <= 0) return null;
  const cropRatio = w / h;
  const cropPixels = w * h;
  const EPS = 1e-9;
  let best: BucketSize = buckets[0];
  let bestRatioDiff = Math.abs(best.ratio - cropRatio);
  let bestPixelDiff = Math.abs(best.width * best.height - cropPixels);
  for (let i = 1; i < buckets.length; i++) {
    const b = buckets[i];
    const ratioDiff = Math.abs(b.ratio - cropRatio);
    const pixelDiff = Math.abs(b.width * b.height - cropPixels);
    if (
      ratioDiff < bestRatioDiff - EPS ||
      (Math.abs(ratioDiff - bestRatioDiff) <= EPS && pixelDiff < bestPixelDiff)
    ) {
      best = b;
      bestRatioDiff = ratioDiff;
      bestPixelDiff = pixelDiff;
    }
  }
  return best;
}

/**
 * Would the trainer upscale this crop to fill the bucket? scale is the factor
 * needed to COVER the bucket (max of per-axis factors); <= 1 means the crop
 * already has enough pixels on both axes.
 */
export function cropResolutionVerdict(
  cropW: number,
  cropH: number,
  bucket: BucketSize
): ResolutionVerdict {
  const safeW = Math.max(1, cropW);
  const safeH = Math.max(1, cropH);
  const scale = Math.max(bucket.width / safeW, bucket.height / safeH);
  return { verdict: scale <= 1 ? "ok" : "upscale", scale };
}

/**
 * "half" framing: a rect at the given ratio around the face, sized so the
 * face height is ~1/4 of the box height (waist-up feel). The face center is
 * biased toward the upper quarter of the box (head up top, body below);
 * everything is clamped to bounds, shrinking to fit while keeping the ratio.
 */
export function halfBodyRect(
  imgW: number,
  imgH: number,
  ratio: number,
  face: FaceBox
): Rect {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const desiredH = face.height * 4;
  const maxH = Math.min(imgH, imgW / safeRatio);
  const h = clamp(Math.round(Math.min(desiredH, maxH)), 1, imgH);
  const w = clamp(Math.round(h * safeRatio), 1, imgW);
  const faceCx = face.x + face.width / 2;
  const faceCy = face.y + face.height / 2;
  // Face center at ~1/4 from the top of the box: anchor the box center at
  // faceCy + h/4 so the box extends mostly downward from the face.
  const pos = anchorRect(imgW, imgH, w, h, faceCx, faceCy + h / 4);
  return { ...pos, w, h };
}

/**
 * "face" framing: a 1:1 rect centered on the face, side = 2.2x the face's
 * larger dimension, clamped to the image (side capped at min(imgW, imgH)).
 */
export function faceCropRect(
  imgW: number,
  imgH: number,
  face: FaceBox,
  scale = 2.2
): Rect {
  const side = clamp(
    Math.round(Math.max(face.width, face.height) * scale),
    1,
    Math.max(1, Math.min(imgW, imgH))
  );
  const pos = anchorRect(
    imgW,
    imgH,
    side,
    side,
    face.x + face.width / 2,
    face.y + face.height / 2
  );
  return { ...pos, w: side, h: side };
}
