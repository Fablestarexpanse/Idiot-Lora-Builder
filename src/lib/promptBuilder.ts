import type { CaptionLength, ExtraOption } from "@/types";
import { DEFAULT_EXTRA_OPTIONS } from "@/types";

const NAME_PLACEHOLDER = "{name}";
const LENGTH_PLACEHOLDER = "{length}";

function substituteName(text: string, characterName: string): string {
  const value = characterName.trim() || "the character";
  return text.split(NAME_PLACEHOLDER).join(value);
}

function substituteLength(text: string, length: CaptionLength | null): string {
  const value = length ?? "";
  let out = text.split(LENGTH_PLACEHOLDER).join(value);
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Builds the final caption prompt from base prompt, optional word count/length,
 * character name, and selected extra options. Used for single and batch captioning.
 */
export function buildEffectivePrompt(
  basePrompt: string,
  options: {
    wordCount: number | null;
    length: CaptionLength | null;
    characterName: string;
    extraOptionIds: string[];
    extraOptions?: ExtraOption[];
  }
): string {
  const {
    wordCount,
    length,
    characterName,
    extraOptionIds,
    extraOptions = DEFAULT_EXTRA_OPTIONS,
  } = options;

  let prompt = basePrompt.trim();
  prompt = substituteLength(prompt, length);
  prompt = substituteName(prompt, characterName);

  if (wordCount != null && wordCount > 0) {
    prompt += ` Keep it within ${wordCount} words.`;
  }

  const selected = extraOptions.filter((o) => extraOptionIds.includes(o.id));
  if (selected.length > 0) {
    const appended = selected
      .map((o) => substituteName(o.text, characterName))
      .join(" ");
    prompt += " " + appended;
  }

  return prompt.replace(/\s+/g, " ").trim();
}
