import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const { findDuplicates, deleteImage } = await import("./tauri");

describe("findDuplicates", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ groups: [] });
  });

  it("defaults to exact matching so the scan can never over-group", async () => {
    await findDuplicates("C:/ds");
    expect(invoke).toHaveBeenCalledWith("find_duplicates", {
      payload: { root_path: "C:/ds", max_distance: 0 },
    });
  });

  it("passes the perceptual distance through when one is given", async () => {
    await findDuplicates("C:/ds", 7);
    expect(invoke).toHaveBeenCalledWith("find_duplicates", {
      payload: { root_path: "C:/ds", max_distance: 7 },
    });
  });

  it("nests the args under the Rust parameter name", async () => {
    // find_duplicates is `fn find_duplicates(payload: FindDuplicatesPayload)`,
    // and Tauri looks that parameter name up as an exact key. Passing the
    // fields at the top level instead rejects the call with "missing required
    // key payload" before any scanning happens.
    await findDuplicates("C:/ds", 3);
    const [, args] = invoke.mock.calls[0];
    expect(args).toHaveProperty("payload");
    expect(args).not.toHaveProperty("root_path");
  });
});

describe("deleteImage", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("names the arg the way Tauri exposes it", async () => {
    // `fn delete_image(image_path: String)` is looked up as `imagePath`:
    // Tauri lowerCamelCases parameter names unless the command opts into
    // rename_all = "snake_case". This is the delete behind the duplicate
    // finder's per-file action and the grid tile's delete button.
    await deleteImage("C:/ds/a.png");
    expect(invoke).toHaveBeenCalledWith("delete_image", { imagePath: "C:/ds/a.png" });
  });
});
