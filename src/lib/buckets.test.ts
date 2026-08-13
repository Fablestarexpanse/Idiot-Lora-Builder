import { describe, it, expect } from "vitest";
import { computeBuckets, BUILTIN_PROFILES } from "@/lib/buckets";
import type { TrainerProfile } from "@/lib/buckets";

function getProfile(id: string): TrainerProfile {
  const p = BUILTIN_PROFILES.find((p) => p.id === id);
  if (!p) throw new Error(`profile ${id} missing`);
  return p;
}

// NOTE: approximateRatioLabel is not exported from buckets.ts, so its
// behavior is verified through the labels on computeBuckets output.
describe.each(["sd15", "sdxl"])("computeBuckets(%s)", (profileId) => {
  const profile = getProfile(profileId);
  const buckets = computeBuckets(profile);

  it("produces at least one bucket, including exactly one square bucket", () => {
    expect(buckets.length).toBeGreaterThan(0);
    const squares = buckets.filter((b) => b.ratio === 1);
    expect(squares).toHaveLength(1);
    expect(squares[0].label).toBe("1:1");
  });

  it("keeps all dimensions within [minRes, maxRes]", () => {
    for (const b of buckets) {
      expect(b.width).toBeGreaterThanOrEqual(profile.minRes);
      expect(b.width).toBeLessThanOrEqual(profile.maxRes);
      expect(b.height).toBeGreaterThanOrEqual(profile.minRes);
      expect(b.height).toBeLessThanOrEqual(profile.maxRes);
    }
  });

  it("keeps all dimensions divisible by the profile step", () => {
    for (const b of buckets) {
      expect(b.width % profile.step).toBe(0);
      expect(b.height % profile.step).toBe(0);
    }
  });

  it("keeps pixel counts within 15% of baseRes^2", () => {
    const basePixels = profile.baseRes * profile.baseRes;
    for (const b of buckets) {
      const deviation = Math.abs(b.width * b.height - basePixels) / basePixels;
      expect(deviation).toBeLessThan(0.15);
    }
  });

  it("deduplicates by ratio rounded to 2 decimals", () => {
    const keys = buckets.map((b) => b.ratio.toFixed(2));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is sorted by ratio ascending (portrait to landscape)", () => {
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].ratio).toBeGreaterThan(buckets[i - 1].ratio);
    }
  });

  it("sets ratio = width / height on every bucket", () => {
    for (const b of buckets) {
      expect(b.ratio).toBeCloseTo(b.width / b.height, 10);
    }
  });
});

describe("ratio dedup keeps the first-scanned bucket", () => {
  // NOTE: documents current behavior — deduplicateByRatio keeps the FIRST
  // bucket encountered per 2-decimal ratio key (scan order: smallest width
  // first), NOT the one closest to baseRes. For SDXL the square bucket is
  // therefore 960x960 (12.1% below 1024^2 pixels), and 1024x1024 is dropped.
  it("SD 1.5 square bucket is 512x512 (base res itself)", () => {
    const square = computeBuckets(getProfile("sd15")).find((b) => b.ratio === 1);
    expect(square).toMatchObject({ width: 512, height: 512 });
  });

  it("SDXL square bucket is 960x960, not the 1024x1024 base res", () => {
    const buckets = computeBuckets(getProfile("sdxl"));
    const square = buckets.find((b) => b.ratio === 1);
    expect(square).toMatchObject({ width: 960, height: 960 });
    expect(
      buckets.find((b) => b.width === 1024 && b.height === 1024)
    ).toBeUndefined();
  });
});

describe("ratio labels (via computeBuckets)", () => {
  it("labels SD1.5 448x576 as ~4:5 (nearest common ratio to 0.778)", () => {
    const buckets = computeBuckets(getProfile("sd15"));
    const b = buckets.find((x) => x.width === 448 && x.height === 576);
    expect(b).toBeDefined();
    expect(b!.label).toBe("~4:5");
  });

  it("labels landscape buckets with a landscape ratio", () => {
    const buckets = computeBuckets(getProfile("sd15"));
    const b = buckets.find((x) => x.width === 640 && x.height === 448);
    expect(b).toBeDefined();
    // 640/448 = 1.43, closest to 3:2 (1.5)
    expect(b!.label).toBe("~3:2");
  });

  it("labels SDXL mirrored portrait/landscape buckets consistently", () => {
    const buckets = computeBuckets(getProfile("sdxl"));
    const portrait = buckets.find((x) => x.width === 896 && x.height === 1152);
    const landscape = buckets.find((x) => x.width === 1152 && x.height === 896);
    expect(portrait).toBeDefined();
    expect(landscape).toBeDefined();
    // 896/1152 = 0.778 is closer to 4:5 (0.8) than 3:4 (0.75);
    // 1152/896 = 1.286 is closer to 5:4 (1.25) than 4:3 (1.333).
    expect(portrait!.label).toBe("~4:5");
    expect(landscape!.label).toBe("~5:4");
  });
});
