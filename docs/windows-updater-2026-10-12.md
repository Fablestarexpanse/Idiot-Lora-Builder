# Windows updater

NEXT: Verification complete; publish the Windows updater.

User wants a batch command to check GitHub and update without repeated manual downloads. Add update.bat with a Windows PowerShell helper. Only fast-forward origin/main, refuse tracked edits, local commits, wrong repositories/branches and a running copy. Refresh dependencies with npm ci, including retries after a failed installation. Never reset, stash or delete user work. ZIP downloads get a separate Git clone beside the original; datasets inside the old folder stay there and can be reopened in the new copy. Git, Node and Rust must be installed. Existing app settings and models live outside the checkout.

Verification: scripts/test-update.ps1 passed with disposable local repositories and real Git/npm commands. Covered fast-forward updates, already-current runs, tracked edits, untracked conflicts, fetch failures, non-main branches, unpublished commits, wrong repositories, ZIP migration, an existing migration destination, and dependency-install failure followed by successful retry. The batch entry point also ran successfully from an unrelated working directory. No product datasets were changed. No frontend changes, so the prior 207-test application result remains applicable.
