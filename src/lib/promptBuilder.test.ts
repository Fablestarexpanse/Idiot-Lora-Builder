import { describe, it, expect } from "vitest";
import { buildEffectivePrompt, isPromptContextMissing } from "@/lib/promptBuilder";
import { DEFAULT_PROMPT_TEMPLATES } from "@/types";
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


describe("LoRA prompt controls", () => {
  it("applies length without requiring a placeholder", () => {
    expect(buildEffectivePrompt("Describe only visible details.", { ...noOptions, length: "short" }))
      .toContain("Keep the caption short");
  });

  it("omits conflicting saved extra instructions but retains compatible ones", () => {
    const template = DEFAULT_PROMPT_TEMPLATES.find((t) => t.id === "character_lora")!;
    const prompt = buildEffectivePrompt(template.prompt, {
      ...noOptions, template, extraOptionIds: ["camera_details", "no_fixed_attributes", "vulgar", "aesthetic_quality", "sfw_rating", "depth_of_field"],
    });
    expect(prompt).not.toContain("what camera was likely used");
    expect(prompt).not.toContain("do still include changeable attributes");
    expect(prompt).not.toContain("Use vulgar slang");
    expect(prompt).not.toContain("subjective aesthetic quality");
    expect(prompt).not.toContain("Include whether the image is sfw");
    expect(prompt).toContain("Specify the depth of field");
  });

  it("includes signature outfit context without turning it into caption content", () => {
    const template = DEFAULT_PROMPT_TEMPLATES.find((t) => t.id === "character_lora_signature_outfit")!;
    const prompt = buildEffectivePrompt(template.prompt, {
      ...noOptions, template, conceptDescription: "silver armor and a red skirt",
    });
    expect(prompt).toContain('"silver armor and a red skirt"');
    expect(prompt).toContain("Reference context only");
  });

  it("does not leak outfit context into a different preset", () => {
    const template = DEFAULT_PROMPT_TEMPLATES.find((t) => t.id === "character_lora")!;
    expect(buildEffectivePrompt(template.prompt, { ...noOptions, template, conceptDescription: "silver armor" }))
      .not.toContain('"silver armor"');
  });

  it("adds style, outfit and object training presets with distinct goals", () => {
    for (const id of ["style_lora", "outfit_lora", "object_lora"]) {
      expect(DEFAULT_PROMPT_TEMPLATES.find((t) => t.id === id)?.category).toBe("lora");
    }
  });
});


describe("Optional target description", () => {
  it.each(["character_lora_signature_outfit", "outfit_lora", "object_lora"])("allows %s without context only when explicitly skipped", (id) => {
    const template = DEFAULT_PROMPT_TEMPLATES.find((t) => t.id === id)!;
    expect(isPromptContextMissing(template, " ")).toBe(true);
    expect(isPromptContextMissing(template, " ", true)).toBe(false);
    expect(isPromptContextMissing(template, "target description")).toBe(false);
  });

  it("omits a saved description when bypassed and supplies instructions for running without it", () => {
    const template = DEFAULT_PROMPT_TEMPLATES.find((t) => t.id === "character_lora_signature_outfit")!;
    const prompt = buildEffectivePrompt(template.prompt, {
      ...noOptions, template, conceptDescription: "my saved outfit details", skipContext: true,
    });
    expect(prompt).not.toContain("my saved outfit details");
    expect(prompt).toContain("No reference description was supplied");
  });
});
