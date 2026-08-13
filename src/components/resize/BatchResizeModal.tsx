import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Scaling, Loader2, FolderOpen, AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useProjectImages } from "@/hooks/useProject";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";
import { batchResize, selectSaveFolder } from "@/lib/tauri";
import type { BatchResizeMode, BatchResizeResult } from "@/lib/tauri";

const MIN_SIZE = 64;
const MAX_SIZE = 2048;
const PRESET_SIZES = [512, 768, 1024] as const;

type Scope = "all" | "selected" | "good";

interface ModeOption {
  value: BatchResizeMode;
  label: string;
  description: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: "resize",
    label: "Resize",
    description: "Fit inside the target size, keeping aspect ratio.",
  },
  {
    value: "center_crop",
    label: "Center crop",
    description: "Square crop from the center, then resize to target.",
  },
  {
    value: "fit",
    label: "Fit",
    description: "Only shrink images larger than the target; smaller ones are kept as-is.",
  },
];

interface BatchResizeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BatchResizeModal({ isOpen, onClose }: BatchResizeModalProps) {
  const { data: images = [] } = useProjectImages();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const showToast = useUiStore((s) => s.showToast);

  const [scope, setScope] = useState<Scope>("all");
  const [targetSize, setTargetSize] = useState(1024);
  const [mode, setMode] = useState<BatchResizeMode>("resize");
  const [outputFolder, setOutputFolder] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResizeResult | null>(null);

  const selectedImages = images.filter((img) => selectedIds.has(img.id));
  const goodImages = images.filter((img) => img.rating === "good");

  const targetImages =
    scope === "selected" ? selectedImages : scope === "good" ? goodImages : images;
  const count = targetImages.length;

  const clampedSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, targetSize));

  const resizeMutation = useMutation({
    mutationFn: async () => {
      if (!outputFolder) throw new Error("Select an output folder first");
      if (count === 0) throw new Error("No images in the selected scope");
      return batchResize(
        targetImages.map((img) => img.path),
        clampedSize,
        mode,
        outputFolder
      );
    },
    onSuccess: (res) => {
      setResult(res);
      if (res.error) {
        showToast(`Batch resize finished with a problem: ${res.error}`);
      } else {
        showToast(
          `Resized ${res.processed_count} image(s)${
            res.skipped_count > 0 ? `, skipped ${res.skipped_count}` : ""
          }`,
          "info"
        );
      }
    },
    onError: (err) => {
      showToast(err instanceof Error ? err.message : String(err));
    },
  });

  const scopeOptions: { value: Scope; label: string; disabled: boolean }[] = [
    { value: "all", label: `All images (${images.length})`, disabled: false },
    {
      value: "selected",
      label: `Selected (${selectedImages.length})`,
      disabled: selectedImages.length === 0,
    },
    { value: "good", label: `Good-rated (${goodImages.length})`, disabled: false },
  ];

  async function handlePickFolder() {
    try {
      const folder = await selectSaveFolder();
      if (folder) setOutputFolder(folder);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  function handleStart() {
    setResult(null);
    resizeMutation.mutate();
  }

  function handleClose() {
    if (resizeMutation.isPending) return;
    setResult(null);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Batch Resize"
      icon={<Scaling className="h-5 w-5" />}
      maxWidthClassName="flex max-h-[90vh] max-w-md flex-col"
      closeDisabled={resizeMutation.isPending}
      footer={
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={resizeMutation.isPending}
            className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={count === 0 || !outputFolder || resizeMutation.isPending}
            className="flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {resizeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Scaling className="h-4 w-4" />
            )}
            {resizeMutation.isPending ? "Resizing…" : "Start"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 overflow-auto p-4">
        {/* Scope */}
        <div>
          <label className="mb-1 block text-xs text-gray-500">Images to process</label>
          <div className="flex gap-2">
            {scopeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setScope(opt.value)}
                disabled={opt.disabled}
                className={`flex-1 rounded border px-2 py-1.5 text-xs ${
                  scope === opt.value
                    ? "border-blue-500 bg-blue-600/20 text-blue-200"
                    : "border-border bg-surface text-gray-300 hover:bg-white/5"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Target size */}
        <div>
          <label className="mb-1 block text-xs text-gray-500">
            Target size (px, {MIN_SIZE}–{MAX_SIZE})
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={targetSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setTargetSize(Number.isNaN(v) ? MIN_SIZE : v);
              }}
              onBlur={() => setTargetSize(clampedSize)}
              className="w-24 rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
            />
            {PRESET_SIZES.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setTargetSize(preset)}
                className={`rounded border px-2 py-1.5 text-xs ${
                  clampedSize === preset
                    ? "border-blue-500 bg-blue-600/20 text-blue-200"
                    : "border-border bg-surface text-gray-300 hover:bg-white/5"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Mode */}
        <div>
          <label className="mb-1 block text-xs text-gray-500">Mode</label>
          <div className="space-y-2">
            {MODE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 ${
                  mode === opt.value
                    ? "border-blue-500 bg-blue-600/10"
                    : "border-border bg-surface hover:bg-white/5"
                }`}
              >
                <input
                  type="radio"
                  name="batch-resize-mode"
                  value={opt.value}
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-gray-200">{opt.label}</span>
                  <span className="block text-xs text-gray-500">{opt.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Output folder */}
        <div>
          <label className="mb-1 block text-xs text-gray-500">Output folder</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePickFolder}
              disabled={resizeMutation.isPending}
              className="flex items-center gap-2 rounded border border-border bg-surface px-3 py-1.5 text-sm text-gray-200 hover:bg-white/5 disabled:opacity-50"
            >
              <FolderOpen className="h-4 w-4" />
              Choose…
            </button>
            <span
              className={`min-w-0 flex-1 truncate text-xs ${
                outputFolder ? "text-gray-300" : "text-gray-500"
              }`}
              title={outputFolder ?? undefined}
            >
              {outputFolder ?? "No folder selected"}
            </span>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Output files are renamed sequentially (0001.png, 0002.jpg, …) and caption
            .txt files are copied alongside them. Originals are not modified.
          </p>
        </div>

        {/* Result */}
        {result && (
          <div
            className={`flex items-start gap-2 rounded px-3 py-2 text-sm ${
              result.error
                ? "bg-amber-900/30 text-amber-200"
                : "bg-green-900/30 text-green-300"
            }`}
          >
            {result.error ? (
              <>
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Processed {result.processed_count}, skipped {result.skipped_count}.{" "}
                  {result.error}
                </span>
              </>
            ) : (
              <span>
                Processed {result.processed_count} image(s)
                {result.skipped_count > 0 ? `, skipped ${result.skipped_count}` : ""}.
              </span>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
