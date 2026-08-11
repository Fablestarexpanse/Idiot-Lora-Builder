import type { ReactNode } from "react";

/**
 * Splits text by term (case-insensitive) and returns React nodes with matches
 * wrapped in a <mark> using the given className.
 */
export function highlightTerm(
  text: string,
  term: string,
  markClassName: string
): ReactNode {
  if (!term.trim()) return text;
  try {
    const termLower = term.trim().toLowerCase();
    const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(re);
    return parts.map((part, i) =>
      part.toLowerCase() === termLower ? (
        <mark key={i} className={markClassName}>
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  } catch {
    return text;
  }
}
