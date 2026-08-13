import { describe, it, expect } from "vitest";
import { selectVisibleImages } from "@/lib/imageFilter";
import type { FilterState, ImageEntry } from "@/types";

function makeImage(overrides: Partial<ImageEntry> = {}): ImageEntry {
  return {
    id: overrides.filename ?? "img",
    path: `C:/proj/${overrides.filename ?? "img.png"}`,
    relative_path: overrides.filename ?? "img.png",
    filename: "img.png",
    has_caption: false,
    tags: [],
    rating: "none",
    ...overrides,
  };
}

const baseFilter: FilterState = {
  query: "",
  showCaptioned: null,
  tagFilter: null,
  ratingFilter: null,
  sortBy: "name",
  sortOrder: "asc",
};

function names(list: ImageEntry[]): string[] {
  return list.map((i) => i.filename);
}

describe("selectVisibleImages", () => {
  describe("caption filter", () => {
    const images = [
      makeImage({ filename: "a.png", has_caption: true }),
      makeImage({ filename: "b.png", has_caption: false }),
    ];

    it("null shows all", () => {
      expect(
        names(selectVisibleImages(images, { ...baseFilter, showCaptioned: null }))
      ).toEqual(["a.png", "b.png"]);
    });

    it("true keeps only captioned", () => {
      expect(
        names(selectVisibleImages(images, { ...baseFilter, showCaptioned: true }))
      ).toEqual(["a.png"]);
    });

    it("false keeps only uncaptioned", () => {
      expect(
        names(selectVisibleImages(images, { ...baseFilter, showCaptioned: false }))
      ).toEqual(["b.png"]);
    });
  });

  describe("tag filter", () => {
    const images = [
      makeImage({ filename: "a.png", tags: ["red hair", "smile"] }),
      makeImage({ filename: "b.png", tags: ["blue eyes"] }),
      makeImage({ filename: "c.png", tags: [] }),
    ];

    it("matches by case-insensitive substring of any tag", () => {
      expect(
        names(selectVisibleImages(images, { ...baseFilter, tagFilter: "RED" }))
      ).toEqual(["a.png"]);
      expect(
        names(selectVisibleImages(images, { ...baseFilter, tagFilter: "e" }))
      ).toEqual(["a.png", "b.png"]);
    });

    it("no tagFilter passes everything through", () => {
      expect(
        names(selectVisibleImages(images, { ...baseFilter, tagFilter: null }))
      ).toEqual(["a.png", "b.png", "c.png"]);
    });
  });

  describe("query filter", () => {
    const images = [
      makeImage({ filename: "cat_photo.png", tags: ["outdoors"] }),
      makeImage({ filename: "dog.png", tags: ["cat ears"] }),
      makeImage({ filename: "bird.png", tags: ["sky"] }),
    ];

    it("matches filename OR tags, case-insensitively", () => {
      expect(
        names(selectVisibleImages(images, { ...baseFilter, query: "CAT" }))
      ).toEqual(["cat_photo.png", "dog.png"]);
    });

    it("whitespace-only query is ignored", () => {
      expect(
        names(selectVisibleImages(images, { ...baseFilter, query: "   " }))
      ).toEqual(["bird.png", "cat_photo.png", "dog.png"]);
    });
  });

  describe("rating filter", () => {
    const images = [
      makeImage({ filename: "a.png", rating: "good" }),
      makeImage({ filename: "b.png", rating: "bad" }),
      makeImage({ filename: "c.png", rating: "none" }),
    ];

    it("keeps only the requested rating", () => {
      expect(
        names(selectVisibleImages(images, { ...baseFilter, ratingFilter: "good" }))
      ).toEqual(["a.png"]);
    });

    it("null rating filter keeps all", () => {
      expect(
        selectVisibleImages(images, { ...baseFilter, ratingFilter: null })
      ).toHaveLength(3);
    });
  });

  describe("sorting", () => {
    it("name sort is numeric-aware (img2 before img10)", () => {
      const images = [
        makeImage({ filename: "img10.png" }),
        makeImage({ filename: "img2.png" }),
        makeImage({ filename: "img1.png" }),
      ];
      expect(names(selectVisibleImages(images, baseFilter))).toEqual([
        "img1.png",
        "img2.png",
        "img10.png",
      ]);
      expect(
        names(selectVisibleImages(images, { ...baseFilter, sortOrder: "desc" }))
      ).toEqual(["img10.png", "img2.png", "img1.png"]);
    });

    it("file_size sort asc and desc", () => {
      const images = [
        makeImage({ filename: "big.png", file_size: 300 }),
        makeImage({ filename: "small.png", file_size: 10 }),
        makeImage({ filename: "mid.png", file_size: 100 }),
      ];
      expect(
        names(selectVisibleImages(images, { ...baseFilter, sortBy: "file_size" }))
      ).toEqual(["small.png", "mid.png", "big.png"]);
      expect(
        names(
          selectVisibleImages(images, {
            ...baseFilter,
            sortBy: "file_size",
            sortOrder: "desc",
          })
        )
      ).toEqual(["big.png", "mid.png", "small.png"]);
    });

    it("dimension sort orders by area (width * height), not width alone", () => {
      const images = [
        // wide but small area: 1000x10 = 10,000
        makeImage({ filename: "wide.png", width: 1000, height: 10 }),
        // 100x200 = 20,000
        makeImage({ filename: "tall.png", width: 100, height: 200 }),
        // 50x50 = 2,500
        makeImage({ filename: "tiny.png", width: 50, height: 50 }),
      ];
      expect(
        names(selectVisibleImages(images, { ...baseFilter, sortBy: "dimension" }))
      ).toEqual(["tiny.png", "wide.png", "tall.png"]);
      expect(
        names(
          selectVisibleImages(images, {
            ...baseFilter,
            sortBy: "dimension",
            sortOrder: "desc",
          })
        )
      ).toEqual(["tall.png", "wide.png", "tiny.png"]);
    });

    it("extension sort asc and desc", () => {
      const images = [
        makeImage({ filename: "a.webp" }),
        makeImage({ filename: "b.jpg" }),
        makeImage({ filename: "c.png" }),
      ];
      expect(
        names(selectVisibleImages(images, { ...baseFilter, sortBy: "extension" }))
      ).toEqual(["b.jpg", "c.png", "a.webp"]);
      expect(
        names(
          selectVisibleImages(images, {
            ...baseFilter,
            sortBy: "extension",
            sortOrder: "desc",
          })
        )
      ).toEqual(["a.webp", "c.png", "b.jpg"]);
    });

    it("does not mutate the input array", () => {
      const images = [
        makeImage({ filename: "b.png" }),
        makeImage({ filename: "a.png" }),
      ];
      const copy = [...images];
      selectVisibleImages(images, baseFilter);
      expect(images).toEqual(copy);
    });
  });

  describe("missing fields", () => {
    it("treats undefined file_size as 0", () => {
      const images = [
        makeImage({ filename: "sized.png", file_size: 5 }),
        makeImage({ filename: "unsized.png", file_size: undefined }),
      ];
      expect(
        names(selectVisibleImages(images, { ...baseFilter, sortBy: "file_size" }))
      ).toEqual(["unsized.png", "sized.png"]);
    });

    it("treats undefined width/height as area 0", () => {
      const images = [
        makeImage({ filename: "dims.png", width: 10, height: 10 }),
        makeImage({ filename: "no-dims.png", width: undefined, height: undefined }),
        makeImage({ filename: "half-dims.png", width: 100, height: undefined }),
      ];
      // half-dims has area 100 * 0 = 0, so it ties with no-dims; dims.png last.
      const result = names(
        selectVisibleImages(images, { ...baseFilter, sortBy: "dimension" })
      );
      expect(result[2]).toBe("dims.png");
      expect(result.slice(0, 2).sort()).toEqual(["half-dims.png", "no-dims.png"]);
    });
  });
});
