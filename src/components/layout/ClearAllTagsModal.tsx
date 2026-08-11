import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eraser } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectImages } from "@/hooks/useProject";
import { useSettingsStore } from "@/stores/settingsStore";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { clearAllCaptions } from "@/lib/tauri";

const CONFIRM_WORD = "clear";

interface ClearAllTagsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ClearAllTagsModal({ isOpen, onClose }: ClearAllTagsModalProps) {
  const rootPath = useProjectStore((s) => s.rootPath);
  const { data: images = [] } = useProjectImages();
  const queryClient = useQueryClient();
  const setPreviousTriggerWord = useSettingsStore((s) => s.setPreviousTriggerWord);

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      if (!rootPath) throw new Error("No project open.");
      return clearAllCaptions(rootPath);
    },
    onSuccess: () => {
      if (rootPath) {
        queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
      }
      setPreviousTriggerWord("");
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
      title="Clear all tags on all images"
      icon={<Eraser className="h-5 w-5 text-amber-400" />}
      confirmLabel="Clear all tags"
      confirmIcon={<Eraser className="h-4 w-4" />}
      confirmButtonClassName="bg-amber-600 hover:bg-amber-500 disabled:hover:bg-amber-600"
      isPending={clearAllMutation.isPending}
      confirmWord={CONFIRM_WORD}
      closeDisabled={clearAllMutation.isPending}
      maxWidthClassName="max-w-md"
    >
      <p className="text-sm text-gray-400">
        This will remove tags (captions) from every image in the current
        folder ({images.length} image{images.length === 1 ? "" : "s"}). This
        cannot be undone.
      </p>
      <p className="text-sm text-gray-300">
        Type <strong className="text-amber-400">{CONFIRM_WORD}</strong> below
        to confirm.
      </p>
    </ConfirmModal>
  );
}
