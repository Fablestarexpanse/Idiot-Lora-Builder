/** Shared caption tag helpers (single source for parse/format/trigger rules). */

export function parseTagsFromText(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

/**
 * Ensures the trigger word is the first tag (case-insensitive dedupe).
 * Returns tags unchanged when no trigger word is set.
 */
export function applyTriggerWord(tags: string[], triggerWord: string | undefined): string[] {
  const tw = triggerWord?.trim();
  if (!tw) return tags;
  const withoutTrigger = tags.filter((t) => t.trim().toLowerCase() !== tw.toLowerCase());
  return [tw, ...withoutTrigger];
}
