import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { loadProject, loadImageDimensions } from "@/lib/tauri";
import type { ImageEntry } from "@/types";

/** How many images to request dimensions for per backend round-trip. */
const DIMENSION_CHUNK = 200;

export function useProjectImages() {
  const rootPath = useProjectStore((s) => s.rootPath);
  const setIsLoadingProject = useProjectStore((s) => s.setIsLoadingProject);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["project", "images", rootPath],
    queryFn: () => loadProject(rootPath!),
    enabled: !!rootPath,
  });

  const setProjectDataReady = useProjectStore((s) => s.setProjectDataReady);

  // Keep overlay up until query settles, then a short grace period so the grid can mount.
  useEffect(() => {
    if (query.isError) {
      setIsLoadingProject(false);
      setProjectDataReady(false);
      return;
    }
    if (query.isSuccess) {
      setProjectDataReady(true);
      const t = setTimeout(() => {
        setIsLoadingProject(false);
        setProjectDataReady(false);
      }, 400);
      return () => clearTimeout(t);
    }
  }, [query.isSuccess, query.isError, setIsLoadingProject, setProjectDataReady]);

  // Backfill image dimensions in the background (project scan skips them for speed).
  // Powers the dimension display in cells and "sort by dimension".
  const imagesData = query.data;
  useEffect(() => {
    if (!rootPath || !imagesData || imagesData.length === 0) return;
    const missing = imagesData.filter((img) => img.width == null || img.height == null);
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      for (let i = 0; i < missing.length; i += DIMENSION_CHUNK) {
        if (cancelled) return;
        const chunk = missing.slice(i, i + DIMENSION_CHUNK);
        try {
          const dims = await loadImageDimensions(chunk.map((img) => img.path));
          if (cancelled) return;
          const byPath = new Map(dims.map((d) => [d.path, d]));
          queryClient.setQueryData<ImageEntry[]>(
            ["project", "images", rootPath],
            (old) =>
              old?.map((img) => {
                const d = byPath.get(img.path);
                return d && d.width != null && d.height != null
                  ? { ...img, width: d.width, height: d.height }
                  : img;
              })
          );
        } catch {
          return; // backend unavailable or command failed; dimensions stay lazy
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath, imagesData, queryClient]);

  return query;
}
