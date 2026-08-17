import type { QueryClient } from "@tanstack/react-query";
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

/**
 * Handles the 1/2/3 rating keys (Good / Bad / Needs Edit; press again to
 * toggle off). Called from the single global keydown listener in
 * `useGlobalShortcuts` — the caller is responsible for the typing-target
 * guard. Returns true when the event was consumed.
 */
export function handleRatingShortcut(
  e: KeyboardEvent,
  queryClient: QueryClient
): boolean {
  if (!RATING_KEYS.includes(e.key as "1" | "2" | "3")) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  const { selectedImage, selectedIds } = useSelectionStore.getState();
  const rootPath = useProjectStore.getState().rootPath;
  if (!rootPath) return false;

  // Multi-select: apply the rating to every selected image in one batch.
  if (selectedIds.size > 0) {
    const images = queryClient.getQueryData<ImageEntry[]>([
      "project",
      "images",
      rootPath,
    ]);
    const targets = images?.filter((img) => selectedIds.has(img.id)) ?? [];
    if (targets.length === 0) return false;

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
        queryClient.setQueryData<ImageEntry[]>(
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
    return true;
  }

  if (!selectedImage) return false;

  e.preventDefault();
  e.stopPropagation();

  const rating = KEY_TO_RATING[e.key];
  const newRating: ImageRating =
    selectedImage.rating === rating ? "none" : rating;

  setImageRating(rootPath, selectedImage.relative_path, newRating)
    .then(() => {
      queryClient.invalidateQueries({
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
  return true;
}
