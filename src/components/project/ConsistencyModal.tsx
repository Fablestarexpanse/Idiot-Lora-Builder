import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { ScanFace, Loader2, Check, Undo2, X, ZoomIn } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useProjectStore } from "@/stores/projectStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectImages } from "@/hooks/useProject";
import {
  consistencyBand,
  lowestFirst,
  suggestedMarks,
  type ConsistencyBand,
} from "@/lib/consistency";
import type { ImageEntry } from "@/types";
import { withThumbnailInvokeLimit } from "@/lib/thumbnailInvokeLimit";
import {
  loadConsistency,
  scanConsistency,
  cancelConsistencyScan,
  setRatingsBatch,
  type RatingChange,
  undoConsistencyExclusion,
  chooseConsistencyBaselines,
  ensureThumbnailUrl,
  type ConsistencyScan,
  type ConsistencyScore,
} from "@/lib/tauri";

const button =
  "rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/10 disabled:opacity-40";
const PAGE_SIZE = 60;
const bands: ConsistencyBand[] = ["good", "bad", "needs_edit"];
const bandStyle = {
  bad: { label: "Bad", card: "border-red-500 bg-red-500/5", badge: "bg-red-600 text-white" },
  needs_edit: {
    label: "Needs Edit",
    card: "border-amber-500 bg-amber-500/5",
    badge: "bg-amber-600 text-white",
  },
  good: {
    label: "Good",
    card: "border-green-500 bg-green-500/5",
    badge: "bg-green-600 text-white",
  },
};
const fileName = (path: string) => path.replace(/\\/g, "/").split("/").pop() || path;
const baselineKey = (path: string) =>
  path
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
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
  const [baselines, setBaselines] = useState<string[]>(["", "", ""]);
  const [scan, setScan] = useState<ConsistencyScan | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [cutoff, setCutoff] = useState(0.25);
  const [goodFrom, setGoodFrom] = useState(0.6);
  const [busy, setBusy] = useState<"scan" | "rate" | "undo" | "load" | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [ratingOverrides, setRatingOverrides] = useState<Record<string, ConsistencyBand>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [referenceSlot, setReferenceSlot] = useState<number | null>(null);
  const [referenceSearch, setReferenceSearch] = useState("");
  const [referencePage, setReferencePage] = useState(0);
  const baselineCount = baselines.filter(Boolean).length;
  const referenceImages = useMemo(
    () =>
      images.filter((image) =>
        image.relative_path.toLowerCase().includes(referenceSearch.toLowerCase())
      ),
    [images, referenceSearch]
  );
  const referencePages = Math.max(1, Math.ceil(referenceImages.length / PAGE_SIZE));
  const currentReferencePage = Math.min(referencePage, referencePages - 1);
  useEffect(() => {
    if (!isOpen || !rootPath) return;
    let active = true;
    setBusy("load");
    setError("");
    setMessage("");
    setScan(null);
    setBaselines(["", "", ""]);
    setReferenceSlot(null);
    setMarked(new Set());
    setRatingOverrides({});
    setCanUndo(false);
    loadConsistency(rootPath)
      .then((result) => {
        if (!active) return;
        setScan(result);
        setBaselines([0, 1, 2].map((i) => result.baselines[i]?.path ?? ""));
        setCanUndo(result.can_undo);
        setCutoff(result.suggested_cutoff ?? 0.25);
        setGoodFrom(Math.max(0.6, result.suggested_cutoff ?? 0.25));
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
    setBaselines([0, 1, 2].map((i) => next[i] ?? ""));
    setScan(null);
    setMarked(new Set());
    setRatingOverrides({});
    setMessage("");
    setError("");
  }
  function addBaselines(paths: string[]) {
    const next = [...baselines];
    for (const path of paths) {
      if (next.some((existing) => existing && baselineKey(existing) === baselineKey(path)))
        continue;
      const empty = next.findIndex((existing) => !existing);
      if (empty === -1) {
        setError("Choose up to three baseline images. Remove a reference to replace it.");
        return;
      }
      next[empty] = path;
    }
    changeBaselines(next);
  }
  function openReference(slot: number) {
    setReferenceSlot(slot);
    setReferenceSearch("");
    setReferencePage(0);
  }
  function chooseReference(path: string) {
    if (referenceSlot === null) return;
    if (
      baselines.some(
        (existing, index) =>
          index !== referenceSlot && existing && baselineKey(existing) === baselineKey(path)
      )
    )
      return;
    if (baselineKey(baselines[referenceSlot]) !== baselineKey(path)) {
      const next = [...baselines];
      next[referenceSlot] = path;
      changeBaselines(next);
    }
    setReferenceSlot(null);
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
        baselines.filter(Boolean),
        images.map((i) => i.relative_path)
      );
      setScan(result);
      setCanUndo(result.can_undo);
      setMarked(new Set());
      setRatingOverrides({});
      setCutoff(result.suggested_cutoff ?? 0.25);
      setGoodFrom(Math.max(0.6, result.suggested_cutoff ?? 0.25));
      setPage(0);
      setMessage(
        "Scan complete. Review Good, Bad and Needs Edit suggestions, then apply ratings to your dataset."
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
    setGoodFrom((previous) => Math.max(previous, value));
    setMarked(suggestedMarks(rows, value));
  }
  function ratingFor(score: ConsistencyScore): ConsistencyBand | null {
    return score.baseline
      ? null
      : (ratingOverrides[score.relative_path] ?? consistencyBand(score, cutoff, goodFrom));
  }
  const ratingChanges: RatingChange[] = rows.flatMap((score) => {
    const rating = ratingFor(score);
    return rating && imagePaths.has(score.relative_path)
      ? [{ relative_path: score.relative_path, rating }]
      : [];
  });
  const selectedRatingChanges = ratingChanges.filter((change) => marked.has(change.relative_path));
  async function applyRatings(selectedOnly: boolean) {
    if (!rootPath) return;
    const changes = selectedOnly ? selectedRatingChanges : ratingChanges;
    if (!changes.length) return;
    setBusy("rate");
    setError("");
    setMessage("");
    try {
      await setRatingsBatch(rootPath, changes);
      const byPath = new Map(changes.map((change) => [change.relative_path, change.rating]));
      queryClient.setQueryData<ImageEntry[]>(["project", "images", rootPath], (old) =>
        old?.map((image) => {
          const rating = byPath.get(image.relative_path);
          return rating ? { ...image, rating } : image;
        })
      );
      if (useProjectStore.getState().rootPath === rootPath) {
        const selection = useSelectionStore.getState();
        const image = selection.selectedImage;
        const rating = image && byPath.get(image.relative_path);
        if (image && rating) selection.setSelectedImage({ ...image, rating });
      }
      setMessage(
        `${changes.length} dataset ratings saved. Close Compare to see them on the main page.`
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  function markBand(band: ConsistencyBand) {
    setMarked(
      new Set(rows.filter((score) => ratingFor(score) === band).map((score) => score.relative_path))
    );
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
  async function undoExclusion() {
    if (!rootPath) return;
    setBusy("undo");
    setError("");
    setMessage("");
    try {
      const result = await undoConsistencyExclusion(rootPath);
      setCanUndo(result.can_undo);
      setMarked(new Set());
      // A bulk filesystem change needs a fresh image list; selection reconciles on refetch.
      await queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
      const refreshed = await loadConsistency(rootPath);
      setScan(refreshed);
      setCanUndo(refreshed.can_undo);
      setMessage(`${result.moved.length} image(s) restored.`);
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
        isOpen={isOpen && !preview && referenceSlot === null}
        onClose={onClose}
        title="Consistency Check"
        icon={<ScanFace className="h-5 w-5" />}
        maxWidthClassName="max-w-5xl flex max-h-[90vh] flex-col"
        closeDisabled={!!busy}
        footer={
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
            <span className="text-xs text-gray-400">
              {marked.size} selected / apply ratings to show them on the main page
            </span>
            <div className="flex flex-wrap gap-2">
              {canUndo && (
                <button className={button} disabled={!!busy} onClick={() => void undoExclusion()}>
                  <Undo2 className="mr-1 inline h-3.5 w-3.5" />
                  Undo previous exclusion
                </button>
              )}
              <button
                className={button}
                disabled={!selectedRatingChanges.length || !!busy}
                onClick={() => void applyRatings(true)}
              >
                Apply selected ratings
              </button>
              <button
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                disabled={!ratingChanges.length || !!busy}
                onClick={() => void applyRatings(false)}
              >
                <Check className="mr-1 inline h-4 w-4" />
                Apply all ratings
              </button>
            </div>
          </div>
        }
      >
        <div className="shrink-0 space-y-3 border-b border-border p-4">
          <p className="text-sm text-gray-400">
            Choose three references that best represent your character, preferably with different
            angles. Click a reference box to choose from the loaded dataset, or choose external
            files.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="relative flex h-24 w-24 items-center justify-center rounded border border-border bg-surface"
                title={baselines[index]}
              >
                <button
                  className="flex h-full w-full flex-col items-center justify-center gap-1 rounded p-1 text-xs text-gray-400 hover:bg-white/10 disabled:opacity-40"
                  aria-label={`Choose reference ${index + 1} from dataset`}
                  title="Choose or replace from loaded dataset"
                  disabled={!!busy || !images.length}
                  onClick={() => openReference(index)}
                >
                  {baselines[index] ? (
                    <Thumbnail path={baselines[index]} />
                  ) : (
                    <>
                      <ScanFace className="h-5 w-5" />
                      <span>Reference {index + 1}</span>
                      <span className="text-[10px]">Choose from dataset</span>
                    </>
                  )}
                </button>
                {baselines[index] && (
                  <>
                    <button
                      className="absolute right-1 top-1 rounded bg-black/80 p-0.5 text-gray-200"
                      disabled={!!busy}
                      aria-label={`Remove baseline ${index + 1}`}
                      onClick={() =>
                        changeBaselines(baselines.map((path, i) => (i === index ? "" : path)))
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <button
                      className="absolute bottom-1 right-1 rounded bg-black/80 p-0.5 text-gray-200"
                      disabled={!!busy}
                      aria-label={`Preview baseline ${index + 1}`}
                      onClick={() => setPreview(baselines[index])}
                    >
                      <ZoomIn className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={!!busy || baselineCount === 3}
                  onClick={() => void pickFiles()}
                >
                  Choose files...
                </button>
                <button
                  className={button}
                  disabled={!!busy || !selectedIds.size || baselineCount === 3}
                  onClick={() =>
                    addBaselines(images.filter((i) => selectedIds.has(i.id)).map((i) => i.path))
                  }
                >
                  Use selected images
                </button>
              </div>
              <button
                className="flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                disabled={!!busy || baselineCount !== 3 || !images.length}
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
                Bad below {cutoff.toFixed(2)}
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
              <label className="flex min-w-64 flex-1 items-center gap-3 text-xs text-gray-300">
                Good from {goodFrom.toFixed(2)}
                <input
                  aria-label="Good similarity cutoff"
                  className="flex-1 accent-green-500"
                  type="range"
                  min={cutoff}
                  max={1}
                  step={0.01}
                  value={goodFrom}
                  disabled={!!busy}
                  onChange={(e) => setGoodFrom(Number(e.target.value))}
                />
              </label>
              <div className="flex w-full flex-wrap gap-2">
                {bands.map((band) => {
                  const count = rows.filter((score) => ratingFor(score) === band).length;
                  return (
                    <button
                      key={band}
                      className={`rounded px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${bandStyle[band].badge}`}
                      disabled={!!busy || !count}
                      onClick={() => markBand(band)}
                    >
                      Select all {bandStyle[band].label.toLowerCase()} ({count})
                    </button>
                  );
                })}
                <span className="self-center text-xs text-gray-400">
                  Needs Edit sits between the cutoffs. Group buttons replace the selection; applying
                  ratings updates existing dataset ratings.
                </span>
              </div>
              <button
                className={button}
                disabled={!!busy || !marked.size}
                onClick={() => setMarked(new Set())}
              >
                Clear selection
              </button>
              <span className="w-full text-xs text-gray-500">
                {scan?.suggested_cutoff == null
                  ? "At least four scored faces are needed for automatic suggestions. You can adjust the cutoff or rate by eye."
                  : `Suggested cutoff ${scan.suggested_cutoff.toFixed(2)} / lowest matches first. Baselines, multiple-face images, and unscored images are never automatically rated.`}
              </span>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!rows.length ? (
            <div className="py-10 text-center text-sm text-gray-500">
              {baselineCount === 3
                ? "Ready to scan your dataset."
                : "Add three baseline images to get started."}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((score) => {
                const band = ratingFor(score);
                return (
                  <article
                    key={score.relative_path}
                    aria-label={`${score.relative_path}: ${band ? bandStyle[band].label : score.baseline ? "Baseline" : "Review"}${marked.has(score.relative_path) ? ", selected" : ""}`}
                    className={`overflow-hidden rounded border-2 ${band ? bandStyle[band].card : "border-border bg-surface"} ${marked.has(score.relative_path) ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-surface" : ""}`}
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
                      <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
                        <span
                          className={`rounded px-2 py-0.5 ${band ? bandStyle[band].badge : "bg-gray-700 text-gray-200"}`}
                        >
                          {band ? bandStyle[band].label : score.baseline ? "Baseline" : "Review"}
                        </span>
                        {marked.has(score.relative_path) && (
                          <span className="text-blue-300">Selected</span>
                        )}
                      </div>
                      {!score.baseline && (
                        <select
                          aria-label={`Rating for ${score.relative_path}`}
                          value={ratingOverrides[score.relative_path] ?? "suggested"}
                          disabled={!!busy}
                          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-gray-200"
                          onChange={(event) =>
                            setRatingOverrides((previous) => {
                              const next = { ...previous };
                              if (event.target.value === "suggested")
                                delete next[score.relative_path];
                              else
                                next[score.relative_path] = event.target.value as ConsistencyBand;
                              return next;
                            })
                          }
                        >
                          <option value="suggested">Use comparison suggestion</option>
                          <option value="good">Good</option>
                          <option value="bad">Bad</option>
                          <option value="needs_edit">Needs Edit</option>
                        </select>
                      )}
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
                              ? "Deselect"
                              : "Select"}
                        </button>
                      </div>
                      <p className="text-[11px] text-gray-500" title={score.error ?? ""}>
                        {status(score)}
                      </p>
                    </div>
                  </article>
                );
              })}
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
        isOpen={isOpen && referenceSlot !== null}
        onClose={() => setReferenceSlot(null)}
        title={`Choose reference ${(referenceSlot ?? 0) + 1} from dataset`}
        maxWidthClassName="max-w-4xl flex max-h-[85vh] flex-col"
      >
        <div className="shrink-0 space-y-2 border-b border-border p-4">
          <p className="text-sm text-gray-400">
            Click an image to use it for this reference. Images used in other reference boxes are
            unavailable.
          </p>
          <input
            aria-label="Search dataset references"
            placeholder="Search by filename or folder..."
            value={referenceSearch}
            onChange={(event) => {
              setReferenceSearch(event.target.value);
              setReferencePage(0);
            }}
            className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!referenceImages.length ? (
            <p className="py-8 text-center text-sm text-gray-500">
              No matching images in the loaded dataset.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {referenceImages
                .slice(currentReferencePage * PAGE_SIZE, (currentReferencePage + 1) * PAGE_SIZE)
                .map((image) => {
                  const used = baselines.some(
                    (path, index) =>
                      index !== referenceSlot &&
                      path &&
                      baselineKey(path) === baselineKey(image.path)
                  );
                  return (
                    <button
                      key={image.id}
                      aria-label={`Use ${image.relative_path} as reference`}
                      disabled={used}
                      onClick={() => chooseReference(image.path)}
                      title={image.relative_path}
                      className="overflow-hidden rounded border border-border bg-surface p-2 text-left hover:border-blue-400 disabled:opacity-40"
                    >
                      <div className="flex h-28 items-center justify-center">
                        <Thumbnail path={image.path} size={256} />
                      </div>
                      <p className="mt-2 truncate text-xs text-gray-300">{image.relative_path}</p>
                      {used && <p className="text-[10px] text-gray-400">Already a reference</p>}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
        {referencePages > 1 && (
          <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border py-3 text-xs text-gray-400">
            <button
              className={button}
              disabled={currentReferencePage === 0}
              onClick={() => setReferencePage(currentReferencePage - 1)}
            >
              Previous references
            </button>
            Page {currentReferencePage + 1} of {referencePages}
            <button
              className={button}
              disabled={currentReferencePage + 1 >= referencePages}
              onClick={() => setReferencePage(currentReferencePage + 1)}
            >
              Next references
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
    </>
  );
}
