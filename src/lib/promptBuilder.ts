import type { CaptionLength, ExtraOption, PromptTemplate } from "@/types";
import { DEFAULT_EXTRA_OPTIONS } from "@/types";

const LORA_EXCLUDED_EXTRA_OPTIONS = new Set([
  "camera_details", "no_fixed_attributes", "vulgar", "aesthetic_quality", "sfw_rating", "ages", "no_ambiguous", "pg",
]);

export function isExtraOptionAvailable(template: PromptTemplate | undefined, optionId: string): boolean {
  return template?.category !== "lora" || !LORA_EXCLUDED_EXTRA_OPTIONS.has(optionId);
}

export function getPromptContextLabel(template: PromptTemplate | undefined): string | null {
  switch (template?.contextKind) {
    case "signature_outfit": return "Signature outfit description";
    case "outfit": return "Target outfit description";
    case "object": return "Target object description";
    default: return null;
  }
}

export function isPromptContextMissing(template: PromptTemplate | undefined, description: string, skipContext = false): boolean {
  return Boolean(template?.contextKind && !skipContext && !description.trim());
}

const NAME_PLACEHOLDER = "{name}";
const LENGTH_PLACEHOLDER = "{length}";

function substituteName(text: string, characterName: string): string {
  const value = characterName.trim() || "the character";
  return text.split(NAME_PLACEHOLDER).join(value);
}

function substituteLength(text: string, length: CaptionLength | null): string {
  const value = length ?? "";
  const out = text.split(LENGTH_PLACEHOLDER).join(value);
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
    template?: PromptTemplate;
    conceptDescription?: string;
    skipContext?: boolean;
  }
): string {
  const {
    wordCount,
    length,
    characterName,
    extraOptionIds,
    extraOptions = DEFAULT_EXTRA_OPTIONS,
    template,
    conceptDescription = "",
    skipContext = false,
  } = options;

  let prompt = basePrompt.trim();
  prompt = substituteLength(prompt, length);
  prompt = substituteName(prompt, characterName);

  if (length && !basePrompt.includes(LENGTH_PLACEHOLDER)) {
    prompt += ` Keep the caption ${length} while preserving the requested format and visible facts; do not add filler to meet a length.`;
  }

  const contextLabel = getPromptContextLabel(template);
  if (contextLabel && !skipContext && conceptDescription.trim()) {
    prompt += ` Reference context only, not caption text: ${contextLabel}: ${JSON.stringify(conceptDescription.trim())}. Use this to identify the target; the preset's omission rules still apply. Never assume an unseen feature or object is visible.`;
  }

  if (contextLabel && skipContext) {
    prompt += " No reference description was supplied; this is intentional. Follow the preset using only visible evidence and do not ask for a description. Treat the visible subject or worn outfit as the intended target according to the preset. Do not guess whether an outfit is an alternate or invent unseen target features. Retain the preset’s fixed-feature omissions and output format.";
  }

  if (wordCount != null && wordCount > 0) {
    prompt += ` Keep it within ${wordCount} words.`;
  }

  const selected = extraOptions.filter((o) => extraOptionIds.includes(o.id) && isExtraOptionAvailable(template, o.id));
  if (selected.length > 0) {
    const appended = selected
      .map((o) => substituteName(o.text, characterName))
      .join(" ");
    prompt += " " + appended;
    if (template?.category === "lora") prompt += " The selected preset’s fixed-feature exclusions, visible-only rules and output format take priority over optional detail instructions.";
  }

  return prompt.replace(/\s+/g, " ").trim();
}
