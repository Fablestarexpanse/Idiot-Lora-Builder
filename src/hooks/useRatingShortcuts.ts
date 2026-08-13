import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectStore } from "@/stores/projectStore";
import { setImageRating, setRatingsBatch } from "@/lib/tauri";
import type { ImageEntry, ImageRating } from "@/types";

const RATING_KEYS = ["1", "2", "3"] as const;
const KEY_TO_RATING: Record<string, ImageRating> = {
  "1": "good",
  "2": "bad",
  "3": "needs_edit",
};

function isTypingInInput(): boolean {
  const el = document.activeElement;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * Registers a global keydown listener in the capture phase so 1/2/3 always set
 * the current image rating (Good / Bad / Needs Edit). Toggle off if same key again.
 * Capture phase ensures this runs before any other handler (grid, modals, etc.).
 */
export function useRatingShortcuts(): void {
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!RATING_KEYS.includes(e.key as "1" | "2" | "3")) return;
      if (isTypingInInput()) return;

      const { selectedImage, selectedIds } = useSelectionStore.getState();
      const rootPath = useProjectStore.getState().rootPath;
      if (!rootPath) return;

      // Multi-select: apply the rating to every selected image in one batch.
      if (selectedIds.size > 0) {
        const images = queryClientRef.current.getQueryData<ImageEntry[]>([
          "project",
          "images",
          rootPath,
        ]);
        const targets = images?.filter((img) => selectedIds.has(img.id)) ?? [];
        if (targets.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const rating = KEY_TO_RATING[e.key];
        // Toggle semantics: if every selected image already has this rating,
        // clear them all instead.
        const newRating: ImageRating = targets.every(
          (img) => img.rating === rating
        )
          ? "none"
          : rating;

        setRatingsBatch(
          rootPath,
          targets.map((img) => ({
            relative_path: img.relative_path,
            rating: newRating,
          }))
        )
          .then(() => {
            queryClientRef.current.setQueryData<ImageEntry[]>(
              ["project", "images", rootPath],
              (old) =>
                old?.map((img) =>
                  selectedIds.has(img.id) ? { ...img, rating: newRating } : img
                )
            );
            const current = useSelectionStore.getState().selectedImage;
            if (current && selectedIds.has(current.id)) {
              useSelectionStore
                .getState()
                .setSelectedImage({ ...current, rating: newRating });
            }
          })
          .catch((err) => {
            console.error("Batch rating shortcut failed:", err);
          });
        return;
      }

      if (!selectedImage) return;

      e.preventDefault();
      e.stopPropagation();

      const rating = KEY_TO_RATING[e.key];
      const newRating: ImageRating =
        selectedImage.rating === rating ? "none" : rating;

      setImageRating(rootPath, selectedImage.relative_path, newRating)
        .then(() => {
          queryClientRef.current.invalidateQueries({
            queryKey: ["project", "images", rootPath],
          });
          useSelectionStore.getState().setSelectedImage({
            ...selectedImage,
            rating: newRating,
          });
        })
        .catch((err) => {
          console.error("Rating shortcut failed:", err);
        });
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);
}
