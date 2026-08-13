import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, X, Smile, Frown, Wrench, CheckSquare, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { useFilterStore } from "@/stores/filterStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useProjectImages } from "@/hooks/useProject";
import { deleteImages } from "@/lib/tauri";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { matchThumbnailPreset } from "@/lib/thumbnailPresets";
import type { ThumbnailPresetId } from "@/lib/thumbnailPresets";
import type { CropStatus, ImageEntry, ImageRating } from "@/types";

const CROP_STATUS_CHIPS: {
  status: CropStatus;
  label: string;
  activeClass: string;
  title: string;
}[] = [
  { status: "uncropped", label: "Uncropped", activeClass: "bg-orange-600 text-white", title: "Show uncropped images" },
  { status: "cropped", label: "Cropped", activeClass: "bg-green-600 text-white", title: "Show cropped images" },
  { status: "multi", label: "Multi", activeClass: "bg-purple-600 text-white", title: "Show multi-cropped images" },
  { status: "flagged", label: "Flagged", activeClass: "bg-red-600 text-white", title: "Show flagged images" },
];

export function FilterBar() {
  const query = useFilterStore((s) => s.query);
  const setQuery = useFilterStore((s) => s.setQuery);
  const showCaptioned = useFilterStore((s) => s.showCaptioned);
  const setShowCaptioned = useFilterStore((s) => s.setShowCaptioned);
  const ratingFilter = useFilterStore((s) => s.ratingFilter);
  const setRatingFilter = useFilterStore((s) => s.setRatingFilter);
  const cropStatusFilter = useFilterStore((s) => s.cropStatusFilter);
  const setCropStatusFilter = useFilterStore((s) => s.setCropStatusFilter);
  const sortBy = useFilterStore((s) => s.sortBy);
  const setSortBy = useFilterStore((s) => s.setSortBy);
  const sortOrder = useFilterStore((s) => s.sortOrder);
  const setSortOrder = useFilterStore((s) => s.setSortOrder);
  const resetFilters = useFilterStore((s) => s.resetFilters);

  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

  const rootPath = useProjectStore((s) => s.rootPath);
  const showToast = useUiStore((s) => s.showToast);
  const queryClient = useQueryClient();
  const { data: projectImages } = useProjectImages();
  const [showDeleteSelected, setShowDeleteSelected] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const gridMinCellScale = useSettingsStore((s) => s.gridMinCellScale);
  const thumbnailSize = useSettingsStore((s) => s.thumbnailSize);
  const setThumbnailPreset = useSettingsStore((s) => s.setThumbnailPreset);
  const activeThumbPreset = matchThumbnailPreset(gridMinCellScale, thumbnailSize);

  const hasFilters =
    query ||
    showCaptioned !== null ||
    ratingFilter !== null ||
    cropStatusFilter !== null;

  function handleRatingFilter(rating: ImageRating) {
    setRatingFilter(ratingFilter === rating ? null : rating);
  }

  function handleCropStatusFilter(status: CropStatus) {
    setCropStatusFilter(cropStatusFilter === status ? null : status);
  }

  async function handleDeleteSelected() {
    if (!rootPath) return;
    const targets = (projectImages ?? []).filter((img) =>
      selectedIds.has(img.id)
    );
    if (targets.length === 0) {
      setShowDeleteSelected(false);
      return;
    }
    setIsDeleting(true);
    try {
      const result = await deleteImages(targets.map((img) => img.path));
      const removedIds = new Set(targets.map((img) => img.id));
      queryClient.setQueryData<ImageEntry[]>(
        ["project", "images", rootPath],
        (old) => old?.filter((img) => !removedIds.has(img.id))
      );
      clearSelection();
      if (result.errors.length > 0) {
        showToast(
          `Failed to delete ${result.errors.length} image${
            result.errors.length === 1 ? "" : "s"
          }: ${result.errors[0]}`
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
      setShowDeleteSelected(false);
    }
  }

  return (
    <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 overflow-x-hidden border-b border-border bg-surface-elevated px-2 py-1.5">
      {/* Search input — shrinks with window, max width so tools stay visible */}
      <div className="relative min-w-[72px] max-w-[160px] flex-1 shrink basis-24">
        <Search className="absolute left-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full min-w-0 rounded border border-border bg-surface py-0.5 pl-6 pr-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Caption filter buttons */}
      <div className="flex items-center gap-1 text-xs">
        <button
          type="button"
          onClick={() => setShowCaptioned(showCaptioned === false ? null : false)}
          className={`rounded px-2 py-1 ${
            showCaptioned === false
              ? "bg-orange-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          Uncaptioned
        </button>
        <button
          type="button"
          onClick={() => setShowCaptioned(showCaptioned === true ? null : true)}
          className={`rounded px-2 py-1 ${
            showCaptioned === true
              ? "bg-green-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          Captioned
        </button>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-1 border-l border-border pl-2">
        <span className="mr-1 text-xs text-gray-500">Sort:</span>
        <button
          type="button"
          onClick={() => setSortBy("name")}
          className={`rounded px-2 py-1 text-xs ${
            sortBy === "name"
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
          title="Sort by name (default)"
        >
          Name
        </button>
        <button
          type="button"
          onClick={() => setSortBy("file_size")}
          className={`rounded px-2 py-1 text-xs ${
            sortBy === "file_size"
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
          title="Sort by file size"
        >
          Size
        </button>
        <button
          type="button"
          onClick={() => setSortBy("extension")}
          className={`rounded px-2 py-1 text-xs ${
            sortBy === "extension"
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
          title="Sort by extension"
        >
          Ext
        </button>
        <button
          type="button"
          onClick={() => setSortBy("dimension")}
          className={`rounded px-2 py-1 text-xs ${
            sortBy === "dimension"
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
          title="Sort by dimensions (width × height)"
        >
          Dim
        </button>
        <span className="mx-1 h-3 w-px bg-gray-600" aria-hidden />
        <button
          type="button"
          onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          className={`flex items-center gap-0.5 rounded px-2 py-1 text-xs ${
            sortOrder === "asc"
              ? "bg-gray-600 text-gray-200"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
          title={sortOrder === "asc" ? "Ascending (click for descending)" : "Descending (click for ascending)"}
        >
          {sortOrder === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )}
          {sortOrder === "asc" ? "Asc" : "Desc"}
        </button>
      </div>

      {/* Thumbnail size preset: fits columns to panel width (no horizontal scroll) */}
      <div
        className="flex shrink-0 items-center gap-0.5 border-l border-border pl-2"
        role="group"
        aria-label="Thumbnail size"
      >
        <span className="mr-0.5 hidden text-xs text-gray-500 sm:inline">Thumbs</span>
        {(
          [
            ["small", "S", "Small — more columns, lighter load"],
            ["medium", "M", "Medium"],
            ["large", "B", "Big — fewer columns, sharper tiles"],
          ] as const
        ).map(([id, label, title]) => (
          <button
            key={id}
            type="button"
            title={title}
            onClick={() => setThumbnailPreset(id as ThumbnailPresetId)}
            className={`rounded px-2 py-1 text-xs font-medium ${
              activeThumbPreset === id
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Rating filter buttons */}
      <div className="flex items-center gap-1 border-l border-border pl-2">
        <button
          type="button"
          onClick={() => handleRatingFilter("good")}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
            ratingFilter === "good"
              ? "bg-green-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
          title="Show Good images"
        >
          <Smile className="h-3 w-3" />
          Good
        </button>
        <button
          type="button"
          onClick={() => handleRatingFilter("bad")}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
            ratingFilter === "bad"
              ? "bg-red-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
          title="Show Bad images"
        >
          <Frown className="h-3 w-3" />
          Bad
        </button>
        <button
          type="button"
          onClick={() => handleRatingFilter("needs_edit")}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
            ratingFilter === "needs_edit"
              ? "bg-yellow-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
          title="Show Needs Edit images"
        >
          <Wrench className="h-3 w-3" />
          Edit
        </button>
      </div>

      {/* Crop status filter chips */}
      <div className="flex items-center gap-1 border-l border-border pl-2">
        {CROP_STATUS_CHIPS.map(({ status, label, activeClass, title }) => (
          <button
            key={status}
            type="button"
            onClick={() => handleCropStatusFilter(status)}
            className={`rounded px-2 py-1 text-xs ${
              cropStatusFilter === status
                ? activeClass
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
            title={title}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Selection indicator */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-1 border-l border-border pl-2">
          <span className="flex items-center gap-1 text-xs text-purple-400">
            <CheckSquare className="h-3 w-3" />
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteSelected(true)}
            disabled={isDeleting}
            className="flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
            title="Delete selected images from folder"
          >
            <Trash2 className="h-3 w-3" />
            Delete ({selectedIds.size})
          </button>
        </div>
      )}

      {/* Clear filters */}
      {hasFilters && (
        <button
          type="button"
          onClick={resetFilters}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        >
          <X className="h-3 w-3" />
          Clear Filters
        </button>
      )}

      {/* Batch delete confirmation */}
      <ConfirmModal
        isOpen={showDeleteSelected}
        onCancel={() => setShowDeleteSelected(false)}
        onConfirm={handleDeleteSelected}
        title={`Delete ${selectedIds.size} image${selectedIds.size === 1 ? "" : "s"}?`}
        icon={<Trash2 className="h-5 w-5 text-red-400" />}
        confirmLabel={`Delete ${selectedIds.size}`}
        confirmIcon={<Trash2 className="h-4 w-4" />}
        confirmButtonClassName="bg-red-600 hover:bg-red-500"
        isPending={isDeleting}
      >
        <p className="text-sm text-gray-400">
          Delete {selectedIds.size} selected image
          {selectedIds.size === 1 ? "" : "s"} from the folder? Their caption
          files will be removed too. This cannot be undone.
        </p>
      </ConfirmModal>
    </div>
  );
}
