import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { ScanFace, Loader2, FolderInput, Undo2, X, ZoomIn } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useProjectStore } from "@/stores/projectStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectImages } from "@/hooks/useProject";
import { lowestFirst, suggestedMarks } from "@/lib/consistency";
import { withThumbnailInvokeLimit } from "@/lib/thumbnailInvokeLimit";
import {
  loadConsistency,
  scanConsistency,
  cancelConsistencyScan,
  excludeConsistency,
  undoConsistencyExclusion,
  chooseConsistencyBaselines,
  ensureThumbnailUrl,
  type ConsistencyScan,
  type ConsistencyScore,
} from "@/lib/tauri";

const button =
  "rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/10 disabled:opacity-40";
const PAGE_SIZE = 60;
const fileName = (path: string) => path.replace(/\\/g, "/").split("/").pop() || path;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
function Thumbnail({ path, size = 128 }: { path: string; size?: number }) {
  const query = useQuery({
    queryKey: ["thumbnail", path, size],
    queryFn: () => withThumbnailInvokeLimit(() => ensureThumbnailUrl(path, size)),
    staleTime: 30 * 60 * 1000,
  });
  return query.data ? (
    <img
      src={query.data}
      alt={fileName(path)}
      className="h-full w-full object-contain"
      decoding="async"
    />
  ) : (
    <span className="text-xs text-gray-500">{query.isError ? "Preview unavailable" : "..."}</span>
  );
}
function status(score: ConsistencyScore): string {
  if (score.error) return "Unable to score";
  if (!score.face_count) return "No face detected";
  if (score.face_count > 1) return "Multiple faces / largest scored";
  return score.baseline ? "Baseline" : "Face similarity";
}
export function ConsistencyModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const rootPath = useProjectStore((s) => s.rootPath);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const { data: images = [] } = useProjectImages();
  const queryClient = useQueryClient();
  const [baselines, setBaselines] = useState<string[]>([]);
  const [scan, setScan] = useState<ConsistencyScan | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [cutoff, setCutoff] = useState(0.25);
  const [busy, setBusy] = useState<"scan" | "move" | "undo" | "load" | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!isOpen || !rootPath) return;
    let active = true;
    setBusy("load");
    setError("");
    setMessage("");
    setScan(null);
    setBaselines([]);
    setMarked(new Set());
    setCanUndo(false);
    loadConsistency(rootPath)
      .then((result) => {
        if (!active) return;
        setScan(result);
        setBaselines(result.baselines.map((b) => b.path));
        setCanUndo(result.can_undo);
        setCutoff(result.suggested_cutoff ?? 0.25);
        setPage(0);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, [isOpen, rootPath]);
  const rows = useMemo(() => lowestFirst(scan?.scores ?? []), [scan]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const imagePaths = useMemo(
    () => new Map(images.map((img) => [img.relative_path, img.path])),
    [images]
  );
  const pathFor = (key: string) => imagePaths.get(key) ?? `${rootPath}/${key}`;
  function changeBaselines(next: string[]) {
    setBaselines(next);
    setScan(null);
    setMarked(new Set());
    setMessage("");
    setError("");
  }
  function addBaselines(paths: string[]) {
    const next = [...new Set([...baselines, ...paths])];
    if (next.length > 3) {
      setError("Choose up to three baseline images. Remove a reference to replace it.");
      return;
    }
    changeBaselines(next);
  }
  async function pickFiles() {
    try {
      addBaselines(await chooseConsistencyBaselines());
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function runScan() {
    if (!rootPath) return;
    setBusy("scan");
    setError("");
    setMessage("");
    setProgress({ current: 0, total: images.length, phase: "Preparing face models..." });
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<typeof progress>("consistency-progress", (event) =>
        setProgress(event.payload)
      );
      const result = await scanConsistency(
        rootPath,
        baselines,
        images.map((i) => i.relative_path)
      );
      setScan(result);
      setCanUndo(result.can_undo);
      setMarked(new Set());
      setCutoff(result.suggested_cutoff ?? 0.25);
      setPage(0);
      setMessage(
        "Scan complete. Review the lowest scores or use Suggest outliers. Nothing has been moved."
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      unlisten?.();
      setBusy(null);
    }
  }
  function applyCutoff(value: number) {
    setCutoff(value);
    setMarked(suggestedMarks(rows, value));
  }
  function toggle(score: ConsistencyScore) {
    if (score.baseline) return;
    setMarked((previous) => {
      const next = new Set(previous);
      if (next.has(score.relative_path)) next.delete(score.relative_path);
      else next.add(score.relative_path);
      return next;
    });
  }
  async function moveOrUndo(undo: boolean) {
    if (!rootPath) return;
    setBusy(undo ? "undo" : "move");
    setError("");
    setMessage("");
    try {
      const result = undo
        ? await undoConsistencyExclusion(rootPath)
        : await excludeConsistency(rootPath, [...marked]);
      setCanUndo(result.can_undo);
      setConfirmMove(false);
      setMarked(new Set());
      // A bulk filesystem change needs a fresh image list; selection reconciles on refetch.
      await queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
      const refreshed = await loadConsistency(rootPath);
      setScan(refreshed);
      setCanUndo(refreshed.can_undo);
      setMessage(
        `${result.moved.length} image(s) ${undo ? "restored" : "moved with their captions to excluded_by_look"}.`
      );
      if (result.errors.length) setError(result.errors.join("\n"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <Modal
        isOpen={isOpen && !preview && !confirmMove}
        onClose={onClose}
        title="Consistency Check"
        icon={<ScanFace className="h-5 w-5" />}
        maxWidthClassName="max-w-5xl flex max-h-[90vh] flex-col"
        closeDisabled={!!busy}
        footer={
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
            <span className="text-xs text-gray-400">
              {marked.size} marked / originals are preserved in an excluded folder
            </span>
            <div className="flex gap-2">
              <button
                className={button}
                disabled={!canUndo || !!busy}
                onClick={() => void moveOrUndo(true)}
              >
                <Undo2 className="mr-1 inline h-3.5 w-3.5" />
                Undo last exclusion
              </button>
              <button
                className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40"
                disabled={!marked.size || !!busy}
                onClick={() => setConfirmMove(true)}
              >
                <FolderInput className="mr-1 inline h-4 w-4" />
                Move marked out
              </button>
            </div>
          </div>
        }
      >
        <div className="shrink-0 space-y-3 border-b border-border p-4">
          <p className="text-sm text-gray-400">
            Choose three references that best represent your character, preferably with different
            angles. Compare the finished dataset before exporting.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="relative flex h-24 w-24 items-center justify-center rounded border border-border bg-surface"
                title={baselines[index]}
              >
                {baselines[index] ? (
                  <>
                    <button
                      className="h-full w-full p-1"
                      aria-label={`Preview baseline ${index + 1}`}
                      disabled={!!busy}
                      onClick={() => setPreview(baselines[index])}
                    >
                      <Thumbnail path={baselines[index]} />
                    </button>
                    <button
                      className="absolute right-1 top-1 rounded bg-black/80 p-0.5 text-gray-200"
                      disabled={!!busy}
                      aria-label={`Remove baseline ${index + 1}`}
                      onClick={() => changeBaselines(baselines.filter((_, i) => i !== index))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-gray-500">Reference {index + 1}</span>
                )}
              </div>
            ))}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={!!busy || baselines.length === 3}
                  onClick={() => void pickFiles()}
                >
                  Choose files...
                </button>
                <button
                  className={button}
                  disabled={!!busy || !selectedIds.size || baselines.length === 3}
                  onClick={() =>
                    addBaselines(images.filter((i) => selectedIds.has(i.id)).map((i) => i.path))
                  }
                >
                  Use selected images
                </button>
              </div>
              <button
                className="flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                disabled={!!busy || baselines.length !== 3 || !images.length}
                onClick={() => void runScan()}
              >
                <ScanFace className="h-4 w-4" />
                Scan {images.length} images
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Local ArcFace comparison, averaged across your three references. Scores are similarity,
            not certainty. Human faces work best; illustrated and nonhuman characters are
            experimental.
          </p>
          {busy && (
            <div
              role="status"
              className="space-y-2 rounded bg-blue-950/30 p-3 text-xs text-blue-200"
            >
              <div className="flex items-center justify-between gap-3">
                <span>
                  <Loader2 className="mr-2 inline h-3 w-3 animate-spin" />
                  {busy === "scan"
                    ? `${progress.phase} ${progress.current}/${progress.total}`
                    : busy === "load"
                      ? "Loading saved results..."
                      : "Updating dataset..."}
                </span>
                {busy === "scan" && (
                  <button
                    className={button}
                    onClick={() =>
                      void cancelConsistencyScan().catch((e) => setError(errorText(e)))
                    }
                  >
                    Cancel scan
                  </button>
                )}
              </div>
              {busy === "scan" && (
                <progress
                  className="h-1.5 w-full accent-blue-500"
                  max={Math.max(1, progress.total)}
                  value={progress.current}
                />
              )}
            </div>
          )}
          {message && (
            <p role="status" className="text-xs text-green-300">
              {message}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-amber-300"
            >
              {error}
            </p>
          )}
          {!!rows.length && (
            <div className="flex flex-wrap items-center gap-3 rounded bg-surface px-3 py-2">
              <button
                className={button}
                disabled={!!busy || scan?.suggested_cutoff == null}
                onClick={() => applyCutoff(scan!.suggested_cutoff!)}
              >
                Suggest outliers
              </button>
              <label className="flex min-w-64 flex-1 items-center gap-3 text-xs text-gray-300">
                Mark below {cutoff.toFixed(2)}
                <input
                  aria-label="Similarity cutoff"
                  className="flex-1 accent-blue-500"
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={cutoff}
                  disabled={!!busy}
                  onChange={(e) => applyCutoff(Number(e.target.value))}
                />
              </label>
              <button
                className={button}
                disabled={!!busy || !marked.size}
                onClick={() => setMarked(new Set())}
              >
                Clear marks
              </button>
              <span className="w-full text-xs text-gray-500">
                {scan?.suggested_cutoff == null
                  ? "At least four scored faces are needed for automatic suggestions. You can adjust the cutoff or mark by eye."
                  : `Suggested cutoff ${scan.suggested_cutoff.toFixed(2)} / lowest matches first. Baselines, multiple-face images, and unscored images are never automatically marked.`}
              </span>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!rows.length ? (
            <div className="py-10 text-center text-sm text-gray-500">
              {baselines.length === 3
                ? "Ready to scan your dataset."
                : "Add three baseline images to get started."}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((score) => (
                <article
                  key={score.relative_path}
                  className={`overflow-hidden rounded border ${marked.has(score.relative_path) ? "border-amber-500 bg-amber-950/20" : "border-border bg-surface"}`}
                >
                  <button
                    className="group relative flex h-40 w-full items-center justify-center bg-black/30 p-2"
                    onClick={() => setPreview(pathFor(score.relative_path))}
                    aria-label={`Preview ${score.relative_path}`}
                    disabled={!!busy}
                  >
                    <Thumbnail path={pathFor(score.relative_path)} size={256} />
                    <ZoomIn className="absolute bottom-2 right-2 h-4 w-4 text-gray-400 group-hover:text-white" />
                  </button>
                  <div className="space-y-2 p-2">
                    <p className="truncate text-xs text-gray-300" title={score.relative_path}>
                      {score.relative_path}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-medium tabular-nums text-gray-100">
                        {score.similarity == null ? "--" : score.similarity.toFixed(2)}
                      </span>
                      <button
                        className={`${button} ${marked.has(score.relative_path) ? "text-amber-300" : ""}`}
                        disabled={score.baseline || !!busy}
                        onClick={() => toggle(score)}
                      >
                        {score.baseline
                          ? "Baseline"
                          : marked.has(score.relative_path)
                            ? "Keep"
                            : "Mark"}
                      </button>
                    </div>
                    <p className="text-[11px] text-gray-500" title={score.error ?? ""}>
                      {status(score)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        {rows.length > PAGE_SIZE && (
          <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border py-2 text-xs text-gray-400">
            <button
              className={button}
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            Page {currentPage + 1} of {pages}
            <button
              className={button}
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </Modal>
      <Modal
        isOpen={!!preview}
        onClose={() => setPreview(null)}
        title={preview ? fileName(preview) : "Preview"}
        maxWidthClassName="max-w-4xl"
      >
        <div className="flex h-[70vh] items-center justify-center bg-black/40 p-4">
          {preview && <Thumbnail path={preview} size={1024} />}
        </div>
      </Modal>
      <ConfirmModal
        isOpen={confirmMove}
        onCancel={() => setConfirmMove(false)}
        onConfirm={() => void moveOrUndo(false)}
        title="Move marked images out?"
        confirmLabel={`Move ${marked.size} images`}
        confirmButtonClassName="bg-amber-600 hover:bg-amber-500"
        isPending={busy === "move"}
        closeDisabled={busy === "move"}
      >
        <p className="text-sm text-gray-300">
          Move {marked.size} marked images and their matching captions to{" "}
          <span className="font-mono">excluded_by_look</span>. They will no longer appear in the
          active dataset. Nothing is deleted, and you can undo the exclusion.
        </p>
        {error && (
          <p role="alert" className="whitespace-pre-wrap text-xs text-amber-300">
            {error}
          </p>
        )}
      </ConfirmModal>
    </>
  );
}
