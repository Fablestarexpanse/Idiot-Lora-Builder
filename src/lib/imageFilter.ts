import type { CropStatus, FilterState, ImageEntry } from "@/types";

/**
 * Filter argument for {@link selectVisibleImages}. Extends the shared
 * `FilterState` with an optional crop-status filter (an image with no
 * `crop_status` counts as "uncropped"). The field is optional so existing
 * callers that pass a plain `FilterState` keep working.
 */
export interface VisibleImagesFilter extends FilterState {
  cropStatusFilter?: CropStatus | null;
}

/**
 * Pure filter + sort pipeline shared by the grid, tag editor, and preview/crop
 * modals so every view walks the images in the same order.
 */
export function selectVisibleImages(
  images: ImageEntry[],
  filter: VisibleImagesFilter
): ImageEntry[] {
  const { showCaptioned, tagFilter, query, ratingFilter, sortBy, sortOrder } =
    filter;
  const cropStatusFilter = filter.cropStatusFilter ?? null;
  let list = images;

  // Crop-status filter (missing status counts as "uncropped")
  if (cropStatusFilter) {
    list = list.filter(
      (img) => (img.crop_status ?? "uncropped") === cropStatusFilter
    );
  }

  // Caption filter
  if (showCaptioned === true) {
    list = list.filter((img) => img.has_caption);
  } else if (showCaptioned === false) {
    list = list.filter((img) => !img.has_caption);
  }

  // Tag filter
  if (tagFilter) {
    const lowerTag = tagFilter.toLowerCase();
    list = list.filter((img) =>
      img.tags.some((t) => t.toLowerCase().includes(lowerTag))
    );
  }

  // Text query filter
  if (query.trim()) {
    const lowerQuery = query.toLowerCase();
    list = list.filter(
      (img) =>
        img.filename.toLowerCase().includes(lowerQuery) ||
        img.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    );
  }

  // Rating filter
  if (ratingFilter) {
    list = list.filter((img) => img.rating === ratingFilter);
  }

  // Sort
  const sorted = [...list];
  const mult = sortOrder === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    let cmp = 0;
    if (sortBy === "name") {
      cmp = (a.filename ?? "").localeCompare(b.filename ?? "", undefined, { numeric: true });
    } else if (sortBy === "file_size") {
      const sa = a.file_size ?? 0;
      const sb = b.file_size ?? 0;
      cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
    } else if (sortBy === "dimension") {
      const areaA = (a.width ?? 0) * (a.height ?? 0);
      const areaB = (b.width ?? 0) * (b.height ?? 0);
      cmp = areaA < areaB ? -1 : areaA > areaB ? 1 : 0;
    } else {
      const extA = (a.filename ?? "").split(".").pop() ?? "";
      const extB = (b.filename ?? "").split(".").pop() ?? "";
      cmp = extA.localeCompare(extB);
    }
    return mult * cmp;
  });
  return sorted;
}
