import { ImageGrid } from "../grid/ImageGrid";
import { RightPanel } from "../editor/RightPanel";
import { FilterBar } from "../filter/FilterBar";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  return (
    <div className="flex min-w-0 flex-1 overflow-x-hidden">
      {/* Sidebar: folders & stats */}
      <Sidebar />

      {/* Main: filter bar + image grid */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        <FilterBar />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
          <ImageGrid />
        </div>
      </section>

      {/* Right: tag editor + AI panel */}
      <aside className="w-80 shrink-0 border-l border-border bg-surface-elevated">
        <RightPanel />
      </aside>
    </div>
  );
}
