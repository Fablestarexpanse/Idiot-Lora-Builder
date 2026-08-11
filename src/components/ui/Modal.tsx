import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  /** Rendered as-is after the body (typically a border-t action bar). */
  footer?: ReactNode;
  /**
   * Extra classes for the panel, e.g. "max-w-md" or
   * "flex max-h-[90vh] max-w-lg flex-col" for scrolling bodies.
   */
  maxWidthClassName?: string;
  /** Close when the backdrop (outside the panel) is clicked. */
  closeOnBackdrop?: boolean;
  /** Disables the X button, Escape, and backdrop close (e.g. while a mutation is pending). */
  closeDisabled?: boolean;
}

/**
 * Shared modal shell: backdrop, elevated panel, header with title + X close
 * button, focus trap, Escape-to-close, and dialog ARIA wiring. Clicks inside
 * the overlay never propagate to elements underneath (modals may be rendered
 * inside clickable containers such as grid cells).
 */
export function Modal({
  isOpen,
  onClose,
  title,
  icon,
  children,
  footer,
  maxWidthClassName = "max-w-sm",
  closeOnBackdrop = true,
  closeDisabled = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !closeDisabled) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeDisabled, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        e.stopPropagation();
        if (closeOnBackdrop && !closeDisabled && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={`w-full rounded-lg border border-border bg-surface-elevated shadow-xl ${maxWidthClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2
            id={titleId}
            className="flex items-center gap-2 text-lg font-medium text-gray-100"
          >
            {icon}
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}
