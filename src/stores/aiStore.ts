import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AiProvider,
  CaptionLength,
  LmStudioSettings,
  OllamaSettings,
  PromptTemplate,
} from "@/types";
import { DEFAULT_PROMPT_TEMPLATES, EXTRA_OPTION_EXCLUSIVE_PAIRS } from "@/types";

interface AiState {
  // Provider selection
  provider: AiProvider;
  setProvider: (provider: AiProvider) => void;

  // Custom prompt (editable by user)
  customPrompt: string;
  setCustomPrompt: (prompt: string) => void;

  // Prompt variables
  wordCount: number | null;
  length: CaptionLength | null;
  characterName: string;
  extraOptionIds: string[];
  setWordCount: (n: number | null) => void;
  setLength: (length: CaptionLength | null) => void;
  setCharacterName: (name: string) => void;
  toggleExtraOption: (id: string) => void;

  // LM Studio settings
  lmStudio: LmStudioSettings;
  setLmStudioUrl: (url: string) => void;
  setLmStudioModel: (model: string | null) => void;
  setLmStudioTimeoutSecs: (timeout_secs: number) => void;
  setLmStudioMaxImageDimension: (max_image_dimension: number | null) => void;

  // Ollama settings
  ollama: OllamaSettings;
  setOllamaBaseUrl: (url: string) => void;
  setOllamaModel: (model: string | null) => void;

  // Prompt templates
  promptTemplates: PromptTemplate[];
  selectedTemplateId: string;
  setSelectedTemplateId: (id: string) => void;
  addPromptTemplate: (template: PromptTemplate) => void;
  removePromptTemplate: (id: string) => void;

  // Connection status
  isConnected: boolean;
  availableModels: string[];
  setConnectionStatus: (connected: boolean, models: string[]) => void;

  // Generation state
  isGenerating: boolean;
  setIsGenerating: (generating: boolean) => void;
  generationProgress: { current: number; total: number };
  setGenerationProgress: (current: number, total: number) => void;

  // Batch captioning: only caption images with these ratings (empty = no filter)
  batchCaptionRatingFilter: Set<string>;
  batchCaptionRatingAll: boolean;
  setBatchCaptionRatingFilter: (ratings: Set<string>) => void;
  setBatchCaptionRatingAll: (all: boolean) => void;
  toggleBatchCaptionRating: (rating: "good" | "bad" | "needs_edit") => void;
  /** When true, batch caption only images whose tag list is empty (or whitespace-only). */
  batchCaptionOnlyNoTags: boolean;
  setBatchCaptionOnlyNoTags: (value: boolean) => void;
  /** Max concurrent requests for batch (1–8, default 2). */
  batchConcurrency: number;
  setBatchConcurrency: (n: number) => void;

  /** OpenAI `max_tokens` / completion budget (reasoning models need more). */
  captionMaxTokens: number;
  setCaptionMaxTokens: (n: number) => void;
}

export const useAiStore = create<AiState>()(
  persist(
    (set) => ({
      // Provider
      provider: "lm_studio",
      setProvider: (provider) => set({ provider }),

      // Custom prompt (matches first template)
      customPrompt: "Write a long detailed description for this image.",
      setCustomPrompt: (customPrompt) => set({ customPrompt }),

      // Prompt variables
      wordCount: null,
      length: null,
      characterName: "",
      extraOptionIds: [],
      setWordCount: (wordCount) => set({ wordCount }),
      setLength: (length) => set({ length }),
      setCharacterName: (characterName) => set({ characterName }),
      toggleExtraOption: (id) =>
        set((state) => {
          const next = new Set(state.extraOptionIds);
          if (next.has(id)) {
            next.delete(id);
          } else {
            for (const [a, b] of EXTRA_OPTION_EXCLUSIVE_PAIRS) {
              if (id === a) next.delete(b);
              else if (id === b) next.delete(a);
            }
            next.add(id);
          }
          return { extraOptionIds: Array.from(next) };
        }),

      // LM Studio
      lmStudio: {
        base_url: "http://localhost:1234",
        model: null,
        timeout_secs: 120,
      },
      setLmStudioUrl: (url) =>
        set((state) => ({
          lmStudio: { ...state.lmStudio, base_url: url },
        })),
      setLmStudioModel: (model) =>
        set((state) => ({
          lmStudio: { ...state.lmStudio, model },
        })),
      setLmStudioTimeoutSecs: (timeout_secs) =>
        set((state) => ({
          lmStudio: { ...state.lmStudio, timeout_secs },
        })),
      setLmStudioMaxImageDimension: (max_image_dimension) =>
        set((state) => ({
          lmStudio: { ...state.lmStudio, max_image_dimension },
        })),

      // Ollama
      ollama: {
        base_url: "http://localhost:11434/v1",
        model: null,
      },
      setOllamaBaseUrl: (url) =>
        set((state) => ({
          ollama: { ...state.ollama, base_url: url },
        })),
      setOllamaModel: (model) =>
        set((state) => ({
          ollama: { ...state.ollama, model },
        })),

      // Prompt templates
      promptTemplates: DEFAULT_PROMPT_TEMPLATES,
      selectedTemplateId: "descriptive",
      setSelectedTemplateId: (id) => set({ selectedTemplateId: id }),
      addPromptTemplate: (template) =>
        set((state) => ({
          promptTemplates: [...state.promptTemplates, template],
        })),
      removePromptTemplate: (id) =>
        set((state) => ({
          promptTemplates: state.promptTemplates.filter((t) => t.id !== id),
        })),

      // Connection
      isConnected: false,
      availableModels: [],
      setConnectionStatus: (isConnected, availableModels) =>
        set({ isConnected, availableModels }),

      // Generation
      isGenerating: false,
      setIsGenerating: (isGenerating) => set({ isGenerating }),
      generationProgress: { current: 0, total: 0 },
      setGenerationProgress: (current, total) =>
        set({ generationProgress: { current, total } }),

      // Batch captioning rating filter
      batchCaptionRatingFilter: new Set<string>(),
      batchCaptionRatingAll: false,
      setBatchCaptionRatingFilter: (ratings) =>
        set({ batchCaptionRatingFilter: ratings, batchCaptionRatingAll: false }),
      setBatchCaptionRatingAll: (all) =>
        set({
          batchCaptionRatingAll: all,
          batchCaptionRatingFilter: all ? new Set() : new Set(),
        }),
      toggleBatchCaptionRating: (rating) =>
        set((state) => {
          const next = new Set(state.batchCaptionRatingFilter);
          if (next.has(rating)) next.delete(rating);
          else next.add(rating);
          return { batchCaptionRatingFilter: next, batchCaptionRatingAll: false };
        }),
      batchCaptionOnlyNoTags: false,
      setBatchCaptionOnlyNoTags: (batchCaptionOnlyNoTags) => set({ batchCaptionOnlyNoTags }),
      batchConcurrency: 1,
      setBatchConcurrency: (batchConcurrency) =>
        set({ batchConcurrency: Math.max(1, Math.min(8, batchConcurrency)) }),

      captionMaxTokens: 1024,
      setCaptionMaxTokens: (captionMaxTokens) =>
        set({ captionMaxTokens: Math.max(64, Math.min(32768, captionMaxTokens)) }),
    }),
    {
      name: "lora-studio-ai-settings",
      partialize: (state) => ({
        provider: state.provider,
        customPrompt: state.customPrompt,
        wordCount: state.wordCount,
        length: state.length,
        characterName: state.characterName,
        extraOptionIds: state.extraOptionIds,
        lmStudio: state.lmStudio,
        ollama: state.ollama,
        batchConcurrency: state.batchConcurrency,
        captionMaxTokens: state.captionMaxTokens,
        batchCaptionOnlyNoTags: state.batchCaptionOnlyNoTags,
        promptTemplates: state.promptTemplates,
        selectedTemplateId: state.selectedTemplateId,
      }),
    }
  )
);
