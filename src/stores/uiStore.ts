import { create } from "zustand";

export type ToastType = "error" | "info";

interface ToastState {
  message: string | null;
  type: ToastType;
}

interface UiState {
  isPreviewOpen: boolean;
  openPreview: () => void;
  closePreview: () => void;
  isCropOpen: boolean;
  openCrop: () => void;
  closeCrop: () => void;
  toast: ToastState | null;
  showToast: (message: string, type?: ToastType) => void;
  hideToast: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  isPreviewOpen: false,
  openPreview: () => set({ isPreviewOpen: true }),
  closePreview: () => set({ isPreviewOpen: false }),
  isCropOpen: false,
  openCrop: () => set({ isCropOpen: true }),
  closeCrop: () => set({ isCropOpen: false }),
  toast: null,
  showToast: (message, type = "error") =>
    set({ toast: { message, type } }),
  hideToast: () => set({ toast: null }),
}));
