import { create } from "zustand";
import type { CropStatus, FilterState, ImageRating, SortBy, SortOrder } from "@/types";

interface FilterStoreState extends FilterState {
  /** null = all; otherwise only images with this crop status (missing = "uncropped"). */
  cropStatusFilter: CropStatus | null;
  setQuery: (query: string) => void;
  setShowCaptioned: (value: boolean | null) => void;
  setTagFilter: (tag: string | null) => void;
  setRatingFilter: (rating: ImageRating | null) => void;
  setCropStatusFilter: (status: CropStatus | null) => void;
  setSortBy: (sortBy: SortBy) => void;
  setSortOrder: (sortOrder: SortOrder) => void;
  resetFilters: () => void;
}

const defaultFilters: FilterState = {
  query: "",
  showCaptioned: null,
  tagFilter: null,
  ratingFilter: null,
  sortBy: "name",
  sortOrder: "asc",
};

export const useFilterStore = create<FilterStoreState>((set) => ({
  ...defaultFilters,
  cropStatusFilter: null,
  setQuery: (query) => set({ query }),
  setShowCaptioned: (showCaptioned) => set({ showCaptioned }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  setRatingFilter: (ratingFilter) => set({ ratingFilter }),
  setCropStatusFilter: (cropStatusFilter) => set({ cropStatusFilter }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortOrder: (sortOrder) => set({ sortOrder }),
  resetFilters: () => set({ ...defaultFilters, cropStatusFilter: null }),
}));
