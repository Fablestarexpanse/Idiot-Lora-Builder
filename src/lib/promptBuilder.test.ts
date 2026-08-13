import { describe, it, expect } from "vitest";
import { buildEffectivePrompt } from "@/lib/promptBuilder";
import type { ExtraOption } from "@/types";

const noOptions = {
  wordCount: null,
  length: null,
  characterName: "",
  extraOptionIds: [] as string[],
};

describe("buildEffectivePrompt", () => {
  it("is a trim-only no-op when everything is null/empty", () => {
    expect(buildEffectivePrompt("  Describe the image.  ", noOptions)).toBe(
      "Describe the image."
    );
  });

  describe("{length} substitution", () => {
    it("substitutes the length value when set", () => {
      expect(
        buildEffectivePrompt("Write a {length} caption.", {
          ...noOptions,
          length: "short",
        })
      ).toBe("Write a short caption.");
    });

    it("replaces every occurrence of {length}", () => {
      expect(
        buildEffectivePrompt("{length} then {length}", {
          ...noOptions,
          length: "long",
        })
      ).toBe("long then long");
    });

    // NOTE: documents current behavior — with length null the placeholder is
    // replaced by an empty string and surrounding whitespace is collapsed,
    // yielding "Write a caption." rather than leaving "{length}" in place.
    it("null length removes the placeholder and collapses whitespace", () => {
      expect(
        buildEffectivePrompt("Write a {length} caption.", {
          ...noOptions,
          length: null,
        })
      ).toBe("Write a caption.");
    });
  });

  describe("{name} substitution", () => {
    it("substitutes the trimmed character name", () => {
      expect(
        buildEffectivePrompt("Refer to them as {name}.", {
          ...noOptions,
          characterName: "  Alice  ",
        })
      ).toBe("Refer to them as Alice.");
    });

    it("falls back to 'the character' when name is empty/whitespace", () => {
      expect(
        buildEffectivePrompt("Refer to them as {name}.", {
          ...noOptions,
          characterName: "   ",
        })
      ).toBe("Refer to them as the character.");
    });

    it("replaces every occurrence of {name}", () => {
      expect(
        buildEffectivePrompt("{name} and {name}", {
          ...noOptions,
          characterName: "Bob",
        })
      ).toBe("Bob and Bob");
    });
  });

  describe("wordCount", () => {
    it("appends a word-limit sentence when positive", () => {
      expect(
        buildEffectivePrompt("Describe.", { ...noOptions, wordCount: 50 })
      ).toBe("Describe. Keep it within 50 words.");
    });

    it("ignores null wordCount", () => {
      expect(
        buildEffectivePrompt("Describe.", { ...noOptions, wordCount: null })
      ).toBe("Describe.");
    });

    it("ignores zero and negative wordCount", () => {
      expect(
        buildEffectivePrompt("Describe.", { ...noOptions, wordCount: 0 })
      ).toBe("Describe.");
      expect(
        buildEffectivePrompt("Describe.", { ...noOptions, wordCount: -5 })
      ).toBe("Describe.");
    });
  });

  describe("extra options", () => {
    const customOptions: ExtraOption[] = [
      { id: "one", label: "One", text: "First extra." },
      { id: "two", label: "Two", text: "Second extra about {name}." },
      { id: "three", label: "Three", text: "Third extra." },
    ];

    it("appends selected options in the order of the options list, not the id list", () => {
      expect(
        buildEffectivePrompt("Base.", {
          ...noOptions,
          extraOptionIds: ["three", "one"],
          extraOptions: customOptions,
        })
      ).toBe("Base. First extra. Third extra.");
    });

    it("substitutes {name} inside extra option text", () => {
      expect(
        buildEffectivePrompt("Base.", {
          ...noOptions,
          characterName: "Zoe",
          extraOptionIds: ["two"],
          extraOptions: customOptions,
        })
      ).toBe("Base. Second extra about Zoe.");
    });

    it("ignores unknown ids", () => {
      expect(
        buildEffectivePrompt("Base.", {
          ...noOptions,
          extraOptionIds: ["nope"],
          extraOptions: customOptions,
        })
      ).toBe("Base.");
    });

    it("uses DEFAULT_EXTRA_OPTIONS when extraOptions is omitted", () => {
      const result = buildEffectivePrompt("Base.", {
        ...noOptions,
        extraOptionIds: ["lighting"],
      });
      expect(result).toBe("Base. Include information about lighting.");
    });
  });

  it("collapses internal whitespace in the final prompt", () => {
    expect(
      buildEffectivePrompt("A   spaced\n\nprompt.", noOptions)
    ).toBe("A spaced prompt.");
  });

  it("combines length, name, wordCount, and extras together", () => {
    const result = buildEffectivePrompt(
      "Write a {length} caption about {name}.",
      {
        wordCount: 30,
        length: "medium",
        characterName: "Rex",
        extraOptionIds: ["lighting"],
      }
    );
    expect(result).toBe(
      "Write a medium caption about Rex. Keep it within 30 words. Include information about lighting."
    );
  });
});
