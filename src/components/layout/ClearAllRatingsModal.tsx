import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StarOff } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectImages } from "@/hooks/useProject";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { clearAllRatings } from "@/lib/tauri";

const CONFIRM_WORD = "clear";

interface ClearAllRatingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ClearAllRatingsModal({ isOpen, onClose }: ClearAllRatingsModalProps) {
  const rootPath = useProjectStore((s) => s.rootPath);
  const { data: images = [] } = useProjectImages();
  const queryClient = useQueryClient();

  const ratedCount = images.filter(
    (img) => img.rating && img.rating !== "none"
  ).length;

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      if (!rootPath) throw new Error("No project open");
      return clearAllRatings(rootPath);
    },
    onSuccess: () => {
      if (rootPath) {
        queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
      }
      onClose();
    },
  });

  function handleClose() {
    if (clearAllMutation.isPending) return;
    onClose();
  }

  return (
    <ConfirmModal
      isOpen={isOpen}
      onCancel={handleClose}
      onConfirm={() => clearAllMutation.mutate()}
      title="Clear all ratings"
      icon={<StarOff className="h-5 w-5 text-amber-400" />}
      confirmLabel="Clear All Ratings"
      confirmIcon={<StarOff className="h-4 w-4" />}
      confirmButtonClassName="bg-amber-600 hover:bg-amber-500"
      isPending={clearAllMutation.isPending}
      confirmWord={CONFIRM_WORD}
      buttonsInFooter
      closeDisabled={clearAllMutation.isPending}
      maxWidthClassName="max-w-md"
    >
      <p className="text-sm text-gray-300">
        This will remove Good / Bad / Needs Edit ratings from all {ratedCount} rated
        image{ratedCount !== 1 ? "s" : ""}.
      </p>
      <p className="text-sm text-gray-400">
        Type <strong className="text-gray-200">{CONFIRM_WORD}</strong> to confirm:
      </p>
    </ConfirmModal>
  );
}
