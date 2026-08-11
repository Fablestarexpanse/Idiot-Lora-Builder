import { thumbEdgeFromCssPx } from "@/lib/displayDensity";

/** Must match backend clamp upper bound in `get_thumbnail`. */
export const GRID_DECODE_MAX = 1536;

/**
 * Smaller chunks at high decode sizes keep each batch round-trip short, so the first
 * thumbnails appear quickly instead of waiting on one huge batch to finish.
 */
export function prefetchChunkSizeForThumbEdge(edge: number): number {
  if (edge >= 896) return 15;
  if (edge >= 512) return 25;
  return 40;
}

/**
 * Fixed decode-size buckets. Snapping requests to a small set of sizes keeps the disk
 * cache reusable across window resizes — a near-continuous size range (8px steps) meant
 * any layout shift changed the request size and regenerated every visible thumbnail.
 */
export const THUMB_SIZE_BUCKETS = [128, 192, 256, 384, 512, 768, 1024, 1536] as const;

/** Stable decode size for grid prefetch + React Query keys (reduces cache misses from ±1px measure noise). */
export function normalizeGridThumbRequestSize(
  estimatedCellWidthPx: number,
  decodeDpr: number,
  thumbnailMaxCap: number
): number {
  if (estimatedCellWidthPx < 1) return 128;
  const raw = Math.min(GRID_DECODE_MAX, thumbEdgeFromCssPx(estimatedCellWidthPx, decodeDpr));
  return alignThumbRequestSize(raw, thumbnailMaxCap);
}

/** Snap to the smallest bucket that covers the requested size without exceeding the cap. */
export function alignThumbRequestSize(raw: number, thumbnailMaxCap: number): number {
  const cap = Math.max(128, Math.min(thumbnailMaxCap, GRID_DECODE_MAX));
  const target = Math.max(128, Math.min(raw, cap));
  const up = THUMB_SIZE_BUCKETS.find((b) => b >= target);
  if (up !== undefined && up <= cap) return up;
  // No bucket >= target fits under the cap; use the largest one that does.
  let best: number = THUMB_SIZE_BUCKETS[0];
  for (const b of THUMB_SIZE_BUCKETS) {
    if (b <= cap) best = b;
  }
  return best;
}

export function collectPathsForRowIndices(
  images: readonly { path: string }[],
  columnCount: number,
  rowIndices: readonly number[]
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const row of rowIndices) {
    const start = row * columnCount;
    for (let c = 0; c < columnCount; c++) {
      const idx = start + c;
      if (idx >= images.length) break;
      const p = images[idx]!.path;
      if (!seen.has(p)) {
        seen.add(p);
        paths.push(p);
      }
    }
  }
  return paths;
}

/** Expand visible row list by a few neighbors so scrolling prefetches ahead. */
export function expandRowIndicesForPrefetch(
  rowIndices: readonly number[],
  rowCount: number,
  pad: number
): number[] {
  if (rowIndices.length === 0 || rowCount <= 0) return [];
  const set = new Set<number>();
  for (const r of rowIndices) {
    for (let d = -pad; d <= pad; d++) {
      const i = r + d;
      if (i >= 0 && i < rowCount) set.add(i);
    }
  }
  return [...set].sort((a, b) => a - b);
}

export function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  if (chunkSize < 1) return [items as T[]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize) as T[]);
  }
  return out;
}
