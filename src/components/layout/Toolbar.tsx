import { useState } from "react";
import { FolderOpen, Download, FileEdit, Settings, HelpCircle, Eraser, StarOff, Rocket } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectImages } from "@/hooks/useProject";
import { openFolder, launchFizgig, clearStagingImages, exportDataset } from "@/lib/tauri";
import { ExportModal } from "../export/ExportModal";
import { BatchRenameModal } from "../rename/BatchRenameModal";
import { SettingsModal } from "../settings/SettingsModal";
import { HelpModal } from "../help/HelpModal";
import { ClearAllTagsModal } from "./ClearAllTagsModal";
import { ClearAllRatingsModal } from "./ClearAllRatingsModal";

export function Toolbar() {
  const rootPath = useProjectStore((s) => s.rootPath);
  const setRootPath = useProjectStore((s) => s.setRootPath);
  const setIsLoadingProject = useProjectStore((s) => s.setIsLoadingProject);
  const setLastOpenedFolder = useProjectStore((s) => s.setLastOpenedFolder);
  const showToast = useUiStore((s) => s.showToast);
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const fizgigPath = useSettingsStore((s) => s.fizgigPath);
  const { data: allImages = [] } = useProjectImages();
  const [isSendingToFizgig, setIsSendingToFizgig] = useState(false);

  const ratingBorderClass =
    selectedImage?.rating === "good"
      ? "border-b-green-500"
      : selectedImage?.rating === "bad"
        ? "border-b-red-500"
        : selectedImage?.rating === "needs_edit"
          ? "border-b-amber-500"
          : "border-b-border";

  const [showExport, setShowExport] = useState(false);
  const [showBatchRename, setShowBatchRename] = useState(false);
  const [showClearAllTags, setShowClearAllTags] = useState(false);
  const [showClearAllRatings, setShowClearAllRatings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  async function handleSendToFizgig() {
    if (!fizgigPath.trim()) {
      showToast("Set your Fizgig folder in Settings first (Integrations section)");
      setShowSettings(true);
      return;
    }
    if (!rootPath) return;

    // Only send curated images: rated Good. Bad / needs-edit / unrated stay home.
    const goodImages = allImages.filter((img) => img.rating === "good");
    if (goodImages.length === 0) {
      showToast("No images rated Good yet — rate your keepers first, then send");
      return;
    }

    setIsSendingToFizgig(true);
    try {
      // Dedicated staging folder next to the project; cleared each send so
      // images demoted since the last export never linger in the training set.
      const stagingDir = rootPath.replace(/[\\/]+$/, "") + "_fizgig";
      await clearStagingImages(stagingDir);
      const result = await exportDataset({
        source_path: rootPath,
        dest_path: stagingDir,
        as_zip: false,
        only_captioned: false,
        relative_paths: goodImages.map((img) => img.relative_path),
        trigger_word: null, // captions already carry the trigger word
        sequential_naming: false,
      });
      if (!result.success && result.error) {
        showToast(`Export problem: ${result.error}`);
        return;
      }
      await launchFizgig(fizgigPath.trim());
      try {
        await navigator.clipboard.writeText(stagingDir);
        showToast(
          `Sent ${result.exported_count} Good image${result.exported_count === 1 ? "" : "s"} — path copied, paste it in Fizgig's Start tab`
        );
      } catch {
        showToast(
          `Sent ${result.exported_count} Good image${result.exported_count === 1 ? "" : "s"} to ${stagingDir} — Fizgig launching`
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSendingToFizgig(false);
    }
  }

  async function handleOpen() {
    try {
      const path = await openFolder();
      if (path) {
        setLastOpenedFolder(path);
        setIsLoadingProject(true);
        setRootPath(path);
      }
    } catch (err) {
      console.error("Open folder failed:", err);
      setIsLoadingProject(false);
      showToast(err instanceof Error ? err.message : "Failed to open folder");
    }
  }

  return (
    <>
      <header
        className={`flex h-12 min-w-0 shrink-0 flex-wrap items-center gap-2 border-b-2 border-border bg-surface-elevated px-3 ${ratingBorderClass}`}
      >
        {/* Open */}
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-white/10"
          aria-label="Open folder"
          onClick={handleOpen}
        >
          <FolderOpen className="h-4 w-4" />
          Open
        </button>

        {/* Export */}
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-white/10 disabled:opacity-50"
          aria-label="Export dataset"
          onClick={() => setShowExport(true)}
          disabled={!rootPath}
        >
          <Download className="h-4 w-4" />
          Export
        </button>

        {/* Batch Rename */}
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-white/10 disabled:opacity-50"
          aria-label="Batch rename"
          onClick={() => setShowBatchRename(true)}
          disabled={!rootPath}
        >
          <FileEdit className="h-4 w-4" />
          Batch Rename
        </button>


        {/* Clear all tags */}
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-amber-600/20 hover:text-amber-400 disabled:opacity-50"
          aria-label="Clear all tags on all images"
          onClick={() => setShowClearAllTags(true)}
          disabled={!rootPath}
        >
          <Eraser className="h-4 w-4" />
          Clear All Tags
        </button>

        {/* Clear all ratings */}
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-amber-600/20 hover:text-amber-400 disabled:opacity-50"
          aria-label="Clear all ratings"
          onClick={() => setShowClearAllRatings(true)}
          disabled={!rootPath}
        >
          <StarOff className="h-4 w-4" />
          Clear All Ratings
        </button>

        {/* Send to Fizgig (external LoRA trainer) */}
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-purple-600/20 hover:text-purple-300 disabled:opacity-50"
          aria-label="Send dataset to Fizgig"
          title={
            fizgigPath.trim()
              ? "Export Good-rated images to a staging folder and launch Fizgig"
              : "Launch Fizgig (set its folder in Settings first)"
          }
          onClick={handleSendToFizgig}
          disabled={!rootPath || isSendingToFizgig}
        >
          <Rocket className={`h-4 w-4 ${isSendingToFizgig ? "animate-pulse" : ""}`} />
          {isSendingToFizgig ? "Sending…" : "Send to Fizgig"}
        </button>

        <span className="text-xs text-gray-500">|</span>

        {/* Title */}
        <span className="min-w-0 flex-1 truncate text-xs text-gray-500">LoRA Dataset Studio</span>

        {/* Right side buttons */}
        <button
          type="button"
          className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          aria-label="Help"
          onClick={() => setShowHelp(true)}
        >
          <HelpCircle className="h-4 w-4" />
        </button>

        <button
          type="button"
          className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          aria-label="Settings"
          onClick={() => setShowSettings(true)}
        >
          <Settings className="h-4 w-4" />
        </button>
      </header>

      {/* Modals */}
      <ExportModal isOpen={showExport} onClose={() => setShowExport(false)} />
      <BatchRenameModal isOpen={showBatchRename} onClose={() => setShowBatchRename(false)} />
      <ClearAllTagsModal
        isOpen={showClearAllTags}
        onClose={() => setShowClearAllTags(false)}
      />
      <ClearAllRatingsModal
        isOpen={showClearAllRatings}
        onClose={() => setShowClearAllRatings(false)}
      />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}
