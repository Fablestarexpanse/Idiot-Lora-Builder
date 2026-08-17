/** Image rating status. */
export type ImageRating = "none" | "good" | "bad" | "needs_edit";

/** Crop status for dataset preparation tracking. */
export type CropStatus = "uncropped" | "cropped" | "multi" | "flagged";

/** Face detection region. */
export interface FaceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

/** Image entry as returned from open_project (list). */
export interface ImageEntry {
  id: string;
  path: string;
  relative_path: string;
  filename: string;
  has_caption: boolean;
  tags: string[];
  rating: ImageRating;
  crop_status?: CropStatus;
  width?: number;
  height?: number;
  file_size?: number;
}

/** Caption data returned from read_caption. */
export interface CaptionData {
  exists: boolean;
  raw: string;
  tags: string[];
}

/** Sort field for image grid. */
export type SortBy = "name" | "file_size" | "extension" | "dimension";
/** Sort order. */
export type SortOrder = "asc" | "desc";

/** Filter state for the image grid. */
export interface FilterState {
  query: string;
  showCaptioned: boolean | null; // null = all, true = captioned only, false = uncaptioned only
  tagFilter: string | null;
  ratingFilter: ImageRating | null; // null = all, or specific rating
  sortBy: SortBy;
  sortOrder: SortOrder;
}

// ============ AI Types ============

export type AiProvider = "lm_studio" | "ollama" | "builtin";

/** LM Studio connection status. */
export interface ConnectionStatus {
  connected: boolean;
  models: string[];
  error: string | null;
}

/** Caption result from AI. */
export interface CaptionResult {
  success: boolean;
  caption: string;
  error: string | null;
}

/** Batch caption result. */
export interface BatchCaptionResult {
  path: string;
  success: boolean;
  caption: string;
  error: string | null;
}

/** LM Studio settings. */
export interface LmStudioSettings {
  base_url: string;
  model: string | null;
  /** Request timeout in seconds (default 120, max 600). */
  timeout_secs?: number;
  /** Max image dimension (longest side) before sending to AI; null = don't resize. */
  max_image_dimension?: number | null;
}

/** Ollama settings (OpenAI-compatible API, e.g. http://localhost:11434/v1). */
export interface OllamaSettings {
  base_url: string;
  model: string | null;
}

// ============ Built-in Captioner ============

export type BuiltinModelId = "qwen3-vl-8b" | "qwen3-vl-4b";
export type BuiltinBackend = "vulkan" | "cpu";

/** Registry entry for a built-in captioner model (mirrors the backend registry). */
export interface BuiltinModelInfo {
  id: BuiltinModelId;
  label: string;
  /** Human-readable approximate download size. */
  downloadSize: string;
  /** Human-readable memory requirement. */
  memoryNote: string;
}

export const BUILTIN_MODELS: BuiltinModelInfo[] = [
  {
    id: "qwen3-vl-8b",
    label: "Qwen3-VL 8B (recommended)",
    downloadSize: "~5.8 GB",
    memoryNote: "needs ~8 GB RAM/VRAM",
  },
  {
    id: "qwen3-vl-4b",
    label: "Qwen3-VL 4B (lighter/faster)",
    downloadSize: "~3 GB",
    memoryNote: "needs ~5 GB RAM/VRAM",
  },
];

export const BUILTIN_BACKENDS: { id: BuiltinBackend; label: string }[] = [
  { id: "vulkan", label: "GPU (Vulkan — NVIDIA/AMD/Intel)" },
  { id: "cpu", label: "CPU only (slower)" },
];

/** Prompt template. May contain placeholders: {length}, {name}. */
export interface PromptTemplate {
  id: string;
  name: string;
  prompt: string;
  provider: AiProvider;
}

/** Optional length for caption (short/medium/long). */
export type CaptionLength = "short" | "medium" | "long";

/** Extra option: appendable instruction for caption generation. */
export interface ExtraOption {
  id: string;
  label: string;
  text: string;
}

/** Mutually exclusive extra option pairs (e.g. PG vs vulgar). Only one of each pair can be selected. */
export const EXTRA_OPTION_EXCLUSIVE_PAIRS: [string, string][] = [
  ["pg", "vulgar"],
];

/** Default extra options (appendable instructions). Use {name} in text for character name substitution. */
export const DEFAULT_EXTRA_OPTIONS: ExtraOption[] = [
  { id: "refer_name", label: "Refer to person/character as {name}", text: "If there is a person/character in the image you must refer to them as {name}." },
  { id: "no_fixed_attributes", label: "Omit unchangeable attributes (ethnicity, gender)", text: "Do NOT include information about people/characters that cannot be changed (like ethnicity, gender, etc), but do still include changeable attributes (like hair style)." },
  { id: "lighting", label: "Include lighting", text: "Include information about lighting." },
  { id: "camera_angle", label: "Include camera angle", text: "Include information about camera angle." },
  { id: "watermark", label: "Include watermark info", text: "Include information about whether there is a watermark or not." },
  { id: "jpeg_artifacts", label: "Include JPEG artifacts info", text: "Include information about whether there are JPEG artifacts or not." },
  { id: "camera_details", label: "Include camera details (photo)", text: "If it is a photo you MUST include information about what camera was likely used and details such as aperture, shutter speed, ISO, etc." },
  { id: "pg", label: "Keep it PG", text: "Do NOT include anything sexual; keep it PG." },
  { id: "no_resolution", label: "Do not mention resolution", text: "Do NOT mention the image's resolution." },
  { id: "aesthetic_quality", label: "Include aesthetic quality", text: "You MUST include information about the subjective aesthetic quality of the image from low to very high." },
  { id: "composition", label: "Include composition style", text: "Include information on the image's composition style, such as leading lines, rule of thirds, or symmetry." },
  { id: "no_text_in_image", label: "Do not mention text in image", text: "Do NOT mention any text that is in the image." },
  { id: "depth_of_field", label: "Specify depth of field", text: "Specify the depth of field and whether the background is in focus or blurred." },
  { id: "lighting_sources", label: "Mention lighting sources", text: "If applicable, mention the likely use of artificial or natural lighting sources." },
  { id: "no_ambiguous", label: "Do not use ambiguous language", text: "Do NOT use any ambiguous language." },
  { id: "sfw_rating", label: "Include sfw/suggestive/nsfw", text: "Include whether the image is sfw, suggestive, or nsfw." },
  { id: "important_only", label: "Only most important elements", text: "ONLY describe the most important elements of the image." },
  { id: "no_artist_title", label: "Do not include artist/title (art)", text: "If it is a work of art, do not include the artist's name or the title of the work." },
  { id: "vulgar", label: "Use vulgar/blunt language", text: "Use vulgar slang and profanity, such as (but not limited to) \"fucking,\" \"slut,\" \"cock,\" etc. Do NOT use polite euphemisms—lean into blunt, casual phrasing." },
  { id: "ages", label: "Include ages when applicable", text: "Include information about the ages of any people/characters when applicable." },
  { id: "shot_type", label: "Mention shot type", text: "Mention whether the image depicts an extreme close-up, close-up, medium close-up, medium shot, cowboy shot, medium wide shot, wide shot, or extreme wide shot." },
  { id: "no_mood", label: "Do not mention mood/feeling", text: "Do not mention the mood/feeling/etc of the image." },
  { id: "vantage_height", label: "Specify vantage height", text: "Explicitly specify the vantage height (eye-level, low-angle worm's-eye, bird's-eye, drone, rooftop, etc.)." },
  { id: "mention_watermark", label: "If watermark, mention it", text: "If there is a watermark, you must mention it." },
  { id: "no_meta_phrases", label: "Avoid meta phrases (for t2i)", text: "Your response will be used by a text-to-image model, so avoid useless meta phrases like \"This image shows…\", \"You are looking at...\", etc." },
  { id: "orientation", label: "Identify orientation and aspect ratio", text: "Identify the image orientation (portrait, landscape, or square) and aspect ratio if obvious." },
];

/** Export options: copy images + .txt captions to folder or ZIP. */
export interface ExportOptions {
  source_path: string;
  dest_path: string;
  as_zip: boolean;
  only_captioned: boolean;
  /** If set, only export these relative paths. */
  relative_paths?: string[] | null;
  trigger_word: string | null;
  sequential_naming: boolean;
  /** kohya (sd-scripts): number of repeats encoded in the image folder name. */
  repeat_count?: number | null;
  /** kohya (sd-scripts): concept folder name (`<repeat>_<concept>`). */
  concept_name?: string | null;
  /** kohya (sd-scripts): full dataset.toml content to write alongside the export. */
  dataset_toml?: string | null;
}

/** Export into good/bad/needs_edit subfolders. */
export interface ExportByRatingOptions {
  source_path: string;
  dest_path: string;
  trigger_word?: string | null;
  sequential_naming?: boolean;
}

/** Export result. */
export interface ExportResult {
  success: boolean;
  exported_count: number;
  skipped_count: number;
  error: string | null;
  output_path: string;
}

/** Batch rename options. */
export interface BatchRenameOptions {
  root_path: string;
  relative_paths: string[];
  prefix: string;
  start_index: number;
  zero_pad: number;
}

/** Batch rename result. */
export interface BatchRenameResult {
  success: boolean;
  renamed_count: number;
  errors: string[];
}

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "descriptive",
    name: "Descriptive",
    prompt: "Write a long detailed description for this image.",
    provider: "lm_studio",
  },
  {
    id: "straightforward",
    name: "Straightforward",
    prompt:
      "Write a straightforward caption for this image. Begin with the main subject and medium. Mention pivotal elements—people, objects, scenery—using confident, definite language. Focus on concrete details like color, shape, texture, and spatial relationships. Show how elements interact. Omit mood and speculative wording. If text is present, quote it exactly. Note any watermarks, signatures, or compression artifacts. Never mention what's absent, resolution, or unobservable details. Vary your sentence structure and keep the description concise, without starting with \"This image is…\" or similar phrasing.",
    provider: "lm_studio",
  },
  {
    id: "stable_diffusion",
    name: "Stable Diffusion Prompt",
    prompt:
      "Output a stable diffusion prompt that is indistinguishable from a real stable diffusion prompt.",
    provider: "lm_studio",
  },
  {
    id: "midjourney",
    name: "MidJourney",
    prompt: "Write a MidJourney prompt for this image.",
    provider: "lm_studio",
  },
  {
    id: "danbooru",
    name: "Danbooru Tags",
    prompt:
      "Generate only comma-separated Danbooru tags (lowercase_underscores). Strict order: artist:, copyright:, character:, meta:, then general tags. Include counts (1girl), appearance, clothing, accessories, pose, expression, actions, background. Use precise Danbooru syntax. No extra text.",
    provider: "lm_studio",
  },
  {
    id: "e621",
    name: "e621 Tags",
    prompt:
      "Write a comma-separated list of e621 tags in alphabetical order for this image. Start with the artist, copyright, character, species, meta, and lore tags (if any), prefixed by 'artist:', 'copyright:', 'character:', 'species:', 'meta:', and 'lore:'. Then all the general tags.",
    provider: "lm_studio",
  },
  {
    id: "rule34",
    name: "Rule34 Tags",
    prompt:
      "Write a comma-separated list of rule34 tags in alphabetical order for this image. Start with the artist, copyright, character, and meta tags (if any), prefixed by 'artist:', 'copyright:', 'character:', and 'meta:'. Then all the general tags.",
    provider: "lm_studio",
  },
  {
    id: "booru_like",
    name: "Booru-Like Tags",
    prompt: "Write a list of Booru-like tags for this image.",
    provider: "lm_studio",
  },
  {
    id: "art_critic",
    name: "Art Critic Analysis",
    prompt:
      "Analyze this image like an art critic would with information about its composition, style, symbolism, the use of color, light, any artistic movement it might belong to, etc.",
    provider: "lm_studio",
  },
  {
    id: "product_listing",
    name: "Product Listing",
    prompt: "Write a caption for this image as though it were a product listing.",
    provider: "lm_studio",
  },
  {
    id: "social_media",
    name: "Social Media Post",
    prompt:
      "Write a caption for this image as if it were being used for a social media post.",
    provider: "lm_studio",
  },
  {
    id: "builtin-prose",
    name: "Built-in: Prose",
    prompt:
      "Describe this image in 1-3 natural-language sentences suitable as a training caption. State the main subject first, then key visual details: appearance, clothing, pose, setting, lighting, and style/medium. Use confident, concrete wording. Output ONLY the description — no preamble, no quotes, no phrases like \"This image shows\", and no commentary.",
    provider: "builtin",
  },
  {
    id: "builtin-danbooru",
    name: "Built-in: Danbooru Tags",
    prompt:
      "Output ONLY a comma-separated list of lowercase danbooru-style tags for this image, with underscores instead of spaces (e.g. 1girl, long_hair, blue_eyes, school_uniform, outdoors). Cover subject count, appearance, clothing, accessories, pose, expression, actions, background, and composition. No prose, no sentences, no explanations, no preamble — nothing but the tag list.",
    provider: "builtin",
  },
  {
    id: "builtin-e621",
    name: "Built-in: e621 Tags",
    prompt:
      "Output ONLY a comma-separated list of lowercase e621-style tags for this image, with underscores instead of spaces, using e621/furry vocabulary (e.g. anthro, feral, male, female, canine, felid, fur_color tags, clothing, pose, expression, background, solo/duo/group). No prose, no sentences, no explanations, no preamble — nothing but the tag list.",
    provider: "builtin",
  },
];
