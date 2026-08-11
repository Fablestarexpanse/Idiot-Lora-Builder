import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StarOff, X, Loader2 } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectImages } from "@/hooks/useProject";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { clearAllRatings } from "@/lib/tauri";

const CONFIRM_WORD = "clear";

interface ClearAllRatingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ClearAllRatingsModal({ isOpen, onClose }: ClearAllRatingsModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusTrap(contentRef, isOpen);
  const rootPath = useProjectStore((s) => s.rootPath);
  const { data: images = [] } = useProjectImages();
  const queryClient = useQueryClient();

  const ratedCount = images.filter(
    (img) => img.rating && img.rating !== "none"
  ).length;

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      if (!rootPath) throw new Error("No project open");
      return clearAllRatings(rootPath);
    },
    onSuccess: () => {
      if (rootPath) {
        queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
      }
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
      aria-labelledby="clear-all-ratings-title"
      aria-modal="true"
    >
      <div
        ref={contentRef}
        className="w-full max-w-md rounded-lg border border-border bg-surface-elevated shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="clear-all-ratings-title"
            className="flex items-center gap-2 text-lg font-medium text-gray-100"
          >
            <StarOff className="h-5 w-5 text-amber-400" />
            Clear all ratings
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
          <p className="text-sm text-gray-300">
            This will remove Good / Bad / Needs Edit ratings from all {ratedCount} rated
            image{ratedCount !== 1 ? "s" : ""}.
          </p>
          <p className="text-sm text-gray-400">
            Type <strong className="text-gray-200">{CONFIRM_WORD}</strong> to confirm:
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_WORD}
            className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
            autoComplete="off"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={clearAllMutation.isPending}
            className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex items-center gap-2 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {clearAllMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <StarOff className="h-4 w-4" />
            )}
            Clear All Ratings
          </button>
        </div>
      </div>
    </div>
  );
}
