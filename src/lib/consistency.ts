import type { ConsistencyScore } from "./tauri";

export function suggestedMarks(scores: ConsistencyScore[], cutoff: number): Set<string> {
  return new Set(
    scores
      .filter(
        (s) =>
          !s.baseline &&
          !s.error &&
          s.face_count === 1 &&
          s.similarity !== null &&
          s.similarity < cutoff
      )
      .map((s) => s.relative_path)
  );
}
export function lowestFirst(scores: ConsistencyScore[]): ConsistencyScore[] {
  return [...scores].sort(
    (a, b) =>
      (a.similarity === null ? Infinity : a.similarity) -
        (b.similarity === null ? Infinity : b.similarity) ||
      a.relative_path.localeCompare(b.relative_path)
  );
}

export type ConsistencyBand = "bad" | "needs_edit" | "good";

export function consistencyBand(
  score: ConsistencyScore,
  badBelow: number,
  goodFrom: number
): ConsistencyBand | null {
  if (score.baseline || score.error || score.face_count !== 1 || score.similarity === null)
    return null;
  if (score.similarity < badBelow) return "bad";
  return score.similarity < goodFrom ? "needs_edit" : "good";
}
