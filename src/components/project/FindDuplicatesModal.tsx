import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Copy, Loader2 } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { findDuplicates } from "@/lib/tauri";

interface FindDuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FindDuplicatesModal({ isOpen, onClose }: FindDuplicatesModalProps) {
  const rootPath = useProjectStore((s) => s.rootPath);
  const [result, setResult] = useState<{ groups: string[][] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const findMutation = useMutation({
    mutationFn: async () => {
      if (!rootPath) throw new Error("No project open");
      return findDuplicates(rootPath);
    },
    onSuccess: (res) => {
      setResult(res);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message ?? "Failed to find duplicates");
      setResult(null);
    },
  });

  function handleFind() {
    setResult(null);
    setError(null);
    findMutation.mutate();
  }

  function handleClose() {
    setResult(null);
    setError(null);
    onClose();
  }

  if (!isOpen) return null;

  const totalDuplicates = result?.groups.reduce((sum, g) => sum + g.length - 1, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface-elevated shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-medium text-gray-100">
            <Copy className="h-5 w-5" />
            Find Duplicates
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-auto p-4">
          <p className="mb-3 text-sm text-gray-400">
            Finds duplicate images by file content (SHA-256). Exact byte-identical files are grouped.
          </p>

          {!result && !error && (
            <button
              type="button"
              onClick={handleFind}
              disabled={!rootPath || findMutation.isPending}
              className="flex items-center justify-center gap-2 self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {findMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning…
                </>
              ) : (
                "Find Duplicates"
              )}
            </button>
          )}

          {error && (
            <p className="rounded bg-red-900/30 p-3 text-sm text-red-300">{error}</p>
          )}

          {result && (
            <>
              {result.groups.length === 0 ? (
                <p className="text-sm text-gray-300">No duplicates found.</p>
              ) : (
                <>
                  <p className="mb-3 text-sm font-medium text-gray-200">
                    {result.groups.length} duplicate group(s) • {totalDuplicates} redundant file(s)
                  </p>
                  <div className="space-y-3 overflow-auto">
                    {result.groups.map((group, i) => (
                      <div
                        key={i}
                        className="rounded border border-border bg-surface/80 p-2"
                      >
                        <p className="mb-1 text-xs text-gray-500">
                          Group {i + 1} ({group.length} copies)
                        </p>
                        <ul className="space-y-0.5 text-xs text-gray-300">
                          {group.map((p, j) => (
                            <li key={j} className="truncate font-mono" title={p}>
                              {p.split(/[/\\]/).pop() ?? p}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            Close
          </button>
          {result && (
            <button
              type="button"
              onClick={handleFind}
              disabled={findMutation.isPending}
              className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {findMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Scan Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
