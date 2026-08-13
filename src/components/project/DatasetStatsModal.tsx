import { useMemo, useState } from "react";
import { BarChart3, Scaling } from "lucide-react";
import { useProjectImages } from "@/hooks/useProject";
import { Modal } from "@/components/ui/Modal";
import { BatchResizeModal } from "@/components/resize/BatchResizeModal";

interface DatasetStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DatasetStatsModal({ isOpen, onClose }: DatasetStatsModalProps) {
  const { data: images = [] } = useProjectImages();
  const [showBatchResize, setShowBatchResize] = useState(false);

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
