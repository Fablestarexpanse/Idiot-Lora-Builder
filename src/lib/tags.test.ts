import { describe, it, expect } from "vitest";
import { parseTagsFromText, tagsToText, applyTriggerWord } from "./tags";

describe("parseTagsFromText / tagsToText", () => {
  it("splits on commas, trims, and drops empties", () => {
    expect(parseTagsFromText(" a, b ,, c ,")).toEqual(["a", "b", "c"]);
  });

  it("round-trips", () => {
    expect(tagsToText(parseTagsFromText("a, b, c"))).toBe("a, b, c");
  });
});

describe("applyTriggerWord", () => {
  it("prepends the trigger word", () => {
    expect(applyTriggerWord(["a", "b"], "trig")).toEqual(["trig", "a", "b"]);
  });

  it("moves an existing trigger to the front (case-insensitive)", () => {
    expect(applyTriggerWord(["a", "TRIG", "b"], "trig")).toEqual(["trig", "a", "b"]);
  });

  it("is a no-op without a trigger word", () => {
    expect(applyTriggerWord(["a"], "")).toEqual(["a"]);
    expect(applyTriggerWord(["a"], undefined)).toEqual(["a"]);
    expect(applyTriggerWord(["a"], "   ")).toEqual(["a"]);
  });

  it("handles an empty tag list", () => {
    expect(applyTriggerWord([], "trig")).toEqual(["trig"]);
  });
});
