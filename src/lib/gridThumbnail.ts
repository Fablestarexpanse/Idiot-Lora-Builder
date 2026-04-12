import { thumbEdgeFromCssPx } from "@/lib/displayDensity";

/** Must match backend clamp upper bound in `get_thumbnail`. */
export const GRID_DECODE_MAX = 1536;

/**
 * Smaller chunks at high decode sizes keep each IPC response smaller (base64 JPEGs add up fast).
 */
export function prefetchChunkSizeForThumbEdge(edge: number): number {
  if (edge >= 896) return 6;
  if (edge >= 512) return 10;
  return 16;
}

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

export function alignThumbRequestSize(raw: number, thumbnailMaxCap: number): number {
  const capped = Math.max(128, Math.min(raw, thumbnailMaxCap, GRID_DECODE_MAX));
  return Math.round(capped / 8) * 8;
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
