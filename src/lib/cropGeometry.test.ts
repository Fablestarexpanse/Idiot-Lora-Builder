import { describe, it, expect } from "vitest";
import {
  largestRectForRatio,
  anchorRect,
  nearestBucket,
  cropResolutionVerdict,
  halfBodyRect,
  faceCropRect,
} from "@/lib/cropGeometry";
import type { FaceBox } from "@/lib/cropGeometry";
import type { BucketSize } from "@/lib/buckets";
import { computeBuckets, BUILTIN_PROFILES } from "@/lib/buckets";

function bucket(width: number, height: number): BucketSize {
  return { width, height, ratio: width / height, label: `${width}x${height}` };
}

describe("largestRectForRatio", () => {
  it("returns the full image when the ratio matches the image exactly", () => {
    expect(largestRectForRatio(1024, 1024, 1)).toEqual({ w: 1024, h: 1024 });
    expect(largestRectForRatio(1600, 900, 16 / 9)).toEqual({ w: 1600, h: 900 });
  });

  it("is width-limited for a ratio wider than the image", () => {
    // 2:1 in a square image -> full width, half height
    expect(largestRectForRatio(1000, 1000, 2)).toEqual({ w: 1000, h: 500 });
  });

  it("is height-limited for a ratio taller than the image", () => {
    // 1:2 in a square image -> full height, half width
    expect(largestRectForRatio(1000, 1000, 0.5)).toEqual({ w: 500, h: 1000 });
  });

  it("square ratio in a landscape image spans the short side", () => {
    expect(largestRectForRatio(1920, 1080, 1)).toEqual({ w: 1080, h: 1080 });
  });

  it("never exceeds image bounds and preserves ratio within rounding", () => {
    const cases: Array<[number, number, number]> = [
      [1237, 811, 4 / 5],
      [333, 999, 3 / 2],
      [50, 50, 16 / 9],
      [2048, 1536, 896 / 1152],
    ];
    for (const [iw, ih, r] of cases) {
      const { w, h } = largestRectForRatio(iw, ih, r);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(h).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(iw);
      expect(h).toBeLessThanOrEqual(ih);
      // ratio exact within integer rounding of the shorter derivation
      expect(Math.abs(w / h - r)).toBeLessThanOrEqual(r / Math.min(w, h) + 1e-9);
      // maximal: growing either side by ~2px would break bounds or ratio
      expect(Math.min(iw - w, (ih - h) * r)).toBeLessThan(2 * Math.max(1, r));
    }
  });

  it("handles degenerate inputs without producing zero-size rects", () => {
    expect(largestRectForRatio(1, 1, 1)).toEqual({ w: 1, h: 1 });
    const tiny = largestRectForRatio(3, 3, 100);
    expect(tiny.w).toBeGreaterThanOrEqual(1);
    expect(tiny.h).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the full image for invalid ratios", () => {
    expect(largestRectForRatio(800, 600, 0)).toEqual({ w: 800, h: 600 });
    expect(largestRectForRatio(800, 600, NaN)).toEqual({ w: 800, h: 600 });
    expect(largestRectForRatio(800, 600, -2)).toEqual({ w: 800, h: 600 });
  });
});

describe("anchorRect", () => {
  it("centers the rect on the anchor when there is room", () => {
    expect(anchorRect(1000, 1000, 200, 100, 500, 500)).toEqual({ x: 400, y: 450 });
  });

  it("clamps to the left/top edges", () => {
    expect(anchorRect(1000, 1000, 200, 200, 10, 10)).toEqual({ x: 0, y: 0 });
  });

  it("clamps to the right/bottom edges", () => {
    expect(anchorRect(1000, 1000, 200, 200, 995, 990)).toEqual({ x: 800, y: 800 });
  });

  it("anchor exactly on a corner stays in bounds", () => {
    expect(anchorRect(640, 480, 100, 100, 0, 480)).toEqual({ x: 0, y: 380 });
  });

  it("pins to 0 when the rect fills the image on an axis", () => {
    expect(anchorRect(1000, 500, 1000, 500, 123, 456)).toEqual({ x: 0, y: 0 });
  });

  it("rounds to integer positions", () => {
    const { x, y } = anchorRect(1000, 1000, 333, 333, 500.4, 499.6);
    expect(Number.isInteger(x)).toBe(true);
    expect(Number.isInteger(y)).toBe(true);
  });
});

describe("nearestBucket", () => {
  const buckets = [
    bucket(832, 1216), // ~0.684
    bucket(896, 1152), // ~0.778
    bucket(1024, 1024), // 1
    bucket(1152, 896), // ~1.286
    bucket(1216, 832), // ~1.462
  ];

  it("picks the exact-ratio bucket for a matching crop", () => {
    expect(nearestBucket(buckets, 2000, 2000)).toMatchObject({
      width: 1024,
      height: 1024,
    });
  });

  it("picks the closest ratio for a near-miss crop", () => {
    // 1500x2000 = 0.75, closest to 0.778 (896x1152)
    expect(nearestBucket(buckets, 1500, 2000)).toMatchObject({
      width: 896,
      height: 1152,
    });
  });

  it("picks a landscape bucket for a landscape crop", () => {
    expect(nearestBucket(buckets, 3000, 2000)).toMatchObject({
      width: 1216,
      height: 832,
    });
  });

  it("tie-breaks equal ratio distance by closest pixel count", () => {
    const tied = [bucket(512, 512), bucket(1024, 1024)];
    // both are ratio 1; a 900x900 crop (810k px) is closer to 1024^2 (1.05M)
    // than to 512^2 (262k)
    expect(nearestBucket(tied, 900, 900)).toMatchObject({
      width: 1024,
      height: 1024,
    });
    expect(nearestBucket(tied, 400, 400)).toMatchObject({
      width: 512,
      height: 512,
    });
  });

  it("returns null for an empty list or degenerate crop", () => {
    expect(nearestBucket([], 100, 100)).toBeNull();
    expect(nearestBucket(buckets, 0, 100)).toBeNull();
    expect(nearestBucket(buckets, 100, 0)).toBeNull();
  });

  it("works against real computeBuckets output for every builtin profile", () => {
    for (const profile of BUILTIN_PROFILES) {
      const bs = computeBuckets(profile);
      const nb = nearestBucket(bs, 4000, 4000);
      expect(nb).not.toBeNull();
      expect(nb!.ratio).toBe(1);
    }
  });
});

describe("cropResolutionVerdict", () => {
  const b = bucket(1024, 1024);

  it("is ok when the crop is larger than the bucket on both axes", () => {
    const v = cropResolutionVerdict(2048, 2048, b);
    expect(v.verdict).toBe("ok");
    expect(v.scale).toBeCloseTo(0.5, 10);
  });

  it("is ok exactly at bucket dimensions (boundary)", () => {
    const v = cropResolutionVerdict(1024, 1024, b);
    expect(v.verdict).toBe("ok");
    expect(v.scale).toBe(1);
  });

  it("is upscale one pixel below the bucket (boundary)", () => {
    const v = cropResolutionVerdict(1023, 1024, b);
    expect(v.verdict).toBe("upscale");
    expect(v.scale).toBeGreaterThan(1);
  });

  it("uses the worst axis: big on one axis, small on the other = upscale", () => {
    const wide = bucket(1216, 832);
    const v = cropResolutionVerdict(4000, 500, wide);
    expect(v.verdict).toBe("upscale");
    expect(v.scale).toBeCloseTo(832 / 500, 10);
  });

  it("reports the scale factor the trainer would apply", () => {
    const v = cropResolutionVerdict(731, 731, b);
    expect(v.scale).toBeCloseTo(1024 / 731, 10);
  });
});

describe("halfBodyRect", () => {
  const face: FaceBox = { x: 900, y: 300, width: 200, height: 200 };

  it("sizes the box so face height is ~1/4 of box height", () => {
    const r = halfBodyRect(2000, 2000, 4 / 5, face);
    expect(r.h).toBe(800); // face.height * 4
    expect(r.w).toBe(640); // h * ratio
  });

  it("keeps the face in the upper part of the box (waist-up)", () => {
    const r = halfBodyRect(2000, 2000, 4 / 5, face);
    const faceCy = face.y + face.height / 2; // 400
    // face center around the top quarter of the box, well above its middle
    expect(faceCy - r.y).toBeLessThan(r.h / 2);
    expect(faceCy).toBeGreaterThanOrEqual(r.y);
    // horizontally centered on the face
    expect(r.x + r.w / 2).toBeCloseTo(face.x + face.width / 2, 0);
  });

  it("shrinks to fit the image while keeping the ratio", () => {
    const small = halfBodyRect(600, 500, 1, face); // desired 800 > image
    expect(small.w).toBeLessThanOrEqual(600);
    expect(small.h).toBeLessThanOrEqual(500);
    expect(small.w).toBe(small.h); // ratio 1 preserved
    expect(small.h).toBe(500); // as large as fits
  });

  it("clamps position to bounds for a face near the bottom edge", () => {
    const lowFace: FaceBox = { x: 100, y: 1800, width: 150, height: 150 };
    const r = halfBodyRect(2000, 2000, 1, lowFace);
    expect(r.y + r.h).toBeLessThanOrEqual(2000);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });

  it("falls back to ratio 1 for invalid ratios", () => {
    const r = halfBodyRect(2000, 2000, 0, face);
    expect(r.w).toBe(r.h);
  });
});

describe("faceCropRect", () => {
  const face: FaceBox = { x: 500, y: 400, width: 200, height: 250 };

  it("is square with side = 2.2x the larger face dimension, centered", () => {
    const r = faceCropRect(3000, 3000, face);
    expect(r.w).toBe(550); // 250 * 2.2
    expect(r.h).toBe(550);
    expect(r.x + r.w / 2).toBeCloseTo(face.x + face.width / 2, 0);
    expect(r.y + r.h / 2).toBeCloseTo(face.y + face.height / 2, 0);
  });

  it("caps the side at the image's shorter dimension", () => {
    const r = faceCropRect(500, 800, face);
    expect(r.w).toBe(500);
    expect(r.h).toBe(500);
    expect(r.x).toBe(0);
  });

  it("clamps to bounds for a face in a corner", () => {
    const corner: FaceBox = { x: 0, y: 0, width: 100, height: 100 };
    const r = faceCropRect(1000, 1000, corner);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.w).toBe(220);
  });

  it("honors a custom scale multiplier", () => {
    const r = faceCropRect(3000, 3000, face, 3);
    expect(r.w).toBe(750);
  });
});
