import { Settings, FolderOpen } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAiStore } from "@/stores/aiStore";
import { matchThumbnailPreset } from "@/lib/thumbnailPresets";
import type { ThumbnailPresetId } from "@/lib/thumbnailPresets";
import { Modal } from "@/components/ui/Modal";
import { openFolder, openLogFolder } from "@/lib/tauri";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    triggerWord,
    setTriggerWord,
    thumbnailSize,
    setThumbnailSize,
    gridMinCellScale,
    setGridMinCellScale,
    setThumbnailPreset,
    confirmBeforeClearTags,
    setConfirmBeforeClearTags,
    showGridDebug,
    setShowGridDebug,
    fizgigPath,
    setFizgigPath,
  } = useSettingsStore();

  const {
    lmStudio,
    setLmStudioUrl,
    setLmStudioModel,
    ollama,
    setOllamaBaseUrl,
    setOllamaModel,
  } = useAiStore();

  const activeThumbPreset = matchThumbnailPreset(gridMinCellScale, thumbnailSize);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      icon={<Settings className="h-5 w-5" />}
      maxWidthClassName="max-w-lg"
      footer={
        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Done
          </button>
        </div>
      }
    >
      {/* Content */}
      <div className="max-h-[60vh] space-y-6 overflow-auto p-4">
          {/* General */}
          <section>
            <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
              General
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Default Trigger Word
                </label>
                <input
                  type="text"
                  value={triggerWord}
                  onChange={(e) => setTriggerWord(e.target.value)}
                  placeholder="e.g., my_character"
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Used as default in export. Leave empty for none.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-300">Thumbnail size</label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["small", "Small"],
                      ["medium", "Medium"],
                      ["large", "Big"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setThumbnailPreset(id as ThumbnailPresetId)}
                      className={`rounded px-3 py-1.5 text-sm ${
                        activeThumbPreset === id
                          ? "bg-blue-600 text-white"
                          : "bg-gray-700 text-gray-200 hover:bg-gray-600"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Sets column density and decode quality together so tiles stay within the panel
                  width (no horizontal scrolling). Use the sliders below for fine tuning.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Max thumbnail resolution: {thumbnailSize}px
                </label>
                <input
                  type="range"
                  min={128}
                  max={1024}
                  step={32}
                  value={thumbnailSize}
                  onChange={(e) => setThumbnailSize(Number(e.target.value))}
                  className="w-full"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Upper limit for decoded thumbnail edge (per tile). Should be at least ~CSS tile
                  size × display scaling if you want crisp previews; lower to save CPU/RAM on very
                  large libraries. Grid uses smaller tiles and letterboxing for mixed aspect ratios.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Grid tile size: {gridMinCellScale.toFixed(2)}×
                </label>
                <input
                  type="range"
                  min={0.55}
                  max={1.75}
                  step={0.05}
                  value={gridMinCellScale}
                  onChange={(e) => setGridMinCellScale(Number(e.target.value))}
                  className="w-full"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Lower = more columns (smaller tiles). Higher = fewer, larger tiles. Changing this
                  after using Small/Medium/Big may clear the preset highlight until values match
                  again.
                </p>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showGridDebug}
                  onChange={(e) => setShowGridDebug(e.target.checked)}
                  className="rounded border-gray-600"
                />
                <span className="text-sm text-gray-300">
                  Show grid / thumbnail debug overlay
                </span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmBeforeClearTags}
                  onChange={(e) => setConfirmBeforeClearTags(e.target.checked)}
                  className="rounded border-gray-600"
                />
                <span className="text-sm text-gray-300">
                  Confirm before clearing tags on an image
                </span>
              </label>
              {!confirmBeforeClearTags && (
                <p className="text-xs text-amber-500">
                  When disabled, clearing tags will happen immediately and you
                  won&apos;t get a chance to cancel.
                </p>
              )}
            </div>
          </section>

          {/* AI Settings */}
          <section>
            <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
              AI Captioning
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  LM Studio URL
                </label>
                <input
                  type="text"
                  value={lmStudio.base_url}
                  onChange={(e) => setLmStudioUrl(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200"
                  placeholder="http://localhost:1234"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  LM Studio Model (optional)
                </label>
                <input
                  type="text"
                  value={lmStudio.model ?? ""}
                  onChange={(e) => setLmStudioModel(e.target.value || null)}
                  placeholder="Leave empty to pick after Test"
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Ollama Base URL
                </label>
                <input
                  type="text"
                  value={ollama.base_url}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200"
                  placeholder="http://localhost:11434/v1"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Ollama Model (optional)
                </label>
                <input
                  type="text"
                  value={ollama.model ?? ""}
                  onChange={(e) => setOllamaModel(e.target.value || null)}
                  placeholder="e.g. llava"
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
                />
              </div>
            </div>
          </section>

          {/* Integrations */}
          <section>
            <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
              Integrations
            </h3>
            <div>
              <label className="mb-1 block text-sm text-gray-300">
                Fizgig folder (LoRA trainer)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={fizgigPath}
                  onChange={(e) => setFizgigPath(e.target.value)}
                  placeholder="e.g. F:\Fizgig-master"
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const folder = await openFolder();
                    if (folder) setFizgigPath(folder);
                  }}
                  className="flex items-center gap-1 rounded border border-border bg-surface px-3 py-2 text-sm text-gray-300 hover:bg-gray-600 hover:text-gray-200"
                  title="Browse for the Fizgig folder"
                >
                  <FolderOpen className="h-4 w-4" />
                  Browse
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Path to your local Fizgig install (the folder containing run_fizgig.bat).
                Enables the &quot;Send to Fizgig&quot; button in the toolbar.
              </p>
            </div>
          </section>

          {/* About */}
          <section>
            <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
              About
            </h3>
            <p className="text-sm text-gray-400">
              Idiot LoRa Builder v{__APP_VERSION__}
            </p>
            <p className="text-xs text-gray-500">
              A tool for preparing image datasets for AI model training.
            </p>
            <button
              type="button"
              onClick={() => {
                void openLogFolder().catch(() => {
                  /* nothing sensible to do if the file manager fails to open */
                });
              }}
              className="mt-2 flex items-center gap-1 rounded border border-border bg-surface px-3 py-2 text-sm text-gray-300 hover:bg-gray-600 hover:text-gray-200"
              title="Open the folder containing the app's log files"
            >
              <FolderOpen className="h-4 w-4" />
              Open log folder
            </button>
          </section>
      </div>
    </Modal>
  );
}
