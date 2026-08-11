export interface BucketSize {
  width: number;
  height: number;
  ratio: number;
  label: string;
}

export interface TrainerProfile {
  id: string;
  name: string;
  baseRes: number;
  step: number;
  minRes: number;
  maxRes: number;
}

export const BUILTIN_PROFILES: TrainerProfile[] = [
  { id: "sd15", name: "SD 1.5", baseRes: 512, step: 64, minRes: 256, maxRes: 768 },
  { id: "sdxl", name: "SDXL", baseRes: 1024, step: 64, minRes: 512, maxRes: 1536 },
  { id: "flux_aitoolkit", name: "Flux (ai-toolkit)", baseRes: 1024, step: 64, minRes: 512, maxRes: 1536 },
  { id: "flux_kohya", name: "Flux (kohya)", baseRes: 1024, step: 64, minRes: 512, maxRes: 1536 },
  { id: "chroma", name: "Chroma", baseRes: 1024, step: 64, minRes: 512, maxRes: 1536 },
];

function approximateRatioLabel(w: number, h: number): string {
  const ratio = w / h;
  const common: [number, string][] = [
    [1, "1:1"],
    [4 / 5, "~4:5"],
    [3 / 4, "~3:4"],
    [2 / 3, "~2:3"],
    [9 / 16, "~9:16"],
    [5 / 4, "~5:4"],
    [4 / 3, "~4:3"],
    [3 / 2, "~3:2"],
    [16 / 9, "~16:9"],
    [2 / 1, "~2:1"],
    [1 / 2, "~1:2"],
  ];
  
  let best = common[0];
  let minDiff = Math.abs(ratio - common[0][0]);
  
  for (const [r, label] of common) {
    const diff = Math.abs(ratio - r);
    if (diff < minDiff) {
      minDiff = diff;
      best = [r, label];
    }
  }
  
  return best[1];
}

function deduplicateByRatio(buckets: BucketSize[]): BucketSize[] {
  // Group by ratio (rounded to 2 decimals), keep one per group
  const groups = new Map<string, BucketSize>();
  
  for (const bucket of buckets) {
    const key = bucket.ratio.toFixed(2);
    if (!groups.has(key)) {
      groups.set(key, bucket);
    }
  }
  
  // Sort by ratio (portrait to landscape)
  return Array.from(groups.values()).sort((a, b) => a.ratio - b.ratio);
}

export function computeBuckets(profile: TrainerProfile): BucketSize[] {
  const basePixels = profile.baseRes * profile.baseRes;
  const buckets: BucketSize[] = [];
  
  for (let w = profile.minRes; w <= profile.maxRes; w += profile.step) {
    for (let h = profile.minRes; h <= profile.maxRes; h += profile.step) {
      const pixels = w * h;
      const deviation = Math.abs(pixels - basePixels) / basePixels;
      if (deviation < 0.15) {
        buckets.push({
          width: w,
          height: h,
          ratio: w / h,
          label: approximateRatioLabel(w, h),
        });
      }
    }
  }
  
  return deduplicateByRatio(buckets);
}

export function getBucketAssignment(
  w: number,
  h: number,
  profile: TrainerProfile
): {
  bucket: BucketSize;
  cropLoss: number;
  match: "exact" | "close" | "significant";
} {
  const buckets = computeBuckets(profile);
  const targetRatio = w / h;
  
  let closest = buckets[0];
  let minDiff = Math.abs(closest.ratio - targetRatio);
  
  for (const bucket of buckets) {
    const diff = Math.abs(bucket.ratio - targetRatio);
    if (diff < minDiff) {
      minDiff = diff;
      closest = bucket;
    }
  }
  
  const cropLoss = Math.abs(closest.width * closest.height - w * h) / (w * h);
  const match =
    closest.width === w && closest.height === h
      ? "exact"
      : cropLoss < 0.05
        ? "close"
        : "significant";
  
  return { bucket: closest, cropLoss, match };
}
