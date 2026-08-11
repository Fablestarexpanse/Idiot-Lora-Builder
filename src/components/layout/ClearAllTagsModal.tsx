import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eraser, X, Loader2 } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectImages } from "@/hooks/useProject";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { clearAllCaptions } from "@/lib/tauri";

const CONFIRM_WORD = "clear";

interface ClearAllTagsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ClearAllTagsModal({ isOpen, onClose }: ClearAllTagsModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusTrap(contentRef, isOpen);
  const rootPath = useProjectStore((s) => s.rootPath);
  const { data: images = [] } = useProjectImages();
  const queryClient = useQueryClient();
  const setPreviousTriggerWord = useSettingsStore((s) => s.setPreviousTriggerWord);

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      if (!rootPath) throw new Error("No project open.");
      return clearAllCaptions(rootPath);
    },
    onSuccess: () => {
      if (rootPath) {
        queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
      }
      setPreviousTriggerWord("");
      setConfirmText("");
      onClose();
    },
  });

  const canConfirm =
    confirmText.trim().toLowerCase() === CONFIRM_WORD && !clearAllMutation.isPending;

  function handleConfirm() {
    if (!canConfirm) return;
    clearAllMutation.mutate();
  }

  function handleClose() {
    if (clearAllMutation.isPending) return;
    setConfirmText("");
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-labelledby="clear-all-tags-title"
      aria-modal="true"
    >
<div
        ref={contentRef}
        className="w-full max-w-md rounded-lg border border-border bg-surface-elevated shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="clear-all-tags-title"
            className="flex items-center gap-2 text-lg font-medium text-gray-100"
          >
            <Eraser className="h-5 w-5 text-amber-400" />
            Clear all prompts on all images
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={clearAllMutation.isPending}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <p className="text-sm text-gray-400">
            This will remove prompts (captions) from every image in the current
            folder ({images.length} image{images.length === 1 ? "" : "s"}). This
            cannot be undone.
          </p>
          <p className="text-sm text-gray-300">
            Type <strong className="text-amber-400">{CONFIRM_WORD}</strong> below
            to confirm.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_WORD}
            className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-amber-500 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canConfirm) handleConfirm();
              if (e.key === "Escape") handleClose();
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={clearAllMutation.isPending}
              className="flex flex-1 items-center justify-center rounded border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600 hover:text-gray-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="flex flex-1 items-center justify-center gap-2 rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50 disabled:hover:bg-amber-600"
            >
              {clearAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Eraser className="h-4 w-4" />
              )}
              Clear all prompts
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
