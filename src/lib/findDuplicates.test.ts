import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const { findDuplicates } = await import("./tauri");

describe("findDuplicates", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ groups: [] });
  });

  it("defaults to exact matching so the scan can never over-group", async () => {
    await findDuplicates("C:/ds");
    expect(invoke).toHaveBeenCalledWith("find_duplicates", {
      root_path: "C:/ds",
      max_distance: 0,
    });
  });

  it("passes the perceptual distance through when one is given", async () => {
    await findDuplicates("C:/ds", 7);
    expect(invoke).toHaveBeenCalledWith("find_duplicates", {
      root_path: "C:/ds",
      max_distance: 7,
    });
  });

  it("sends args directly, not wrapped in a payload key", async () => {
    // find_duplicates is on the "args object directly" side of the convention
    // documented at the top of tauri.ts — wrapping it would silently 404.
    await findDuplicates("C:/ds", 3);
    const [, args] = invoke.mock.calls[0];
    expect(args).not.toHaveProperty("payload");
  });
});
