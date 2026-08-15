import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TrainerProfile } from "@/lib/buckets";
import { BUILTIN_PROFILES } from "@/lib/buckets";

const DEFAULT_PROFILE = BUILTIN_PROFILES.find((p) => p.id === "sdxl")!;

interface CropState {
  selectedProfile: TrainerProfile;
  setSelectedProfile: (profile: TrainerProfile) => void;
  /** Persisted user-defined profiles. */
  customProfiles: TrainerProfile[];
  /** Adds (or replaces, by id) a custom profile and selects it. */
  addCustomProfile: (profile: TrainerProfile) => void;
  /** Removes a custom profile; falls back to the default if it was selected. */
  removeCustomProfile: (id: string) => void;
}

export const useCropStore = create<CropState>()(
  persist(
    (set) => ({
      selectedProfile: DEFAULT_PROFILE,
      setSelectedProfile: (profile) => set({ selectedProfile: profile }),
      customProfiles: [],
      addCustomProfile: (profile) =>
        set((s) => ({
          customProfiles: [
            ...s.customProfiles.filter((p) => p.id !== profile.id),
            profile,
          ],
          selectedProfile: profile,
        })),
      removeCustomProfile: (id) =>
        set((s) => ({
          customProfiles: s.customProfiles.filter((p) => p.id !== id),
          selectedProfile:
            s.selectedProfile.id === id ? DEFAULT_PROFILE : s.selectedProfile,
        })),
    }),
    { name: "lora-studio-crop-settings" }
  )
);
