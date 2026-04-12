export type ThumbnailPresetId = "small" | "medium" | "large";

/** Tile density + decode cap for quick S / M / L switching (also updates advanced sliders in settings). */
export const THUMBNAIL_PRESETS: Record<
  ThumbnailPresetId,
  { gridMinCellScale: number; thumbnailSize: number }
> = {
  small: { gridMinCellScale: 0.68, thumbnailSize: 384 },
  medium: { gridMinCellScale: 1, thumbnailSize: 768 },
  large: { gridMinCellScale: 1.42, thumbnailSize: 1024 },
};

/** Which preset matches current settings, if any (for highlighting S / M / L). */
export function matchThumbnailPreset(
  gridMinCellScale: number,
  thumbnailSize: number
): ThumbnailPresetId | null {
  const order: ThumbnailPresetId[] = ["small", "medium", "large"];
  for (const id of order) {
    const p = THUMBNAIL_PRESETS[id];
    if (
      Math.abs(gridMinCellScale - p.gridMinCellScale) < 0.09 &&
      Math.abs(thumbnailSize - p.thumbnailSize) <= 56
    ) {
      return id;
    }
  }
  return null;
}
