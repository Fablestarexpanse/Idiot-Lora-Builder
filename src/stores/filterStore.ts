import { create } from "zustand";
import type { FilterState, ImageRating, SortBy, SortOrder } from "@/types";

interface FilterStoreState extends FilterState {
  setQuery: (query: string) => void;
  setShowCaptioned: (value: boolean | null) => void;
  setTagFilter: (tag: string | null) => void;
  setRatingFilter: (rating: ImageRating | null) => void;
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
  setQuery: (query) => set({ query }),
  setShowCaptioned: (showCaptioned) => set({ showCaptioned }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  setRatingFilter: (ratingFilter) => set({ ratingFilter }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortOrder: (sortOrder) => set({ sortOrder }),
  resetFilters: () => set(defaultFilters),
}));
