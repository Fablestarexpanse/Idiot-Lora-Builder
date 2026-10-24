import { describe, it, expect } from "vitest";
import { findSharedCaptions } from "./sharedCaptions";

describe("findSharedCaptions", () => {
  it("groups images that differ only by extension, ignoring case", () => {
    expect(
      findSharedCaptions(["a.jpg", "A.PNG", "b.png", "sub/a.png", "sub\\c.webp", "sub/c.gif"])
    ).toEqual([
      ["a.jpg", "A.PNG"],
      ["sub\\c.webp", "sub/c.gif"],
    ]);
  });

  it("does not group names that only share a prefix", () => {
    expect(findSharedCaptions(["a.b.png", "a.png", "a.b.jpg.png"])).toEqual([]);
  });
});
