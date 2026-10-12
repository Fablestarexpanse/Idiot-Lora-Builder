# Fresh-install dependency audit

NEXT: Validate and publish compatible updates. Remaining Tailwind-chain advisories require a separate tested migration; do not hide or suppress them.

User reported the fresh-install console showing setup completed with 12 npm audit warnings. Reproduced 12 affected dependency entries (3 moderate, 9 high); npm audit --omit=dev reports zero. install.bat runs npm install and successfully finishes because this audit report is not an installation error.

Affected packages include @humanfs/node, baseline-browser-mapping, brace-expansion, braces, browserslist, chokidar, fast-glob, js-yaml, micromatch, postcss-selector-parser, source-map-js and tailwindcss. The braces issue has no patched published version (registry latest 3.0.3); npm proposes Tailwind 4 as a major-version replacement for the affected dependency chain. Keep the current Tailwind 3 design compatible, apply available compatible fixes, and report remaining issues accurately.

Sources: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm and https://github.com/advisories/GHSA-rj75-hqrm-r3gf .

Applied npm audit fix without force: 4 packages added, 11 removed, 26 changed in the working installation; committed lockfile contains the compatible dependency refresh. A clean npm ci reproduced 7 affected entries (2 moderate, 5 high). Remaining entries are braces, chokidar, micromatch, fast-glob, postcss-selector-parser, postcss-nested and tailwindcss, all development/build dependencies. Production audit still reports zero. Tailwind remains on 3.4.19. No audit suppression, severity downgrade, major-version override or application code changes. Added README guidance distinguishing setup success from audit notices and acknowledging that run.bat uses the development toolchain.

Verification: clean npm ci succeeded, all 202 frontend tests passed with NODE_OPTIONS=--no-experimental-webstorage for the known Node 25 storage environment issue, production frontend build passed, native desktop build passed, and git diff --check passed. Remaining audit findings are explicitly unresolved.
