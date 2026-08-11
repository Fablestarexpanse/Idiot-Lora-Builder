import { describe, it, expect } from "vitest";
import { THUMBNAIL_PRESETS, matchThumbnailPreset } from "./thumbnailPresets";

describe("matchThumbnailPreset", () => {
  it("matches exact preset values", () => {
    for (const id of ["small", "medium", "large"] as const) {
      const p = THUMBNAIL_PRESETS[id];
      expect(matchThumbnailPreset(p.gridMinCellScale, p.thumbnailSize)).toBe(id);
    }
  });

  it("returns null for custom combinations", () => {
    expect(matchThumbnailPreset(0.9, 512)).toBeNull();
  });
});
