import { describe, it, expect } from "vitest";
import {
  alignThumbRequestSize,
  chunkArray,
  collectPathsForRowIndices,
  expandRowIndicesForPrefetch,
  normalizeGridThumbRequestSize,
  prefetchChunkSizeForThumbEdge,
} from "./gridThumbnail";

describe("prefetchChunkSizeForThumbEdge", () => {
  it("uses smaller batches at high decode sizes so first thumbnails appear sooner", () => {
    expect(prefetchChunkSizeForThumbEdge(1024)).toBe(15);
    expect(prefetchChunkSizeForThumbEdge(896)).toBe(15);
    expect(prefetchChunkSizeForThumbEdge(895)).toBe(25);
    expect(prefetchChunkSizeForThumbEdge(512)).toBe(25);
    expect(prefetchChunkSizeForThumbEdge(511)).toBe(40);
  });
});

describe("normalizeGridThumbRequestSize", () => {
  it("snaps to a bucket and respects thumbnail cap", () => {
    const s = normalizeGridThumbRequestSize(120, 2, 400);
    expect(s).toBeLessThanOrEqual(400);
    expect(s).toBeGreaterThanOrEqual(128);
  });
});

describe("alignThumbRequestSize", () => {
  it("snaps up to the next fixed bucket", () => {
    expect(alignThumbRequestSize(333, 1024)).toBe(384);
    expect(alignThumbRequestSize(120, 1024)).toBe(128);
    expect(alignThumbRequestSize(500, 1024)).toBe(512);
  });

  it("never exceeds the cap: falls back to the largest bucket under it", () => {
    expect(alignThumbRequestSize(500, 400)).toBe(384);
    expect(alignThumbRequestSize(2000, 1536)).toBe(1536);
  });

  it("is idempotent so cell and grid requests agree on one cache key", () => {
    for (const cap of [400, 1024, 1536]) {
      for (const raw of [100, 333, 500, 900, 2000]) {
        const once = alignThumbRequestSize(raw, cap);
        expect(alignThumbRequestSize(once, cap)).toBe(once);
      }
    }
  });
});

describe("collectPathsForRowIndices", () => {
  const imgs = [{ path: "/a" }, { path: "/b" }, { path: "/c" }, { path: "/d" }];

  it("collects left-to-right row-major paths", () => {
    expect(collectPathsForRowIndices(imgs, 2, [0])).toEqual(["/a", "/b"]);
    expect(collectPathsForRowIndices(imgs, 2, [1])).toEqual(["/c", "/d"]);
  });

  it("dedupes when the same row is listed twice", () => {
    expect(collectPathsForRowIndices(imgs, 2, [0, 0])).toEqual(["/a", "/b"]);
  });
});

describe("expandRowIndicesForPrefetch", () => {
  it("pads neighbors and clamps to row count", () => {
    expect(expandRowIndicesForPrefetch([2], 5, 1).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(expandRowIndicesForPrefetch([0], 3, 2).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });
});

describe("chunkArray", () => {
  it("splits into fixed-size chunks", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
