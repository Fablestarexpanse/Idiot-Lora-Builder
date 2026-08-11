import { useMemo } from "react";
import { useProjectImages } from "@/hooks/useProject";
import { useSelectionStore } from "@/stores/selectionStore";

export function StatusBar() {
  const { data: images = [], isLoading, isError } = useProjectImages();
  const selectedImage = useSelectionStore((s) => s.selectedImage);

  const stats = useMemo(() => {
    const captioned = images.filter((img) => img.has_caption).length;
    return { total: images.length, captioned };
  }, [images]);

  return (
    <footer className="flex h-7 shrink-0 items-center border-t border-border bg-surface-elevated px-3 text-xs text-gray-500">
      <span>{stats.total} images</span>
      <span className="mx-2">|</span>
      <span className="text-green-400">{stats.captioned} captioned</span>
      <span className="mx-2">|</span>
      {selectedImage ? (
        <span className="truncate text-gray-400" title={selectedImage.path}>
          {selectedImage.filename}
        </span>
      ) : (
        <span>
          {isLoading ? "Loading…" : isError ? "Error" : "Ready"}
        </span>
      )}
    </footer>
  );
}
