# Changelog

All notable changes to LoRA Dataset Studio are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Send to Fizgig** toolbar button: exports only your **Good-rated** images
  (with captions) to a dedicated `<project>_fizgig` staging folder — cleared on
  each send so demoted images never linger — then launches your local
  [Fizgig](https://github.com/shootthesound/Fizgig) install (LoRA training
  workbench) with the staging path copied to the clipboard for Fizgig's Start
  tab. Configure the Fizgig folder under Settings → Integrations.

## [0.6.0] - 2026-08-11

### Added

- **Built-in local AI captioner.** No more external LM Studio/Ollama setup
  required: pick "Built-in (local)" as the caption provider and the app
  downloads everything itself — the llama.cpp server runtime plus a quantized
  Qwen3-VL vision model (8B recommended, ~5.8 GB; or 4B lighter, ~3 GB).
  Nothing downloads until you click the button; downloads show progress, can be
  cancelled, and resume where they left off. Runs on GPU via Vulkan
  (NVIDIA/AMD/Intel) or CPU-only. The server starts on demand on a private
  localhost port, can be stopped from the panel to free memory, and is shut
  down with the app. Single-image and batch captioning both work with it.
- **Caption style presets:** three new built-in prompt templates — Prose
  (natural language), Danbooru tags, and e621 tags — matching what tag-trained
  base models expect.
- **Real face detection.** The crop tool's auto-centering now uses the YuNet
  ONNX face detector (model + ONNX Runtime downloaded on first use, ~80 MB
  total) with real confidence scores and non-max suppression, replacing the
  previous placeholder that always returned a centered box. On any failure it
  reports no faces instead of fake data.

## [0.5.0] - 2026-08-11

Major performance overhaul and full-codebase audit. Large datasets now load
dramatically faster and the UI stays responsive throughout.

### Performance

- **All heavy backend commands moved off the main thread.** Previously every
  command ran synchronously on the app's main thread, so opening a large folder
  or generating thumbnails froze the entire app. Project scan, thumbnail
  generation, crops, batch resize, exports, batch rename, captioning, and
  duplicate detection now run on background threads.
- **Parallel project scan.** Caption files and metadata are read across all CPU
  cores instead of one file at a time.
- **Thumbnail size buckets.** Thumbnail requests snap to fixed sizes
  (128–1536px) instead of tracking the exact cell width, so resizing the window
  no longer regenerates every thumbnail; the disk cache stays valid.
- **Deduplicated thumbnail generation.** The grid prefetcher and per-cell
  requests no longer decode the same image twice concurrently; cache files are
  written atomically.
- Image dimensions now load lazily in the background after the scan (this also
  makes "sort by dimension" actually work).
- Removed the artificial 2.5-second delay after opening a project.
- Reduced unnecessary re-renders in the AI panel, sidebar, tag editor, and grid
  debug panel; batch captioning updates the grid incrementally instead of
  refetching the whole project.

### Fixed

- **Ratings/crop-status data loss:** a corrupt or momentarily unreadable
  `ratings.json` previously loaded as empty and was overwritten on the next
  write, silently wiping all ratings. Sidecar JSON files are now written
  atomically, never overwritten after a failed parse, serialized against
  concurrent writes, and backed up before "clear all" operations.
- "Clear all tags" no longer creates empty `.txt` files for images that never
  had captions, and no longer aborts partway on the first error.
- Batch rename validates the whole batch for filename collisions before
  renaming anything, and surfaces metadata-save failures instead of reporting
  success.
- Export: closed a path traversal hole (crafted `../` paths could read files
  outside the project) and fixed silent overwrites when files in different
  subfolders shared a name.
- Trigger word: no longer produces `"trigger, "` on empty captions or a doubled
  trigger on re-export; the auto-apply no longer fires overlapping
  whole-dataset writes.
- Undo/redo now updates the visible tag list (previously only the file on disk
  changed).
- Preview and crop modals navigate the same filtered/sorted order as the grid,
  and the image counter is correct under active filters.
- Crop tool: resizing the crop box no longer snaps it back onto the detected
  face region; failed crop-status writes no longer silently block the modal.
- Rating keyboard shortcuts (1/2/3) no longer have a second, conflicting
  implementation in the preview modal.
- Newly shipped default AI prompt templates now appear for existing users
  (previously hidden by persisted settings).
- Failed file writes across the app now show an error toast instead of failing
  silently.
- Settings dialog shows the real app version.

### Security

- Added a Content-Security-Policy (previously none).
- Shell-open permission narrowed to http/https URLs.
- LM Studio/Ollama base URLs are validated before use.

### Changed

- UI vocabulary standardized on "tags" (formerly a mix of "prompts"/"tags").
- Shared HTTP client for AI providers (connection reuse).
- Consolidated duplicated backend helpers into a common module; extracted
  shared frontend helpers for filtering/sorting, term highlighting, and modal
  shells (with consistent focus trapping and Escape handling).
- Rewrote README with accurate features, data locations, and architecture;
  added CLAUDE.md with development conventions.

### Known limitations

- Face detection in the crop tool is a placeholder: it returns a centered
  region, not real detection.
- Batch resize exists in the backend but has no UI yet.

## [0.4.1] and earlier

No changelog was kept before 0.5.0.
