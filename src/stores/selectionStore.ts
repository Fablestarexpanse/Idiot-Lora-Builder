import { create } from "zustand";
import type { ImageEntry } from "@/types";

interface SelectionState {
  selectedImage: ImageEntry | null;
  selectedIds: Set<string>;
  /** Anchor for Shift+Click range selection (last plain/Ctrl-clicked image id). */
  lastClickedId: string | null;
  setSelectedImage: (image: ImageEntry | null) => void;
  toggleSelection: (id: string) => void;
  setLastClickedId: (id: string | null) => void;
  /** Adds the given ids to the current selection (Shift+Click range). */
  selectRange: (ids: string[]) => void;
  /** Replaces the current selection with the given ids (Ctrl+A). */
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedImage: null,
  selectedIds: new Set(),
  lastClickedId: null,
  setSelectedImage: (selectedImage) => set({ selectedImage }),
  toggleSelection: (id) =>
    set((state) => {
      const newSet = new Set(state.selectedIds);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { selectedIds: newSet };
    }),
  setLastClickedId: (lastClickedId) => set({ lastClickedId }),
  selectRange: (ids) =>
    set((state) => {
      const newSet = new Set(state.selectedIds);
      for (const id of ids) newSet.add(id);
      return { selectedIds: newSet };
    }),
  selectAll: (ids) => set({ selectedIds: new Set(ids) }),
  clearSelection: () =>
    set({ selectedIds: new Set(), selectedImage: null, lastClickedId: null }),
}));
