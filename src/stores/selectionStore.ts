import { create } from "zustand";
import type { ImageEntry } from "@/types";

interface SelectionState {
  selectedImage: ImageEntry | null;
  selectedIds: Set<string>;
  setSelectedImage: (image: ImageEntry | null) => void;
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedImage: null,
  selectedIds: new Set(),
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
  selectAll: (ids) => set({ selectedIds: new Set(ids) }),
  clearSelection: () => set({ selectedIds: new Set(), selectedImage: null }),
}));
