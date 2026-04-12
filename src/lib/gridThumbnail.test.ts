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
  it("uses smaller batches at high decode sizes to limit IPC payload size", () => {
    expect(prefetchChunkSizeForThumbEdge(1024)).toBe(6);
    expect(prefetchChunkSizeForThumbEdge(896)).toBe(6);
    expect(prefetchChunkSizeForThumbEdge(895)).toBe(10);
    expect(prefetchChunkSizeForThumbEdge(512)).toBe(10);
    expect(prefetchChunkSizeForThumbEdge(511)).toBe(16);
  });
});

describe("normalizeGridThumbRequestSize", () => {
  it("aligns to 8px and respects thumbnail cap", () => {
    const s = normalizeGridThumbRequestSize(120, 2, 400);
    expect(s % 8).toBe(0);
    expect(s).toBeLessThanOrEqual(400);
    expect(s).toBeGreaterThanOrEqual(128);
  });
});

describe("alignThumbRequestSize", () => {
  it("rounds to multiples of 8", () => {
    expect(alignThumbRequestSize(333, 1024)).toBe(336);
    expect(alignThumbRequestSize(120, 1024)).toBe(128);
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
