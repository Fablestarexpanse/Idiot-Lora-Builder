import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ImageEntry,
  ImageRating,
  ConnectionStatus,
  CaptionResult,
  BatchCaptionResult,
  ExportOptions,
  ExportResult,
  ExportByRatingOptions,
  BatchRenameOptions,
  BatchRenameResult,
  FaceRegion,
} from "@/types";

/**
 * Tauri invoke payload convention:
 * - Commands that expect { payload: { ... } }: open_project, get_thumbnail, get_image_data_url,
 *   crop_image, read_caption, write_caption, add_tag, remove_tag, reorder_tags,
 *   test_lm_studio_connection, test_ollama_connection, generate_caption_lm_studio, generate_captions_batch,
 *   clear_all_ratings, set_rating, get_ratings, batch_rename.
 * - Commands that expect the args object directly (no "payload" key): find_duplicates, delete_image,
 *   batch_resize, export_dataset, export_by_rating.
 * - No args: get_resource_stats.
 */

export async function openFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
  });
  if (selected === null || Array.isArray(selected)) return null;
  return selected;
}

export async function loadProject(rootPath: string, includeDimensions = false): Promise<ImageEntry[]> {
  return invoke<ImageEntry[]>("open_project", {
    payload: { root_path: rootPath, include_dimensions: includeDimensions },
  });
}

export interface ImageDimensions {
  path: string;
  width: number | null;
  height: number | null;
}

export async function loadImageDimensions(paths: string[]): Promise<ImageDimensions[]> {
  return invoke<ImageDimensions[]>("load_image_dimensions", {
    payload: { paths },
  });
}

export interface FindDuplicatesResult {
  groups: string[][];
}

/** Find duplicate images by file content hash (SHA-256). */
export async function findDuplicates(rootPath: string): Promise<FindDuplicatesResult> {
  return invoke<FindDuplicatesResult>("find_duplicates", {
    root_path: rootPath,
  });
}

// ============ Path-based thumbnail functions (asset protocol — fast) ============

/**
 * Ensures a thumbnail exists on disk and returns a browser-loadable asset URL.
 * Uses Tauri asset protocol — bypasses base64 IPC overhead entirely.
 * The browser loads the image natively with hardware decoding and parallel fetch.
 */
export async function ensureThumbnailUrl(
  path: string,
  size?: number
): Promise<string> {
  const cachePath = await invoke<string>("ensure_thumbnail", {
    payload: { path, size },
  });
  return convertFileSrc(cachePath);
}

export interface ThumbnailPathResult {
  path: string;
  cache_path: string | null;
  error: string | null;
}

/**
 * Batch-ensure thumbnails on disk and return browser-loadable asset URLs.
 * Returns Map<originalPath, assetUrl> for cache seeding.
 */
export async function ensureThumbnailUrlsBatch(
  paths: string[],
  size = 256
): Promise<Map<string, string>> {
  const results = await invoke<ThumbnailPathResult[]>("ensure_thumbnails_batch", {
    payload: { paths, size },
  });
  const map = new Map<string, string>();
  for (const r of results) {
    if (r.cache_path) {
      map.set(r.path, convertFileSrc(r.cache_path));
    }
  }
  return map;
}

/** Load image as data URL for preview/crop (works without asset protocol). */
export async function getImageDataUrl(
  path: string,
  maxSide?: number
): Promise<string> {
  return invoke<string>("get_image_data_url", {
    payload: { path, max_side: maxSide ?? 0 },
  });
}

export interface CropImagePayload {
  image_path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  flip_x?: boolean;
  flip_y?: boolean;
  rotate_degrees?: number;
  /** If true, save to a new file (keeps original). Returns new path. */
  save_as_new?: boolean;
  /** If set, resize output to this size (square) for LoRA/training (e.g. 512 or 1024). */
  output_size?: number | null;
}

/** Crops image. Returns new path when save_as_new is true, else undefined. */
export async function cropImage(
  payload: CropImagePayload
): Promise<string | undefined> {
  return invoke<string | undefined>("crop_image", { payload });
}

/** Deletes an image file and its caption .txt from disk. */
export async function deleteImage(imagePath: string): Promise<void> {
  return invoke<void>("delete_image", { image_path: imagePath });
}

export type BatchResizeMode = "resize" | "center_crop" | "fit";

export interface BatchResizeResult {
  processed_count: number;
  skipped_count: number;
  output_paths: string[];
  error: string | null;
}

/** Batch resize/preprocess images to target size. Outputs to specified folder, copies captions. */
export async function batchResize(
  imagePaths: string[],
  targetSize: number,
  mode: BatchResizeMode,
  outputFolder: string
): Promise<BatchResizeResult> {
  return invoke<BatchResizeResult>("batch_resize", {
    image_paths: imagePaths,
    target_size: targetSize,
    mode,
    output_folder: outputFolder,
  });
}

export async function writeCaption(
  path: string,
  tags: string[]
): Promise<void> {
  return invoke<void>("write_caption", {
    payload: { path, tags },
  });
}

export async function addTag(path: string, tag: string): Promise<string[]> {
  return invoke<string[]>("add_tag", {
    payload: { path, tag },
  });
}

export async function removeTag(path: string, tag: string): Promise<string[]> {
  return invoke<string[]>("remove_tag", {
    payload: { path, tag },
  });
}

export async function reorderTags(
  path: string,
  tags: string[]
): Promise<void> {
  return invoke<void>("reorder_tags", {
    payload: { path, tags },
  });
}

export interface ClearAllCaptionsResult {
  cleared_count: number;
}

export async function clearAllCaptions(
  rootPath: string
): Promise<ClearAllCaptionsResult> {
  return invoke<ClearAllCaptionsResult>("clear_all_captions", {
    payload: { root_path: rootPath },
  });
}

// ============ AI Functions ============

export async function testLmStudioConnection(
  baseUrl: string
): Promise<ConnectionStatus> {
  return invoke<ConnectionStatus>("test_lm_studio_connection", {
    payload: { base_url: baseUrl },
  });
}

export async function testOllamaConnection(
  baseUrl: string
): Promise<ConnectionStatus> {
  return invoke<ConnectionStatus>("test_ollama_connection", {
    payload: { base_url: baseUrl },
  });
}

export async function generateCaptionLmStudio(
  imagePath: string,
  baseUrl: string,
  model: string | null,
  prompt: string,
  maxTokens: number = 1024,
  timeoutSecs: number = 120,
  maxImageDimension: number | null = null
): Promise<CaptionResult> {
  return invoke<CaptionResult>("generate_caption_lm_studio", {
    payload: {
      image_path: imagePath,
      base_url: baseUrl,
      model,
      prompt,
      max_tokens: maxTokens,
      timeout_secs: timeoutSecs,
      max_image_dimension: maxImageDimension ?? undefined,
    },
  });
}

export async function generateCaptionsBatch(
  imagePaths: string[],
  baseUrl: string,
  model: string | null,
  prompt: string,
  maxTokens: number = 1024,
  timeoutSecs: number = 120,
  concurrency: number = 1,
  maxImageDimension: number | null = null
): Promise<BatchCaptionResult[]> {
  return invoke<BatchCaptionResult[]>("generate_captions_batch", {
    payload: {
      image_paths: imagePaths,
      base_url: baseUrl,
      model,
      prompt,
      max_tokens: maxTokens,
      timeout_secs: timeoutSecs,
      max_image_dimension: maxImageDimension ?? undefined,
      concurrency,
    },
  });
}

// ============ Export Functions ============

export async function exportDataset(
  options: ExportOptions
): Promise<ExportResult> {
  return invoke<ExportResult>("export_dataset", { options: options as unknown as Record<string, unknown> });
}

export async function selectSaveFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
  });
  if (selected === null || Array.isArray(selected)) return null;
  return selected;
}

export async function exportByRating(
  options: ExportByRatingOptions
): Promise<ExportResult> {
  return invoke<ExportResult>("export_by_rating", { options: options as unknown as Record<string, unknown> });
}

export async function selectSaveFile(
  defaultName: string
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    defaultPath: defaultName,
    filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
  });
  return selected;
}

// ============ Rating Functions ============

/** Clear all ratings for a project. Returns count of cleared ratings. */
export async function clearAllRatings(rootPath: string): Promise<number> {
  return invoke<number>("clear_all_ratings", {
    payload: { root_path: rootPath },
  });
}

export async function setImageRating(
  rootPath: string,
  relativePath: string,
  rating: ImageRating
): Promise<void> {
  return invoke<void>("set_rating", {
    payload: {
      root_path: rootPath,
      relative_path: relativePath,
      rating,
    },
  });
}

// ============ Batch Rename ============

export async function batchRename(
  options: BatchRenameOptions
): Promise<BatchRenameResult> {
  return invoke<BatchRenameResult>("batch_rename", {
    payload: options,
  });
}

// ============ Face Detection ============

export async function detectFaces(imagePath: string): Promise<FaceRegion[]> {
  return invoke<FaceRegion[]>("detect_faces", {
    payload: { path: imagePath },
  });
}

// ============ Multi-Crop ============

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
  suffix: string;
}

export interface MultiCropPayload {
  image_path: string;
  crops: CropRect[];
  flip_x?: boolean;
  flip_y?: boolean;
  rotate_degrees?: number;
  output_size?: number | null;
}

export async function multiCrop(payload: MultiCropPayload): Promise<string[]> {
  return invoke<string[]>("multi_crop", { payload });
}

// ============ Crop Status Tracking ============

export type { CropStatus } from "@/types";
import type { CropStatus } from "@/types";

export async function setCropStatus(
  rootPath: string,
  relativePath: string,
  status: CropStatus
): Promise<void> {
  return invoke<void>("set_crop_status", {
    payload: {
      root_path: rootPath,
      relative_path: relativePath,
      status,
    },
  });
}

