import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, FolderOpen, Archive, Loader2, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useCropStore } from "@/stores/cropStore";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useProjectImages } from "@/hooks/useProject";
import { useSelectionStore } from "@/stores/selectionStore";
import {
  exportDataset,
  exportByRating,
  selectSaveFolder,
  selectSaveFile,
} from "@/lib/tauri";
import type { ExportResult } from "@/types";

type WhatToExport = "all" | "selected" | "good" | "bad" | "needs_edit" | "by_rating";
type TrainerPreset = "plain" | "kohya";

function buildKohyaToml(
  profile: { baseRes: number; step: number; minRes: number; maxRes: number },
  repeatCount: number,
  conceptName: string
): string {
  const dir = `${repeatCount}_${conceptName}`;
  return [
    "[general]",
    `resolution = ${profile.baseRes}`,
    "enable_bucket = true",
    `min_bucket_reso = ${profile.minRes}`,
    `max_bucket_reso = ${profile.maxRes}`,
    `bucket_reso_steps = ${profile.step}`,
    'caption_extension = ".txt"',
    "",
    "[[datasets]]",
    "",
    "  [[datasets.subsets]]",
    `  image_dir = "${dir}"`,
    `  num_repeats = ${repeatCount}`,
    "",
  ].join("\n");
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const rootPath = useProjectStore((s) => s.rootPath);
  const { data: images = [] } = useProjectImages();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const showToast = useUiStore((s) => s.showToast);
  const triggerWordFromSettings = useSettingsStore((s) => s.triggerWord);
  const selectedProfile = useCropStore((s) => s.selectedProfile);

  const [what, setWhat] = useState<WhatToExport>("all");
  const [asZip, setAsZip] = useState(false);
  const [destPath, setDestPath] = useState("");
  const [onlyCaptioned, setOnlyCaptioned] = useState(false);
  const [sequentialNaming, setSequentialNaming] = useState(false);
  const [triggerWord, setTriggerWord] = useState("");
  const [preset, setPreset] = useState<TrainerPreset>("plain");
  const [repeatCount, setRepeatCount] = useState(10);
  const [conceptName, setConceptName] = useState("");
  const [writeToml, setWriteToml] = useState(true);
  const [result, setResult] = useState<ExportResult | null>(null);

  const defaultConceptName = useMemo(() => {
    const effectiveTrigger = triggerWord.trim() || triggerWordFromSettings.trim();
    if (effectiveTrigger) return effectiveTrigger;
    const folderName = rootPath?.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
    return folderName || "concept";
  }, [triggerWord, triggerWordFromSettings, rootPath]);

  const kohyaActive = preset === "kohya" && what !== "by_rating";
  const effectiveRepeats = Math.max(1, Math.round(repeatCount) || 1);
  const effectiveConcept = conceptName.trim() || defaultConceptName;

  const { goodCount, badCount, needsEditCount, ratedCount } = useMemo(() => {
    let good = 0;
    let bad = 0;
    let needsEdit = 0;
    for (const img of images) {
      if (img.rating === "good") good++;
      else if (img.rating === "bad") bad++;
      else if (img.rating === "needs_edit") needsEdit++;
    }
    return {
      goodCount: good,
      badCount: bad,
      needsEditCount: needsEdit,
      ratedCount: good + bad + needsEdit,
    };
  }, [images]);

  const list =
    what === "selected"
      ? images.filter((i) => selectedIds.has(i.id))
      : what === "good"
        ? images.filter((i) => i.rating === "good")
        : what === "bad"
          ? images.filter((i) => i.rating === "bad")
          : what === "needs_edit"
            ? images.filter((i) => i.rating === "needs_edit")
            : what === "by_rating"
              ? images.filter(
                  (i) =>
                    i.rating === "good" || i.rating === "bad" || i.rating === "needs_edit"
                )
              : images;

  const toExport = onlyCaptioned ? list.filter((i) => i.has_caption) : list;
  const count = toExport.length;

  const useFolder = what === "by_rating" || !asZip;

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!rootPath || !destPath) throw new Error("Choose a destination.");
      if (count === 0) throw new Error("No images to export.");

      if (what === "by_rating") {
        return exportByRating({
          source_path: rootPath,
          dest_path: destPath,
          trigger_word: triggerWord.trim() || null,
          sequential_naming: sequentialNaming,
        });
      }

      const relativePaths =
        toExport.length > 0
          ? toExport.map((i) => i.relative_path.replace(/\\/g, "/").replace(/^[/\\]+/, ""))
          : null;

      return exportDataset({
        source_path: rootPath,
        dest_path: destPath,
        as_zip: asZip,
        only_captioned: onlyCaptioned,
        relative_paths: relativePaths,
        trigger_word: triggerWord.trim() || null,
        sequential_naming: sequentialNaming,
        repeat_count: kohyaActive ? effectiveRepeats : null,
        concept_name: kohyaActive ? effectiveConcept : null,
        dataset_toml:
          kohyaActive && writeToml
            ? buildKohyaToml(selectedProfile, effectiveRepeats, effectiveConcept)
            : null,
      });
    },
    onSuccess: (res) => setResult(res),
    onError: (err: Error) => {
      const msg = err.message ?? String(err);
      setResult({
        success: false,
        exported_count: 0,
        skipped_count: 0,
        error: msg,
        output_path: "",
      });
      showToast(msg);
    },
  });

  async function handleBrowse() {
    if (useFolder) {
      const path = await selectSaveFolder();
      if (path) setDestPath(path);
    } else {
      const path = await selectSaveFile("dataset.zip");
      if (path) setDestPath(path);
    }
  }

  function handleExport() {
    setResult(null);
    exportMutation.mutate();
  }

  function handleClose() {
    setResult(null);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Export Dataset"
      icon={<Download className="h-5 w-5" />}
      maxWidthClassName="flex max-h-[90vh] max-w-md flex-col"
      footer={
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            {result?.success ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!destPath || exportMutation.isPending || count === 0}
            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {exportMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {result?.success ? "Export again" : "Export"}
          </button>
        </div>
      }
    >
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <p className="text-sm text-gray-400">
            Exporting <strong className="text-gray-200">{count}</strong> image
            {count === 1 ? "" : "s"}.
          </p>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              What to export
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWhat("all")}
                className={`rounded px-3 py-2 text-sm ${
                  what === "all"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                All ({images.length})
              </button>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setWhat("selected")}
                  className={`rounded px-3 py-2 text-sm ${
                    what === "selected"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  Selected ({selectedIds.size})
                </button>
              )}
              <button
                type="button"
                onClick={() => setWhat("good")}
                disabled={goodCount === 0}
                className={`rounded px-3 py-2 text-sm disabled:opacity-50 ${
                  what === "good"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                Good ({goodCount})
              </button>
              <button
                type="button"
                onClick={() => setWhat("bad")}
                disabled={badCount === 0}
                className={`rounded px-3 py-2 text-sm disabled:opacity-50 ${
                  what === "bad"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                Bad ({badCount})
              </button>
              <button
                type="button"
                onClick={() => setWhat("needs_edit")}
                disabled={needsEditCount === 0}
                className={`rounded px-3 py-2 text-sm disabled:opacity-50 ${
                  what === "needs_edit"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                Needs Edit ({needsEditCount})
              </button>
              <button
                type="button"
                onClick={() => setWhat("by_rating")}
                disabled={ratedCount === 0}
                className={`rounded px-3 py-2 text-sm disabled:opacity-50 ${
                  what === "by_rating"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                By rating folders
              </button>
            </div>
            {what === "by_rating" && (
              <p className="mt-1 text-xs text-gray-500">
                Creates good/, bad/, needs_edit/ under the chosen folder.
              </p>
            )}
          </div>

          {what !== "by_rating" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Trainer preset
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPreset("plain")}
                  className={`flex-1 rounded py-2 text-sm ${
                    preset === "plain"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  Plain folder (default)
                </button>
                <button
                  type="button"
                  onClick={() => setPreset("kohya")}
                  className={`flex-1 rounded py-2 text-sm ${
                    preset === "kohya"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  kohya (sd-scripts)
                </button>
              </div>
              {preset === "kohya" && (
                <div className="mt-2 space-y-2 rounded border border-border bg-surface p-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm text-gray-400" htmlFor="kohya-repeats">
                      Repeats
                    </label>
                    <input
                      id="kohya-repeats"
                      type="number"
                      min={1}
                      value={repeatCount}
                      onChange={(e) => {
                        const v = e.target.valueAsNumber;
                        setRepeatCount(Number.isFinite(v) ? Math.max(1, Math.round(v)) : 1);
                      }}
                      className="w-20 rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-gray-400" htmlFor="kohya-concept">
                      Concept name
                    </label>
                    <input
                      id="kohya-concept"
                      type="text"
                      value={conceptName}
                      onChange={(e) => setConceptName(e.target.value)}
                      placeholder={defaultConceptName}
                      className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500"
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={writeToml}
                      onChange={(e) => setWriteToml(e.target.checked)}
                      className="rounded border-gray-600"
                    />
                    <span className="text-sm text-gray-300">Write dataset.toml</span>
                  </label>
                  <p className="text-xs text-gray-500">
                    Images go into{" "}
                    <span className="font-mono text-gray-400">
                      {effectiveRepeats}_{effectiveConcept}/
                    </span>
                    {writeToml && (
                      <>
                        {" "}with a dataset.toml for the{" "}
                        <span className="text-gray-400">{selectedProfile.name}</span> profile
                      </>
                    )}
                    .
                  </p>
                </div>
              )}
            </div>
          )}

          {what !== "by_rating" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Output
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAsZip(false);
                    setDestPath("");
                  }}
                  className={`flex flex-1 items-center justify-center gap-2 rounded py-2 text-sm ${
                    !asZip
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  <FolderOpen className="h-4 w-4" />
                  Folder
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAsZip(true);
                    setDestPath("");
                  }}
                  className={`flex flex-1 items-center justify-center gap-2 rounded py-2 text-sm ${
                    asZip
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  <Archive className="h-4 w-4" />
                  ZIP
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm text-gray-400">
              {useFolder ? "Destination folder" : "ZIP file path"}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={destPath}
                readOnly
                placeholder="Choose..."
                className="flex-1 truncate rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600"
              >
                Browse
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={onlyCaptioned}
                onChange={(e) => setOnlyCaptioned(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Only captioned images</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={sequentialNaming}
                onChange={(e) => setSequentialNaming(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Sequential names (0001, 0002…)</span>
            </label>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">
              Trigger word (prepended to captions)
            </label>
            <input
              type="text"
              value={triggerWord}
              onChange={(e) => setTriggerWord(e.target.value)}
              placeholder={triggerWordFromSettings || "Optional"}
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500"
            />
          </div>

          {result && (
            <div
              className={`rounded p-3 text-sm ${
                result.success
                  ? "bg-green-900/50 text-green-300"
                  : "bg-red-900/50 text-red-300"
              }`}
            >
              {result.success ? (
                <>
                  <p className="flex items-center gap-1 font-medium">
                    <Check className="h-4 w-4" />
                    Exported {result.exported_count} images
                    {kohyaActive && (
                      <>
                        {" "}into{" "}
                        <span className="font-mono">
                          {effectiveRepeats}_{effectiveConcept}/
                        </span>
                      </>
                    )}
                  </p>
                  {result.skipped_count > 0 && (
                    <p className="mt-1 text-xs">Skipped: {result.skipped_count}</p>
                  )}
                </>
              ) : (
                <p>{result.error}</p>
              )}
            </div>
          )}
      </div>
    </Modal>
  );
}
