NEXT: Color bands and group marking verified in the live desktop app; commit locally and report. No push requested for this step.

# Character consistency implementation plan

Approved workflow: choose three references from the dataset, external files, or a mix; scan; suggest statistical outliers; optionally adjust a low-score cutoff; review individual marks; explicitly move marked images and captions into excluded_by_look. Match existing app styling. Never dismiss on outside clicks or Escape. Exclusion is reversible.

Architecture: User ruling: use the same InsightFace buffalo_l models as Fizgig; this tool is noncommercial. Implement SCRFD det_10g and ArcFace w600k_r50 with native Rust ONNX Runtime and five-landmark alignment. No Python, no GPU dependency, no claims of validated nonhuman accuracy. Scores are cosine similarity, not identity probabilities. Match Fizgig: cutoff = max(median - 1.5 IQR, 0.25), at least four scored images. Average similarity against three baselines; protect baselines from suggestions. No-face, error, and multiple-face images require manual review and are never auto-marked. Three unique baselines must each have exactly one face.

Tasks:
- [x] Add SCRFD detector and ArcFace lazy download, alignment, normalized embedding cache, CPU inference; tests for alignment, cosine, and real fixture inference.
- [x] Add async scan/load/cancel and move/undo commands. Results saved atomically under .lora-studio. Validate dataset-relative paths, reject traversal/symlink escape, protect baselines, preserve captions, no overwrite, journal moves for undo. Excluded directory skipped by project scans and duplicate discovery. Tests for exclusions/undo/collisions/corrupt sidecars.
- [x] Add native-style Consistency Check dialog and toolbar entry, baseline picking from selection or files, progress/cancel, lowest-first thumbnails, suggestions/cutoff, mark/keep, preview, confirmation and undo. Results persist; edited/missing files invalidate saved scores. Bind commands through src/lib/tauri.ts.
- [x] Verify targeted interaction tests, full frontend suite/build, backend tests/check, actual model inference and app screenshot where available. Review diff, update changelog and these notes, commit locally.

Sources:
- https://github.com/shootthesound/Fizgig/blob/master/lora_trainer_gui.py#L12762-L13229 (workflow inspiration; no code copied)
- https://github.com/deepinsight/insightface#license
- https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface

Review focus: baseline protection; failures vs no-face; moved files reappearing in recursive scans; nested identical filenames and shared captions; restore collision must not overwrite new user work; stale saved scans after edits; cancellation must not publish partial scores.

## Verification and decisions, 2026-10-11

- The native inference check used installed buffalo_l weights and two public sample faces. Same face cosine = 1.0; Grace Hopper vs Lena cosine = 0.038792714. The ignored real-inference regression was explicitly run with ILB_FACE_MODELS, ILB_ORT_DLL, ILB_TEST_FACE, and ILB_TEST_OTHER_FACE set to the local model/runtime/fixture paths.
- Isolated desktop WebView run scanned nine disposable images. Auto-Suggest marked the different face and one valid low-scoring brightness variant; reviewer kept the valid variant. Moving the different face removed its image and caption from the active dataset, taking the image count from nine to eight. Undo restored both files and returned the count to nine. Escape did not close the dialog.
- Screenshot: C:/Users/Brian/.codex/visualizations/2026/10/11/01a12bac-7d1f-74a3-b941-c2e97fb0d8b9/consistency-check.png
- Frontend: 187 tests passed; production build and focused lint passed. Tests used NODE_OPTIONS=--no-experimental-webstorage due to the host Node localStorage conflict.
- Backend: 76 tests passed, with the model-dependent real inference test run separately and passing. Regression checks cover interrupted link recovery, overwrite refusal, shared caption refusal, baseline/traversal protection, stale scores, and excluded-file scans/exports/caption clearing.
- Independent review found an interrupted hard-link move recovery gap, fixed with journal SHA256 checks and a crash-window regression test. Final focused review reported no remaining material findings. Index-based median and quartiles intentionally match Fizgig exactly.
- Found the user's running checkout at F:/idiot lora builder/Idiot-Lora-Builder, with an existing uncommitted Cargo.toml change. Left it untouched. Implementation remains in F:/Cursor Projects/Lora Dataset Studio. Used an isolated verification server on port 1421 and a separate WebView profile; the user's server on port 1420 was not modified.
- Model weights are reused read-only from the standard .insightface cache when present. The first-use download path uses the official buffalo_l release and extracts only det_10g.onnx and w600k_r50.onnx; that network path was not needed on this machine.

## Visual consistency groups (2026-10-11)
User requested easy visual identification and selection like the existing Good/Bad ratings. Use matching red/amber/green borders and explicit Bad/Middle/Good badges, separate blue mark indicators, and group mark buttons. Bad follows the existing outlier cutoff; Good initially starts at 0.60 and is adjustable; Middle lies between them. These are review bands, not dataset ratings or model confidence. Baselines and unscored/ambiguous faces remain neutral and excluded from group marking. Group buttons replace current marks; moving still requires confirmation.

Verification: all 189 frontend tests passed, production build and focused ESLint passed. Live native desktop showed red Bad, amber Middle and green Good cards; Bad/Good group marking replaced the prior selection, preserving baseline protection. No files moved during this check. Screenshot: consistency-colors.png in the current chat visualization directory.

## Compare toolbar entry (2026-10-11)
User requested the comparison tool beside Batch Rename and Batch Resize. Rename its toolbar entry to Compare, retaining its position immediately after Batch Resize and adding a descriptive tooltip. Allow the toolbar to grow when buttons wrap so lower rows remain visible in narrower windows. Verify in the desktop app and rebuild the launched version.

Verification: production frontend build and desktop build passed. Launched the bundled app at tauri.localhost and verified the visible toolbar order is Batch Rename, Batch Resize, Compare. Saved compare-toolbar.png as live evidence. Updated app remains open for the user.

## Per-box dataset reference picker (2026-10-11)
User requested clicking each reference box to choose from the already-loaded archive while retaining external files as an option. Implement a searchable, paginated thumbnail picker per slot, filled-slot replacement, duplicate prevention, separate preview buttons, and explicit close behavior. Preserve slot positions when filling or clearing them; changed references invalidate old scores.

Verification: 191 frontend tests passed, production build, focused ESLint and bundled desktop build passed. Live native app on a disposable dataset verified per-slot replacement, search, canonical duplicate protection and returning via explicit close. Screenshot: dataset-reference-picker.png. No scans or file moves performed in the live check.
