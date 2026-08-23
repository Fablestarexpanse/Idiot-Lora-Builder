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
  BuiltinModelId,
  BuiltinBackend,
  DatasetMeta,
} from "@/types";

/**
 * Tauri invoke payload convention:
 * - There is one rule: each key in the args object is the *Rust parameter name*,
 *   lowerCamelCased. Tauri looks that key up exactly (`ipc/command.rs`) and rejects
 *   the call with "missing required key" if it isn't there — it does not fall back
 *   to snake_case, and it never spreads the object across several parameters.
 * - So `fn open_project(payload: OpenProjectPayload)` takes { payload: { ... } } —
 *   most commands here — `fn export_dataset(options: ExportOptions)` takes
 *   { options: { ... } }, and `fn download_builtin(model_id: String, ...)` takes
 *   { modelId, ... }.
 * - Fields *inside* a payload struct keep their Rust names (snake_case); only the
 *   parameter name is cased by Tauri.
 * - No args: get_resource_stats, cancel_builtin_download, stop_builtin_server,
 *   get_builtin_server_status, open_log_folder.
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

/**
 * Reads a generator's metadata.json from a project folder, if there is one we
 * recognise. Resolves to null for any folder that has none — never throws for
 * a missing or malformed file.
 */
export async function readDatasetMetadata(rootPath: string): Promise<DatasetMeta | null> {
  return invoke<DatasetMeta | null>("read_dataset_metadata", {
    payload: { root_path: rootPath },
  });
}

/**
 * Finds duplicate images. maxDistance 0 (default) matches byte-identical files
 * via SHA-256; above 0 matches perceptually, grouping images whose dHashes are
 * within that many bits so re-encodes and resizes are caught too.
 */
export async function findDuplicates(
  rootPath: string,
  maxDistance = 0
): Promise<FindDuplicatesResult> {
  return invoke<FindDuplicatesResult>("find_duplicates", {
    payload: { root_path: rootPath, max_distance: maxDistance },
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
  return invoke<void>("delete_image", { imagePath });
}

export interface DeleteImagesResult {
  deleted_count: number;
  errors: string[];
}

/** Deletes multiple image files and their caption .txt sidecars from disk. */
export async function deleteImages(paths: string[]): Promise<DeleteImagesResult> {
  return invoke<DeleteImagesResult>("delete_images", {
    payload: { paths },
  });
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
    payload: {
      image_paths: imagePaths,
      target_size: targetSize,
      mode,
      output_folder: outputFolder,
    },
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

// ============ Built-in Captioner ============

export interface BuiltinComponentStatus {
  id: "llama-server" | "model" | "mmproj";
  installed: boolean;
  approx_bytes: number;
  partial_bytes: number;
}

export interface BuiltinStatus {
  ready: boolean;
  components: BuiltinComponentStatus[];
  missing_bytes: number;
  downloading: boolean;
}

/** Payload of the "builtin-download-progress" event emitted during download_builtin. */
export interface BuiltinDownloadProgress {
  component: string;
  phase: "downloading" | "extracting" | "done" | "error" | "cancelled";
  received: number;
  total: number;
  overall_received: number;
  overall_total: number;
  error: string | null;
}

export interface BuiltinServerStatus {
  running: boolean;
  model_id: string | null;
  backend: string | null;
  base_url: string | null;
}

/** Check install status of the built-in captioner components for a model/backend pair. */
export async function getBuiltinStatus(
  modelId: BuiltinModelId,
  backend: BuiltinBackend
): Promise<BuiltinStatus> {
  return invoke<BuiltinStatus>("get_builtin_status", { modelId, backend });
}

/**
 * Download all missing built-in captioner components. Long-running; progress is
 * emitted on the "builtin-download-progress" event. Rejects with an error string
 * (including "cancelled"). Partial files are kept, so re-running resumes.
 */
export async function downloadBuiltin(
  modelId: BuiltinModelId,
  backend: BuiltinBackend
): Promise<void> {
  return invoke<void>("download_builtin", { modelId, backend });
}

/** Cancel an in-progress built-in download (partial files kept for resume). */
export async function cancelBuiltinDownload(): Promise<void> {
  return invoke<void>("cancel_builtin_download");
}

/**
 * Start (or reuse) the local llama-server and wait for the model to load.
 * Returns the base URL (e.g. "http://127.0.0.1:52341"). The first call after
 * startup can take 30-240s while the model loads.
 */
export async function ensureBuiltinServer(
  modelId: BuiltinModelId,
  backend: BuiltinBackend
): Promise<string> {
  return invoke<string>("ensure_builtin_server", { modelId, backend });
}

/** Deletes downloaded model weights (not the server runtime) to free disk space. */
export async function deleteBuiltinModel(modelId: BuiltinModelId): Promise<void> {
  return invoke<void>("delete_builtin_model", { modelId });
}

/** Stop the local llama-server (frees RAM/VRAM). */
export async function stopBuiltinServer(): Promise<void> {
  return invoke<void>("stop_builtin_server");
}

export async function getBuiltinServerStatus(): Promise<BuiltinServerStatus> {
  return invoke<BuiltinServerStatus>("get_builtin_server_status");
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

export interface RatingChange {
  relative_path: string;
  rating: ImageRating;
}

/** Set ratings for multiple images in a single backend write. */
export async function setRatingsBatch(
  rootPath: string,
  changes: RatingChange[]
): Promise<void> {
  return invoke<void>("set_ratings_batch", {
    payload: {
      root_path: rootPath,
      changes,
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

// ============ Fizgig Handoff ============

/** Launches the user's local Fizgig install (LoRA trainer) via its run_fizgig.bat. */
export async function launchFizgig(fizgigPath: string): Promise<void> {
  return invoke<void>("launch_fizgig", {
    payload: { fizgig_path: fizgigPath },
  });
}

/**
 * Clears image + caption files from the top level of a dedicated staging folder
 * (used before re-exporting to Fizgig so stale images never linger). Returns
 * the number of files removed.
 */
export async function clearStagingImages(folder: string): Promise<number> {
  return invoke<number>("clear_staging_images", {
    payload: { folder },
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

/** Get all crop statuses for a project as a map of relative path -> status. */
export async function getCropStatuses(
  rootPath: string
): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_crop_statuses", {
    payload: { root_path: rootPath },
  });
}

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


// ============ Logs ============

/** Open the app's log folder in the system file manager. */
export async function openLogFolder(): Promise<void> {
  return invoke<void>("open_log_folder");
}
