import { useEffect } from "react";
import { X } from "lucide-react";
import { useUiStore, type ToastItem } from "@/stores/uiStore";

/** Errors linger longer so failures aren't missed; success/info dismiss quickly. */
const ERROR_DISMISS_MS = 7000;
const DEFAULT_DISMISS_MS = 4000;
const MAX_ERROR_LEN = 400;

function summarizeError(msg: string): string {
  if (!msg || msg.length <= MAX_ERROR_LEN) return msg;
  const lines = msg.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1];
  if (lastLine && lastLine.length <= MAX_ERROR_LEN && lastLine.includes(":")) {
    return lastLine;
  }
  return `${msg.slice(0, MAX_ERROR_LEN).trim()}…`;
}

function ToastEntry({ toast }: { toast: ToastItem }) {
  const dismissToast = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    const ms = toast.type === "error" ? ERROR_DISMISS_MS : DEFAULT_DISMISS_MS;
    const t = setTimeout(() => dismissToast(toast.id), ms);
    return () => clearTimeout(t);
  }, [toast.id, toast.type, dismissToast]);

  const isError = toast.type === "error";
  const isSuccess = toast.type === "success";
  const displayMessage = isError ? summarizeError(toast.message) : toast.message;
  const accentBorder = isSuccess
    ? "border-green-600/60"
    : isError
      ? "border-border"
      : "border-border";
  const textClass = isError
    ? "text-red-300"
    : isSuccess
      ? "text-green-300"
      : "text-gray-200";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex max-w-md max-h-48 items-start gap-2 overflow-auto rounded-lg border ${accentBorder} bg-surface-elevated px-4 py-3 shadow-lg`}
    >
      <p className={`flex-1 overflow-auto text-sm ${textClass}`}>
        {displayMessage}
      </p>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Toast() {
  const toasts = useUiStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <ToastEntry key={t.id} toast={t} />
      ))}
    </div>
  );
}
