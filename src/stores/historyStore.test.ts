import { describe, it, expect, vi, beforeEach } from "vitest";
import { useHistoryStore } from "@/stores/historyStore";
import { writeCaption } from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({
  writeCaption: vi.fn().mockResolvedValue(undefined),
}));

const mockedWriteCaption = vi.mocked(writeCaption);

function entry(n: number) {
  return {
    imagePath: `C:/proj/img${n}.png`,
    imageFilename: `img${n}.png`,
    previousTags: [`old${n}`],
    newTags: [`new${n}`],
    description: `edit ${n}`,
  };
}

beforeEach(() => {
  useHistoryStore.setState({ past: [], future: [], maxHistory: 100 });
  mockedWriteCaption.mockClear();
});

describe("historyStore", () => {
  it("starts with nothing to undo or redo", () => {
    const s = useHistoryStore.getState();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it("pushHistory appends entries in order and assigns id/timestamp", () => {
    const s = useHistoryStore.getState();
    s.pushHistory(entry(1));
    s.pushHistory(entry(2));

    const { past } = useHistoryStore.getState();
    expect(past.map((e) => e.description)).toEqual(["edit 1", "edit 2"]);
    expect(past[0].id).toBeTruthy();
    expect(typeof past[0].timestamp).toBe("number");
    expect(useHistoryStore.getState().canUndo()).toBe(true);
  });

  it("undo restores previousTags of the most recent entry and moves it to future", async () => {
    const s = useHistoryStore.getState();
    s.pushHistory(entry(1));
    s.pushHistory(entry(2));

    const undone = await useHistoryStore.getState().undo();

    expect(undone?.description).toBe("edit 2");
    expect(mockedWriteCaption).toHaveBeenCalledTimes(1);
    expect(mockedWriteCaption).toHaveBeenCalledWith("C:/proj/img2.png", [
      "old2",
    ]);

    const state = useHistoryStore.getState();
    expect(state.past.map((e) => e.description)).toEqual(["edit 1"]);
    expect(state.future.map((e) => e.description)).toEqual(["edit 2"]);
    expect(state.canRedo()).toBe(true);
  });

  it("redo re-applies newTags of the most recently undone entry", async () => {
    const s = useHistoryStore.getState();
    s.pushHistory(entry(1));
    await useHistoryStore.getState().undo();
    mockedWriteCaption.mockClear();

    const redone = await useHistoryStore.getState().redo();

    expect(redone?.description).toBe("edit 1");
    expect(mockedWriteCaption).toHaveBeenCalledWith("C:/proj/img1.png", [
      "new1",
    ]);

    const state = useHistoryStore.getState();
    expect(state.past.map((e) => e.description)).toEqual(["edit 1"]);
    expect(state.future).toEqual([]);
    expect(state.canUndo()).toBe(true);
    expect(state.canRedo()).toBe(false);
  });

  it("undo/undo/redo preserves LIFO ordering", async () => {
    const s = useHistoryStore.getState();
    s.pushHistory(entry(1));
    s.pushHistory(entry(2));
    s.pushHistory(entry(3));

    await useHistoryStore.getState().undo(); // undoes 3
    await useHistoryStore.getState().undo(); // undoes 2

    let state = useHistoryStore.getState();
    expect(state.past.map((e) => e.description)).toEqual(["edit 1"]);
    // future is newest-undone-first
    expect(state.future.map((e) => e.description)).toEqual([
      "edit 2",
      "edit 3",
    ]);

    await useHistoryStore.getState().redo(); // redoes 2
    state = useHistoryStore.getState();
    expect(state.past.map((e) => e.description)).toEqual(["edit 1", "edit 2"]);
    expect(state.future.map((e) => e.description)).toEqual(["edit 3"]);
  });

  it("undo with empty history returns null and does not write", async () => {
    const result = await useHistoryStore.getState().undo();
    expect(result).toBeNull();
    expect(mockedWriteCaption).not.toHaveBeenCalled();
  });

  it("redo with empty future returns null and does not write", async () => {
    useHistoryStore.getState().pushHistory(entry(1));
    const result = await useHistoryStore.getState().redo();
    expect(result).toBeNull();
    expect(mockedWriteCaption).not.toHaveBeenCalled();
  });

  it("pushHistory clears the redo stack", async () => {
    const s = useHistoryStore.getState();
    s.pushHistory(entry(1));
    await useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().canRedo()).toBe(true);

    useHistoryStore.getState().pushHistory(entry(2));
    expect(useHistoryStore.getState().canRedo()).toBe(false);
    expect(useHistoryStore.getState().future).toEqual([]);
  });

  it("caps past at maxHistory, dropping the oldest entries", () => {
    useHistoryStore.setState({ maxHistory: 3 });
    const s = useHistoryStore.getState();
    s.pushHistory(entry(1));
    s.pushHistory(entry(2));
    s.pushHistory(entry(3));
    s.pushHistory(entry(4));

    const { past } = useHistoryStore.getState();
    expect(past).toHaveLength(3);
    expect(past.map((e) => e.description)).toEqual([
      "edit 2",
      "edit 3",
      "edit 4",
    ]);
  });
});
