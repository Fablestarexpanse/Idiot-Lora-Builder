import { create } from "zustand";
import { writeCaption } from "@/lib/tauri";

/** One image's before/after tags within a history entry. */
export interface HistoryItem {
  imagePath: string;
  previousTags: string[];
  newTags: string[];
}

/**
 * A single undoable action. Single-image edits are one-item arrays; batch
 * operations (search & replace, add-tag-to-all, trigger word) carry every
 * affected image so one Ctrl+Z reverts the whole batch.
 */
export interface HistoryEntry {
  id: string;
  items: HistoryItem[];
  timestamp: number;
  description: string;
}

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  maxHistory: number;

  // Add a new entry to history
  pushHistory: (entry: Omit<HistoryEntry, "id" | "timestamp">) => void;

  // Undo the last action
  undo: () => Promise<HistoryEntry | null>;

  // Redo the last undone action
  redo: () => Promise<HistoryEntry | null>;

  // Check if can undo/redo
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  maxHistory: 100,

  pushHistory: (entry) => {
    if (entry.items.length === 0) return;
    const fullEntry: HistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
    };

    set((state) => ({
      past: [...state.past, fullEntry].slice(-state.maxHistory),
      future: [], // Clear redo stack on new action
    }));
  },

  undo: async () => {
    const { past } = get();
    if (past.length === 0) return null;

    const entry = past[past.length - 1];

    // Restore previous tags for every image in the entry
    for (const item of entry.items) {
      await writeCaption(item.imagePath, item.previousTags);
    }

    set((state) => ({
      past: state.past.slice(0, -1),
      future: [entry, ...state.future],
    }));

    return entry;
  },

  redo: async () => {
    const { future } = get();
    if (future.length === 0) return null;

    const entry = future[0];

    // Apply new tags again for every image in the entry
    for (const item of entry.items) {
      await writeCaption(item.imagePath, item.newTags);
    }

    set((state) => ({
      past: [...state.past, entry],
      future: state.future.slice(1),
    }));

    return entry;
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
