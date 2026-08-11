import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectStore } from "@/stores/projectStore";
import { setImageRating } from "@/lib/tauri";
import type { ImageRating } from "@/types";

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

      const selectedImage = useSelectionStore.getState().selectedImage;
      const rootPath = useProjectStore.getState().rootPath;
      if (!selectedImage || !rootPath) return;

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
