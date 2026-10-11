import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProjectStore } from "@/stores/projectStore";
import { useSelectionStore } from "@/stores/selectionStore";
import type { ConsistencyScan } from "@/lib/tauri";
const api = vi.hoisted(() => ({
  loadConsistency: vi.fn(),
  scanConsistency: vi.fn(),
  excludeConsistency: vi.fn(),
  undoConsistencyExclusion: vi.fn(),
  chooseConsistencyBaselines: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  ...api,
  cancelConsistencyScan: vi.fn(),
  ensureThumbnailUrl: vi.fn().mockResolvedValue("data:image/png;base64,"),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/hooks/useProject", () => ({
  useProjectImages: () => ({
    data: [
      {
        id: "selected",
        path: "C:/dataset/base3.png",
        relative_path: "base3.png",
        filename: "base3.png",
      },
    ],
  }),
}));
import { ConsistencyModal } from "./ConsistencyModal";
function saved(): ConsistencyScan {
  return {
    baselines: ["base1", "base2", "base3"].map((p) => ({ path: `C:/dataset/${p}.png` })),
    scores: [
      { relative_path: "low.png", similarity: 0.1, face_count: 1, baseline: false, error: null },
      { relative_path: "base1.png", similarity: 0.6, face_count: 1, baseline: true, error: null },
      { relative_path: "back.png", similarity: null, face_count: 0, baseline: false, error: null },
    ],
    suggested_cutoff: 0.25,
    can_undo: false,
    model: "buffalo_l/arcface-v1",
  };
}
function mount() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ConsistencyModal isOpen onClose={onClose} />
    </QueryClientProvider>
  );
  return onClose;
}
beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ rootPath: "C:/dataset" });
  useSelectionStore.setState({ selectedIds: new Set(["selected"]) });
  api.loadConsistency.mockResolvedValue(saved());
  api.scanConsistency.mockResolvedValue(saved());
});
describe("Consistency Check", () => {
  it("suggests without moving, allows keeping, and confirms before moving", async () => {
    const user = userEvent.setup();
    const onClose = mount();
    await screen.findByText("low.png");
    expect(api.excludeConsistency).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Suggest outliers" }));
    expect(screen.getByText(/1 marked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Baseline" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByText(/0 marked/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Similarity cutoff" }), {
      target: { value: "0.2" },
    });
    await user.click(screen.getByRole("button", { name: "Move marked out" }));
    expect(api.excludeConsistency).not.toHaveBeenCalled();
    api.excludeConsistency.mockResolvedValue({ moved: ["low.png"], errors: [], can_undo: true });
    api.loadConsistency.mockResolvedValue({
      ...saved(),
      can_undo: true,
      scores: saved().scores.filter((s) => s.relative_path !== "low.png"),
    });
    await user.click(screen.getByRole("button", { name: "Move 1 images" }));
    await waitFor(() =>
      expect(api.excludeConsistency).toHaveBeenCalledWith("C:/dataset", ["low.png"])
    );
    await screen.findByText(/1 image.*moved/);
    expect(screen.getByRole("button", { name: "Undo last exclusion" })).toBeEnabled();
    fireEvent.click(screen.getByRole("dialog", { name: "Consistency Check" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
  it("combines external references with selected dataset images before scanning", async () => {
    api.loadConsistency.mockResolvedValue({
      ...saved(),
      baselines: [],
      scores: [],
      suggested_cutoff: null,
    });
    api.chooseConsistencyBaselines.mockResolvedValue(["C:/refs/front.png", "C:/refs/side.png"]);
    const user = userEvent.setup();
    mount();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Choose files..." })).toBeEnabled()
    );
    await user.click(screen.getByRole("button", { name: "Choose files..." }));
    await user.click(screen.getByRole("button", { name: "Use selected images" }));
    await user.click(screen.getByRole("button", { name: "Scan 1 images" }));
    await waitFor(() =>
      expect(api.scanConsistency).toHaveBeenCalledWith(
        "C:/dataset",
        ["C:/refs/front.png", "C:/refs/side.png", "C:/dataset/base3.png"],
        ["base3.png"]
      )
    );
    expect(api.excludeConsistency).not.toHaveBeenCalled();
  });
});
