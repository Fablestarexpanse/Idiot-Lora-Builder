# README Compare walkthrough (2026-10-11)

NEXT: Documentation and screenshot verification complete; commit and push the README update to main.

User requested new README image examples showing how to use the latest features. Capture three real screenshots from the current bundled desktop build: per-slot dataset reference picker, comparison review with Good/Bad/Needs Edit overrides and apply actions, and saved ratings on the main grid. Refresh the README hero screenshot too. Use only a disposable demo dataset with brightness variants of the public-domain Grace Hopper U.S. Navy portrait; do not publish personal dataset images. Credit the source and explicitly describe the sample as a controls demonstration, not a varied training set or accuracy benchmark.

Document both external and loaded-dataset references, adjustable cutoffs, selection versus ratings, explicit apply-all/selected writes and overwriting existing ratings only for applied images. Clarify protected baselines and manual review for ambiguous/unscored results. Correct the README version badge to the existing 0.7.0 package version and the dialog-close instructions to the current X-button behavior.

Verified all four README screenshots exist and are valid 1280x1080 PNGs; inspected them visually after waiting for thumbnails. Screenshots show the latest native app, including a real eight-image scan and four saved ratings. Checked all local README image references and `git diff --check`. No application code changed.

## Joan set screenshots
User corrected the screenshot choice: use the Joan set currently loaded in the app. Located the loaded folder through the app profile and copied its 70 image files to a disposable temporary Joan folder for screenshot capture. Leave the user's open app, originals and ratings unchanged. Use front/three-quarter/expression references from this actual character set. Replace all four demo screenshots and remove the Grace Hopper demo attribution.

Verified the Joan copy scan: 70 images, 68 scored faces, 64 eligible ratings saved only in the temporary copy. Captured references, reviewed suggestions with two manual overrides, and main-grid ratings. Limited the screenshot-session caption preview to Good so its green highlight does not obscure Bad/Needs Edit borders. Original Joan folder still has no .lora-studio metadata, and the original app process remains open and responsive. All four screenshots were visually checked and all README image paths validated.
