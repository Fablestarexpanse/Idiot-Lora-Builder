import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProjectStore } from "@/stores/projectStore";
import { useSelectionStore } from "@/stores/selectionStore";
import type { ImageEntry } from "@/types";
import type { ConsistencyScan } from "@/lib/tauri";
const api = vi.hoisted(() => ({
  projectImages: vi.fn(),
  loadConsistency: vi.fn(),
  scanConsistency: vi.fn(),
  excludeConsistency: vi.fn(),
  setRatingsBatch: vi.fn(),
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
    data: api.projectImages(),
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
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ConsistencyModal isOpen onClose={onClose} />
    </QueryClientProvider>
  );
  return onClose;
}
beforeEach(() => {
  vi.clearAllMocks();
  api.projectImages.mockReturnValue([
    {
      id: "selected",
      path: "C:/dataset/base3.png",
      relative_path: "base3.png",
      filename: "base3.png",
    },
  ]);
  useProjectStore.setState({ rootPath: "C:/dataset" });
  useSelectionStore.setState({ selectedIds: new Set(["selected"]) });
  api.loadConsistency.mockResolvedValue(saved());
  api.scanConsistency.mockResolvedValue(saved());
  api.setRatingsBatch.mockResolvedValue(undefined);
  useSelectionStore.setState({ selectedImage: null });
});
describe("Consistency Check", () => {
  it("saves selected dataset ratings only after applying and synchronizes the main grid and selected image", async () => {
    const original = {
      id: "low",
      path: "C:/dataset/low.png",
      relative_path: "low.png",
      filename: "low.png",
      rating: "good",
    } as ImageEntry;
    const untouched = {
      ...original,
      id: "other",
      relative_path: "other.png",
      rating: "needs_edit",
    } as ImageEntry;
    api.projectImages.mockReturnValue([original, untouched]);
    useSelectionStore.setState({ selectedImage: original });
    const client = new QueryClient();
    client.setQueryData(["project", "images", "C:/dataset"], [original, untouched]);
    const user = userEvent.setup();
    const onClose = mount(client);
    await screen.findByText("low.png");
    expect(api.setRatingsBatch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Suggest outliers" }));
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Baseline" })).toBeDisabled();
    api.setRatingsBatch.mockRejectedValueOnce(new Error("Write failed"));
    await user.click(screen.getByRole("button", { name: "Apply selected ratings" }));
    await screen.findByRole("alert");
    expect(client.getQueryData<ImageEntry[]>(["project", "images", "C:/dataset"])?.[0].rating).toBe(
      "good"
    );
    await user.click(screen.getByRole("button", { name: "Apply selected ratings" }));
    await screen.findByText(/1 dataset ratings saved/);
    expect(api.setRatingsBatch).toHaveBeenLastCalledWith("C:/dataset", [
      { relative_path: "low.png", rating: "bad" },
    ]);
    expect(
      client.getQueryData<ImageEntry[]>(["project", "images", "C:/dataset"])?.map((i) => i.rating)
    ).toEqual(["bad", "needs_edit"]);
    expect(useSelectionStore.getState().selectedImage?.rating).toBe("bad");
    expect(api.excludeConsistency).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Move marked out" })).not.toBeInTheDocument();
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

it("colors score bands and replaces marks by group without moving files", async () => {
  const result = saved();
  result.scores.push(
    { relative_path: "middle.png", similarity: 0.4, face_count: 1, baseline: false, error: null },
    { relative_path: "good.png", similarity: 0.8, face_count: 1, baseline: false, error: null },
    { relative_path: "multi.png", similarity: 0.1, face_count: 2, baseline: false, error: null }
  );
  api.loadConsistency.mockResolvedValue(result);
  const user = userEvent.setup();
  mount();
  expect(await screen.findByRole("article", { name: "low.png: Bad" })).toHaveClass(
    "border-red-500"
  );
  expect(screen.getByRole("article", { name: "middle.png: Needs Edit" })).toHaveClass(
    "border-amber-500"
  );
  expect(screen.getByRole("article", { name: "good.png: Good" })).toHaveClass("border-green-500");
  expect(screen.getByRole("article", { name: "multi.png: Review" })).toHaveClass("border-border");
  await user.click(screen.getByRole("button", { name: "Select all bad (1)" }));
  expect(screen.getByRole("article", { name: "low.png: Bad, selected" })).toHaveClass(
    "ring-blue-400"
  );
  await user.click(screen.getByRole("button", { name: "Select all needs edit (1)" }));
  expect(screen.getByRole("article", { name: "low.png: Bad" })).not.toHaveClass("ring-blue-400");
  expect(
    screen.getByRole("article", { name: "middle.png: Needs Edit, selected" })
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Good similarity cutoff" }), {
    target: { value: "0.35" },
  });
  expect(screen.getByRole("article", { name: "middle.png: Good, selected" })).toHaveClass(
    "border-green-500"
  );
  await user.click(screen.getByRole("button", { name: "Select all good (2)" }));
  expect(screen.getByText(/2 selected/)).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "base1.png: Baseline" })).not.toHaveClass(
    "ring-blue-400"
  );
  expect(api.excludeConsistency).not.toHaveBeenCalled();
});

it("picks exact reference slots from the dataset, protects duplicates, and replaces a filled slot", async () => {
  api.projectImages.mockReturnValue(
    ["one", "two", "three", "four"].map((name) => ({
      id: name,
      path: `C:/dataset/${name}.png`,
      relative_path: `${name}.png`,
      filename: `${name}.png`,
    }))
  );
  api.loadConsistency.mockResolvedValue({
    ...saved(),
    baselines: [],
    scores: [],
    suggested_cutoff: null,
  });
  const user = userEvent.setup();
  const onClose = mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Choose reference 3 from dataset" })).toBeEnabled()
  );
  await user.click(screen.getByRole("button", { name: "Choose reference 3 from dataset" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(
    screen.getByRole("dialog", { name: "Choose reference 3 from dataset" })
  ).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "Search dataset references" }), "three");
  expect(
    screen.queryByRole("button", { name: "Use one.png as reference" })
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Use three.png as reference" }));
  expect(screen.getByRole("button", { name: "Preview baseline 3" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Scan 4 images" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Choose reference 1 from dataset" }));
  expect(screen.getByRole("button", { name: "Use three.png as reference" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Use one.png as reference" }));
  await user.click(screen.getByRole("button", { name: "Choose reference 2 from dataset" }));
  await user.click(screen.getByRole("button", { name: "Use two.png as reference" }));
  await user.click(screen.getByRole("button", { name: "Choose reference 2 from dataset" }));
  await user.click(screen.getByRole("button", { name: "Use four.png as reference" }));
  await user.click(screen.getByRole("button", { name: "Scan 4 images" }));
  await waitFor(() =>
    expect(api.scanConsistency).toHaveBeenCalledWith(
      "C:/dataset",
      ["C:/dataset/one.png", "C:/dataset/four.png", "C:/dataset/three.png"],
      ["one.png", "two.png", "three.png", "four.png"]
    )
  );
  expect(api.chooseConsistencyBaselines).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("recognizes canonical Windows references and leaves slots intact when removing a reference", async () => {
  api.loadConsistency.mockResolvedValue({
    ...saved(),
    baselines: [
      { path: "C:/refs/external.png" },
      { path: "C:/refs/side.png" },
      { path: "\\\\?\\C:\\dataset\\base3.png" },
    ],
  });
  const user = userEvent.setup();
  mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Choose reference 1 from dataset" })).toBeEnabled()
  );
  await user.click(screen.getByRole("button", { name: "Choose reference 1 from dataset" }));
  expect(screen.getByRole("button", { name: "Use base3.png as reference" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Remove baseline 1" }));
  expect(screen.getByRole("button", { name: "Preview baseline 3" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Preview baseline 1" })).not.toBeInTheDocument();
});

it("applies all score bands with manual overrides while preserving baselines and unrated ambiguous images", async () => {
  const result = saved();
  result.scores.push(
    { relative_path: "middle.png", similarity: 0.4, face_count: 1, baseline: false, error: null },
    { relative_path: "good.png", similarity: 0.8, face_count: 1, baseline: false, error: null },
    { relative_path: "multi.png", similarity: 0.1, face_count: 2, baseline: false, error: null },
    { relative_path: "gone.png", similarity: 0.1, face_count: 1, baseline: false, error: null }
  );
  api.loadConsistency.mockResolvedValue(result);
  api.projectImages.mockReturnValue(
    result.scores
      .filter((s) => s.relative_path !== "gone.png")
      .map((s) => ({
        id: s.relative_path,
        path: `C:/dataset/${s.relative_path}`,
        relative_path: s.relative_path,
      }))
  );
  const user = userEvent.setup();
  mount();
  await screen.findByText("low.png");
  await user.selectOptions(screen.getByRole("combobox", { name: "Rating for low.png" }), "good");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Rating for back.png" }),
    "needs_edit"
  );
  expect(screen.getByRole("article", { name: "low.png: Good" })).toHaveClass("border-green-500");
  await user.click(screen.getByRole("button", { name: "Apply all ratings" }));
  await screen.findByText(/4 dataset ratings saved/);
  expect(api.setRatingsBatch).toHaveBeenCalledWith(
    "C:/dataset",
    expect.arrayContaining([
      { relative_path: "low.png", rating: "good" },
      { relative_path: "back.png", rating: "needs_edit" },
      { relative_path: "middle.png", rating: "needs_edit" },
      { relative_path: "good.png", rating: "good" },
    ])
  );
  expect(api.setRatingsBatch.mock.calls[0][1]).toHaveLength(4);
  expect(api.excludeConsistency).not.toHaveBeenCalled();
});
