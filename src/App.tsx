import { useEffect } from "react";
import { Toolbar } from "./components/layout/Toolbar";
import { AppLayout } from "./components/layout/AppLayout";
import { StatusBar } from "./components/layout/StatusBar";
import { Toast } from "./components/layout/Toast";
import { ImagePreviewModal } from "./components/preview/ImagePreviewModal";
import { CropModal } from "./components/preview/CropModal";
import { ProjectLoadOverlay } from "./components/project/ProjectLoadOverlay";
import { RestorePreviousFolderPrompt } from "./components/project/RestorePreviousFolderPrompt";
import { GridDebugPanel } from "./components/grid/GridDebugPanel";
import { useUiStore } from "./stores/uiStore";
import { useRatingShortcuts } from "./hooks/useRatingShortcuts";

function App() {
  const isPreviewOpen = useUiStore((s) => s.isPreviewOpen);
  const closePreview = useUiStore((s) => s.closePreview);

  useRatingShortcuts();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // ? to open help
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        // Help is handled by Toolbar, but we could trigger it here
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="flex h-screen min-w-0 flex-col overflow-x-hidden bg-surface">
      <Toolbar />
      <main className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <AppLayout />
      </main>
      <StatusBar />

      {/* Modals */}
      <ImagePreviewModal isOpen={isPreviewOpen} onClose={closePreview} />
      <CropModal />
      <ProjectLoadOverlay />
      <RestorePreviousFolderPrompt />
      <Toast />
      <GridDebugPanel />
    </div>
  );
}

export default App;
