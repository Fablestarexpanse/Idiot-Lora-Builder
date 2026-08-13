import { describe, it, expect } from "vitest";
import {
  buildBatchCaptionTargets,
  buildBatchCaptionBase,
  filterBatchCaptionNoTagsOnly,
  hasUsableTags,
} from "@/lib/batchCaptionTargets";
import type { ImageEntry, ImageRating } from "@/types";

function makeImage(
  id: string,
  overrides: Partial<ImageEntry> = {}
): ImageEntry {
  return {
    id,
    path: `C:/proj/${id}.png`,
    relative_path: `${id}.png`,
    filename: `${id}.png`,
    has_caption: false,
    tags: [],
    rating: "none" as ImageRating,
    ...overrides,
  };
}

const images: ImageEntry[] = [
  makeImage("a", { rating: "good", has_caption: true, tags: ["tag1"] }),
  makeImage("b", { rating: "bad", has_caption: false, tags: [] }),
  makeImage("c", { rating: "good", has_caption: false, tags: ["  "] }),
  makeImage("d", { rating: "needs_edit", has_caption: true, tags: [] }),
];

const ids = (list: ImageEntry[]) => list.map((i) => i.id);
const none = new Set<string>();

describe("hasUsableTags", () => {
  it("is false for empty and whitespace-only tag lists", () => {
    expect(hasUsableTags([])).toBe(false);
    expect(hasUsableTags(["", "   "])).toBe(false);
  });

  it("is true when any tag has non-whitespace content", () => {
    expect(hasUsableTags(["", "x"])).toBe(true);
  });
});

describe("buildBatchCaptionTargets", () => {
  it("rating-all returns every image regardless of other filters", () => {
    const result = buildBatchCaptionTargets(
      images,
      true,
      new Set(["good"]), // ignored when All is set
      new Set(["b"]), // ignored when All is set
      false
    );
    expect(ids(result)).toEqual(["a", "b", "c", "d"]);
  });

  it("specific rating filter keeps only matching ratings", () => {
    const result = buildBatchCaptionTargets(
      images,
      false,
      new Set(["good"]),
      none,
      false
    );
    expect(ids(result)).toEqual(["a", "c"]);
  });

  it("rating filter with multiple ratings unions them", () => {
    const result = buildBatchCaptionTargets(
      images,
      false,
      new Set(["bad", "needs_edit"]),
      none,
      false
    );
    expect(ids(result)).toEqual(["b", "d"]);
  });

  it("rating filter takes precedence over selection", () => {
    const result = buildBatchCaptionTargets(
      images,
      false,
      new Set(["needs_edit"]),
      new Set(["a", "b"]),
      false
    );
    expect(ids(result)).toEqual(["d"]);
  });

  it("with no rating filter, selection narrows to selected ids", () => {
    const result = buildBatchCaptionTargets(
      images,
      false,
      none,
      new Set(["b", "d"]),
      false
    );
    expect(ids(result)).toEqual(["b", "d"]);
  });

  it("with no rating filter and no selection, falls back to uncaptioned images", () => {
    const result = buildBatchCaptionTargets(images, false, none, none, false);
    expect(ids(result)).toEqual(["b", "c"]);
  });

  it("only-no-tags keeps images whose tags are empty or whitespace-only", () => {
    const result = buildBatchCaptionTargets(images, true, none, none, true);
    // "a" has a real tag; "c" has only a whitespace tag so it counts as untagged
    expect(ids(result)).toEqual(["b", "c", "d"]);
  });

  it("combines rating filter with only-no-tags", () => {
    const result = buildBatchCaptionTargets(
      images,
      false,
      new Set(["good"]),
      none,
      true
    );
    expect(ids(result)).toEqual(["c"]);
  });

  it("combines selection with only-no-tags", () => {
    const result = buildBatchCaptionTargets(
      images,
      false,
      none,
      new Set(["a", "b"]),
      true
    );
    expect(ids(result)).toEqual(["b"]);
  });
});

describe("buildBatchCaptionBase / filterBatchCaptionNoTagsOnly", () => {
  it("base returns a copy, not the original array, in the All case", () => {
    const base = buildBatchCaptionBase(images, true, none, none);
    expect(base).not.toBe(images);
    expect(base).toEqual(images);
  });

  it("filter with flag off returns a copy of the input", () => {
    const out = filterBatchCaptionNoTagsOnly(images, false);
    expect(out).not.toBe(images);
    expect(out).toEqual(images);
  });
});
