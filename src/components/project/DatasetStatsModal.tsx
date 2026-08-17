import { useMemo, useState } from "react";
import { BarChart3, Scaling } from "lucide-react";
import { useProjectImages } from "@/hooks/useProject";
import { Modal } from "@/components/ui/Modal";
import { BatchResizeModal } from "@/components/resize/BatchResizeModal";
import { useFilterStore } from "@/stores/filterStore";
import { useSettingsStore } from "@/stores/settingsStore";

interface DatasetStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

export function DatasetStatsModal({ isOpen, onClose }: DatasetStatsModalProps) {
  const { data: images = [] } = useProjectImages();
  const setTagFilter = useFilterStore((s) => s.setTagFilter);
  const triggerWord = useSettingsStore((s) => s.triggerWord);
  const [showBatchResize, setShowBatchResize] = useState(false);

  const stats = useMemo(() => {
    const resolutions: Record<string, number> = {};
    const tagFrequency = new Map<string, number>();
    let captioned = 0;
    let captionSamples = 0;
    let captionLenSum = 0;
    let tagCountSum = 0;
    let outside512 = 0;
    let outside1024 = 0;
    let notDivisibleBy64 = 0;
    let totalBytes = 0;
    let good = 0;
    let bad = 0;
    let needsEdit = 0;

    const trigger = triggerWord.trim().toLowerCase();

    for (const img of images) {
      const w = img.width ?? 0;
      const h = img.height ?? 0;
      const key = `${w}x${h}`;
      resolutions[key] = (resolutions[key] ?? 0) + 1;

      if (img.has_caption) {
        captioned++;
        if (img.tags) {
          captionSamples++;
          captionLenSum += img.tags.join(", ").length;
          tagCountSum += img.tags.length;
        }
      }

      for (const tag of img.tags ?? []) {
        if (trigger && tag.trim().toLowerCase() === trigger) continue;
        tagFrequency.set(tag, (tagFrequency.get(tag) ?? 0) + 1);
      }

      if (img.rating === "good") good++;
      else if (img.rating === "bad") bad++;
      else if (img.rating === "needs_edit") needsEdit++;

      totalBytes += img.file_size ?? 0;

      if (w > 0 && h > 0) {
        const minSide = Math.min(w, h);
        if (minSide < 512) outside512++;
        if (minSide < 1024) outside1024++;
        if (w % 64 !== 0 || h % 64 !== 0) notDivisibleBy64++;
      }
    }

    const topResolutions = Object.entries(resolutions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const topTags = Array.from(tagFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    return {
      total: images.length,
      captioned,
      uncaptioned: images.length - captioned,
      topResolutions,
      topTags,
      avgCaptionLen: captionSamples > 0 ? Math.round(captionLenSum / captionSamples) : 0,
      avgTagCount:
        captionSamples > 0 ? Math.round((tagCountSum / captionSamples) * 10) / 10 : 0,
      outside512,
      outside1024,
      notDivisibleBy64,
      totalBytes,
      good,
      bad,
      needsEdit,
      unrated: images.length - good - bad - needsEdit,
    };
  }, [images, triggerWord]);

  function handleTagClick(tag: string) {
    setTagFilter(tag);
    onClose();
  }

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Dataset Statistics"
      icon={<BarChart3 className="h-5 w-5" />}
      maxWidthClassName="flex max-h-[80vh] max-w-lg flex-col"
      footer={
        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4 overflow-auto p-4">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase text-gray-500">
              Overview
            </h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total images</span>
                <span className="text-gray-200">{stats.total}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-green-400">Captioned</span>
                <span className="text-gray-200">{stats.captioned}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-orange-400">Uncaptioned</span>
                <span className="text-gray-200">{stats.uncaptioned}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Size on disk</span>
                <span className="text-gray-200">{formatBytes(stats.totalBytes)}</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase text-gray-500">
              Ratings
            </h3>
            <div className="grid grid-cols-4 gap-1 text-center text-sm">
              <div className="rounded bg-surface py-1">
                <div className="text-green-400">{stats.good}</div>
                <div className="text-[10px] uppercase text-gray-500">Good</div>
              </div>
              <div className="rounded bg-surface py-1">
                <div className="text-red-400">{stats.bad}</div>
                <div className="text-[10px] uppercase text-gray-500">Bad</div>
              </div>
              <div className="rounded bg-surface py-1">
                <div className="text-amber-400">{stats.needsEdit}</div>
                <div className="text-[10px] uppercase text-gray-500">Needs Edit</div>
              </div>
              <div className="rounded bg-surface py-1">
                <div className="text-gray-300">{stats.unrated}</div>
                <div className="text-[10px] uppercase text-gray-500">Unrated</div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase text-gray-500">
              Captions
            </h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Avg caption length (chars)</span>
                <span className="text-gray-200">{stats.avgCaptionLen}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Avg tags per image</span>
                <span className="text-gray-200">{stats.avgTagCount}</span>
              </div>
            </div>
          </div>

          {stats.topTags.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase text-gray-500">
                Top tags
              </h3>
              <div className="flex flex-wrap gap-1">
                {stats.topTags.map(([tag, count]) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleTagClick(tag)}
                    title={`Filter grid to "${tag}"`}
                    className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-gray-300 hover:bg-white/10 hover:text-gray-100"
                  >
                    <span className="max-w-[160px] truncate">{tag}</span>
                    <span className="text-gray-500">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase text-gray-500">
              Top resolutions
            </h3>
            <div className="space-y-0.5 text-sm">
              {stats.topResolutions.map(([res, count]) => (
                <div key={res} className="flex justify-between">
                  <span className="font-mono text-gray-300">{res}</span>
                  <span className="text-gray-200">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase text-gray-500">
              Training compatibility
            </h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Below 512px (smaller side)</span>
                <span className={stats.outside512 > 0 ? "text-amber-400" : "text-gray-200"}>
                  {stats.outside512}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Below 1024px (SDXL)</span>
                <span className={stats.outside1024 > 0 ? "text-amber-400" : "text-gray-200"}>
                  {stats.outside1024}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Not divisible by 64 (w or h)</span>
                <span
                  className={stats.notDivisibleBy64 > 0 ? "text-amber-400" : "text-gray-200"}
                >
                  {stats.notDivisibleBy64}
                </span>
              </div>
            </div>
            {stats.notDivisibleBy64 > 0 && (
              <p className="mt-1 text-xs text-gray-500">
                {stats.notDivisibleBy64} image{stats.notDivisibleBy64 === 1 ? " has" : "s have"}{" "}
                dimensions not divisible by 64 — fine for bucketing trainers, but crops/resizes
                will be cleaner at multiples of 64.
              </p>
            )}
            {(stats.outside512 > 0 || stats.notDivisibleBy64 > 0) && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  setShowBatchResize(true);
                }}
                className="mt-2 flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 text-xs text-gray-300 hover:bg-white/10 hover:text-gray-100"
              >
                <Scaling className="h-3.5 w-3.5" />
                Batch Resize to normalize dimensions for training
              </button>
            )}
          </div>
      </div>
    </Modal>
    <BatchResizeModal
      isOpen={showBatchResize}
      onClose={() => setShowBatchResize(false)}
    />
    </>
  );
}
