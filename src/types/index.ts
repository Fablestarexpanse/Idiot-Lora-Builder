/** Subset of a generator's metadata.json that we offer to reuse. */
export interface DatasetMeta {
  generator: string | null;
  trigger: string | null;
  character_name: string | null;
  dataset_type: string | null;
  caption_style: string | null;
}

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
  category?: "lora" | "caption" | "writing";
  description?: string;
  contextKind?: "signature_outfit" | "outfit" | "object";
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
  { id: "no_fixed_attributes", label: "Omit unchangeable attributes (ethnicity, gender)", text: "Do NOT include information about people/characters that cannot be changed (like ethnicity, gender, etc), Describe variable attributes only when they do not conflict with the selected preset’s fixed identity rules." },
  { id: "lighting", label: "Include lighting", text: "Include information about lighting." },
  { id: "camera_angle", label: "Include camera angle", text: "Include information about camera angle." },
  { id: "watermark", label: "Include watermark info", text: "Include information about whether there is a watermark or not." },
  { id: "jpeg_artifacts", label: "Include JPEG artifacts info", text: "Include information about whether there are JPEG artifacts or not." },
  { id: "camera_details", label: "Describe visible photographic effects", text: "Describe visible photographic effects such as motion blur or shallow depth of field. Do not guess the camera, lens, aperture, shutter speed, or ISO." },
  { id: "pg", label: "Keep it PG", text: "Do NOT include anything sexual; keep it PG." },
  { id: "no_resolution", label: "Do not mention resolution", text: "Do NOT mention the image's resolution." },
  { id: "aesthetic_quality", label: "Include aesthetic quality", text: "You MUST include information about the subjective aesthetic quality of the image from low to very high." },
  { id: "composition", label: "Include composition style", text: "Include information on the image's composition style, such as leading lines, rule of thirds, or symmetry." },
  { id: "no_text_in_image", label: "Do not mention text in image", text: "Do NOT mention any text that is in the image." },
  { id: "depth_of_field", label: "Specify depth of field", text: "Specify the depth of field and whether the background is in focus or blurred." },
  { id: "lighting_sources", label: "Mention lighting sources", text: "Describe visible lighting and visible light sources without guessing hidden equipment." },
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

export const CHARACTER_LORA_PROMPT = `You are an image captioning assistant preparing a training dataset for a character LoRA (Krea2 / FLUX-based model, natural-language captions).

For each image, write exactly one caption as a single flowing sentence. Never prefix the caption with a number, letter, bullet, dash, label, or list marker. Never number captions or include image indices, even when processing multiple images. Do not use comma-separated tag lists or line breaks within a caption. Express any necessary visible quantities in words rather than numerals.

Describe ONLY what changes from image to image:
Framing/shot type based on what is actually visible (close-up, waist-up, three-quarter-length, full-body); do not call a cropped view full-body
Pose and action
Facial expression and gaze direction, only when visible
Camera angle (eye-level, low angle, high angle, from behind, profile)
Clothing/outfit, including material and color — or state plainly "nude" / "wearing a gray bodysuit" for reference shots
Lighting condition and direction, using literal descriptions of visible effects and light sources without inventing a lighting setup
Setting/background
Any props or interaction with the environment

Do NOT describe:
The character's fixed physical identity — species traits, face shape, ears, tail, permanent markings, tattoos, eye color, hair color/style (unless it changes between shots). These are intended to associate with the trigger token; omit them to focus captions on changing details.
Art-style or quality filler words ("high quality", "detailed", "masterpiece", etc.)
Anything not actually visible in the frame; do not infer props, movement, expressions, or hidden body parts

Be literal and neutral. For nude reference/anatomy shots, describe pose and framing plainly and clinically (e.g. "standing nude in a neutral A-pose against a plain background") with no stylistic embellishment.

Output only the caption text, beginning directly with the descriptive sentence — no numbering, list markers, preamble, filename, heading, label, quotation marks, or explanation.`;

export const CHARACTER_LORA_SIGNATURE_OUTFIT_PROMPT = `You are an image captioning assistant preparing a training dataset for a character LoRA (Krea2 / FLUX-based model, natural-language captions) whose signature outfit should be part of the character's learned identity.

For each image, write exactly one caption as a single flowing sentence. Never prefix it with a number, letter, bullet, dash, label, or list marker. Never include image indices, comma-separated tag lists, or line breaks within a caption. Express visible quantities in words rather than numerals.

Treat the character's fixed physical appearance AND signature outfit as identity features intended to bind to the trigger token. Do not describe the signature clothing, armor, uniform, footwear, or permanently worn accessories, including their components, colors, materials, patterns, or trim. This applies even when only part of the outfit is visible. Do not substitute generic outfit descriptions such as "wearing armor" or "in a dress".

Describe ONLY changing visible details:
Framing and shot type, based on what is actually in the frame (close-up, waist-up, three-quarter-length, full-body)
Pose and action, including hand placement and body orientation
Facial expression and gaze direction, only when visible
Camera angle (eye-level, low angle, high angle, rear view, profile)
Lighting condition and direction, using literal descriptions such as soft window light, overcast daylight, candlelight, or screen light; do not invent a lighting setup
Setting and background
Held props and interactions with the environment

Do NOT describe fixed identity traits such as species, face shape, ears, tail, permanent markings, tattoos, eye color, or the usual hair color and style. Do not use art-style or quality filler such as "high quality", "detailed", or "masterpiece". Do not infer actions, props, motion, or facial expressions that are not visible. Do not call a cropped view full-body.

Use the supplied Signature outfit description as reference context for identifying the intended outfit. Do not copy this description into the caption. Do not assume the outfit is present when it is not. If an image clearly shows a different outfit, describe that alternate outfit literally. For nude reference images, state "nude" and describe pose and framing clinically. If the outfit is outside the frame, do not mention clothing at all.

Be literal and neutral. Describe what the character is doing without describing the signature outfit itself; for example, "standing with arms crossed against a plain wall" or "sitting beside a window holding an open book". Do not invent a trigger word or character name; the application handles the configured trigger separately.

Output only the caption text, beginning directly with the descriptive sentence, with no numbering, list markers, preamble, filename, heading, label, quotation marks, or explanation.`;

export const CAPTION_ACCURACY_RULES = `Describe only visible evidence. Do not invent identities, props, actions, expressions, hidden details, camera settings, or lighting equipment. Use framing that matches the actual crop. Omit uncertain details rather than guess. Output only the requested caption or tags, with no preamble, headings, numbering, explanation, or generation parameters. Do not invent a trigger word; the application adds the configured trigger separately.`;

export const GENERAL_CAPTION_PROMPT = `Write a concise factual natural-language training caption describing the visible subject, pose or action, clothing, setting, lighting and relevant composition. Avoid quality filler and subjective evaluation. This is a general caption, so describe visible appearance; use a dedicated LoRA preset when fixed identity, outfit, object or style details should be excluded. ${CAPTION_ACCURACY_RULES}`;

export const STYLE_LORA_PROMPT = `Prepare a natural-language caption for a style LoRA. Write one flowing sentence describing the depicted content: subjects, visible appearance and clothing, actions, expressions, props, layout, setting and lighting. The recurring visual treatment is the concept to learn, so do not repeatedly name or analyze the art style, rendering technique, brushwork, quality, artist, or aesthetic. Describe changing content rather than critique the image. If text is clearly legible and relevant, transcribe it literally. ${CAPTION_ACCURACY_RULES}`;

export const OUTFIT_LORA_PROMPT = `Prepare a natural-language caption for an outfit or armor LoRA that should reproduce one target outfit across different wearers. Write one flowing sentence. Use the supplied Target outfit description to identify the outfit being learned. Do not describe that outfit's fixed shape, parts, materials, colors, patterns, logos, trim, or footwear included in the target. Caption the changing wearer, visible hairstyle, expression, pose, view, framing, lighting, background, held props and other clothing outside the target. Do not bind a particular wearer's identity to the outfit by omitting every wearer attribute. If the target is absent, state that it is not visible and describe the actual clothing rather than claiming it is present. Do not infer covered anatomy. ${CAPTION_ACCURACY_RULES}`;

export const OBJECT_LORA_PROMPT = `Prepare a natural-language caption for a LoRA of a specific object or product design. Write one flowing sentence. Use the supplied Target object description to identify the learned object. Refer to it by a generic class such as "the teapot" rather than repeating its fixed design, materials, colors, patterns, logos, brand, or unique markings. Describe changing view, orientation, placement, visible quantity, framing, lighting, environment, other objects, and interactions with people. If the target is absent, state that it is not visible rather than pretending it is present. Do not invent advertising claims, performance, ingredients, function, or specifications. ${CAPTION_ACCURACY_RULES}`;

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "character_lora",
    name: "Character LoRA",
    category: "lora",
    description: "Keep character likeness while allowing outfits to change.",
    prompt: CHARACTER_LORA_PROMPT,
    provider: "lm_studio",
  },
  {
    id: "character_lora_signature_outfit",
    name: "Character LoRA — Signature Outfit",
    category: "lora",
    contextKind: "signature_outfit",
    description: "Learn the character and recurring outfit together; caption changing scenes.",
    prompt: CHARACTER_LORA_SIGNATURE_OUTFIT_PROMPT,
    provider: "lm_studio",
  },
  {
    id: "style_lora",
    name: "Style LoRA",
    category: "lora",
    description: "Learn an art style while describing changing subjects, actions and scenes.",
    prompt: STYLE_LORA_PROMPT,
    provider: "lm_studio",
  },
  {
    id: "outfit_lora",
    name: "Outfit / Armor LoRA",
    category: "lora",
    contextKind: "outfit",
    description: "Learn one outfit across different wearers.",
    prompt: OUTFIT_LORA_PROMPT,
    provider: "lm_studio",
  },
  {
    id: "object_lora",
    name: "Object / Product LoRA",
    category: "lora",
    contextKind: "object",
    description: "Learn a specific object design across views and surroundings.",
    prompt: OBJECT_LORA_PROMPT,
    provider: "lm_studio",
  },
  {
    id: "descriptive",
    name: "Descriptive",
    category: "caption",
    description: "General factual caption; describes appearance and clothing.",
    prompt: GENERAL_CAPTION_PROMPT,
    provider: "lm_studio",
  },
  {
    id: "straightforward",
    category: "caption",
    name: "Straightforward",
    prompt:
      "Write a straightforward caption for this image. Begin with the main subject and medium. Mention pivotal elements—people, objects, scenery—using confident, definite language. Focus on concrete details like color, shape, texture, and spatial relationships. Show how elements interact. Omit mood and speculative wording. If text is present, quote it exactly. Note any watermarks, signatures, or compression artifacts. Never mention what's absent, resolution, or unobservable details. Vary your sentence structure and keep the description concise, without starting with \"This image is…\" or similar phrasing." + " " + CAPTION_ACCURACY_RULES,
    provider: "lm_studio",
  },
  {
    id: "stable_diffusion",
    category: "writing",
    name: "Stable Diffusion Prompt",
    prompt:
      "Output a stable diffusion prompt that is indistinguishable from a real stable diffusion prompt.",
    provider: "lm_studio",
  },
  {
    id: "midjourney",
    category: "writing",
    name: "MidJourney",
    prompt: "Write a MidJourney prompt for this image.",
    provider: "lm_studio",
  },
  {
    id: "danbooru",
    category: "caption",
    name: "Danbooru Tags",
    prompt:
      "Generate only comma-separated Danbooru tags (lowercase_underscores). Strict order: artist:, copyright:, character:, meta:, then general tags. Include counts (1girl), appearance, clothing, accessories, pose, expression, actions, background. Use precise Danbooru syntax. Omit artist, copyright and character identity tags unless explicitly supplied; never guess them. No extra text." + " " + CAPTION_ACCURACY_RULES,
    provider: "lm_studio",
  },
  {
    id: "e621",
    category: "caption",
    name: "e621 Tags",
    prompt:
      "Write a comma-separated list of e621 tags in alphabetical order for this image. Start with the artist, copyright, character, species, meta, and lore tags (if any), prefixed by 'artist:', 'copyright:', 'character:', 'species:', 'meta:', and 'lore:'. Then all the general tags. Omit artist, copyright, character, meta or lore attribution unless explicitly supplied; never guess names or provenance." + " " + CAPTION_ACCURACY_RULES,
    provider: "lm_studio",
  },
  {
    id: "rule34",
    category: "caption",
    name: "Rule34 Tags",
    prompt:
      "Write a comma-separated list of rule34 tags in alphabetical order for this image. Start with the artist, copyright, character, and meta tags (if any), prefixed by 'artist:', 'copyright:', 'character:', and 'meta:'. Then all the general tags. Omit artist, copyright, character, meta or lore attribution unless explicitly supplied; never guess names or provenance." + " " + CAPTION_ACCURACY_RULES,
    provider: "lm_studio",
  },
  {
    id: "booru_like",
    category: "caption",
    name: "Booru-Like Tags",
    prompt: "Output only comma-separated lowercase booru-style tags with underscores instead of spaces. Cover visible subject count, appearance, clothing, pose, expression, actions and background. Use only supported tags; do not invent artist, copyright, franchise or character names." + " " + CAPTION_ACCURACY_RULES,
    provider: "lm_studio",
  },
  {
    id: "art_critic",
    category: "writing",
    name: "Art Critic Analysis",
    prompt:
      "Analyze this image like an art critic would with information about its composition, style, symbolism, the use of color, light, any artistic movement it might belong to, etc.",
    provider: "lm_studio",
  },
  {
    id: "product_listing",
    category: "writing",
    name: "Product Listing",
    prompt: "Write a caption for this image as though it were a product listing.",
    provider: "lm_studio",
  },
  {
    id: "social_media",
    category: "writing",
    name: "Social Media Post",
    prompt:
      "Write a caption for this image as if it were being used for a social media post.",
    provider: "lm_studio",
  },
  {
    id: "builtin-prose",
    category: "caption",
    name: "Built-in: Prose",
    prompt:
      "Describe this image in 1-3 natural-language sentences suitable as a training caption. State the main subject first, then key visual details: appearance, clothing, pose, setting, lighting, and style/medium. Use confident, concrete wording. Output ONLY the description — no preamble, no quotes, no phrases like \"This image shows\", and no commentary." + " " + CAPTION_ACCURACY_RULES,
    provider: "builtin",
  },
  {
    id: "builtin-danbooru",
    category: "caption",
    name: "Built-in: Danbooru Tags",
    prompt:
      "Output ONLY a comma-separated list of lowercase danbooru-style tags for this image, with underscores instead of spaces (e.g. 1girl, long_hair, blue_eyes, school_uniform, outdoors). Cover subject count, appearance, clothing, accessories, pose, expression, actions, background, and composition. No prose, no sentences, no explanations, no preamble — nothing but the tag list." + " " + CAPTION_ACCURACY_RULES,
    provider: "builtin",
  },
  {
    id: "builtin-e621",
    category: "caption",
    name: "Built-in: e621 Tags",
    prompt:
      "Output ONLY a comma-separated list of lowercase e621-style tags for this image, with underscores instead of spaces, using e621/furry vocabulary (e.g. anthro, feral, male, female, canine, felid, fur_color tags, clothing, pose, expression, background, solo/duo/group). No prose, no sentences, no explanations, no preamble — nothing but the tag list." + " " + CAPTION_ACCURACY_RULES,
    provider: "builtin",
  },
];
