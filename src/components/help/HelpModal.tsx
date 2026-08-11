import { useRef } from "react";
import { X, Keyboard } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { key: "←→↑↓", action: "Navigate image grid" },
  { key: "Home / End", action: "Jump to first / last image" },
  { key: "Ctrl+Click", action: "Multi-select images" },
  { key: "Double-click", action: "Open image in preview" },
  { key: "T", action: "Focus tag input" },
  { key: "Enter", action: "Add tag (when input focused)" },
  { key: "Ctrl+Z", action: "Undo last tag change" },
  { key: "Ctrl+Y / Ctrl+Shift+Z", action: "Redo" },
  { key: "1 / 2 / 3", action: "Set rating: Good / Bad / Needs Edit" },
  { key: "Escape", action: "Close preview or modal" },
  { key: "+ / −", action: "Zoom in / out (in preview)" },
  { key: "← / →", action: "Previous / next image (in preview)" },
  { key: "?", action: "Show this help" },
];

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusTrap(contentRef, isOpen);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        ref={contentRef}
        className="w-full max-w-md rounded-lg border border-border bg-surface-elevated shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-medium text-gray-100">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

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

        {/* Footer */}
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
      </div>
    </div>
  );
}
