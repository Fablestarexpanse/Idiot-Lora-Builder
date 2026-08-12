import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ThumbnailPresetId } from "@/lib/thumbnailPresets";
import { THUMBNAIL_PRESETS } from "@/lib/thumbnailPresets";

interface SettingsState {
  triggerWord: string;
  /** Previous trigger word, used when changing it so we remove the old one from all tags */
  previousTriggerWord: string;
  /** When true, trigger word input is disabled and cannot be changed */
  triggerWordLocked: boolean;
  thumbnailSize: number;
  /** Multiplier for grid column sizing (smaller = more columns / smaller tiles). */
  gridMinCellScale: number;
  /** When true, show a confirmation dialog before clearing tags on a single image */
  confirmBeforeClearTags: boolean;
  /** Performance / layout overlay (bottom-left) */
  showGridDebug: boolean;
  /** Root folder of a local Fizgig install (LoRA trainer) for the handoff button. */
  fizgigPath: string;
  setTriggerWord: (word: string) => void;
  setPreviousTriggerWord: (word: string) => void;
  setTriggerWordLocked: (locked: boolean) => void;
  setThumbnailSize: (size: number) => void;
  setGridMinCellScale: (value: number) => void;
  setThumbnailPreset: (preset: ThumbnailPresetId) => void;
  setConfirmBeforeClearTags: (value: boolean) => void;
  setShowGridDebug: (value: boolean) => void;
  setFizgigPath: (path: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      triggerWord: "",
      previousTriggerWord: "",
      triggerWordLocked: false,
      thumbnailSize: 768,
      gridMinCellScale: 1,
      confirmBeforeClearTags: true,
      showGridDebug: false,
      fizgigPath: "",
      setTriggerWord: (triggerWord) => set({ triggerWord }),
      setPreviousTriggerWord: (previousTriggerWord) => set({ previousTriggerWord }),
      setTriggerWordLocked: (triggerWordLocked) => set({ triggerWordLocked }),
      setThumbnailSize: (thumbnailSize) => set({ thumbnailSize }),
      setGridMinCellScale: (gridMinCellScale) => set({ gridMinCellScale }),
      setThumbnailPreset: (preset) => {
        const p = THUMBNAIL_PRESETS[preset];
        set({ gridMinCellScale: p.gridMinCellScale, thumbnailSize: p.thumbnailSize });
      },
      setConfirmBeforeClearTags: (confirmBeforeClearTags) => set({ confirmBeforeClearTags }),
      setShowGridDebug: (showGridDebug) => set({ showGridDebug }),
      setFizgigPath: (fizgigPath) => set({ fizgigPath }),
    }),
    {
      name: "lora-studio-settings",
    }
  )
);
