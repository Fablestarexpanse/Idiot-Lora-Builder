import { describe, it, expect, vi } from "vitest";
import { useAiStore } from "./aiStore";
import { CHARACTER_LORA_PROMPT, CHARACTER_LORA_SIGNATURE_OUTFIT_PROMPT } from "@/types";

const merge = useAiStore.persist.getOptions().merge!;

describe("Character LoRA prompt upgrade", () => {
  it("replaces a selected saved Character LoRA template and its active prompt", () => {
    const state = merge({
      selectedTemplateId: "character_lora",
      customPrompt: "old caption instructions",
      promptTemplates: [{ id: "character_lora", name: "Character LoRA", prompt: "old caption instructions", provider: "lm_studio" }],
    }, useAiStore.getState());
    expect(state.selectedTemplateId).toBe("character_lora");
    expect(state.customPrompt).toBe(CHARACTER_LORA_PROMPT);
    expect(state.promptTemplates.filter((t) => t.name === "Character LoRA")).toHaveLength(1);
  });

  it("preserves unrelated custom prompts and templates", () => {
    const template = { id: "my-prompt", name: "My prompt", prompt: "My own instructions", provider: "lm_studio" };
    const state = merge({ selectedTemplateId: template.id, customPrompt: template.prompt, promptTemplates: [template] }, useAiStore.getState());
    expect(state.customPrompt).toBe(template.prompt);
    expect(state.selectedTemplateId).toBe(template.id);
    expect(state.promptTemplates).toContainEqual(template);
    expect(state.promptTemplates.find((t) => t.id === "character_lora")?.prompt).toBe(CHARACTER_LORA_PROMPT);
  });
});


describe("Signature Outfit preset availability", () => {
  it("adds the secondary preset to existing settings without changing the active custom prompt", () => {
    const state = merge({
      selectedTemplateId: "descriptive",
      customPrompt: "My current caption instructions",
      promptTemplates: [],
    }, useAiStore.getState());
    expect(state.selectedTemplateId).toBe("descriptive");
    expect(state.customPrompt).toBe("My current caption instructions");
    expect(state.promptTemplates.find((t) => t.id === "character_lora_signature_outfit")?.prompt)
      .toBe(CHARACTER_LORA_SIGNATURE_OUTFIT_PROMPT);
    expect(state.promptTemplates.find((t) => t.id === "character_lora")?.prompt).toBe(CHARACTER_LORA_PROMPT);
  });
});


describe("Preset refresh", () => {
  it("refreshes an untouched active built-in prompt from its saved version", () => {
    const state = merge({ selectedTemplateId: "descriptive", customPrompt: "old default", promptTemplates: [
      { id: "descriptive", name: "Descriptive", prompt: "old default", provider: "lm_studio" },
    ] }, useAiStore.getState());
    expect(state.customPrompt).toBe(state.promptTemplates.find((t) => t.id === "descriptive")?.prompt);
  });

  it("preserves edits to an active built-in prompt", () => {
    const state = merge({ selectedTemplateId: "character_lora", customPrompt: "My edited instructions", promptTemplates: [
      { id: "character_lora", name: "Character LoRA", prompt: "old default", provider: "lm_studio" },
    ] }, useAiStore.getState());
    expect(state.customPrompt).toBe("My edited instructions");
  });

  it("stores separate context for different training targets", () => {
    const original = useAiStore.getState();
    const storage = useAiStore.persist.getOptions().storage;
    const setItem = vi.fn();
    useAiStore.persist.setOptions({ storage: { getItem: () => null, setItem, removeItem: () => {} } });
    try {
      original.setTemplateContext("character_lora_signature_outfit", "silver armor");
      original.setTemplateContext("object_lora", "a ceramic teapot");
      expect(useAiStore.getState().templateContexts.character_lora_signature_outfit).toBe("silver armor");
      expect(useAiStore.getState().templateContexts.object_lora).toBe("a ceramic teapot");
      expect(setItem.mock.lastCall?.[1].state.templateContexts).toEqual({
        character_lora_signature_outfit: "silver armor", object_lora: "a ceramic teapot",
      });
    } finally {
      useAiStore.setState(original, true);
      useAiStore.persist.setOptions({ storage });
    }
  });
});


it("preserves a user-created template even when its name matches a built-in", () => {
  const template = { id: "custom_123", name: "Character LoRA", prompt: "My own identity instructions", provider: "lm_studio" };
  const state = merge({ selectedTemplateId: template.id, customPrompt: template.prompt, promptTemplates: [template] }, useAiStore.getState());
  expect(state.selectedTemplateId).toBe(template.id);
  expect(state.customPrompt).toBe(template.prompt);
  expect(state.promptTemplates).toContainEqual(template);
});


it("persists the description bypass independently per preset", () => {
  const original = useAiStore.getState();
  const storage = useAiStore.persist.getOptions().storage;
  const setItem = vi.fn();
  useAiStore.persist.setOptions({ storage: { getItem: () => null, setItem, removeItem: () => {} } });
  try {
    original.setSkipTemplateContext("character_lora_signature_outfit", true);
    expect(useAiStore.getState().skipTemplateContexts.character_lora_signature_outfit).toBe(true);
    expect(useAiStore.getState().skipTemplateContexts.object_lora).toBeUndefined();
    const persisted = setItem.mock.lastCall?.[1].state;
    const restored = merge(persisted, original);
    expect(restored.skipTemplateContexts.character_lora_signature_outfit).toBe(true);
    original.setSkipTemplateContext("character_lora_signature_outfit", false);
    expect(useAiStore.getState().skipTemplateContexts.character_lora_signature_outfit).toBe(false);
  } finally {
    useAiStore.setState(original, true);
    useAiStore.persist.setOptions({ storage });
  }
});
