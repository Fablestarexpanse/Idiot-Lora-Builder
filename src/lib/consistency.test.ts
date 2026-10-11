import { describe, expect, it } from "vitest";
import { consistencyBand, lowestFirst, suggestedMarks } from "./consistency";
import type { ConsistencyScore } from "./tauri";
const row = (
  relative_path: string,
  similarity: number | null,
  extra: Partial<ConsistencyScore> = {}
): ConsistencyScore => ({
  relative_path,
  similarity,
  face_count: similarity == null ? 0 : 1,
  error: null,
  baseline: false,
  ...extra,
});
describe("consistency review", () => {
  it("marks below the cutoff while protecting references and ambiguous/unscored images", () => {
    expect([
      ...suggestedMarks(
        [
          row("low", 0.1),
          row("equal", 0.25),
          row("high", 0.8),
          row("base", 0.1, { baseline: true }),
          row("group", 0.1, { face_count: 2 }),
          row("missing", null),
          row("error", 0.1, { error: "decode failed" }),
        ],
        0.25
      ),
    ]).toEqual(["low"]);
  });
  it("sorts the worst scores first and leaves unscored images last", () => {
    const input = [row("none", null), row("high", 0.9), row("low", -0.1)];
    expect(lowestFirst(input).map((r) => r.relative_path)).toEqual(["low", "high", "none"]);
    expect(input[0].relative_path).toBe("none");
  });
});

it("assigns inclusive band boundaries and leaves protected or ambiguous images neutral", () => {
  expect(consistencyBand(row("bad", 0.24), 0.25, 0.6)).toBe("bad");
  expect(consistencyBand(row("middle", 0.25), 0.25, 0.6)).toBe("middle");
  expect(consistencyBand(row("good", 0.6), 0.25, 0.6)).toBe("good");
  for (const score of [
    row("base", 0.1, { baseline: true }),
    row("multi", 0.1, { face_count: 2 }),
    row("error", 0.1, { error: "failed" }),
    row("missing", null),
  ]) {
    expect(consistencyBand(score, 0.25, 0.6)).toBeNull();
  }
});
