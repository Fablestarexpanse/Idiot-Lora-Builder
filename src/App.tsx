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
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";

function App() {
  const isPreviewOpen = useUiStore((s) => s.isPreviewOpen);
  const closePreview = useUiStore((s) => s.closePreview);

  // Single app-global keydown listener: "?" help, 1/2/3 ratings.
  useGlobalShortcuts();

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
