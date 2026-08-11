import type { ImageEntry } from "@/types";

/** True if there is at least one non-empty tag string. */
export function hasUsableTags(tags: readonly string[]): boolean {
  return tags.some((t) => t.trim().length > 0);
}

/**
 * Base batch list before "no tags only" filter (matches AI panel / grid outline).
 * All → every image. Rating checkboxes → those ratings. Else → selected, or uncaptioned if none selected.
 */
export function buildBatchCaptionBase(
  images: readonly ImageEntry[],
  batchCaptionRatingAll: boolean,
  batchCaptionRatingFilter: ReadonlySet<string>,
  selectedIds: ReadonlySet<string>
): ImageEntry[] {
  if (batchCaptionRatingAll) {
    return [...images];
  }
  if (batchCaptionRatingFilter.size > 0) {
    return images.filter((img) => batchCaptionRatingFilter.has(img.rating));
  }
  return selectedIds.size > 0
    ? images.filter((img) => selectedIds.has(img.id))
    : images.filter((img) => !img.has_caption);
}

/** When enabled, keep only images with no tags (empty or whitespace-only strings ignored). */
export function filterBatchCaptionNoTagsOnly(
  images: readonly ImageEntry[],
  onlyNoTags: boolean
): ImageEntry[] {
  if (!onlyNoTags) return [...images];
  return images.filter((img) => !hasUsableTags(img.tags));
}

export function buildBatchCaptionTargets(
  images: readonly ImageEntry[],
  batchCaptionRatingAll: boolean,
  batchCaptionRatingFilter: ReadonlySet<string>,
  selectedIds: ReadonlySet<string>,
  batchCaptionOnlyNoTags: boolean
): ImageEntry[] {
  const base = buildBatchCaptionBase(
    images,
    batchCaptionRatingAll,
    batchCaptionRatingFilter,
    selectedIds
  );
  return filterBatchCaptionNoTagsOnly(base, batchCaptionOnlyNoTags);
}
