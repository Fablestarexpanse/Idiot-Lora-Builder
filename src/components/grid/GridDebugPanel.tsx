import { useMemo } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useGridMetricsStore } from "@/stores/gridMetricsStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function GridDebugPanel() {
  const show = useSettingsStore((s) => s.showGridDebug);
  const thumbnailSize = useSettingsStore((s) => s.thumbnailSize);
  const containerInnerWidth = useGridMetricsStore((s) => s.containerInnerWidth);
  const columnCount = useGridMetricsStore((s) => s.columnCount);
  const estimatedCellWidth = useGridMetricsStore((s) => s.estimatedCellWidth);
  const fallbackThumbEdge = useGridMetricsStore((s) => s.fallbackThumbEdge);
  const filteredTotal = useGridMetricsStore((s) => s.filteredTotal);
  const rowCount = useGridMetricsStore((s) => s.rowCount);
  const fetchingThumbs = useIsFetching({ queryKey: ["thumbnail"] });
  const queryClient = useQueryClient();

  // Only walk the query cache while the panel is visible; fetchingThumbs keeps
  // the count roughly fresh as thumbnail queries come and go.
  const thumbQueryCount = useMemo(() => {
    if (!show) return 0;
    void fetchingThumbs;
    return queryClient.getQueryCache().findAll({ queryKey: ["thumbnail"] }).length;
  }, [show, queryClient, fetchingThumbs]);

  if (!show) return null;

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio ?? 1 : 1;

  return (
    <div
      className="pointer-events-none fixed bottom-12 left-4 z-40 max-w-sm rounded-md border border-amber-500/40 bg-black/85 px-3 py-2 font-mono text-[11px] leading-relaxed text-amber-100/95 shadow-lg"
      aria-live="polite"
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-400/90">
        Grid / thumbnails
      </div>
      <div>inner width: {Math.round(containerInnerWidth)}px</div>
      <div>columns: {columnCount}</div>
      <div>
        ~cell width: {estimatedCellWidth > 0 ? `${Math.round(estimatedCellWidth)}px` : "—"}
      </div>
      <div>dpr: {dpr.toFixed(2)}</div>
      <div>thumb cap (settings): {thumbnailSize}px</div>
      <div>fallback thumb edge: {fallbackThumbEdge}px</div>
      <div>
        images: {filteredTotal} rows: {rowCount}
      </div>
      <div>thumbnail fetches in flight: {fetchingThumbs}</div>
      <div>thumbnail queries cached: {thumbQueryCount}</div>
    </div>
  );
}
