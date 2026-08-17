import { create } from "zustand";

// Batch undo lives in historyStore (entries with multiple items), so
// search & replace shares the same Ctrl+Z stack as single tag edits.

interface SearchReplaceState {
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
  searchHighlightText: "",
  setSearchHighlightText: (text) => set({ searchHighlightText: text }),

  addTagPreviewText: "",
  addTagPreviewAtFront: true,
  setAddTagPreview: (text, atFront) =>
    set({ addTagPreviewText: text, addTagPreviewAtFront: atFront }),

  addTagRatingFilter: "all",
  setAddTagRatingFilter: (filter) => set({ addTagRatingFilter: filter }),
}));
