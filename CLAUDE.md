# CLAUDE.md

LoRA Dataset Studio — Tauri v2 desktop app for tagging/curating image datasets for LoRA training.
Frontend: React 18 + TypeScript + Vite + Tailwind + Zustand + TanStack Query. Backend: Rust in `src-tauri/`.

## Commands

```bash
npm run dev            # Vite only (browser, no Tauri backend)
npm run tauri dev      # full app
npm run build          # tsc -b && vite build (type-checks everything)
npm run tauri build    # release bundles -> src-tauri/target/release/bundle/
npx vitest run         # frontend tests (also: npm run test:run)
npm run lint           # eslint, --max-warnings 0
cd src-tauri && cargo check   # backend type-check (cargo test for backend tests)
```

## Architecture map

- `src/lib/tauri.ts` — every backend call goes through here. Read its header comment: some
  commands take `{ payload: {...} }`, others take args directly. Keep new wrappers consistent.
- `src/stores/` — Zustand stores: projectStore, selectionStore, filterStore, settingsStore,
  aiStore, cropStore, historyStore, uiStore, gridMetricsStore, projectLoadStore, searchReplaceStore.
- `src/hooks/useProject.ts` — the react-query image list; `src/components/` grouped by feature
  (grid, editor, preview, ai, export, rename, filter, project, layout, settings, help).
- `src-tauri/src/commands/` — one module per feature: project, images (thumbnails, crop,
  multi_crop, batch_resize, delete), captions, ratings, crop_status, export, batch_rename,
  lm_studio, ollama, detect.

## Hard-won conventions (do not regress)

### 1. Async commands
Tauri v2 runs sync commands on the main thread — a blocking sync command freezes the UI.
Every heavy command must be `async` and wrap its blocking body in
`tauri::async_runtime::spawn_blocking(move || ...)`. See `detect.rs` or `images.rs` for the pattern.

### 2. Thumbnail pipeline
- Rust writes JPEG thumbs to `$TEMP/lora-dataset-studio-thumbnails`; the frontend loads them
  via the asset protocol with `convertFileSrc` (no base64 IPC). Asset scope is `$TEMP/**` in
  `tauri.conf.json` — keep the cache under temp.
- Request sizes must snap to `THUMB_SIZE_BUCKETS` in `src/lib/gridThumbnail.ts`.
  `alignThumbRequestSize` must stay idempotent (aligning an already-aligned size returns the
  same value) or resizes regenerate every visible thumbnail.
- Generation is deduped via `ensure_thumbnail_file` + `THUMB_INFLIGHT` in
  `src-tauri/src/commands/images.rs` — route new thumbnail paths through it, don't bypass.

### 3. Sidecar JSON (ratings, crop status)
Project metadata lives in `<project>/.lora-studio/` (`ratings.json`, `crop_status.json`);
captions are per-image sidecar `.txt` files. Writes must be atomic: write to a tmp file, then
rename over the target. On load, a *missing* file yields the empty default, but a file that
exists and fails to parse is an error — never overwrite user data with an empty default after
a parse failure. Load-modify-save sections are serialized (`RATINGS_LOCK` in `ratings.rs`).

### 4. react-query cache
Image list query key is `["project", "images", rootPath]`. For per-image edits (rating,
caption, crop status) prefer `setQueryData` merges over full `invalidateQueries` — invalidation
refetches the whole project and thrashes the grid. Full invalidation is fine for bulk ops
(clear-all, batch rename).

## Built-in captioner (v0.6.0)

- `models.rs` downloads the llama.cpp server runtime (pinned release tag) and Qwen3-VL GGUF
  weights into `app_local_data_dir()/builtin/` with resume + progress events;
  `llama_server.rs` manages the sidecar process and returns an OpenAI-compatible base URL.
  The frontend reuses the existing LM Studio caption commands against that URL — do not add
  a parallel caption client.
- `detect_faces` runs real YuNet ONNX inference via `ort` (model auto-downloaded, session
  cached globally). Failures return an empty list, never fabricated regions.

## Honesty notes

- `batch_resize` exists in the backend (`images.rs`) and `src/lib/tauri.ts` but has **no UI**.

## Misc

- `vitest.config.js` / `vitest.config.d.ts` at repo root are `tsc -b` build artifacts of
  `vitest.config.ts` — ignored by git; never edit them by hand.
- Frontend never touches the filesystem directly; add capability via a new Tauri command.
