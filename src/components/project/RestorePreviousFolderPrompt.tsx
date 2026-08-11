import { useEffect, useRef, useState } from "react";
import { FolderOpen, FolderPlus, X } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { openFolder } from "@/lib/tauri";

export function RestorePreviousFolderPrompt() {
  const rootPath = useProjectStore((s) => s.rootPath);
  const lastOpenedFolder = useProjectStore((s) => s.lastOpenedFolder);
  const setRootPath = useProjectStore((s) => s.setRootPath);
  const setLastOpenedFolder = useProjectStore((s) => s.setLastOpenedFolder);
  const setIsLoadingProject = useProjectStore((s) => s.setIsLoadingProject);
  const showToast = useUiStore((s) => s.showToast);

  const [show, setShow] = useState(false);
  const hasAttemptedShow = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Show when lastOpenedFolder is available (after persist rehydration) and no project is open
  useEffect(() => {
    if (hasAttemptedShow.current) return;
    if (!rootPath && lastOpenedFolder && lastOpenedFolder.trim().length > 0) {
      hasAttemptedShow.current = true;
      setShow(true);
    }
  }, [rootPath, lastOpenedFolder]);

  function handleYes() {
    if (lastOpenedFolder) {
      setIsLoadingProject(true);
      setRootPath(lastOpenedFolder);
    }
    setShow(false);
  }

  function handleNo() {
    setShow(false);
  }

  async function handleChooseNew() {
    try {
      const path = await openFolder();
      if (path) {
        setLastOpenedFolder(path);
        setIsLoadingProject(true);
        setRootPath(path);
        setShow(false);
      }
    } catch (err) {
      console.error("Open folder failed:", err);
      showToast(err instanceof Error ? err.message : "Failed to open folder");
    }
  }

  if (!show) return null;

  const displayPath =
    lastOpenedFolder?.split(/[/\\]/).pop() ?? lastOpenedFolder ?? "";
  const fullPath = lastOpenedFolder ?? "";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-labelledby="restore-prompt-title"
      aria-modal="true"
    >
      <div ref={contentRef} className="w-full max-w-md rounded-lg border border-border bg-surface-elevated shadow-xl">
        {/* Header - matches ExportModal, SettingsModal */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="restore-prompt-title"
            className="flex items-center gap-2 text-lg font-medium text-gray-100"
          >
            <FolderOpen className="h-5 w-5 text-purple-400" />
            Load previous folder?
          </h2>
          <button
            type="button"
            onClick={handleNo}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          <p className="text-sm text-gray-400">
            You were last working in this folder:
          </p>
          <div className="rounded border border-border bg-surface px-3 py-2">
            <p
              className="truncate text-sm font-medium text-gray-200"
              title={fullPath}
            >
              {displayPath}
            </p>
            <p
              className="mt-1 truncate text-xs text-gray-500"
              title={fullPath}
            >
              {fullPath}
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleYes}
                className="flex flex-1 items-center justify-center gap-2 rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500"
              >
                <FolderOpen className="h-4 w-4" />
                Yes, load it
              </button>
              <button
                type="button"
                onClick={handleNo}
                className="flex flex-1 items-center justify-center gap-2 rounded border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600 hover:text-gray-200"
              >
                No
              </button>
            </div>
            <button
              type="button"
              onClick={handleChooseNew}
              className="flex items-center justify-center gap-2 rounded border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600 hover:text-gray-200"
            >
              <FolderPlus className="h-4 w-4" />
              Choose a different folder…
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
