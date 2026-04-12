import { create } from "zustand";

/** Snapshot of grid layout for the performance debug overlay (updated by ImageGrid). */
export interface GridMetricsSnapshot {
  containerInnerWidth: number;
  columnCount: number;
  filteredTotal: number;
  rowCount: number;
  estimatedCellWidth: number;
  fallbackThumbEdge: number;
}

interface GridMetricsState extends GridMetricsSnapshot {
  setSnapshot: (partial: Partial<GridMetricsSnapshot>) => void;
}

const initial: GridMetricsSnapshot = {
  containerInnerWidth: 0,
  columnCount: 0,
  filteredTotal: 0,
  rowCount: 0,
  estimatedCellWidth: 0,
  fallbackThumbEdge: 0,
};

export const useGridMetricsStore = create<GridMetricsState>((set) => ({
  ...initial,
  setSnapshot: (partial) => set((state) => ({ ...state, ...partial })),
}));
