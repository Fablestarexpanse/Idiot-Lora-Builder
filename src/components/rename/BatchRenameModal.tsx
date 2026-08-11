import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, FileEdit, Loader2, AlertCircle } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectImages } from "@/hooks/useProject";
import { useSelectionStore } from "@/stores/selectionStore";
import { batchRename } from "@/lib/tauri";
import type { BatchRenameResult } from "@/types";
import { listen } from "@tauri-apps/api/event";

interface BatchRenameProgress {
  current: number;
  total: number;
  current_file: string;
}

interface BatchRenameModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BatchRenameModal({ isOpen, onClose }: BatchRenameModalProps) {
  const queryClient = useQueryClient();
  const rootPath = useProjectStore((s) => s.rootPath);
  const { data: images = [] } = useProjectImages();
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  const [prefix, setPrefix] = useState("img");
  const [startIndex, setStartIndex] = useState(1);
  const [zeroPad, setZeroPad] = useState(4);
  const [result, setResult] = useState<BatchRenameResult | null>(null);
  const [progress, setProgress] = useState<BatchRenameProgress | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const targetImages =
    selectedIds.size > 0
      ? images.filter((img) => selectedIds.has(img.id))
      : images;
  const relativePaths = targetImages.map((img) => img.relative_path);
  const count = relativePaths.length;

  useEffect(() => {
    // Only listen while the modal or its progress overlay is showing.
    if (!isOpen && !showProgress) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<BatchRenameProgress>(
        "batch-rename-progress",
        (event) => {
          setProgress(event.payload);
        }
      );
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen, showProgress]);

  const renameMutation = useMutation({
    mutationFn: async () => {
      if (!rootPath || relativePaths.length === 0)
        throw new Error("No project or no images");
      setShowProgress(true);
      setProgress({ current: 0, total: relativePaths.length, current_file: "" });
      return batchRename({
        root_path: rootPath,
        relative_paths: relativePaths,
        prefix: prefix.trim() || "img",
        start_index: startIndex,
        zero_pad: Math.max(1, Math.min(12, zeroPad)),
      });
    },
    onSuccess: async (res) => {
      setResult(res);

      // Let the backend rescan be the source of truth for the new paths.
      if (res.success && rootPath) {
        setIsUpdating(true);
        await queryClient.invalidateQueries({
          queryKey: ["project", "images", rootPath],
        });
      }

      setIsUpdating(false);
      setShowProgress(false);
      setProgress(null);
    },
    onError: () => {
      setShowProgress(false);
      setProgress(null);
    },
  });

  const exampleName = (i: number) => {
    const pad = Math.max(1, Math.min(12, zeroPad));
    const idx = startIndex + i;
    const name = `${(prefix.trim() || "img")}_${String(idx).padStart(pad, "0")}`;
    const ext = targetImages[i]?.filename.split(".").pop() ?? "png";
    return `${name}.${ext}`;
  };

  function handleRename() {
    setResult(null);
    onClose(); // Close the rename modal immediately; the progress overlay takes over
    renameMutation.mutate();
  }

  function handleClose() {
    setResult(null);
    setProgress(null);
    setShowProgress(false);
    setIsUpdating(false);
    onClose();
  }

  // Always show the progress modal while a rename is active, regardless of isOpen
  if (showProgress && progress) {
    const percentage = Math.round((progress.current / progress.total) * 100);
    
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface-elevated shadow-xl p-6">
          <h2 className="mb-4 text-lg font-medium text-gray-100">
            {isUpdating ? "Updating Grid..." : "Renaming Files..."}
          </h2>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-gray-300">
              <span>Progress</span>
              <span className="font-medium">
                {isUpdating ? (
                  "Refreshing..."
                ) : (
                  `${progress.current} / ${progress.total} (${percentage}%)`
                )}
              </span>
            </div>
            
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
              <div
                className="h-full bg-blue-600 transition-all duration-200"
                style={{ width: isUpdating ? "100%" : `${percentage}%` }}
              />
            </div>
            
            {!isUpdating && progress.current_file && (
              <div className="text-xs text-gray-500 truncate">
                Current: {progress.current_file}
              </div>
            )}
            
            {isUpdating && (
              <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Refreshing image grid...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-elevated shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-medium text-gray-100">
            <FileEdit className="h-5 w-5" />
            Batch Rename
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <p className="text-sm text-gray-400">
            {selectedIds.size > 0
              ? `${selectedIds.size} selected image(s) will be renamed.`
              : `All ${images.length} image(s) will be renamed.`}
          </p>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Prefix</label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="img"
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-gray-500">Start index</label>
              <input
                type="number"
                min={0}
                value={startIndex}
                onChange={(e) => setStartIndex(parseInt(e.target.value, 10) || 1)}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-gray-500">Zero-pad (digits)</label>
              <input
                type="number"
                min={1}
                max={12}
                value={zeroPad}
                onChange={(e) => setZeroPad(parseInt(e.target.value, 10) || 4)}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
            </div>
          </div>

          {count > 0 && (
            <div className="rounded bg-surface/80 px-3 py-2">
              <p className="mb-1 text-xs text-gray-500">Preview (first 3)</p>
              <p className="text-xs text-gray-300">
                {[0, 1, 2]
                  .filter((i) => i < count)
                  .map((i) => exampleName(i))
                  .join(", ")}
                {count > 3 && ` … +${count - 3} more`}
              </p>
            </div>
          )}

          {result && (
            <div
              className={`flex items-start gap-2 rounded px-3 py-2 text-sm ${
                result.success
                  ? "bg-green-900/30 text-green-300"
                  : "bg-amber-900/30 text-amber-200"
              }`}
            >
              {result.success ? (
                <span>Renamed {result.renamed_count} file(s).</span>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p>Renamed {result.renamed_count}, with errors:</p>
                    <ul className="mt-1 list-inside list-disc text-xs">
                      {result.errors.slice(0, 5).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                      {result.errors.length > 5 && (
                        <li>… and {result.errors.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleRename}
            disabled={count === 0 || renameMutation.isPending}
            className="flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {renameMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileEdit className="h-4 w-4" />
            )}
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
