import { useEffect } from "react";
import { X } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";

const AUTO_DISMISS_MS = 5000;
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

export function Toast() {
  const toast = useUiStore((s) => s.toast);
  const hideToast = useUiStore((s) => s.hideToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(hideToast, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast, hideToast]);

  if (!toast) return null;

  const isError = toast.type === "error";
  const displayMessage = isError && toast.message ? summarizeError(toast.message) : toast.message;
  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[100] flex max-w-md max-h-48 items-start gap-2 overflow-auto rounded-lg border border-border bg-surface-elevated px-4 py-3 shadow-lg"
    >
      <p
        className={`flex-1 overflow-auto text-sm ${isError ? "text-red-300" : "text-gray-200"}`}
      >
        {displayMessage}
      </p>
      <button
        type="button"
        onClick={hideToast}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
