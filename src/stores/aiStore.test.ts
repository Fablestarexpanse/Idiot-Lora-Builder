import { describe, it, expect } from "vitest";
import { useAiStore } from "./aiStore";
import { CHARACTER_LORA_PROMPT } from "@/types";

const merge = useAiStore.persist.getOptions().merge!;

describe("Character LoRA prompt upgrade", () => {
  it("replaces a selected saved Character LoRA template and its active prompt", () => {
    const state = merge({
      selectedTemplateId: "saved-character",
      customPrompt: "old caption instructions",
      promptTemplates: [{ id: "saved-character", name: "Character LoRA", prompt: "old caption instructions", provider: "lm_studio" }],
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
