import { useEffect, useMemo, useState } from "react";
import { Loader2, Rocket } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useUiStore } from "@/stores/uiStore";
import { useProjectImages } from "@/hooks/useProject";
import { clearStagingImages, exportDataset, launchFizgig } from "@/lib/tauri";
import type { ImageEntry, ImageRating } from "@/types";

type Scope = "ratings" | "all" | "selected";

const RATING_CHOICES: { id: ImageRating; label: string }[] = [
  { id: "good", label: "Good" },
  { id: "needs_edit", label: "Needs Edit" },
  { id: "bad", label: "Bad" },
  { id: "none", label: "Unrated" },
];

interface SendToFizgigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SendToFizgigModal({ isOpen, onClose }: SendToFizgigModalProps) {
  const rootPath = useProjectStore((s) => s.rootPath);
  const fizgigPath = useSettingsStore((s) => s.fizgigPath);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const showToast = useUiStore((s) => s.showToast);
  const { data: allImages = [] } = useProjectImages();

  const defaultName = useMemo(() => {
    if (!rootPath) return "dataset";
    return rootPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "dataset";
  }, [rootPath]);

  const [datasetName, setDatasetName] = useState(defaultName);
  const [scope, setScope] = useState<Scope>("ratings");
  const [ratings, setRatings] = useState<Set<ImageRating>>(new Set(["good"]));
  const [isSending, setIsSending] = useState(false);
  const [sentSummary, setSentSummary] = useState<string | null>(null);

  // Re-seed the name when the modal opens for a (possibly different) project.
  useEffect(() => {
    if (isOpen) {
      setDatasetName(defaultName);
      setSentSummary(null);
    }
  }, [isOpen, defaultName]);

  const targets: ImageEntry[] = useMemo(() => {
    if (scope === "all") return allImages;
    if (scope === "selected") return allImages.filter((img) => selectedIds.has(img.id));
    return allImages.filter((img) => ratings.has(img.rating));
  }, [scope, allImages, selectedIds, ratings]);

  const cleanName = datasetName.trim().replace(/[<>:"/\\|?*]/g, "").trim();
  const stagingDir = fizgigPath.trim()
    ? `${fizgigPath.trim().replace(/[\\/]+$/, "")}\\dataset\\${cleanName || "dataset"}`
    : "";

  function toggleRating(id: ImageRating) {
    setRatings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSend() {
    if (!rootPath || !stagingDir || targets.length === 0 || !cleanName) return;
    setIsSending(true);
    setSentSummary(null);
    try {
      // Clear only our managed subfolder so demoted images never linger.
      await clearStagingImages(stagingDir);
      const result = await exportDataset({
        source_path: rootPath,
        dest_path: stagingDir,
        as_zip: false,
        only_captioned: false,
        relative_paths: targets.map((img) => img.relative_path),
        trigger_word: null, // captions already carry the trigger word
        sequential_naming: false,
      });
      if (!result.success && result.error) {
        showToast(`Export problem: ${result.error}`);
        return;
      }
      await launchFizgig(fizgigPath.trim());
      let clipboardNote = "";
      try {
        await navigator.clipboard.writeText(stagingDir);
        clipboardNote = " — path copied for Fizgig's Start tab";
      } catch {
        clipboardNote = "";
      }
      setSentSummary(
        `Sent ${result.exported_count} image${result.exported_count === 1 ? "" : "s"} to dataset\\${cleanName}${clipboardNote}`
      );
      showToast(
        `Fizgig launching — ${result.exported_count} image${result.exported_count === 1 ? "" : "s"} in dataset\\${cleanName}`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Send to Fizgig"
      icon={<Rocket className="h-5 w-5 text-purple-400" />}
      maxWidthClassName="max-w-md"
      closeDisabled={isSending}
      footer={
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <p className="min-w-0 truncate text-xs text-gray-500" title={stagingDir}>
            {stagingDir ? `→ ${stagingDir}` : "Set the Fizgig folder in Settings first"}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="rounded border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600 hover:text-gray-200 disabled:opacity-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || targets.length === 0 || !stagingDir || !cleanName}
              className="flex items-center gap-2 rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              Send {targets.length} image{targets.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 block text-sm text-gray-300">Dataset name</label>
          <input
            type="text"
            value={datasetName}
            onChange={(e) => setDatasetName(e.target.value)}
            placeholder={defaultName}
            className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Creates (or refreshes) this folder inside Fizgig&apos;s dataset directory.
            Existing images in it are cleared before sending.
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm text-gray-300">Include</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="radio"
                name="fizgig-scope"
                checked={scope === "ratings"}
                onChange={() => setScope("ratings")}
              />
              By rating
            </label>
            {scope === "ratings" && (
              <div className="ml-6 flex flex-wrap gap-2">
                {RATING_CHOICES.map((choice) => {
                  const count = allImages.filter((img) => img.rating === choice.id).length;
                  const active = ratings.has(choice.id);
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => toggleRating(choice.id)}
                      className={`rounded px-2.5 py-1 text-xs ${
                        active
                          ? "bg-purple-600 text-white"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      {choice.label} ({count})
                    </button>
                  );
                })}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="radio"
                name="fizgig-scope"
                checked={scope === "all"}
                onChange={() => setScope("all")}
              />
              All images ({allImages.length})
            </label>
            <label
              className={`flex items-center gap-2 text-sm ${
                selectedIds.size === 0 ? "text-gray-500" : "text-gray-300"
              }`}
            >
              <input
                type="radio"
                name="fizgig-scope"
                checked={scope === "selected"}
                onChange={() => setScope("selected")}
                disabled={selectedIds.size === 0}
              />
              Selected images ({selectedIds.size})
            </label>
          </div>
        </div>

        {sentSummary && (
          <p className="rounded border border-green-800 bg-green-900/30 px-3 py-2 text-sm text-green-300">
            {sentSummary}
          </p>
        )}
      </div>
    </Modal>
  );
}
