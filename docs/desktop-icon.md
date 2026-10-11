# Desktop icon visibility (2026-10-11)

NEXT: Windows executable rebuilt successfully and embedded icon verified; commit the icon update locally and report.

User requested a more visible desktop/taskbar icon featuring just the unicorn. Existing icon contains a speech bubble and large white margins. Use the existing mascot identity as the reference for a transparent unicorn-head-only asset, enlarged to fill the square. Preserve the full logo and original source as branding assets. Generate platform icon sizes with the existing Tauri CLI.

Created assets/unicorn-icon.png using built-in imagegen, with genuine transparent background. Prompt: isolate the existing goofy unicorn head, preserving purple mane, rainbow horn, star eye and smile; remove speech bubble, writing, hand and body; fill nearly the whole square with safe transparent margins and crisp outlines for small desktop sizes.

Rebuild icons with `npx tauri icon assets/unicorn-icon.png`. Verified the actual 32px asset visually, multi-resolution ICO includes 32px and 256px, and `cargo build --manifest-path src-tauri/Cargo.toml --no-default-features` passed. Extracted the Windows executable icon for visual verification. Existing installed/running copies receive the new icon when rebuilt/updated.

The first incremental build retained the previous Windows resource. Forcing the build script to rerun embedded the new unicorn, verified by extracting from a fresh executable path. Added an explicit Cargo watch for the icons directory so future icon changes rebuild resources automatically.
