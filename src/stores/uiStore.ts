import { create } from "zustand";

export type ToastType = "error" | "info" | "success";

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

/** Max toasts shown at once; older ones are dropped when the queue is full. */
const MAX_TOASTS = 3;

let nextToastId = 1;

interface UiState {
  isPreviewOpen: boolean;
  openPreview: () => void;
  closePreview: () => void;
  isCropOpen: boolean;
  openCrop: () => void;
  closeCrop: () => void;
  isHelpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  toasts: ToastItem[];
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isPreviewOpen: false,
  openPreview: () => set({ isPreviewOpen: true }),
  closePreview: () => set({ isPreviewOpen: false }),
  isCropOpen: false,
  openCrop: () => set({ isCropOpen: true }),
  closeCrop: () => set({ isCropOpen: false }),
  isHelpOpen: false,
  openHelp: () => set({ isHelpOpen: true }),
  closeHelp: () => set({ isHelpOpen: false }),
  toasts: [],
  showToast: (message, type = "error") =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { id: nextToastId++, message, type },
      ].slice(-MAX_TOASTS),
    })),
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
