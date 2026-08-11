import { useState, useRef, useEffect, memo, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Smile, Frown, Wrench, Loader2, Maximize2, Crop, Trash2, Eraser, Check, Sparkles } from "lucide-react";
import {
  ensureThumbnailUrl,
  writeCaption,
  setImageRating,
  deleteImage,
  generateCaptionLmStudio,
} from "@/lib/tauri";
import { buildEffectivePrompt } from "@/lib/promptBuilder";
import { alignThumbRequestSize } from "@/lib/gridThumbnail";
import { withThumbnailInvokeLimit } from "@/lib/thumbnailInvokeLimit";
import { useAiStore } from "@/stores/aiStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useSearchReplaceStore } from "@/stores/searchReplaceStore";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { highlightTerm } from "@/lib/highlight";
import type { ImageEntry, ImageRating } from "@/types";

function parseTagsFromText(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ThumbnailCellProps {
  entry: ImageEntry;
  /** Approximate decode size before the cell is measured (from grid layout × DPR). */
  fallbackThumbEdge: number;
  index: number;
  /** True if this image would be included in batch captioning */
  isInCaptionBatch?: boolean;
}

export const ThumbnailCell = memo(function ThumbnailCell({
  entry,
  fallbackThumbEdge,
  index,
  isInCaptionBatch = false,
}: ThumbnailCellProps) {
  const cellRef = useRef<HTMLDivElement>(null);
  const thumbBoxRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const setSelectedImage = useSelectionStore((s) => s.setSelectedImage);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const toggleSelection = useSelectionStore((s) => s.toggleSelection);
  const openPreview = useUiStore((s) => s.openPreview);
  const openCrop = useUiStore((s) => s.openCrop);
  const showToast = useUiStore((s) => s.showToast);
  const rootPath = useProjectStore((s) => s.rootPath);
  const queryClient = useQueryClient();
  const thumbnailMax = useSettingsStore((s) => s.thumbnailSize);

  // Intersection observer for lazy loading (root = grid scrollport, not viewport)
  useEffect(() => {
    const element = cellRef.current;
    if (!element) return;

    const root = element.closest("[data-grid-scroll-root]");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            // Once visible, we don't need to observe anymore
            observer.disconnect();
          }
        });
      },
      {
        root: root instanceof Element ? root : null,
        rootMargin: "300px",
      }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  // Use individual selectors to avoid unnecessary re-renders
  const provider = useAiStore((s) => s.provider);
  const lmStudio = useAiStore((s) => s.lmStudio);
  const ollama = useAiStore((s) => s.ollama);
  const captionMaxTokens = useAiStore((s) => s.captionMaxTokens);
  const customPrompt = useAiStore((s) => s.customPrompt);
  const promptTemplates = useAiStore((s) => s.promptTemplates);
  const selectedTemplateId = useAiStore((s) => s.selectedTemplateId);
  const wordCount = useAiStore((s) => s.wordCount);
  const length = useAiStore((s) => s.length);
  const characterName = useAiStore((s) => s.characterName);
  const extraOptionIds = useAiStore((s) => s.extraOptionIds);
  
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

  const [captionText, setCaptionText] = useState(() => tagsToText(entry.tags));
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showClearTagsConfirm, setShowClearTagsConfirm] = useState(false);
  const captionInputRef = useRef<HTMLTextAreaElement>(null);
  const searchHighlightText = useSearchReplaceStore((s) => s.searchHighlightText);
  const addTagPreviewText = useSearchReplaceStore((s) => s.addTagPreviewText);
  const addTagPreviewAtFront = useSearchReplaceStore((s) => s.addTagPreviewAtFront);
  const addTagRatingFilter = useSearchReplaceStore((s) => s.addTagRatingFilter);
  const triggerWord = useSettingsStore((s) => s.triggerWord);
  const confirmBeforeClearTags = useSettingsStore((s) => s.confirmBeforeClearTags);

  const isSelected = selectedImage?.id === entry.id;
  const isMultiSelected = selectedIds.has(entry.id);

  const writeMutation = useMutation({
    mutationFn: async (tags: string[]) => writeCaption(entry.path, tags),
    onSuccess: (_, tags) => {
      // Optimistic update: update cache directly instead of full refetch
      if (rootPath) {
        queryClient.setQueryData(
          ["project", "images", rootPath],
          (old: ImageEntry[] | undefined) => {
            if (!Array.isArray(old)) return old;
            return old.map((img) =>
              img.id === entry.id
                ? { ...img, has_caption: tags.length > 0, tags }
                : img
            );
          }
        );
      }
    },
  });

  const ratingMutation = useMutation({
    mutationFn: async (rating: ImageRating) => {
      if (!rootPath) throw new Error("No project open");
      return setImageRating(rootPath, entry.relative_path, rating);
    },
    onSuccess: (_, rating) => {
      // Optimistic update: update cache directly instead of full refetch
      if (rootPath) {
        queryClient.setQueryData(
          ["project", "images", rootPath],
          (old: ImageEntry[] | undefined) => {
            if (!Array.isArray(old)) return old;
            return old.map((img) =>
              img.id === entry.id
                ? { ...img, rating }
                : img
            );
          }
        );
        
        // Also update selectedImage if this is the selected one
        if (selectedImage?.id === entry.id) {
          setSelectedImage({ ...selectedImage, rating });
        }
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteImage(entry.path),
    onSuccess: () => {
      if (selectedImage?.id === entry.id) {
        setSelectedImage(null);
      }
      // Optimistic update: remove from cache instead of full refetch
      if (rootPath) {
        queryClient.setQueryData(
          ["project", "images", rootPath],
          (old: ImageEntry[] | undefined) => {
            if (!Array.isArray(old)) return old;
            return old.filter((img) => img.id !== entry.id);
          }
        );
      }
    },
  });

  const baseUrl = provider === "ollama" ? ollama.base_url : lmStudio.base_url;
  const model = provider === "ollama" ? ollama.model : lmStudio.model;
  const generateCaptionMutation = useMutation({
    mutationFn: async () => {
      return generateCaptionLmStudio(
        entry.path,
        baseUrl,
        model,
        effectivePrompt,
        captionMaxTokens,
        lmStudio.timeout_secs ?? 120,
        lmStudio.max_image_dimension ?? null
      );
    },
    onSuccess: async (result) => {
      if (result?.success && result.caption) {
        const tags = result.caption
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        await writeCaption(entry.path, tags);
        
        // Optimistic update
        if (rootPath) {
          queryClient.setQueryData(
            ["project", "images", rootPath],
            (old: ImageEntry[] | undefined) => {
              if (!Array.isArray(old)) return old;
              return old.map((img) =>
                img.id === entry.id
                  ? { ...img, has_caption: true, tags }
                  : img
              );
            }
          );
        }
      } else if (result?.error) {
        showToast(result.error);
      }
    },
    onError: (err: Error) => {
      showToast(err.message);
    },
  });

  const displayText = useMemo(() => tagsToText(entry.tags), [entry.tags]);
  
  const showAddTagPreview = useMemo(
    () => addTagPreviewText.trim() !== "" &&
      (addTagRatingFilter === "all" || entry.rating === addTagRatingFilter),
    [addTagPreviewText, addTagRatingFilter, entry.rating]
  );
  
  const previewTags = useMemo(
    () => !showAddTagPreview
      ? entry.tags
      : addTagPreviewAtFront
        ? [addTagPreviewText.trim(), ...entry.tags]
        : [...entry.tags, addTagPreviewText.trim()],
    [showAddTagPreview, entry.tags, addTagPreviewAtFront, addTagPreviewText]
  );
  
  const previewDisplayText = useMemo(() => tagsToText(previewTags), [previewTags]);

  function handleCaptionFocus() {
    setIsEditing(true);
    setCaptionText(displayText);
  }

  useEffect(() => {
    if (isEditing && captionInputRef.current) {
      captionInputRef.current.focus();
    }
  }, [isEditing]);

  function handleCaptionBlur() {
    setIsEditing(false);
    let tags = parseTagsFromText(captionText);
    const tw = triggerWord?.trim();
    if (tw) {
      const withoutTrigger = tags.filter(
        (t) => t.trim().toLowerCase() !== tw.toLowerCase()
      );
      tags = [tw, ...withoutTrigger];
    }
    const prevTags = entry.tags;
    const tagsChanged =
      tags.length !== prevTags.length || tags.some((t, i) => t !== prevTags[i]);
    if (tagsChanged) {
      writeMutation.mutate(tags);
    } else {
      setCaptionText(displayText);
    }
  }

  function handleCaptionChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setCaptionText(e.target.value);
  }

  function handleCaptionKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLTextAreaElement).blur();
    }
  }

  function handleRatingClick(rating: ImageRating, e: React.MouseEvent) {
    e.stopPropagation();
    // Toggle: if already this rating, set to none
    const newRating = entry.rating === rating ? "none" : rating;
    ratingMutation.mutate(newRating);
  }

  const requestThumbSize = alignThumbRequestSize(
    fallbackThumbEdge,
    thumbnailMax
  );

  const { data: src, isLoading, isError } = useQuery({
    queryKey: ["thumbnail", entry.path, requestThumbSize],
    queryFn: () =>
      withThumbnailInvokeLimit(() => ensureThumbnailUrl(entry.path, requestThumbSize)),
    staleTime: 30 * 60 * 1000,
    gcTime: 45 * 60 * 1000,
    enabled: isVisible && requestThumbSize > 0,
  });

  function handleImageClick(e: React.MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Click for multi-select
      toggleSelection(entry.id);
    } else {
      setSelectedImage(entry);
    }
  }

  function handleDoubleClick() {
    setSelectedImage(entry);
    openPreview();
  }

  function handleViewLarger(e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedImage(entry);
    openPreview();
  }

  function handleCrop(e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedImage(entry);
    openCrop();
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  }

  function handleDeleteConfirm() {
    setShowDeleteConfirm(false);
    deleteMutation.mutate();
  }

  function handleDeleteCancel() {
    setShowDeleteConfirm(false);
  }

  function doClearTags() {
    writeMutation.mutate([]);
    setCaptionText("");
  }

  function handleClearTagsClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (confirmBeforeClearTags) {
      setShowClearTagsConfirm(true);
    } else {
      doClearTags();
    }
  }

  function handleClearTagsConfirm() {
    setShowClearTagsConfirm(false);
    doClearTags();
  }

  function handleClearTagsCancel() {
    setShowClearTagsConfirm(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (
      (e.target as HTMLElement).closest("textarea") ||
      (e.target as HTMLElement).closest("input")
    ) {
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      setSelectedImage(entry);
      openPreview();
    } else if (e.key === " ") {
      e.preventDefault();
      setSelectedImage(entry);
    }
  }

  return (
    <div
      ref={cellRef}
      role="option"
      aria-selected={isSelected || isMultiSelected}
      aria-current={isSelected ? "true" : undefined}
      tabIndex={0}
      data-index={index}
      onClick={handleImageClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      className={`group relative flex min-w-0 max-w-full cursor-pointer flex-col rounded border-2 transition-colors ${
        isMultiSelected
          ? "border-purple-500 bg-purple-500/10"
          : isInCaptionBatch
            ? "border-green-500 bg-green-500/15"
            : entry.rating === "good"
              ? isSelected
                ? "border-green-500 bg-green-500/15"
                : "border-green-500 bg-green-500/5 hover:bg-green-500/10"
              : entry.rating === "bad"
                ? isSelected
                  ? "border-red-500 bg-red-500/15"
                  : "border-red-500 bg-red-500/5 hover:bg-red-500/10"
                : entry.rating === "needs_edit"
                  ? isSelected
                    ? "border-amber-500 bg-amber-500/15"
                    : "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10"
                  : isSelected
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-border bg-surface-elevated hover:border-gray-500"
      }`}
    >
      {/* Multi-select indicator */}
      {isMultiSelected && (
        <div className="absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded bg-purple-600 text-white">
          <Check className="h-3 w-3" />
        </div>
      )}

      {/* Caption indicator */}
      <div className="absolute right-1 top-1 z-10 flex gap-1">
        {entry.has_caption ? (
          <span
            className="h-2 w-2 rounded-full bg-green-500"
            title={`${entry.tags.length} tags`}
          />
        ) : (
          <span
            className="h-2 w-2 rounded-full bg-gray-500"
            title="No caption"
          />
        )}
      </div>

      {/* Thumbnail */}
      <div
        ref={thumbBoxRef}
        className="relative flex aspect-square w-full shrink-0 items-center justify-center bg-gray-900/80"
      >
        {/* View larger - always visible top-left on image */}
        <button
          type="button"
          onClick={handleViewLarger}
          className="absolute left-1 top-1 z-10 rounded p-1 bg-black/50 text-gray-200 hover:bg-black/70"
          title="View larger"
          aria-label="View larger"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        {isLoading && <span className="text-xs text-gray-500">…</span>}
        {isError && <span className="text-xs text-red-400">Err</span>}
        {src && (
          <img
            src={src}
            alt=""
            className="h-full w-full object-contain"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        )}
      </div>

      {/* Rating icons, Generate caption, Crop, Delete, Clear tags (View larger is on image top-left) */}
      <div className="flex flex-wrap items-center justify-center gap-0.5 px-0.5 py-1">
        <button
          type="button"
          onClick={(e) => handleRatingClick("good", e)}
          className={`rounded p-0.5 transition-colors ${
            entry.rating === "good"
              ? "bg-green-600 text-white"
              : "text-gray-500 hover:bg-green-600/20 hover:text-green-400"
          }`}
          title="Good (happy)"
        >
          <Smile className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => handleRatingClick("bad", e)}
          className={`rounded p-0.5 transition-colors ${
            entry.rating === "bad"
              ? "bg-red-600 text-white"
              : "text-gray-500 hover:bg-red-600/20 hover:text-red-400"
          }`}
          title="Bad (sad)"
        >
          <Frown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => handleRatingClick("needs_edit", e)}
          className={`rounded p-0.5 transition-colors ${
            entry.rating === "needs_edit"
              ? "bg-yellow-600 text-white"
              : "text-gray-500 hover:bg-yellow-600/20 hover:text-yellow-400"
          }`}
          title="Needs Edit (wrench)"
        >
          <Wrench className="h-3.5 w-3.5" />
        </button>
        <span className="mx-0.5 h-3 w-px bg-gray-600" aria-hidden />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            generateCaptionMutation.mutate();
          }}
          disabled={generateCaptionMutation.isPending}
          className="rounded p-0.5 text-gray-500 hover:bg-purple-600/20 hover:text-purple-400 disabled:opacity-30"
          title="Generate tags for this image"
        >
          {generateCaptionMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={handleCrop}
          className="rounded p-0.5 text-gray-500 hover:bg-white/10 hover:text-gray-200"
          title="Crop image"
        >
          <Crop className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={deleteMutation.isPending}
          className="rounded p-0.5 text-gray-500 hover:bg-red-600/20 hover:text-red-400 disabled:opacity-30"
          title="Delete image from folder"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleClearTagsClick}
          disabled={writeMutation.isPending}
          className="rounded p-0.5 text-gray-500 hover:bg-amber-600/20 hover:text-amber-400 disabled:opacity-30"
          title="Clear all tags for this image"
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Delete confirmation modal — matches app style */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onCancel={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        title="Delete image?"
        icon={<Trash2 className="h-5 w-5 text-red-400" />}
        confirmLabel="Delete"
        confirmIcon={<Trash2 className="h-4 w-4" />}
        confirmButtonClassName="bg-red-600 hover:bg-red-500"
        isPending={deleteMutation.isPending}
      >
        <p className="text-sm text-gray-400">
          Are you sure you want to delete this image from the folder? The
          file and its caption will be removed. This cannot be undone.
        </p>
      </ConfirmModal>

      {/* Clear tags confirmation modal */}
      <ConfirmModal
        isOpen={showClearTagsConfirm}
        onCancel={handleClearTagsCancel}
        onConfirm={handleClearTagsConfirm}
        title="Clear all tags?"
        icon={<Eraser className="h-5 w-5 text-amber-400" />}
        confirmLabel="Clear tags"
        confirmIcon={<Eraser className="h-4 w-4" />}
        confirmButtonClassName="bg-amber-600 hover:bg-amber-500"
        isPending={writeMutation.isPending}
      >
        <p className="text-sm text-gray-400">
          Remove all tags from this image. The caption file will be
          cleared. You can add new tags afterward.
        </p>
      </ConfirmModal>

      {/* Filename, dimensions, file size */}
      <div className="px-1 py-0.5">
        <p
          className="truncate text-xs text-gray-400"
          title={entry.filename}
        >
          {entry.filename}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-gray-500">
          {(entry.width != null && entry.height != null && entry.width > 0 && entry.height > 0) && (
            <span title="Pixel dimensions">
              {entry.width}×{entry.height}
            </span>
          )}
          {entry.file_size != null && entry.file_size > 0 && (
            <span title="File size">
              {formatFileSize(entry.file_size)}
            </span>
          )}
        </div>
      </div>

      {/* Editable caption — expands vertically to fit content */}
      <div className="px-1 pb-2">
        {isEditing ? (
          <textarea
            ref={captionInputRef}
            value={captionText}
            onChange={handleCaptionChange}
            onBlur={handleCaptionBlur}
            onKeyDown={handleCaptionKeyDown}
            placeholder="Add tags…"
            rows={Math.max(3, Math.ceil(captionText.length / 40))}
            className="w-full min-h-[3rem] resize-none rounded border border-border bg-gray-800/80 px-2 py-1.5 text-xs leading-relaxed text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            role="textbox"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              handleCaptionFocus();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleCaptionFocus();
              }
            }}
            className="min-h-[3rem] w-full cursor-text whitespace-pre-wrap break-words rounded border border-border bg-gray-800/80 px-2 py-1.5 text-xs leading-relaxed text-gray-200 hover:border-gray-600 focus:border-blue-500 focus:outline-none"
          >
            {showAddTagPreview ? (
              previewDisplayText ? (
                highlightTerm(
                  previewDisplayText,
                  addTagPreviewText.trim(),
                  "bg-blue-500/50 text-blue-100 rounded px-0.5"
                )
              ) : (
                <span className="text-blue-400">{addTagPreviewText.trim()}</span>
              )
            ) : displayText ? (
              searchHighlightText.trim() ? (
                highlightTerm(
                  displayText,
                  searchHighlightText,
                  "bg-yellow-500/70 text-yellow-900 dark:text-yellow-100 rounded px-0.5"
                )
              ) : triggerWord.trim() ? (
                highlightTerm(
                  displayText,
                  triggerWord.trim(),
                  "bg-purple-500/60 text-purple-100 rounded px-0.5"
                )
              ) : (
                displayText
              )
            ) : (
              <span className="text-gray-500">Add tags…</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
