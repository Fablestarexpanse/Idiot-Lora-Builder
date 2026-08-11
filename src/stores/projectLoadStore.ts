import { create } from "zustand";

interface ProjectLoadState {
  /** Number of images found so far during scan */
  imagesFound: number;
  setImagesFound: (count: number) => void;
  reset: () => void;
}

export const useProjectLoadStore = create<ProjectLoadState>((set) => ({
  imagesFound: 0,
  setImagesFound: (count) => set({ imagesFound: count }),
  reset: () => set({ imagesFound: 0 }),
}));
