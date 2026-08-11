import { useMemo } from "react";
import { X, BarChart3 } from "lucide-react";
import { useProjectImages } from "@/hooks/useProject";

interface DatasetStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DatasetStatsModal({ isOpen, onClose }: DatasetStatsModalProps) {
  const { data: images = [] } = useProjectImages();

  const stats = useMemo(() => {
    const captioned = images.filter((img) => img.has_caption);
    const uncaptioned = images.filter((img) => !img.has_caption);

    const resolutions: Record<string, number> = {};
    const captionLengths: number[] = [];
    const tagCounts: number[] = [];
    let outside512 = 0;
    let outside1024 = 0;
    let oddDimensions = 0;

    for (const img of images) {
      const w = img.width ?? 0;
      const h = img.height ?? 0;
      const key = `${w}x${h}`;
      resolutions[key] = (resolutions[key] ?? 0) + 1;

      if (img.has_caption && img.tags) {
        const captionLen = img.tags.join(", ").length;
        captionLengths.push(captionLen);
        tagCounts.push(img.tags.length);
      }

      if (w > 0 && h > 0) {
        const minSide = Math.min(w, h);
        if (minSide < 512) outside512++;
        if (minSide < 1024) outside1024++;
        if (w % 2 !== 0 || h % 2 !== 0) oddDimensions++;
      }
    }

    const topResolutions = Object.entries(resolutions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const avgCaptionLen =
      captionLengths.length > 0
        ? Math.round(captionLengths.reduce((a, b) => a + b, 0) / captionLengths.length)
        : 0;
    const avgTagCount =
      tagCounts.length > 0
        ? Math.round((tagCounts.reduce((a, b) => a + b, 0) / tagCounts.length) * 10) / 10
        : 0;

    return {
      total: images.length,
      captioned: captioned.length,
      uncaptioned: uncaptioned.length,
      topResolutions,
      avgCaptionLen,
      avgTagCount,
      outside512,
      outside1024,
      oddDimensions,
    };
  }, [images]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface-elevated shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-medium text-gray-100">
            <BarChart3 className="h-5 w-5" />
            Dataset Statistics
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

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
                <span className="text-gray-400">Odd dimensions (w or h)</span>
                <span className={stats.oddDimensions > 0 ? "text-amber-400" : "text-gray-200"}>
                  {stats.oddDimensions}
                </span>
              </div>
            </div>
            {(stats.outside512 > 0 || stats.oddDimensions > 0) && (
              <p className="mt-2 text-xs text-gray-500">
                Use Batch Resize to normalize dimensions for training.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
