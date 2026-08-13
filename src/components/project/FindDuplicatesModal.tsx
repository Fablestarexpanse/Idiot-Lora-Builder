import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { findDuplicates, deleteImage, ensureThumbnailUrl, loadProject } from "@/lib/tauri";
import { withThumbnailInvokeLimit } from "@/lib/thumbnailInvokeLimit";
import type { ImageEntry } from "@/types";

interface FindDuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Truncate long paths in the middle, keeping start and filename end. */
function truncateMiddle(text: string, max = 60): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** Normalize path separators so relative paths from different commands match. */
function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/");
}

/** What a delete confirmation is about to remove. */
interface PendingDelete {
  /** Absolute paths to delete. */
  paths: string[];
  /** Body text for the confirm dialog. */
  message: string;
}

interface DuplicateRowProps {
  relPath: string;
  absPath: string;
  entry: ImageEntry | undefined;
  actionsDisabled: boolean;
  onDelete: () => void;
}

function DuplicateRow({ relPath, absPath, entry, actionsDisabled, onDelete }: DuplicateRowProps) {
  const { data: src, isLoading, isError } = useQuery({
    queryKey: ["thumbnail", absPath, 128],
    queryFn: () =>
      withThumbnailInvokeLimit(() => ensureThumbnailUrl(absPath, 128)),
    staleTime: 30 * 60 * 1000,
    gcTime: 45 * 60 * 1000,
  });

  return (
    <li className="flex items-center gap-2 rounded bg-gray-800/40 px-1.5 py-1">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-900/80">
        {isLoading && <span className="text-[10px] text-gray-500">…</span>}
        {isError && <span className="text-[10px] text-red-400">Err</span>}
        {src && (
          <img
            src={src}
            alt=""
            className="h-full w-full object-contain"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-gray-300" title={relPath}>
          {truncateMiddle(relPath)}
        </p>
        {entry?.file_size != null && entry.file_size > 0 && (
          <p className="text-[10px] text-gray-500" title="File size">
            {formatFileSize(entry.file_size)}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={actionsDisabled}
        className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 hover:bg-red-600/20 hover:text-red-400 disabled:opacity-40"
        title="Delete this file"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
    </li>
  );
}

export function FindDuplicatesModal({ isOpen, onClose }: FindDuplicatesModalProps) {
  const rootPath = useProjectStore((s) => s.rootPath);
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const setSelectedImage = useSelectionStore((s) => s.setSelectedImage);
  const showToast = useUiStore((s) => s.showToast);
  const queryClient = useQueryClient();

  const [groups, setGroups] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  // Subscribe to the project image list cache (never fetches from here) so
  // relative duplicate paths can be resolved to absolute paths and sizes.
  const { data: images } = useQuery({
    queryKey: ["project", "images", rootPath],
    queryFn: () => loadProject(rootPath!),
    enabled: false,
  });

  const entriesByRelPath = useMemo(() => {
    const map = new Map<string, ImageEntry>();
    for (const img of images ?? []) {
      map.set(normalizeRel(img.relative_path), img);
    }
    return map;
  }, [images]);

  const pathSep = rootPath?.includes("\\") ? "\\" : "/";

  function entryFor(relPath: string): ImageEntry | undefined {
    return entriesByRelPath.get(normalizeRel(relPath));
  }

  function toAbsolute(relPath: string): string {
    // Prefer the exact absolute path the backend reported for this image.
    const entry = entryFor(relPath);
    if (entry) return entry.path;
    if (!rootPath) return relPath;
    const root = rootPath.endsWith(pathSep) ? rootPath.slice(0, -1) : rootPath;
    return `${root}${pathSep}${relPath}`;
  }

  const findMutation = useMutation({
    mutationFn: async () => {
      if (!rootPath) throw new Error("No project open");
      return findDuplicates(rootPath);
    },
    onSuccess: (res) => {
      setGroups(res.groups);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err instanceof Error ? err.message : String(err));
      setGroups(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (absPaths: string[]) => {
      const deleted: string[] = [];
      let firstError: string | null = null;
      for (const path of absPaths) {
        try {
          await deleteImage(path);
          deleted.push(path);
        } catch (err) {
          if (firstError === null) {
            firstError = err instanceof Error ? err.message : String(err);
          }
        }
      }
      return { deleted, firstError };
    },
    onSuccess: ({ deleted, firstError }) => {
      if (deleted.length > 0) {
        const deletedAbs = new Set(deleted);
        // Same optimistic cache update as ThumbnailCell: filter out, no refetch.
        if (rootPath) {
          queryClient.setQueryData(
            ["project", "images", rootPath],
            (old: ImageEntry[] | undefined) => {
              if (!Array.isArray(old)) return old;
              return old.filter((img) => !deletedAbs.has(img.path));
            }
          );
        }
        if (selectedImage && deletedAbs.has(selectedImage.path)) {
          setSelectedImage(null);
        }
        // Remove deleted files from local groups; drop groups below 2 entries.
        setGroups((prev) =>
          prev === null
            ? prev
            : prev
                .map((group) => group.filter((rel) => !deletedAbs.has(toAbsolute(rel))))
                .filter((group) => group.length >= 2)
        );
      }
      setPendingDelete(null);
      if (firstError !== null) {
        showToast(`Failed to delete some files: ${firstError}`);
      }
    },
    onError: (err: Error) => {
      setPendingDelete(null);
      showToast(err instanceof Error ? err.message : String(err));
    },
  });

  const actionsDisabled = deleteMutation.isPending;

  function handleFind() {
    setGroups(null);
    setError(null);
    findMutation.mutate();
  }

  function handleClose() {
    // While the confirm dialog is open, Escape/backdrop should only dismiss it.
    if (pendingDelete !== null) {
      if (!deleteMutation.isPending) setPendingDelete(null);
      return;
    }
    setGroups(null);
    setError(null);
    setPendingDelete(null);
    onClose();
  }

  function requestDeleteFile(relPath: string) {
    setPendingDelete({
      paths: [toAbsolute(relPath)],
      message:
        `Delete "${relPath}" from the folder? The file and its caption will be removed. This cannot be undone.`,
    });
  }

  function requestKeepLargest(group: string[]) {
    const withSizes = group.map((rel) => ({
      rel,
      size: entryFor(rel)?.file_size,
    }));
    if (withSizes.some((f) => f.size == null)) return;
    let winner = withSizes[0];
    for (const f of withSizes) {
      if ((f.size ?? 0) > (winner.size ?? 0)) winner = f;
    }
    const losers = withSizes.filter((f) => f.rel !== winner.rel);
    if (losers.length === 0) return;
    setPendingDelete({
      paths: losers.map((f) => toAbsolute(f.rel)),
      message:
        `Keep "${winner.rel}" and delete the other ${losers.length} file(s) in this group? ` +
        "The files and their captions will be removed. This cannot be undone.",
    });
  }

  /** Whether "Keep largest" applies: all sizes known and not all identical. */
  function canKeepLargest(group: string[]): boolean {
    const sizes = group.map((rel) => entryFor(rel)?.file_size);
    if (sizes.some((s) => s == null)) return false;
    return new Set(sizes).size > 1;
  }

  const totalDuplicates = groups?.reduce((sum, g) => sum + g.length - 1, 0) ?? 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Find Duplicates"
      icon={<Copy className="h-5 w-5" />}
      maxWidthClassName="flex max-h-[80vh] max-w-2xl flex-col"
      footer={
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            Close
          </button>
          {groups !== null && (
            <button
              type="button"
              onClick={handleFind}
              disabled={findMutation.isPending || actionsDisabled}
              className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {findMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Scan Again
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-1 flex-col overflow-auto p-4">
          <p className="mb-3 text-sm text-gray-400">
            Finds duplicate images by file content (SHA-256). Exact byte-identical files are grouped.
          </p>

          {groups === null && !error && (
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

          {groups !== null && (
            <>
              {groups.length === 0 ? (
                <p className="text-sm text-gray-300">No duplicates found.</p>
              ) : (
                <>
                  <p className="mb-3 text-sm font-medium text-gray-200">
                    {groups.length} duplicate group(s) • {totalDuplicates} redundant file(s)
                  </p>
                  <div className="space-y-3 overflow-auto">
                    {groups.map((group, i) => (
                      <div
                        key={group[0] ?? i}
                        className="rounded border border-border bg-surface/80 p-2"
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <p className="text-xs text-gray-500">
                            Group {i + 1} ({group.length} copies)
                          </p>
                          {canKeepLargest(group) && (
                            <button
                              type="button"
                              onClick={() => requestKeepLargest(group)}
                              disabled={actionsDisabled}
                              className="rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-red-600/20 hover:text-red-400 disabled:opacity-40"
                              title="Keep the largest file and delete the rest of this group"
                            >
                              Keep largest
                            </button>
                          )}
                        </div>
                        <ul className="space-y-1">
                          {group.map((relPath) => (
                            <DuplicateRow
                              key={relPath}
                              relPath={relPath}
                              absPath={toAbsolute(relPath)}
                              entry={entryFor(relPath)}
                              actionsDisabled={actionsDisabled}
                              onDelete={() => requestDeleteFile(relPath)}
                            />
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

      <ConfirmModal
        isOpen={pendingDelete !== null}
        onCancel={() => {
          if (!deleteMutation.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.paths);
        }}
        title={
          pendingDelete !== null && pendingDelete.paths.length > 1
            ? `Delete ${pendingDelete.paths.length} files?`
            : "Delete image?"
        }
        icon={<Trash2 className="h-5 w-5 text-red-400" />}
        confirmLabel="Delete"
        confirmIcon={<Trash2 className="h-4 w-4" />}
        confirmButtonClassName="bg-red-600 hover:bg-red-500"
        isPending={deleteMutation.isPending}
      >
        <p className="text-sm text-gray-400">{pendingDelete?.message}</p>
      </ConfirmModal>
    </Modal>
  );
}
