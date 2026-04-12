# LoRA Dataset Studio

A desktop app for preparing image datasets for AI training (LoRA, DreamBooth, etc.). Tag and caption images, use local AI (LM Studio or Ollama), and export to folder or ZIP.

![Version](https://img.shields.io/badge/version-0.4.1-blue.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

![LoRA Dataset Studio — main window](assets/screenshot.png)

## Features

- **Grid & ratings** — Open a folder, rate images (Good / Bad / Needs Edit), multi-select, sort by name/size/dimensions, search
- **Tag editing** — Inline captions, right-panel editor, search/replace, trigger word, add-tag-to-all with preview
- **AI captioning** — LM Studio or Ollama; vision models; single or batch; rating filter
- **Preview** — Full-size view with zoom, prev/next, crop; ratings editable in preview
- **Export** — Folder or ZIP; export all, selected, or by rating (good/bad/needs_edit subfolders); trigger word, sequential naming
- **Tools** — Find duplicates, clear all tags (type "clear" to confirm), clear all ratings

## Performance

**Optimized for large datasets (500+ images):**
- Virtual scrolling for smooth rendering with thousands of images
- Lazy-loaded thumbnails with intelligent caching
- Optimistic UI updates for instant rating/caption changes (100x faster)
- Parallel file processing in Rust backend (6x faster duplicate detection)
- Memoized React components to minimize re-renders

## Tech

- **Desktop:** [Tauri 2](https://v2.tauri.app/) (Rust + webview)
- **Frontend:** React 18, TypeScript, Vite, Zustand, TanStack Query, Tailwind
- **Performance:** Virtual scrolling (@tanstack/react-virtual), lazy loading, parallel processing (rayon)

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://rustup.rs/) (stable)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (e.g. WebView2 on Windows, Xcode CLI on macOS)

## Install & run

```bash
git clone https://github.com/Fablestarexpanse/Promptwaffle_LoRa_Organizer_Tagger.git
cd Promptwaffle_LoRa_Organizer_Tagger
npm install
npm run tauri dev
```

First build can take several minutes. Then:

```bash
npm run tauri build
```

Output: `src-tauri/target/release/bundle/` (installers for your platform).

## AI captioning setup

### LM Studio

1. **Download:** [LM Studio](https://lmstudio.ai/) — free, run LLMs locally.
2. **Install** and open LM Studio.
3. **Get a vision model:** Recommended: **mistralai/devstral-small-2-2512**. Search in LM Studio, download it (or another quantized vision model). You need a model that supports images.
4. **Load the model:** In Chat / Load Model, select the model and load it.
5. **Start server:** Open the **Local Server** tab, select your model, click **Start Server**. Default URL: `http://localhost:1234`.
6. **In the app:** AI tab → **LM Studio** → set URL (e.g. `http://localhost:1234`) → **Test** → pick model → **Generate Caption** or **Batch**.

**Links:** [LM Studio](https://lmstudio.ai/) · [Docs](https://lmstudio.ai/docs/) · [Model hub](https://lmstudio.ai/models)

### Ollama

1. **Download:** [Ollama](https://ollama.com/) — install for your OS.
2. **Pull a vision model:** e.g. `ollama pull llava` (or another [vision model](https://ollama.com/library)).
3. **In the app:** AI tab → **Ollama** → URL usually `http://localhost:11434/v1` → **Test** → pick model → **Generate Caption** or **Batch**.

**Links:** [Ollama](https://ollama.com/) · [Library](https://ollama.com/library)

### Tips

- Use a **vision** model (e.g. **mistralai/devstral-small-2-2512**, LLaVA, Llama 3.2 Vision); text-only models won’t caption images.
- **Settings → Preview AI caption before saving** lets you accept/reject before overwriting.
- If captions time out: increase **Request timeout** in the AI panel, set **Max image size for AI** (e.g. 1024), or keep **Batch: concurrent requests** at 1.

## Usage

1. **Open** a folder of images.
2. **Edit tags** — click caption under an image or use the right panel.
3. **Rate** — Good / Bad / Needs Edit (or 1 / 2 / 3 when focused).
4. **AI** — Choose LM Studio or Ollama, Test, then Generate Caption (single) or Batch.
5. **Export** — Export → choose what to export (all, selected, by rating, etc.) → pick destination.

### Shortcuts

| Action            | Shortcut        |
|-------------------|-----------------|
| Navigate grid     | Arrow keys      |
| First / last      | Home / End      |
| Multi-select      | Ctrl+Click      |
| Preview           | Enter / double-click |
| Close             | Escape          |
| Zoom (preview)    | + / −           |
| Prev/next (preview) | ← / →         |
| Undo / redo       | Ctrl+Z / Ctrl+Y |
| Rating 1/2/3      | 1 / 2 / 3 (grid or preview)      |
| Help              | ?               |

## Caption format

One `.txt` per image, same base name; comma-separated tags (e.g. Kohya/OneTrainer compatible):

```
image001.png
image001.txt  →  "trigger_word, tag1, tag2, ..."
```

## Project layout

```
src/           — React app (components, hooks, stores, lib)
src-tauri/     — Rust backend (commands: captions, images, lm_studio, ollama, export, …)
```

## License

MIT — see [LICENSE](LICENSE).
