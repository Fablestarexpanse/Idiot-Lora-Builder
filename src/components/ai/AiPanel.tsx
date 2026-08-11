import { useState, useRef, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Wifi,
  WifiOff,
  Play,
  X,
  Square,
} from "lucide-react";
import { useAiStore } from "@/stores/aiStore";
import { useUiStore } from "@/stores/uiStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectImages } from "@/hooks/useProject";
import {
  testLmStudioConnection,
  testOllamaConnection,
  generateCaptionsBatch,
  writeCaption,
} from "@/lib/tauri";
import { Modal } from "@/components/ui/Modal";
import { buildEffectivePrompt } from "@/lib/promptBuilder";
import { buildBatchCaptionTargets } from "@/lib/batchCaptionTargets";
import { DEFAULT_PROMPT_TEMPLATES } from "@/types";
import type { ImageEntry } from "@/types";

export function AiPanel() {
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const cancelBatchRef = useRef(false);

  const queryClient = useQueryClient();
  const rootPath = useProjectStore((s) => s.rootPath);
  const { data: images = [] } = useProjectImages();

  const provider = useAiStore((s) => s.provider);
  const setProvider = useAiStore((s) => s.setProvider);
  const customPrompt = useAiStore((s) => s.customPrompt);
  const setCustomPrompt = useAiStore((s) => s.setCustomPrompt);
  const wordCount = useAiStore((s) => s.wordCount);
  const length = useAiStore((s) => s.length);
  const characterName = useAiStore((s) => s.characterName);
  const extraOptionIds = useAiStore((s) => s.extraOptionIds);
  const setWordCount = useAiStore((s) => s.setWordCount);
  const setCharacterName = useAiStore((s) => s.setCharacterName);
  const addPromptTemplate = useAiStore((s) => s.addPromptTemplate);
  const removePromptTemplate = useAiStore((s) => s.removePromptTemplate);
  const lmStudio = useAiStore((s) => s.lmStudio);
  const setLmStudioUrl = useAiStore((s) => s.setLmStudioUrl);
  const setLmStudioModel = useAiStore((s) => s.setLmStudioModel);
  const setLmStudioTimeoutSecs = useAiStore((s) => s.setLmStudioTimeoutSecs);
  const setLmStudioMaxImageDimension = useAiStore((s) => s.setLmStudioMaxImageDimension);
  const ollama = useAiStore((s) => s.ollama);
  const setOllamaBaseUrl = useAiStore((s) => s.setOllamaBaseUrl);
  const setOllamaModel = useAiStore((s) => s.setOllamaModel);
  const promptTemplates = useAiStore((s) => s.promptTemplates);
  const selectedTemplateId = useAiStore((s) => s.selectedTemplateId);
  const setSelectedTemplateId = useAiStore((s) => s.setSelectedTemplateId);
  const isConnected = useAiStore((s) => s.isConnected);
  const availableModels = useAiStore((s) => s.availableModels);
  const setConnectionStatus = useAiStore((s) => s.setConnectionStatus);
  const isGenerating = useAiStore((s) => s.isGenerating);
  const setIsGenerating = useAiStore((s) => s.setIsGenerating);
  const generationProgress = useAiStore((s) => s.generationProgress);
  const setGenerationProgress = useAiStore((s) => s.setGenerationProgress);
  const batchCaptionRatingFilter = useAiStore((s) => s.batchCaptionRatingFilter);
  const batchCaptionRatingAll = useAiStore((s) => s.batchCaptionRatingAll);
  const setBatchCaptionRatingAll = useAiStore((s) => s.setBatchCaptionRatingAll);
  const toggleBatchCaptionRating = useAiStore((s) => s.toggleBatchCaptionRating);
  const batchCaptionOnlyNoTags = useAiStore((s) => s.batchCaptionOnlyNoTags);
  const setBatchCaptionOnlyNoTags = useAiStore((s) => s.setBatchCaptionOnlyNoTags);
  const batchConcurrency = useAiStore((s) => s.batchConcurrency);
  const setBatchConcurrency = useAiStore((s) => s.setBatchConcurrency);
  const captionMaxTokens = useAiStore((s) => s.captionMaxTokens);
  const setCaptionMaxTokens = useAiStore((s) => s.setCaptionMaxTokens);

  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const showToast = useUiStore((s) => s.showToast);

  const selectedTemplate = useMemo(
    () => promptTemplates.find((t) => t.id === selectedTemplateId),
    [promptTemplates, selectedTemplateId]
  );

  const basePrompt = useMemo(
    () => customPrompt.trim() || selectedTemplate?.prompt || "Describe this image.",
    [customPrompt, selectedTemplate]
  );
  
  const effectivePrompt = useMemo(
    () => buildEffectivePrompt(basePrompt, {
      wordCount,
      length,
      characterName,
      extraOptionIds,
    }),
    [basePrompt, wordCount, length, characterName, extraOptionIds]
  );
  
  // Memoize filtered templates to avoid re-filtering on every render
  const filteredTemplates = useMemo(
    () => promptTemplates.filter((t) => 
      t.name.toLowerCase().includes(templateSearch.toLowerCase())
    ),
    [promptTemplates, templateSearch]
  );

  const testConnectionMutation = useMutation({
    mutationFn: () =>
      provider === "ollama"
        ? testOllamaConnection(ollama.base_url)
        : testLmStudioConnection(lmStudio.base_url),
    onSuccess: (status) => {
      setConnectionStatus(status.connected, status.models);
      if (status.models.length > 0) {
        if (provider === "ollama" && !ollama.model) {
          setOllamaModel(status.models[0]);
        } else if (provider === "lm_studio" && !lmStudio.model) {
          setLmStudioModel(status.models[0]);
        }
      }
    },
  });

  function handleSaveTemplate() {
    if (!templateName.trim()) return;
    const newTemplate = {
      id: `custom_${Date.now()}`,
      name: templateName.trim(),
      prompt: customPrompt.trim() || "Describe this image.",
      provider,
    };
    addPromptTemplate(newTemplate);
    setSelectedTemplateId(newTemplate.id);
    setShowSaveTemplate(false);
  }

  async function handleBatchGenerate() {
    const targetImages = buildBatchCaptionTargets(
      images,
      batchCaptionRatingAll,
      batchCaptionRatingFilter,
      selectedIds,
      batchCaptionOnlyNoTags
    );

    if (targetImages.length === 0) {
      showToast(
        batchCaptionOnlyNoTags
          ? "No images match (try turning off “no tags only”, or adjust rating / selection)."
          : "No images to caption. Select images, check All, or pick Good/Bad/Needs Edit."
      );
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(0, targetImages.length);
    cancelBatchRef.current = false;

    try {
      const baseUrl = provider === "ollama" ? ollama.base_url : lmStudio.base_url;
      const model = provider === "ollama" ? ollama.model : lmStudio.model;
      const chunkSize = 5;

      for (let i = 0; i < targetImages.length; i += chunkSize) {
        if (cancelBatchRef.current) break;

        const chunk = targetImages.slice(i, i + chunkSize);
        const paths = chunk.map((img) => img.path);

        const timeoutSecs = lmStudio.timeout_secs ?? 120;
        const maxImageDimension = lmStudio.max_image_dimension ?? null;
        const results = await generateCaptionsBatch(
          paths,
          baseUrl,
          model,
          effectivePrompt,
          captionMaxTokens,
          timeoutSecs,
          batchConcurrency,
          maxImageDimension
        );

        let failed = 0;
        let firstError: string | null = null;
        const written = new Map<string, string[]>();
        for (const result of results) {
          if (result.success && result.caption) {
            const tags = result.caption
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t);
            await writeCaption(result.path, tags);
            written.set(result.path, tags);
          } else {
            failed++;
            if (!firstError && result.error) firstError = result.error;
          }
        }

        // Merge written captions into the cache instead of refetching the project.
        if (rootPath && written.size > 0) {
          queryClient.setQueryData<ImageEntry[]>(
            ["project", "images", rootPath],
            (old) =>
              old?.map((img) => {
                const tags = written.get(img.path);
                return tags
                  ? { ...img, has_caption: tags.length > 0, tags }
                  : img;
              })
          );
        }

        if (failed > 0 && firstError) {
          showToast(
            `${failed} of ${results.length} failed: ${firstError.slice(0, 200)}${firstError.length > 200 ? "…" : ""}`
          );
        }

        setGenerationProgress(Math.min(i + chunkSize, targetImages.length), targetImages.length);
      }
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err));
    } finally {
      cancelBatchRef.current = false;
      setIsGenerating(false);
    }
  }

  function handleStopCaptioning() {
    cancelBatchRef.current = true;
  }

  const batchTargetImages = useMemo(
    () =>
      buildBatchCaptionTargets(
        images,
        batchCaptionRatingAll,
        batchCaptionRatingFilter,
        selectedIds,
        batchCaptionOnlyNoTags
      ),
    [
      images,
      batchCaptionRatingAll,
      batchCaptionRatingFilter,
      selectedIds,
      batchCaptionOnlyNoTags,
    ]
  );
  
  const batchTargetCount = batchTargetImages.length;
  
  const batchLabel = useMemo(() => {
    const base = batchCaptionRatingAll
      ? `${batchTargetCount} (all)`
      : batchCaptionRatingFilter.size > 0
        ? `${batchTargetCount} (rating filter)`
        : selectedIds.size > 0
          ? `${batchTargetCount} selected`
          : `${batchTargetCount} uncaptioned`;
    return batchCaptionOnlyNoTags ? `${base}, no tags only` : base;
  }, [
    batchCaptionRatingAll,
    batchTargetCount,
    batchCaptionRatingFilter.size,
    selectedIds.size,
    batchCaptionOnlyNoTags,
  ]);

  return (
    <div className="flex flex-col border-t border-border">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="h-4 w-4 text-purple-400" />
        <span className="text-sm font-medium text-gray-200">AI Captioning</span>
      </div>

      {/* Provider selector */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">AI Provider</label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setProvider("lm_studio")}
            className={`min-w-[6rem] flex-1 shrink-0 whitespace-nowrap rounded px-2 py-2 text-xs font-medium ${
              provider === "lm_studio"
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            LM Studio
          </button>
          <button
            type="button"
            onClick={() => setProvider("ollama")}
            className={`min-w-[6rem] flex-1 shrink-0 whitespace-nowrap rounded px-2 py-2 text-xs font-medium ${
              provider === "ollama"
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            Ollama
          </button>
        </div>
      </div>

      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">Max completion tokens</label>
        <p className="mb-2 text-[11px] leading-snug text-gray-500">
          Reasoning models spend much of this on internal thinking. If captions are empty or cut off, increase this (e.g. 2048).
        </p>
        <select
          value={captionMaxTokens}
          onChange={(e) => setCaptionMaxTokens(Number(e.target.value))}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
        >
          {[512, 1024, 1536, 2048, 4096].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {/* Provider-specific settings */}
      <div className="space-y-3 border-b border-border bg-surface/50 p-3">
        {provider === "lm_studio" ? (
          <>
            <div>
              <label className="mb-1 block text-xs text-gray-500">LM Studio URL</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={lmStudio.base_url}
                  onChange={(e) => setLmStudioUrl(e.target.value)}
                  className="flex-1 rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                  placeholder="http://localhost:1234"
                />
                <button
                  type="button"
                  onClick={() => testConnectionMutation.mutate()}
                  disabled={testConnectionMutation.isPending}
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {testConnectionMutation.isPending ? "..." : "Test"}
                </button>
                {isConnected ? (
                  <Wifi className="h-4 w-4 shrink-0 text-green-400" aria-label="Connected" />
                ) : (
                  <WifiOff className="h-4 w-4 shrink-0 text-gray-500" aria-label="Not connected" />
                )}
              </div>
            </div>
            {availableModels.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-gray-500">Model</label>
                <select
                  value={lmStudio.model || ""}
                  onChange={(e) => setLmStudioModel(e.target.value || null)}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-gray-500">Request timeout (seconds)</label>
              <select
                value={lmStudio.timeout_secs ?? 120}
                onChange={(e) => setLmStudioTimeoutSecs(Number(e.target.value))}
                className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
              >
                <option value={60}>60</option>
                <option value={120}>120</option>
                <option value={180}>180</option>
                <option value={300}>300</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Max image size for AI (px)</label>
              <select
                value={lmStudio.max_image_dimension ?? ""}
                onChange={(e) =>
                  setLmStudioMaxImageDimension(
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
              >
                <option value="">Don't resize</option>
                <option value={1024}>1024</option>
                <option value={2048}>2048</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Batch: concurrent requests</label>
              <select
                value={batchConcurrency}
                onChange={(e) => setBatchConcurrency(Number(e.target.value))}
                className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Ollama URL (OpenAI-compatible)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={ollama.base_url}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  className="flex-1 rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                  placeholder="http://localhost:11434/v1"
                />
                <button
                  type="button"
                  onClick={() => testConnectionMutation.mutate()}
                  disabled={testConnectionMutation.isPending}
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {testConnectionMutation.isPending ? "..." : "Test"}
                </button>
                {isConnected ? (
                  <Wifi className="h-4 w-4 shrink-0 text-green-400" aria-label="Connected" />
                ) : (
                  <WifiOff className="h-4 w-4 shrink-0 text-gray-500" aria-label="Not connected" />
                )}
              </div>
            </div>
            {availableModels.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-gray-500">Model (e.g. llava, llava:13b)</label>
                <select
                  value={ollama.model || ""}
                  onChange={(e) => setOllamaModel(e.target.value || null)}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      {/* Prompt template selector */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">Prompt Template (right-click to delete)</label>
        <input
          type="text"
          value={templateSearch}
          onChange={(e) => setTemplateSearch(e.target.value)}
          placeholder="Search templates..."
          className="w-full mb-2 rounded border border-border bg-surface px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <div className="max-h-40 overflow-y-auto rounded border border-border bg-surface">
          {filteredTemplates.map((t) => {
            const isSelected = t.id === selectedTemplateId;
            const isDefault = DEFAULT_PROMPT_TEMPLATES.some((d) => d.id === t.id);
            return (
              <div
                key={t.id}
                className={`group flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-white/5 ${
                  isSelected ? "bg-blue-600/20 text-blue-300" : "text-gray-300"
                }`}
                onClick={() => {
                  setSelectedTemplateId(t.id);
                  setCustomPrompt(t.prompt);
                }}
                onContextMenu={(e) => {
                  if (isDefault) return;
                  e.preventDefault();
                  if (confirm(`Delete template "${t.name}"?`)) {
                    removePromptTemplate(t.id);
                    if (isSelected) {
                      setSelectedTemplateId("descriptive");
                      setCustomPrompt(promptTemplates.find((pt) => pt.id === "descriptive")?.prompt || "");
                    }
                  }
                }}
              >
                <span className="flex-1 truncate">{t.name}</span>
                {!isDefault && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete template "${t.name}"?`)) {
                        removePromptTemplate(t.id);
                        if (isSelected) {
                          setSelectedTemplateId("descriptive");
                          setCustomPrompt(promptTemplates.find((pt) => pt.id === "descriptive")?.prompt || "");
                        }
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-gray-500 hover:bg-red-600/20 hover:text-red-400"
                    title="Delete template"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom prompt input */}
      <div className="border-b border-border p-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-gray-500">Custom Prompt</label>
          <button
            type="button"
            onClick={() => {
              setTemplateName("");
              setShowSaveTemplate(true);
            }}
            disabled={!customPrompt.trim()}
            className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
            title="Save current prompt as a new template"
          >
            Save as Template
          </button>
        </div>
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Enter your custom prompt..."
          rows={6}
          className="w-full min-h-[8rem] resize-y rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Word limit and character name */}
      <div className="border-b border-border p-3">
        <div className="grid gap-4 items-end sm:grid-cols-[auto_1fr]">
          <div className="w-20 shrink-0">
            <label className="mb-1 block text-xs text-gray-500">Word limit</label>
            <input
              type="number"
              min={1}
              max={500}
              value={wordCount ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setWordCount(v === "" ? null : Math.max(1, Math.min(500, Number(v) || 0)));
              }}
              placeholder="—"
              title="Optional word limit"
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs text-gray-500">
              Character name <span className="whitespace-nowrap">(for {`{name}`})</span>
            </label>
            <input
              type="text"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder="—"
              title="Optional; used in prompt"
              className="w-full min-w-0 rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500"
            />
          </div>
        </div>
      </div>

      {/* Prompt used (read-only) */}
      <details className="border-b border-border group">
        <summary className="cursor-pointer px-3 py-2 text-xs text-gray-500 hover:text-gray-400">
          Prompt used
        </summary>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words border-t border-border bg-surface/50 px-3 py-2 text-[10px] text-gray-400">
          {effectivePrompt}
        </pre>
      </details>

      {/* Batch captioning: rating filter */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">
          Only caption images rated:
        </label>
        <div className="flex flex-wrap gap-2">
          <label
            className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-xs hover:bg-white/5 ${
              batchCaptionRatingAll
                ? "border-green-500 bg-green-500/20 text-green-300"
                : "border-border bg-surface text-gray-300"
            }`}
          >
            <input
              type="checkbox"
              checked={batchCaptionRatingAll}
              onChange={(e) => setBatchCaptionRatingAll(e.target.checked)}
              className="rounded border-gray-600"
            />
            <span>All</span>
          </label>
          {(["good", "bad", "needs_edit"] as const).map((r) => {
            const checked = !batchCaptionRatingAll && batchCaptionRatingFilter.has(r);
            const ratingStyles =
              r === "good"
                ? "border-green-500 hover:bg-green-500/10"
                : r === "bad"
                  ? "border-red-500 hover:bg-red-500/10"
                  : "border-amber-500 hover:bg-amber-500/10";
            const checkedStyles =
              r === "good"
                ? "border-green-500 bg-green-500/20 text-green-300"
                : r === "bad"
                  ? "border-red-500 bg-red-500/20 text-red-300"
                  : "border-amber-500 bg-amber-500/20 text-amber-300";
            return (
              <label
                key={r}
                className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-xs ${
                  checked
                    ? checkedStyles
                    : `${ratingStyles} bg-surface text-gray-300`
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleBatchCaptionRating(r)}
                  disabled={batchCaptionRatingAll}
                  className="rounded border-gray-600 disabled:opacity-50"
                />
                <span className="capitalize">{r.replace("_", " ")}</span>
              </label>
            );
          })}
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded border border-border bg-surface px-2 py-1.5 text-xs text-gray-300 hover:bg-white/5">
          <input
            type="checkbox"
            checked={batchCaptionOnlyNoTags}
            onChange={(e) => setBatchCaptionOnlyNoTags(e.target.checked)}
            className="rounded border-gray-600"
          />
          <span>Only caption images with no tags</span>
        </label>
        <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
          All = every image in project (re-caption). Otherwise: selected/uncaptioned + rating. “No tags”
          skips any image that already has at least one non-empty tag (useful after a partial run).
        </p>
      </div>

      {/* Actions */}
      <div className="space-y-2 p-3">
        {isGenerating ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleStopCaptioning}
                className="flex flex-1 items-center justify-center gap-2 rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                <Square className="h-4 w-4" />
                Stop
              </button>
              <span className="flex items-center justify-center px-3 py-2 text-sm font-medium text-gray-300">
                {generationProgress.current}/{generationProgress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-700">
              <div
                className="h-full bg-purple-600 transition-all duration-300"
                style={{
                  width: generationProgress.total
                    ? `${(100 * generationProgress.current) / generationProgress.total}%`
                    : "0%",
                }}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleBatchGenerate}
            disabled={
              batchTargetCount === 0 ||
              !isConnected
            }
            className="flex w-full items-center justify-center gap-2 rounded bg-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Batch ({batchLabel})
          </button>
        )}
      </div>

      {/* Connection hint */}
      {provider === "lm_studio" && !isConnected && (
        <div className="p-3 text-center">
          <p className="text-xs text-gray-500">
            Start LM Studio, load a vision model, then click Test above
          </p>
        </div>
      )}

      {provider === "ollama" && !isConnected && (
        <div className="p-3 text-center">
          <p className="text-xs text-gray-500">
            Start Ollama, pull a vision model (e.g. llava), then click Test above
          </p>
        </div>
      )}

      {/* Save Template Modal */}
      <Modal
        isOpen={showSaveTemplate}
        onClose={() => setShowSaveTemplate(false)}
        title="Save Prompt Template"
        maxWidthClassName="max-w-md"
        footer={
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setShowSaveTemplate(false)}
              className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={!templateName.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        }
      >
        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-sm text-gray-300">Template Name</label>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="My Custom Prompt"
              className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTemplate();
              }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
