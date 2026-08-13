import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { CheckCircle2, Download, Loader2, Square, Trash2, X } from "lucide-react";
import { useAiStore } from "@/stores/aiStore";
import { useUiStore } from "@/stores/uiStore";
import {
  getBuiltinStatus,
  downloadBuiltin,
  cancelBuiltinDownload,
  stopBuiltinServer,
  getBuiltinServerStatus,
  deleteBuiltinModel,
} from "@/lib/tauri";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import type { BuiltinDownloadProgress } from "@/lib/tauri";
import { BUILTIN_MODELS, BUILTIN_BACKENDS } from "@/types";
import type { BuiltinBackend, BuiltinModelId } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

const COMPONENT_LABELS: Record<string, string> = {
  "llama-server": "Inference engine (llama-server)",
  model: "Vision model",
  mmproj: "Vision projector (mmproj)",
};

/**
 * Setup/status section for the built-in local captioner: one-time download of
 * llama-server + model, plus local server status controls.
 */
export function BuiltinSetup() {
  const builtinModelId = useAiStore((s) => s.builtinModelId);
  const setBuiltinModelId = useAiStore((s) => s.setBuiltinModelId);
  const builtinBackend = useAiStore((s) => s.builtinBackend);
  const setBuiltinBackend = useAiStore((s) => s.setBuiltinBackend);
  const showToast = useUiStore((s) => s.showToast);
  const queryClient = useQueryClient();

  const [progress, setProgress] = useState<BuiltinDownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showDeleteModel, setShowDeleteModel] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const statusQuery = useQuery({
    queryKey: ["builtin-status", builtinModelId, builtinBackend],
    queryFn: () => getBuiltinStatus(builtinModelId, builtinBackend),
  });
  const status = statusQuery.data;
  const ready = status?.ready === true;

  const serverQuery = useQuery({
    queryKey: ["builtin-server-status"],
    queryFn: getBuiltinServerStatus,
    enabled: ready,
    refetchInterval: 10_000,
  });
  const server = serverQuery.data;

  const downloadMutation = useMutation({
    mutationFn: async () => {
      setDownloadError(null);
      setProgress(null);
      // Subscribe to progress only while a download is running.
      unlistenRef.current = await listen<BuiltinDownloadProgress>(
        "builtin-download-progress",
        (event) => setProgress(event.payload)
      );
      try {
        await downloadBuiltin(builtinModelId, builtinBackend);
      } finally {
        unlistenRef.current?.();
        unlistenRef.current = null;
      }
    },
    onError: (err: Error) => {
      const message = err.message || String(err);
      if (!message.toLowerCase().includes("cancelled")) {
        setDownloadError(message);
      }
    },
    onSettled: () => {
      setProgress(null);
      statusQuery.refetch();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelBuiltinDownload,
    onError: (err: Error) => showToast(err.message || String(err)),
  });

  const deleteModelMutation = useMutation({
    mutationFn: async () => {
      // Stop the local server first if this model is currently loaded.
      const serverStatus = await getBuiltinServerStatus();
      if (serverStatus.running && serverStatus.model_id === builtinModelId) {
        await stopBuiltinServer();
      }
      await deleteBuiltinModel(builtinModelId);
    },
    onSuccess: () => {
      setShowDeleteModel(false);
      queryClient.invalidateQueries({ queryKey: ["builtin-status"] });
      queryClient.invalidateQueries({ queryKey: ["builtin-server-status"] });
    },
    onError: (err: Error) => {
      setShowDeleteModel(false);
      showToast(err.message || String(err));
    },
  });

  const stopServerMutation = useMutation({
    mutationFn: stopBuiltinServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["builtin-server-status"] });
    },
    onError: (err: Error) => showToast(err.message || String(err)),
  });

  // Drop the event listener if the component unmounts mid-download.
  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const isDownloading = downloadMutation.isPending || status?.downloading === true;
  const hasPartial =
    status?.components.some((c) => !c.installed && c.partial_bytes > 0) ?? false;
  const selectedModel = BUILTIN_MODELS.find((m) => m.id === builtinModelId);

  const modelSelect = (
    <div>
      <label className="mb-1 block text-xs text-gray-500">Model</label>
      <select
        value={builtinModelId}
        onChange={(e) => setBuiltinModelId(e.target.value as BuiltinModelId)}
        disabled={isDownloading}
        className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200 disabled:opacity-50"
      >
        {BUILTIN_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {m.downloadSize} download, {m.memoryNote}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-3">
      {modelSelect}
      <div>
        <label className="mb-1 block text-xs text-gray-500">Backend</label>
        <select
          value={builtinBackend}
          onChange={(e) => setBuiltinBackend(e.target.value as BuiltinBackend)}
          disabled={isDownloading}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200 disabled:opacity-50"
        >
          {BUILTIN_BACKENDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      {statusQuery.isLoading ? (
        <div className="flex items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-xs text-gray-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking installed components…
        </div>
      ) : statusQuery.isError ? (
        <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Failed to check status: {String(statusQuery.error)}
        </p>
      ) : ready ? (
        <div className="space-y-2 rounded border border-border bg-surface px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Installed — {selectedModel?.label ?? builtinModelId}
          </p>
          <p className="text-xs text-gray-400">
            Server:{" "}
            {server?.running ? (
              <span className="text-green-400">
                running{server.base_url ? ` at ${server.base_url}` : ""}
              </span>
            ) : (
              <span className="text-gray-500">stopped (starts automatically when captioning)</span>
            )}
          </p>
          {server?.running && (
            <button
              type="button"
              onClick={() => stopServerMutation.mutate()}
              disabled={stopServerMutation.isPending}
              className="flex items-center gap-1.5 rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600 disabled:opacity-50"
            >
              <Square className="h-3 w-3" />
              Stop server (free memory)
            </button>
          )}
          <p className="text-[10px] leading-relaxed text-gray-500">
            The first caption after startup takes longer while the model loads
            (up to a few minutes). Later captions are much faster.
          </p>
          <button
            type="button"
            onClick={() => setShowDeleteModel(true)}
            disabled={deleteModelMutation.isPending}
            className="flex items-center gap-1.5 rounded bg-gray-700 px-2 py-1 text-xs text-red-300 hover:bg-red-600/20 hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            Delete downloaded model
          </button>
          <ConfirmModal
            isOpen={showDeleteModel}
            onCancel={() => setShowDeleteModel(false)}
            onConfirm={() => deleteModelMutation.mutate()}
            title="Delete downloaded model?"
            icon={<Trash2 className="h-5 w-5 text-red-400" />}
            confirmLabel="Delete model"
            confirmIcon={<Trash2 className="h-4 w-4" />}
            confirmButtonClassName="bg-red-600 hover:bg-red-500"
            isPending={deleteModelMutation.isPending}
          >
            <p className="text-sm text-gray-400">
              Delete the downloaded weights for{" "}
              {selectedModel?.label ?? builtinModelId}? This frees{" "}
              {selectedModel?.downloadSize ?? "several GB"} of disk space. The
              inference engine stays installed; you can re-download the model
              later. If the local server is running this model, it will be
              stopped first.
            </p>
          </ConfirmModal>
        </div>
      ) : (
        <div className="space-y-2 rounded border border-border bg-surface px-3 py-2">
          <p className="text-xs text-gray-300">One-time download required</p>
          <p className="text-[11px] leading-relaxed text-gray-500">
            The built-in captioner runs fully on your machine. It needs the
            inference engine and the vision model downloaded once; after that,
            captioning works offline.
          </p>
          {status && (
            <p className="text-xs text-gray-400">
              Download size: {formatBytes(status.missing_bytes)}
            </p>
          )}

          {isDownloading ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-300">
                <span className="flex items-center gap-1.5 truncate">
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  {progress
                    ? progress.phase === "extracting"
                      ? `Extracting ${COMPONENT_LABELS[progress.component] ?? progress.component}…`
                      : `${COMPONENT_LABELS[progress.component] ?? progress.component}`
                    : "Starting download…"}
                </span>
                {progress && progress.total > 0 && (
                  <span className="shrink-0 text-gray-400">
                    {formatBytes(progress.received)} / {formatBytes(progress.total)}
                  </span>
                )}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-700">
                <div
                  className="h-full bg-purple-600 transition-all duration-300"
                  style={{
                    width:
                      progress && progress.overall_total > 0
                        ? `${(100 * progress.overall_received) / progress.overall_total}%`
                        : "0%",
                  }}
                />
              </div>
              {progress && progress.overall_total > 0 && (
                <p className="text-[10px] text-gray-500">
                  Overall: {formatBytes(progress.overall_received)} /{" "}
                  {formatBytes(progress.overall_total)}
                </p>
              )}
              <button
                type="button"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="flex items-center gap-1.5 rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => downloadMutation.mutate()}
              className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
            >
              <Download className="h-3.5 w-3.5" />
              {hasPartial ? "Resume download" : "Download"}
            </button>
          )}

          {downloadError && (
            <p className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] leading-snug text-red-300">
              {downloadError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
