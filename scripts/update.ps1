$ErrorActionPreference = 'Stop'
$repository = 'https://github.com/Fablestarexpanse/Idiot-Lora-Builder.git'
$project = Split-Path -Parent $PSScriptRoot

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed. Check the messages above, then run update.bat again." }
}

try {
    Write-Host "`nIdiot LoRa Builder - Update`n"
    foreach ($command in @('git', 'node', 'npm.cmd', 'cargo')) {
        if (!(Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "$command was not found. Install Git for Windows (https://git-scm.com/download/win), Node.js and Rust as needed, then reopen update.bat."
        }
    }

    # Require a repository marker in this folder; never use a parent repository.
    if (!(Test-Path -LiteralPath (Join-Path $project '.git'))) {
        $destination = Join-Path (Split-Path -Parent $project) 'Idiot-Lora-Builder-updated'
        if (Test-Path -LiteralPath $destination) {
            throw "The ZIP copy has no Git history. An update folder already exists at $destination. Use update.bat inside that folder, or choose a different location for a fresh Git clone."
        }
        Write-Host "This is a ZIP download. Creating an updateable copy at $destination."
        Write-Host 'Your original folder and any datasets inside it will stay intact.'
        Invoke-Checked git @('clone', '--branch', 'main', '--single-branch', $repository, $destination)
        $project = $destination
    }

    Push-Location -LiteralPath $project
    try {
        $origin = & git config --get remote.origin.url
        if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^(https://github\.com/|git@github\.com:)Fablestarexpanse/Idiot-Lora-Builder(\.git)?/?$') {
            throw 'This folder does not use the Idiot LoRa Builder GitHub repository as origin. No files were updated.'
        }
        $branch = & git branch --show-current
        if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
            throw 'Updates require the main branch. Switch back to main before running update.bat.'
        }
        $changes = & git status --porcelain --untracked-files=no
        if ($LASTEXITCODE -ne 0) { throw 'Could not check local changes.' }
        if ($changes) { throw 'Local program files have been changed. Save or commit those changes before updating. The updater will not overwrite them.' }

        $running = Get-Process -Name 'idiot-lora-builder' -ErrorAction SilentlyContinue | Where-Object {
            $_.Path -and $_.Path.StartsWith($project + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
        }
        if ($running) { throw 'Close this copy of the tool and its run.bat window, then run update.bat again.' }

        Write-Host 'Checking GitHub for updates...'
        Invoke-Checked git @('fetch', 'origin', 'main')
        $ahead = & git rev-list --count 'FETCH_HEAD..HEAD'
        if ($LASTEXITCODE -ne 0) { throw 'Could not compare local and published versions.' }
        if ([int]$ahead -gt 0) { throw 'This copy has local commits that are not on GitHub main. No files were updated.' }
        $before = & git rev-parse HEAD
        Invoke-Checked git @('merge', '--ff-only', 'FETCH_HEAD')
        $after = & git rev-parse HEAD
        if ($before -eq $after) { Write-Host 'The program files are already up to date.' }
        else { Write-Host 'The latest program files are downloaded.' }

        Write-Host "`nRefreshing dependencies. This may take a few minutes..."
        Invoke-Checked npm.cmd @('ci')
        Write-Host "`n[OK] Update complete. Double-click run.bat in:"
        Write-Host $project
        Write-Host 'The next launch rebuilds the app if needed. Your app settings and downloaded models are retained.'
    }
    finally { Pop-Location }
    exit 0
}
catch {
    Write-Host "`n[X] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
