import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TrainerProfile } from "@/lib/buckets";
import { BUILTIN_PROFILES } from "@/lib/buckets";

interface CropState {
  selectedProfile: TrainerProfile;
  setSelectedProfile: (profile: TrainerProfile) => void;
  customProfiles: TrainerProfile[];
  addCustomProfile: (profile: TrainerProfile) => void;
  removeCustomProfile: (id: string) => void;
}

export const useCropStore = create<CropState>()(
  persist(
    (set) => ({
      selectedProfile: BUILTIN_PROFILES.find((p) => p.id === "sdxl")!,
      setSelectedProfile: (profile) => set({ selectedProfile: profile }),
      customProfiles: [],
      addCustomProfile: (profile) =>
        set((state) => ({ customProfiles: [...state.customProfiles, profile] })),
      removeCustomProfile: (id) =>
        set((state) => ({
          customProfiles: state.customProfiles.filter((p) => p.id !== id),
        })),
    }),
    { name: "lora-studio-crop-settings" }
  )
);
