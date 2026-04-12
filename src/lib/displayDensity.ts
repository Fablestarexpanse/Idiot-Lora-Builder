/** Cap so we do not request enormous decodes on exotic displays. */
const DPR_CAP = 3;

/**
 * Effective DPR for thumbnail decode. Some embedded WebViews report 1.0 while the display is
 * scaled; `min-resolution` queries recover a better estimate when possible.
 */
export function getThumbnailDecodeDpr(): number {
  if (typeof window === "undefined") return 1;
  let d = window.devicePixelRatio ?? 1;
  if (d <= 1.01 && typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(min-resolution: 2dppx)").matches) d = Math.max(d, 2);
      else if (window.matchMedia("(min-resolution: 1.5dppx)").matches) d = Math.max(d, 1.5);
      else if (window.matchMedia("(min-resolution: 1.25dppx)").matches) d = Math.max(d, 1.25);
    } catch {
      /* ignore */
    }
  }
  return Math.min(Math.max(d, 1), DPR_CAP);
}

/** Slight overscale vs CSS pixels to offset JPEG + GPU scale softness. */
const CRISP_FACTOR = 1.12;

export function thumbEdgeFromCssPx(cssEdge: number, dpr: number): number {
  if (cssEdge < 1) return 128;
  return Math.max(96, Math.ceil(cssEdge * dpr * CRISP_FACTOR));
}
