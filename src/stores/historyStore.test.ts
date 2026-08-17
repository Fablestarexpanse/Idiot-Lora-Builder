import { describe, it, expect, vi, beforeEach } from "vitest";
import { useHistoryStore } from "@/stores/historyStore";
import { writeCaption } from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({
  writeCaption: vi.fn().mockResolvedValue(undefined),
}));

const mockedWriteCaption = vi.mocked(writeCaption);

function entry(n: number) {
  return {
    items: [
      {
        imagePath: `C:/proj/img${n}.png`,
        previousTags: [`old${n}`],
        newTags: [`new${n}`],
      },
    ],
    description: `edit ${n}`,
  };
}

function batchEntry() {
  return {
    items: [
      {
        imagePath: "C:/proj/a.png",
        previousTags: ["oldA"],
        newTags: ["newA"],
      },
      {
        imagePath: "C:/proj/b.png",
        previousTags: ["oldB1", "oldB2"],
        newTags: ["newB"],
      },
      {
        imagePath: "C:/proj/c.png",
        previousTags: [],
        newTags: ["newC"],
      },
    ],
    description: "search & replace batch",
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

  it("pushHistory ignores entries with no items", () => {
    useHistoryStore.getState().pushHistory({ items: [], description: "noop" });
    expect(useHistoryStore.getState().past).toEqual([]);
    expect(useHistoryStore.getState().canUndo()).toBe(false);
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

  it("undoes a batch entry as one action, writing every item", async () => {
    const s = useHistoryStore.getState();
    s.pushHistory(entry(1));
    s.pushHistory(batchEntry());

    const undone = await useHistoryStore.getState().undo();

    // One undo reverts all three images in the batch.
    expect(undone?.description).toBe("search & replace batch");
    expect(mockedWriteCaption).toHaveBeenCalledTimes(3);
    expect(mockedWriteCaption).toHaveBeenNthCalledWith(1, "C:/proj/a.png", [
      "oldA",
    ]);
    expect(mockedWriteCaption).toHaveBeenNthCalledWith(2, "C:/proj/b.png", [
      "oldB1",
      "oldB2",
    ]);
    expect(mockedWriteCaption).toHaveBeenNthCalledWith(3, "C:/proj/c.png", []);

    const state = useHistoryStore.getState();
    expect(state.past.map((e) => e.description)).toEqual(["edit 1"]);
    expect(state.future.map((e) => e.description)).toEqual([
      "search & replace batch",
    ]);
  });

  it("redoes a batch entry as one action, re-applying every item", async () => {
    useHistoryStore.getState().pushHistory(batchEntry());
    await useHistoryStore.getState().undo();
    mockedWriteCaption.mockClear();

    const redone = await useHistoryStore.getState().redo();

    expect(redone?.description).toBe("search & replace batch");
    expect(mockedWriteCaption).toHaveBeenCalledTimes(3);
    expect(mockedWriteCaption).toHaveBeenNthCalledWith(1, "C:/proj/a.png", [
      "newA",
    ]);
    expect(mockedWriteCaption).toHaveBeenNthCalledWith(2, "C:/proj/b.png", [
      "newB",
    ]);
    expect(mockedWriteCaption).toHaveBeenNthCalledWith(3, "C:/proj/c.png", [
      "newC",
    ]);
    expect(useHistoryStore.getState().canRedo()).toBe(false);
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
