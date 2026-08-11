import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, GripVertical, Plus, Undo2, Redo2, Hash, ChevronLeft, ChevronRight } from "lucide-react";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectStore } from "@/stores/projectStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useFilterStore } from "@/stores/filterStore";
import { useProjectImages } from "@/hooks/useProject";
import { addTag, removeTag, reorderTags, writeCaption } from "@/lib/tauri";
import { selectVisibleImages } from "@/lib/imageFilter";

export function TagEditor() {
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const rootPath = useProjectStore((s) => s.rootPath);
  const { data: allImages = [] } = useProjectImages();
  const showCaptioned = useFilterStore((s) => s.showCaptioned);
  const tagFilter = useFilterStore((s) => s.tagFilter);
  const query = useFilterStore((s) => s.query);
  const ratingFilter = useFilterStore((s) => s.ratingFilter);
  const sortBy = useFilterStore((s) => s.sortBy);
  const sortOrder = useFilterStore((s) => s.sortOrder);
  const queryClient = useQueryClient();

  const orderedImages = useMemo(
    () =>
      selectVisibleImages(allImages, {
        showCaptioned,
        tagFilter,
        query,
        ratingFilter,
        sortBy,
        sortOrder,
      }),
    [allImages, showCaptioned, tagFilter, query, ratingFilter, sortBy, sortOrder]
  );
  const currentIndex = selectedImage
    ? orderedImages.findIndex((img) => img.id === selectedImage.id)
    : -1;
  const prevImage = currentIndex > 0 ? orderedImages[currentIndex - 1] : null;
  const nextImage = currentIndex >= 0 && currentIndex < orderedImages.length - 1
    ? orderedImages[currentIndex + 1]
    : null;

  const pushHistory = useHistoryStore((s) => s.pushHistory);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const canUndo = useHistoryStore((s) => s.past.length > 0);
  const canRedo = useHistoryStore((s) => s.future.length > 0);

  const [inputValue, setInputValue] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync tags from selected image
  useEffect(() => {
    if (selectedImage) {
      setTags(selectedImage.tags);
    } else {
      setTags([]);
    }
  }, [selectedImage]);

  const invalidateProject = useCallback(() => {
    if (rootPath) {
      queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
    }
  }, [queryClient, rootPath]);

  const addTagMutation = useMutation({
    mutationFn: async (tag: string) => {
      if (!selectedImage) return;
      const previousTags = [...tags];
      const newTags = await addTag(selectedImage.path, tag);
      if (newTags) {
        pushHistory({
          imagePath: selectedImage.path,
          imageFilename: selectedImage.filename,
          previousTags,
          newTags,
          description: `Added tag "${tag}"`,
        });
      }
      return newTags;
    },
    onSuccess: (newTags) => {
      if (newTags) setTags(newTags);
      invalidateProject();
    },
  });

  const removeTagMutation = useMutation({
    mutationFn: async (tag: string) => {
      if (!selectedImage) return;
      const previousTags = [...tags];
      const newTags = await removeTag(selectedImage.path, tag);
      if (newTags) {
        pushHistory({
          imagePath: selectedImage.path,
          imageFilename: selectedImage.filename,
          previousTags,
          newTags,
          description: `Removed tag "${tag}"`,
        });
      }
      return newTags;
    },
    onSuccess: (newTags) => {
      if (newTags) setTags(newTags);
      invalidateProject();
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (newTags: string[]) => {
      if (!selectedImage) return;
      const previousTags = selectedImage.tags;
      await reorderTags(selectedImage.path, newTags);
      pushHistory({
        imagePath: selectedImage.path,
        imageFilename: selectedImage.filename,
        previousTags,
        newTags,
        description: "Reordered tags",
      });
    },
    onSuccess: () => {
      invalidateProject();
    },
  });

  const copyCaptionMutation = useMutation({
    mutationFn: async (sourceTags: string[]) => {
      if (!selectedImage) return;
      const previousTags = [...tags];
      await writeCaption(selectedImage.path, sourceTags);
      pushHistory({
        imagePath: selectedImage.path,
        imageFilename: selectedImage.filename,
        previousTags,
        newTags: sourceTags,
        description: "Copied caption from adjacent image",
      });
      return sourceTags;
    },
    onSuccess: (newTags) => {
      if (newTags) setTags(newTags);
      invalidateProject();
    },
  });

  const setWeightMutation = useMutation({
    mutationFn: async ({ tag, weight }: { tag: string; weight: number }) => {
      if (!selectedImage) return tags;
      const baseTag = tag.replace(/^\((.*):[\d.]+\)$/, "$1").trim() || tag;
      const weightedTag = `(${baseTag}:${weight})`;
      const newTags = tags.map((t) => (t === tag ? weightedTag : t));
      await writeCaption(selectedImage.path, newTags);
      pushHistory({
        imagePath: selectedImage.path,
        imageFilename: selectedImage.filename,
        previousTags: tags,
        newTags,
        description: `Set weight ${weight} on "${baseTag}"`,
      });
      return newTags;
    },
    onSuccess: (newTags) => {
      if (newTags) setTags(newTags);
      invalidateProject();
    },
  });

  const handleUndo = useCallback(async () => {
    const entry = await undo();
    // Read the current selection from the store: this runs from a global
    // keydown handler and must not act on a stale closure.
    const current = useSelectionStore.getState().selectedImage;
    if (entry && entry.imagePath === current?.path) {
      setTags(entry.previousTags);
    }
    invalidateProject();
  }, [undo, invalidateProject]);

  const handleRedo = useCallback(async () => {
    const entry = await redo();
    const current = useSelectionStore.getState().selectedImage;
    if (entry && entry.imagePath === current?.path) {
      setTags(entry.newTags);
    }
    invalidateProject();
  }, [redo, invalidateProject]);

  function handleAddTag() {
    const tag = inputValue.trim();
    if (tag && selectedImage) {
      addTagMutation.mutate(tag);
      setInputValue("");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  }

  function handleRemoveTag(tag: string) {
    removeTagMutation.mutate(tag);
  }

  function handleSetWeight(tag: string, e: React.MouseEvent) {
    e.stopPropagation();
    const baseTag = tag.replace(/^\((.*):[\d.]+\)$/, "$1").trim() || tag;
    const currentMatch = tag.match(/:([\d.]+)\)$/);
    const currentWeight = currentMatch ? currentMatch[1] : "1.2";
    const input = window.prompt(`Weight for "${baseTag}" (Kohya/DreamBooth format):`, currentWeight);
    if (input === null) return;
    const weight = parseFloat(input);
    if (Number.isFinite(weight) && weight > 0) {
      setWeightMutation.mutate({ tag, weight });
    }
  }

  function handleDragStart(index: number) {
    setDragIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;

    const newTags = [...tags];
    const [moved] = newTags.splice(dragIndex, 1);
    newTags.splice(index, 0, moved);
    setTags(newTags);
    setDragIndex(index);
  }

  function handleDragEnd() {
    if (dragIndex !== null) {
      reorderMutation.mutate(tags);
    }
    setDragIndex(null);
  }

  // Global keyboard shortcuts
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      const isInput =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA";

      // T to focus tag input
      if (
        e.key.toLowerCase() === "t" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isInput
      ) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      // Ctrl+Z to undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Ctrl+Shift+Z or Ctrl+Y to redo
      if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y")
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }
    }
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [handleUndo, handleRedo]);

  if (!selectedImage) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <p className="text-sm text-gray-500">Select an image to edit tags</p>
        <p className="mt-1 text-xs text-gray-600">Click an image or use arrow keys</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-200" title={selectedImage.filename}>
            {selectedImage.filename}
          </p>
          <p className="text-xs text-gray-500">
            {tags.length} tag{tags.length !== 1 ? "s" : ""}
            {!selectedImage.has_caption && " • No caption file"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {prevImage && (
            <button
              type="button"
              onClick={() => copyCaptionMutation.mutate(prevImage.tags)}
              disabled={copyCaptionMutation.isPending}
              className="flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs font-medium text-gray-300 hover:border-gray-500 hover:bg-white/10 hover:text-gray-200 disabled:opacity-50"
              title="Copy caption from previous image"
              aria-label="Copy caption from previous image"
            >
              <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
              <span>Copy prev</span>
            </button>
          )}
          {nextImage && (
            <button
              type="button"
              onClick={() => copyCaptionMutation.mutate(nextImage.tags)}
              disabled={copyCaptionMutation.isPending}
              className="flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs font-medium text-gray-300 hover:border-gray-500 hover:bg-white/10 hover:text-gray-200 disabled:opacity-50"
              title="Copy caption from next image"
              aria-label="Copy caption from next image"
            >
              <span>Copy next</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            className="rounded p-1 text-gray-500 hover:bg-white/10 hover:text-gray-200 disabled:opacity-30"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            className="rounded p-1 text-gray-500 hover:bg-white/10 hover:text-gray-200 disabled:opacity-30"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tag input */}
      <div className="border-b border-border p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add tag... (press T to focus)"
            className="flex-1 rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddTag}
            disabled={!inputValue.trim()}
            className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tag list */}
      <div className="flex-1 overflow-auto p-2">
        {tags.length === 0 ? (
          <p className="p-2 text-center text-xs text-gray-500">No tags yet</p>
        ) : (
          <ul className="space-y-1">
            {tags.map((tag, index) => (
              <li
                key={`${tag}-${index}`}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-2 rounded border border-border bg-surface px-2 py-1 text-sm ${
                  dragIndex === index ? "opacity-50" : ""
                }`}
              >
                <GripVertical className="h-3 w-3 cursor-grab text-gray-500" />
                <span className="flex-1 truncate text-gray-200">{tag}</span>
                <button
                  type="button"
                  onClick={(e) => handleSetWeight(tag, e)}
                  className="text-gray-500 hover:text-blue-400"
                  aria-label={`Set weight for ${tag}`}
                  title="Set weight (e.g. 1.2)"
                >
                  <Hash className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="text-gray-500 hover:text-red-400"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Keyboard hints */}
      <div className="border-t border-border px-3 py-2 text-xs text-gray-600">
        <span className="mr-2">
          <kbd className="rounded bg-gray-700 px-1">T</kbd> Focus
        </span>
        <span className="mr-2">
          <kbd className="rounded bg-gray-700 px-1">Ctrl+Z</kbd> Undo
        </span>
        <span>
          <kbd className="rounded bg-gray-700 px-1">Ctrl+Y</kbd> Redo
        </span>
      </div>
    </div>
  );
}
