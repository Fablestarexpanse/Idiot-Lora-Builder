import { useRef, useEffect, useLayoutEffect, useMemo, useState, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { useProjectImages } from "@/hooks/useProject";
import { useSelectionStore } from "@/stores/selectionStore";
import { useFilterStore } from "@/stores/filterStore";
import { useAiStore } from "@/stores/aiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useGridMetricsStore } from "@/stores/gridMetricsStore";
import { getThumbnailDecodeDpr } from "@/lib/displayDensity";
import {
  chunkArray,
  collectPathsForRowIndices,
  expandRowIndicesForPrefetch,
  normalizeGridThumbRequestSize,
  prefetchChunkSizeForThumbEdge,
} from "@/lib/gridThumbnail";
import { buildBatchCaptionTargets } from "@/lib/batchCaptionTargets";
import { ensureThumbnailUrlsBatch } from "@/lib/tauri";
import { matchThumbnailPreset } from "@/lib/thumbnailPresets";
import { ThumbnailCell } from "./ThumbnailCell";

/** Base target minimum cell width (CSS px); multiplied by settings `gridMinCellScale`. */
const GRID_BASE_MIN_CELL = 104;
const MIN_COLS = 3;
/** Upper bound on columns; wide windows need >12 or S/M/B all clamp to the same count and tiles never resize. */
const MAX_COLS = 24;
/** Large (B): always 3 or 4 columns — min cell cap made this impossible via the density formula alone. */
const LARGE_GRID_INNER_BREAKPOINT = 560;
const GAP = 12;
const ROW_GAP = 12; // Vertical spacing between rows (same as horizontal)
// Initial virtual row estimate; actual height comes from measureElement (square thumbs scale with column width).
const ROW_HEIGHT = 340;

export const ImageGrid = memo(function ImageGrid() {
  const gridRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const thumbnailMax = useSettingsStore((s) => s.thumbnailSize);
  const gridMinCellScale = useSettingsStore((s) => s.gridMinCellScale);
  const { data: allImages = [], isLoading, isError } = useProjectImages();

  const [layout, setLayout] = useState({ innerWidth: 0, columnCount: 5 });
  const { innerWidth: gridInnerWidth, columnCount } = layout;

  const estimatedCellWidth = useMemo(() => {
    if (columnCount <= 0 || gridInnerWidth <= 0) return 0;
    return (gridInnerWidth - GAP * Math.max(0, columnCount - 1)) / columnCount;
  }, [gridInnerWidth, columnCount]);

  const decodeDpr = getThumbnailDecodeDpr();
  const sharedThumbSize = useMemo(
    () =>
      estimatedCellWidth > 0
        ? normalizeGridThumbRequestSize(estimatedCellWidth, decodeDpr, thumbnailMax)
        : 256,
    [estimatedCellWidth, decodeDpr, thumbnailMax]
  );
  const fallbackThumbEdge = sharedThumbSize;

  // Filter state
  const showCaptioned = useFilterStore((s) => s.showCaptioned);
  const tagFilter = useFilterStore((s) => s.tagFilter);
  const query = useFilterStore((s) => s.query);
  const ratingFilter = useFilterStore((s) => s.ratingFilter);

  // Selection state
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const setSelectedImage = useSelectionStore((s) => s.setSelectedImage);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const batchCaptionRatingFilter = useAiStore((s) => s.batchCaptionRatingFilter);
  const batchCaptionRatingAll = useAiStore((s) => s.batchCaptionRatingAll);
  const batchCaptionOnlyNoTags = useAiStore((s) => s.batchCaptionOnlyNoTags);

  // IDs of images that would be included in batch captioning (for green outline)
  const captionBatchIds = useMemo(() => {
    const targets = buildBatchCaptionTargets(
      allImages,
      batchCaptionRatingAll,
      batchCaptionRatingFilter,
      selectedIds,
      batchCaptionOnlyNoTags
    );
    return new Set(targets.map((img) => img.id));
  }, [
    allImages,
    selectedIds,
    batchCaptionRatingFilter,
    batchCaptionRatingAll,
    batchCaptionOnlyNoTags,
  ]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = allImages;

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

    return list;
  }, [allImages, showCaptioned, tagFilter, query, ratingFilter]);

  // Sort
  const sortBy = useFilterStore((s) => s.sortBy);
  const sortOrder = useFilterStore((s) => s.sortOrder);
  const images = useMemo(() => {
    const list = [...filtered];
    const mult = sortOrder === "asc" ? 1 : -1;
    list.sort((a, b) => {
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
    return list;
  }, [filtered, sortBy, sortOrder]);

  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const updateLayout = () => {
      const inner = Math.max(0, container.clientWidth - GAP * 2);
      const thumbPreset = matchThumbnailPreset(gridMinCellScale, thumbnailMax);

      let cols: number;
      if (thumbPreset === "large") {
        cols = inner < LARGE_GRID_INNER_BREAKPOINT ? 3 : 4;
      } else {
        const scaled = Math.round(GRID_BASE_MIN_CELL * gridMinCellScale);
        const preferredMinCell = Math.max(64, Math.min(220, scaled));
        cols = Math.max(
          MIN_COLS,
          Math.min(MAX_COLS, Math.floor((inner + GAP) / (preferredMinCell + GAP)))
        );
      }

      setLayout({ innerWidth: inner, columnCount: cols });
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(container);
    return () => observer.disconnect();
    // Re-attach when the scroll container mounts (ref was null during loading / empty states) or when
    // the filtered list appears again — not only when gridMinCellScale changes, or S/M/B feels inert.
  }, [gridMinCellScale, thumbnailMax, isLoading, images.length]);

  // Get current selected index
  const selectedIndex = useMemo(() => {
    if (!selectedImage) return -1;
    return images.findIndex((img) => img.id === selectedImage.id);
  }, [selectedImage, images]);

  // Calculate rows based on column count
  const rowCount = Math.ceil(images.length / columnCount);

  // Virtual scrolling with dynamic sizing
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
    measureElement: (element) => element.getBoundingClientRect().height + ROW_GAP,
  });

  const visibleRowKey = rowVirtualizer.getVirtualItems().map((v) => v.index).join(",");

  const scrollActiveRef = useRef(false);
  const scrollIdleTimerRef = useRef<number | undefined>(undefined);
  const [scrollIdleEpoch, setScrollIdleEpoch] = useState(0);

  useEffect(() => {
    if (rowCount < 1 || images.length < 1) return;
    const el = gridRef.current;
    if (!el) return;

    const onScroll = () => {
      scrollActiveRef.current = true;
      if (scrollIdleTimerRef.current !== undefined) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = window.setTimeout(() => {
        scrollActiveRef.current = false;
        scrollIdleTimerRef.current = undefined;
        setScrollIdleEpoch((n) => n + 1);
      }, 80);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollIdleTimerRef.current !== undefined) {
        window.clearTimeout(scrollIdleTimerRef.current);
        scrollIdleTimerRef.current = undefined;
      }
    };
  }, [rowCount, images.length]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (scrollActiveRef.current) return;
      if (images.length === 0 || columnCount < 1 || sharedThumbSize < 128) return;
      const indices = visibleRowKey.length
        ? visibleRowKey
            .split(",")
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n))
        : [];
      if (indices.length === 0) return;
      const padded = expandRowIndicesForPrefetch(indices, rowCount, 3);
      const paths = collectPathsForRowIndices(images, columnCount, padded);
      if (paths.length === 0) return;
      const chunkSize = prefetchChunkSizeForThumbEdge(sharedThumbSize);
      const chunks = chunkArray(paths, chunkSize);
      for (const chunk of chunks) {
        if (cancelled) return;
        try {
          const urlMap = await ensureThumbnailUrlsBatch(chunk, sharedThumbSize);
          if (cancelled) return;
          for (const [imgPath, assetUrl] of urlMap) {
            queryClient.setQueryData(["thumbnail", imgPath, sharedThumbSize], assetUrl);
          }
        } catch {
          /* cells fall back to limited single-invoke fetch */
        }
      }
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [visibleRowKey, scrollIdleEpoch, images, columnCount, rowCount, sharedThumbSize, queryClient]);

  const setGridMetrics = useGridMetricsStore((s) => s.setSnapshot);
  useLayoutEffect(() => {
    setGridMetrics({
      containerInnerWidth: gridInnerWidth,
      columnCount,
      filteredTotal: images.length,
      rowCount,
      estimatedCellWidth,
      fallbackThumbEdge,
    });
  }, [
    setGridMetrics,
    gridInnerWidth,
    columnCount,
    images.length,
    rowCount,
    estimatedCellWidth,
    fallbackThumbEdge,
  ]);

  // Keyboard navigation (1/2/3 rating is handled globally in App via useRatingShortcuts)
  useEffect(() => {
    const handleKeyNav = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const navigate = (delta: number) => {
        e.preventDefault();
        const newIndex = Math.max(0, Math.min(images.length - 1, selectedIndex + delta));
        if (newIndex !== selectedIndex && images[newIndex]) {
          setSelectedImage(images[newIndex]);
          // Scroll to the row containing the selected image
          const rowIndex = Math.floor(newIndex / columnCount);
          rowVirtualizer.scrollToIndex(rowIndex, { align: "auto", behavior: "smooth" });
        }
      };

      switch (e.key) {
        case "ArrowRight":
          navigate(1);
          break;
        case "ArrowLeft":
          navigate(-1);
          break;
        case "ArrowDown":
          navigate(columnCount);
          break;
        case "ArrowUp":
          navigate(-columnCount);
          break;
        case "Home":
          if (images.length > 0) {
            e.preventDefault();
            setSelectedImage(images[0]);
            rowVirtualizer.scrollToIndex(0, { align: "start", behavior: "smooth" });
          }
          break;
        case "End":
          if (images.length > 0) {
            e.preventDefault();
            setSelectedImage(images[images.length - 1]);
            const lastRowIndex = Math.floor((images.length - 1) / columnCount);
            rowVirtualizer.scrollToIndex(lastRowIndex, { align: "end", behavior: "smooth" });
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyNav);
    return () => window.removeEventListener("keydown", handleKeyNav);
  }, [images, selectedIndex, setSelectedImage, columnCount, rowVirtualizer]);

  // Select first image when images load and nothing selected
  useEffect(() => {
    if (images.length > 0 && !selectedImage) {
      setSelectedImage(images[0]);
    }
  }, [images, selectedImage, setSelectedImage]);

  if (!allImages.length && !isLoading && !isError) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface-elevated/50 p-8 text-center">
        <p className="text-gray-500">Open a folder to see the image grid.</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface-elevated/50 p-8 text-center">
        <p className="text-red-400">Failed to load images.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface-elevated/50 p-8">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (images.length === 0 && allImages.length > 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface-elevated/50 p-8 text-center">
        <p className="text-gray-500">No images match the current filter.</p>
      </div>
    );
  }

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={gridRef}
      data-grid-scroll-root
      className="h-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden rounded-lg focus:outline-none"
      role="listbox"
      aria-label="Image grid"
      tabIndex={-1}
    >
      <div
        className="min-w-0 max-w-full"
        style={{
          height: `${rowVirtualizer.getTotalSize() + GAP * 2}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualRows.map((virtualRow) => {
          const startIndex = virtualRow.index * columnCount;
          const endIndex = Math.min(startIndex + columnCount, images.length);
          const rowImages = images.slice(startIndex, endIndex);

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              className="min-w-0 max-w-full"
              style={{
                position: "absolute",
                top: 0,
                left: GAP,
                right: GAP,
                transform: `translateY(${virtualRow.start + GAP}px)`,
                marginBottom: `${ROW_GAP}px`,
              }}
            >
              <div
                className="grid min-w-0 max-w-full items-start"
                style={{
                  gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                  gap: `${GAP}px`,
                }}
              >
                {rowImages.map((entry, colIndex) => {
                  const index = startIndex + colIndex;
                  return (
                    <ThumbnailCell
                      key={entry.id}
                      entry={entry}
                      fallbackThumbEdge={fallbackThumbEdge}
                      index={index}
                      isInCaptionBatch={captionBatchIds.has(entry.id)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
