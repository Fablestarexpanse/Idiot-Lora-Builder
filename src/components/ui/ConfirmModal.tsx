import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./Modal";

interface ConfirmModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: ReactNode;
  icon?: ReactNode;
  /** Body content (explanatory paragraphs). */
  children: ReactNode;
  confirmLabel: ReactNode;
  /** Icon shown inside the confirm button when not pending. */
  confirmIcon?: ReactNode;
  /**
   * Color classes for the confirm button, e.g.
   * "bg-red-600 hover:bg-red-500" or
   * "bg-amber-600 hover:bg-amber-500 disabled:hover:bg-amber-600".
   */
  confirmButtonClassName: string;
  isPending?: boolean;
  /** When set, the user must type this word before the confirm button enables. */
  confirmWord?: string;
  /** Render Cancel/confirm in a bordered footer bar instead of inline in the body. */
  buttonsInFooter?: boolean;
  /** Disables Cancel, the X button, Escape, and backdrop close. */
  closeDisabled?: boolean;
  maxWidthClassName?: string;
}

/**
 * Destructive-confirmation modal built on Modal. Supports an optional
 * "type a word to confirm" input and a pending spinner on the confirm button.
 */
export function ConfirmModal({
  isOpen,
  onCancel,
  onConfirm,
  title,
  icon,
  children,
  confirmLabel,
  confirmIcon,
  confirmButtonClassName,
  isPending = false,
  confirmWord,
  buttonsInFooter = false,
  closeDisabled = false,
  maxWidthClassName,
}: ConfirmModalProps) {
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (!isOpen) setConfirmText("");
  }, [isOpen]);

  const wordOk =
    !confirmWord ||
    confirmText.trim().toLowerCase() === confirmWord.toLowerCase();
  const canConfirm = wordOk && !isPending;

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm();
  }

  const cancelButton = (
    <button
      type="button"
      onClick={onCancel}
      disabled={closeDisabled}
      className={
        buttonsInFooter
          ? "rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
          : "flex flex-1 items-center justify-center rounded border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600 hover:text-gray-200 disabled:opacity-50"
      }
    >
      Cancel
    </button>
  );

  const confirmButton = (
    <button
      type="button"
      onClick={handleConfirm}
      disabled={!canConfirm}
      className={`${
        buttonsInFooter
          ? "flex items-center gap-2 rounded px-3 py-1.5"
          : "flex flex-1 items-center justify-center gap-2 rounded px-3 py-2"
      } text-sm font-medium text-white disabled:opacity-50 ${confirmButtonClassName}`}
    >
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmIcon}
      {confirmLabel}
    </button>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      icon={icon}
      maxWidthClassName={maxWidthClassName}
      closeDisabled={closeDisabled}
      footer={
        buttonsInFooter ? (
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            {cancelButton}
            {confirmButton}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4 p-4">
        {children}
        {confirmWord && (
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={confirmWord}
            autoComplete="off"
            className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-amber-500 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canConfirm) handleConfirm();
            }}
          />
        )}
        {!buttonsInFooter && (
          <div className="flex gap-2">
            {cancelButton}
            {confirmButton}
          </div>
        )}
      </div>
    </Modal>
  );
}
