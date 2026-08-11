import { create } from "zustand";
import { writeCaption } from "@/lib/tauri";

export interface HistoryEntry {
  id: string;
  imagePath: string;
  imageFilename: string;
  previousTags: string[];
  newTags: string[];
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

  // Clear history
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  maxHistory: 100,

  pushHistory: (entry) => {
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

    // Restore previous tags
    await writeCaption(entry.imagePath, entry.previousTags);

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

    // Apply new tags again
    await writeCaption(entry.imagePath, entry.newTags);

    set((state) => ({
      past: [...state.past, entry],
      future: state.future.slice(1),
    }));

    return entry;
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  clearHistory: () => set({ past: [], future: [] }),
}));
