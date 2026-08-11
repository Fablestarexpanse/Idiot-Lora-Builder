import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TrainerProfile } from "@/lib/buckets";
import { BUILTIN_PROFILES } from "@/lib/buckets";

interface CropState {
  selectedProfile: TrainerProfile;
  setSelectedProfile: (profile: TrainerProfile) => void;
  /** Persisted user-defined profiles; no creation UI exists yet, but stored ones still load. */
  customProfiles: TrainerProfile[];
}

export const useCropStore = create<CropState>()(
  persist(
    (set) => ({
      selectedProfile: BUILTIN_PROFILES.find((p) => p.id === "sdxl")!,
      setSelectedProfile: (profile) => set({ selectedProfile: profile }),
      customProfiles: [],
    }),
    { name: "lora-studio-crop-settings" }
  )
);
