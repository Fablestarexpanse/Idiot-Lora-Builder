# Changelog

All notable changes to Idiot LoRa Builder (formerly LoRA Dataset Studio) are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Similar-image duplicate detection.** The duplicate finder gains an
  Exact / Similar toggle with a sensitivity slider. Exact (SHA-256,
  byte-identical) stays the default; Similar uses a perceptual hash, so a
  re-encoded, resized or lightly cropped copy is grouped too — cases the
  content hash sees as unrelated files.
- **Trigger word picked up from a generated dataset.** Opening a folder that
  carries a generator's `metadata.json` (currently
  [Dataset Deviser](https://github.com/EnragedAntelope/dataset-deviser))
  offers the trigger word it recorded, instead of asking you to retype it.
  Dismissible, never shown twice for the same folder, and skipped entirely
  when the trigger word is locked. A missing or malformed `metadata.json` is
  ignored and can never stop a folder opening.

### Fixed

- **Duplicate finder reported absolute paths instead of relative ones.** The
  scan walked the raw project root while stripping the canonicalized one, so
  the two disagreed whenever they differed — which on Windows is every scan,
  because `canonicalize()` always returns a `\\?\` path. Deleting a duplicate
  then resolved to a doubled path like `C:\ds\C:/ds/a.png`. Now walks from
  the canonical root, matching `open_project`, `captions.rs` and `export.rs`.
- **Find duplicates and single-image delete never reached the backend.** Both
  passed their arguments under the wrong key, so Tauri rejected the call with
  "missing required key" before the command ran: the duplicate scan failed
  outright, and the grid tile's delete button (and the duplicate finder's own
  per-file delete) did nothing.

## [0.7.0] - 2026-08-17

Renamed to **Idiot LoRa Builder** (new unicorn logo, app icon, window title;
formerly LoRA Dataset Studio). Double-click `install.bat` / `run.bat`
launchers added for easy setup on Windows.

### Added

- **Crop tool rebuilt for LoRA prep.** Bucket chips now set *ratio* (largest
  fitting box, anchored on the detected face) instead of tiny absolute-pixel
  patches; a live readout shows the crop's ratio, its nearest bucket for your
  trainer profile, and whether the trainer would upscale it; output sizing is
  honest (keep original / fit longest side); multi-crop is now three
  toggleable face-aware framings (full / waist-up / face close-up); new SD 3.5
  and Illustrious/Pony profiles plus save-your-own custom profiles.
- **kohya (sd-scripts) export preset**: `<N>_<concept>/` repeat-count folder
  layout with optional generated `dataset.toml` built from your selected
  trainer profile's bucket config.
- **Dataset stats upgrades**: clickable top-20 tag frequency (filters the
  grid), rating breakdown, dataset size on disk, and a correct
  divisible-by-64 dimension warning.
- **Working `?` shortcut** opens keyboard help (was documented but never
  implemented); shortcuts are handled by one central keymap.
- **Success toasts** with a small queue — long operations now confirm
  consistently instead of only surfacing errors.
- **Unified undo**: search & replace, add-tag-to-all, and trigger-word batch
  edits now share the same Ctrl+Z history as single tag edits — one keystroke
  reverts a whole batch.
- **Logging**: failures in the captioner, model downloads, exports, and
  sidecar persistence are written to a log file (Settings → About → Open log
  folder).
- **Batch operations on multi-select**: Shift+Click range select, Ctrl+A
  select-all-visible, Escape clears selection; pressing 1/2/3 with a
  multi-selection rates every selected image at once; a Delete button in the
  filter bar removes the whole selection (with confirmation).
- **Batch resize UI**: resize / center-crop / fit to a target size
  (512/768/1024 presets) for all, selected, or Good-rated images — the backend
  existed since v0.5 but had no UI.
- **Caption customizer**: caption length control (Short/Medium/Long) and a
  collapsible "Extra instructions" panel with 26 toggleable prompt options
  (lighting, camera angle, shot type, PG vs. blunt language, refer-by-name, …).
- **Duplicate finder actions**: thumbnails and full paths per group, per-file
  delete, and a "Keep largest" quick action — previously view-only.
- **Crop-status filtering**: crop statuses now load from disk into the grid
  and can be filtered via new chips (previously write-only data).
- **Delete downloaded model** button in the built-in captioner setup to
  reclaim disk space.
- **Send to Fizgig**: handoff to a local
  [Fizgig](https://github.com/shootthesound/Fizgig) install (LoRA training
  workbench). A dialog lets you name the dataset and choose what to include
  (by rating / all images / current selection); images + captions export into
  Fizgig's own `dataset/<name>` folder (cleared on each send so demoted images
  never linger), Fizgig launches, and the path is copied to the clipboard for
  its Start tab. Configure the Fizgig folder under Settings → Integrations.

### Fixed

- **Crop correctness**: flipped previews now crop exactly what you framed
  (coordinates were mirrored); crop statuses no longer vanish after each crop;
  thumbnails refresh immediately after cropping; aspect lock holds while
  dragging; outputs use Lanczos resampling at JPEG quality 92, preserve
  transparency, honor EXIF orientation, and never upscale; batch-resize
  center-crop no longer zooms into a tiny center patch.
- AI-generated captions (single and batch) now keep the configured trigger
  word as the first tag; previously it was silently dropped until the caption
  was manually edited.
- "Send to Fizgig" failed silently due to Windows `start` command quoting;
  Fizgig now launches reliably in its own console window.
- The test suite's component tests never ran (config excluded .tsx and lacked
  a DOM environment); fixed. Coverage grew from 18 frontend tests to 167,
  plus the codebase's first 47 Rust tests (export path traversal, atomic
  sidecar persistence, rename collision checks, crop math).
- CI's Rust job referenced a nonexistent GitHub action and had failed since
  creation; repaired, with Tauri Linux deps, caching, and `cargo test`.

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
