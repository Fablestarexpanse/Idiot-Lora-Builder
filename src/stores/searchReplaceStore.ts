import { create } from "zustand";

export interface SearchReplaceBatchItem {
  path: string;
  previousTags: string[];
  newTags: string[];
}

interface SearchReplaceState {
  /** Last batch of search-replace changes for undo */
  lastBatch: SearchReplaceBatchItem[] | null;
  pushBatch: (batch: SearchReplaceBatchItem[]) => void;
  clearLastBatch: () => void;

  /** Current search text for live highlighting in tags */
  searchHighlightText: string;
  setSearchHighlightText: (text: string) => void;

  /** Add tag: live preview in image tag section */
  addTagPreviewText: string;
  addTagPreviewAtFront: boolean;
  setAddTagPreview: (text: string, atFront: boolean) => void;

  /** Add tag: which images to target (all, good, bad, needs_edit) */
  addTagRatingFilter: "all" | "good" | "bad" | "needs_edit";
  setAddTagRatingFilter: (filter: "all" | "good" | "bad" | "needs_edit") => void;
}

export const useSearchReplaceStore = create<SearchReplaceState>((set) => ({
  lastBatch: null,
  pushBatch: (batch) => set({ lastBatch: batch }),
  clearLastBatch: () => set({ lastBatch: null }),

  searchHighlightText: "",
  setSearchHighlightText: (text) => set({ searchHighlightText: text }),

  addTagPreviewText: "",
  addTagPreviewAtFront: true,
  setAddTagPreview: (text, atFront) =>
    set({ addTagPreviewText: text, addTagPreviewAtFront: atFront }),

  addTagRatingFilter: "all",
  setAddTagRatingFilter: (filter) => set({ addTagRatingFilter: filter }),
}));
