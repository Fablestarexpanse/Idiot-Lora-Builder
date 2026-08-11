import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ProjectState {
  rootPath: string | null;
  setRootPath: (path: string | null) => void;
  isLoadingProject: boolean;
  setIsLoadingProject: (loading: boolean) => void;
  /** True when project list is loaded but overlay is still up (preparing grid). */
  projectDataReady: boolean;
  setProjectDataReady: (ready: boolean) => void;
  /** Last opened folder path (persisted, used to prompt on next launch). */
  lastOpenedFolder: string | null;
  setLastOpenedFolder: (path: string | null) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      rootPath: null,
      setRootPath: (rootPath) => set({ rootPath }),
      isLoadingProject: false,
      setIsLoadingProject: (isLoadingProject) => set({ isLoadingProject }),
      projectDataReady: false,
      setProjectDataReady: (projectDataReady) => set({ projectDataReady }),
      lastOpenedFolder: null,
      setLastOpenedFolder: (lastOpenedFolder) => set({ lastOpenedFolder }),
    }),
    { name: "lora-studio-project", partialize: (s) => ({ lastOpenedFolder: s.lastOpenedFolder }) }
  )
);
