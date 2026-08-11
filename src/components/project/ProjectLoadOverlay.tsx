import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2, FolderOpen } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectLoadStore } from "@/stores/projectLoadStore";

interface ProjectLoadProgressPayload {
  count: number;
}

export function ProjectLoadOverlay() {
  const isLoadingProject = useProjectStore((s) => s.isLoadingProject);
  const projectDataReady = useProjectStore((s) => s.projectDataReady);
  const imagesFound = useProjectLoadStore((s) => s.imagesFound);
  const setImagesFound = useProjectLoadStore((s) => s.setImagesFound);
  const reset = useProjectLoadStore((s) => s.reset);

  const prevLoading = useRef(false);

  // Reset count when loading starts
  useEffect(() => {
    if (isLoadingProject && !prevLoading.current) {
      reset();
    }
    prevLoading.current = isLoadingProject;
  }, [isLoadingProject, reset]);

  // Listen for progress events
  useEffect(() => {
    const unlisten = listen<ProjectLoadProgressPayload>(
      "project-load-progress",
      (event) => setImagesFound(event.payload.count)
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setImagesFound]);

  if (!isLoadingProject) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface/95 backdrop-blur-sm"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex max-w-sm flex-col items-center gap-6 rounded-xl border border-border bg-surface-elevated px-10 py-8 shadow-xl">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-purple-500/20">
          <FolderOpen className="h-8 w-8 text-purple-400" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-100">
            Loading project
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            {projectDataReady
              ? "Loading thumbnails…"
              : "Scanning folder for images…"}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
            <span className="text-sm font-medium text-gray-300">
              {imagesFound > 0
                ? `${imagesFound.toLocaleString()} image${imagesFound === 1 ? "" : "s"} found`
                : projectDataReady
                  ? "Preparing grid…"
                  : "Scanning…"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
