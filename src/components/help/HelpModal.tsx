import { Keyboard } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { key: "←→↑↓", action: "Navigate image grid" },
  { key: "Home / End", action: "Jump to first / last image" },
  { key: "Ctrl+Click", action: "Multi-select images" },
  { key: "Shift+Click", action: "Select a range of images" },
  { key: "Ctrl+A", action: "Select all visible (filtered) images" },
  { key: "Escape", action: "Clear selection / close dialog" },
  { key: "Enter / Double-click", action: "Open image in preview" },
  { key: "Space", action: "Select the focused tile" },
  { key: "T", action: "Focus tag input" },
  { key: "Ctrl+Z", action: "Undo last tag change" },
  { key: "Ctrl+Y / Ctrl+Shift+Z", action: "Redo" },
  { key: "1 / 2 / 3", action: "Rate Good / Bad / Needs Edit (whole selection when multi-selected)" },
  { key: "+ / −", action: "Zoom in / out (in preview)" },
  { key: "← / →", action: "Previous / next image (in preview)" },
  { key: "←→↑↓ (crop)", action: "Nudge crop box" },
  { key: "Ctrl+Enter (crop)", action: "Apply crop" },
  { key: "S (crop)", action: "Save crop as new file" },
];

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Keyboard Shortcuts"
      icon={<Keyboard className="h-5 w-5" />}
      maxWidthClassName="max-w-md"
      footer={
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-xs text-gray-500">v{__APP_VERSION__}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Got it
          </button>
        </div>
      }
    >
      {/* Content */}
      <div className="p-4">
        <table className="w-full text-sm">
          <tbody>
            {shortcuts.map((s) => (
              <tr key={s.key} className="border-b border-border/50">
                <td className="py-2 pr-4">
                  <kbd className="rounded bg-gray-700 px-2 py-0.5 font-mono text-xs text-gray-200">
                    {s.key}
                  </kbd>
                </td>
                <td className="py-2 text-gray-300">{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
