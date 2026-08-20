import { useEffect, useRef, useState } from "react";
import { Tag, X } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { readDatasetMetadata } from "@/lib/tauri";

/**
 * When a folder was produced by a dataset generator that recorded its trigger
 * word, offer it rather than making the user retype it.
 *
 * Accepting only sets the trigger word — Sidebar's debounced effect already
 * applies a change across every caption and records it in the undo history, so
 * this must not duplicate or bypass that.
 */
export function DatasetMetaPrompt() {
  const rootPath = useProjectStore((s) => s.rootPath);
  const triggerWord = useSettingsStore((s) => s.triggerWord);
  const triggerWordLocked = useSettingsStore((s) => s.triggerWordLocked);
  const setTriggerWord = useSettingsStore((s) => s.setTriggerWord);

  const [offer, setOffer] = useState<{ trigger: string; name: string | null } | null>(null);
  // Folders already answered for, so re-opening one doesn't nag.
  const dismissed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!rootPath || triggerWordLocked || dismissed.current.has(rootPath)) {
      setOffer(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const meta = await readDatasetMetadata(rootPath);
        const trigger = meta?.trigger?.trim();
        // Nothing to offer if there is no trigger, or it is already in use.
        if (cancelled || !trigger || trigger === triggerWord.trim()) return;
        setOffer({ trigger, name: meta?.character_name?.trim() || null });
      } catch {
        // A hint that fails to load is not worth telling anyone about.
      }
    })();
    return () => {
      cancelled = true;
    };
    // triggerWord is deliberately not a dependency: re-running on every
    // keystroke in the trigger field would re-offer mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, triggerWordLocked]);

  function close() {
    if (rootPath) dismissed.current.add(rootPath);
    setOffer(null);
  }

  function accept() {
    if (offer) setTriggerWord(offer.trigger);
    close();
  }

  if (!offer) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-labelledby="dataset-meta-prompt-title"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-elevated shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="dataset-meta-prompt-title"
            className="flex items-center gap-2 text-lg font-medium text-gray-100"
          >
            <Tag className="h-5 w-5 text-purple-400" />
            Use this dataset&apos;s trigger word?
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <p className="text-sm text-gray-400">
            This folder was generated with a trigger word already recorded
            {offer.name ? ` for ${offer.name}` : ""}.
          </p>
          <div className="rounded border border-border bg-surface px-3 py-2">
            <p className="truncate text-sm font-medium text-gray-200" title={offer.trigger}>
              {offer.trigger}
            </p>
          </div>
          <p className="text-xs text-gray-500">
            Using it sets the trigger word and puts it first on every caption.
            Ctrl+Z undoes the whole batch.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={accept}
              className="flex flex-1 items-center justify-center gap-2 rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500"
            >
              <Tag className="h-4 w-4" />
              Use it
            </button>
            <button
              type="button"
              onClick={close}
              className="flex flex-1 items-center justify-center gap-2 rounded border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600 hover:text-gray-200"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
