$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$root = Join-Path $env:TEMP ('ilb-update-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$upstream = Join-Path $root 'upstream'
$client = Join-Path $root 'client'
git init -b main $upstream | Out-Null
Push-Location $upstream
git config user.name 'Updater Test'
git config user.email 'updater@example.invalid'
New-Item -ItemType Directory scripts | Out-Null
Copy-Item -LiteralPath "$source\scripts\update.ps1" -Destination scripts
Copy-Item -LiteralPath "$source\update.bat" -Destination .
'{"name":"updater-test","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"updater-test","version":"1.0.0"}}}' | Set-Content package-lock.json
'{"name":"updater-test","version":"1.0.0"}' | Set-Content package.json
'first' | Set-Content version.txt
git add .
git commit -m initial | Out-Null
Pop-Location
git clone $upstream $client
Push-Location $client
git remote set-url origin https://github.com/Fablestarexpanse/Idiot-Lora-Builder.git
Pop-Location
$env:GIT_CONFIG_COUNT='1'
$env:GIT_CONFIG_KEY_0="url.$($upstream.Replace('\','/')).insteadOf"
$env:GIT_CONFIG_VALUE_0='https://github.com/Fablestarexpanse/Idiot-Lora-Builder.git'
function Check-Update([string]$Folder,[int]$Expected,[string]$Text) {
    $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Folder\scripts\update.ps1" 2>&1 | Out-String
    $result=$LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($result -ne $Expected -or !$output.Contains($Text)) { throw "Unexpected result $result expected $Expected with $Text`n$output" }
    Write-Host "PASS: $Text"
}
Push-Location $upstream
'second' | Set-Content version.txt
git add version.txt
git commit -m update | Out-Null
Pop-Location
Check-Update $client 0 'Update complete'
if ((Get-Content "$client\version.txt") -ne 'second') {throw 'Update not applied'}
Check-Update $client 0 'already up to date'
Push-Location $upstream
'upstream file' | Set-Content collision.txt
git add collision.txt
git commit -m collision | Out-Null
Pop-Location
'local file' | Set-Content "$client\collision.txt"
Check-Update $client 1 'git failed'
if ((Get-Content "$client\collision.txt") -ne 'local file') { throw 'Untracked file overwritten' }
Move-Item -LiteralPath "$client\collision.txt" -Destination "$root\saved-collision.txt"
Check-Update $client 0 'Update complete'
$env:GIT_CONFIG_KEY_0="url.$($root.Replace('\','/'))/missing-repository.insteadOf"
Check-Update $client 1 'git failed'
$env:GIT_CONFIG_KEY_0="url.$($upstream.Replace('\','/')).insteadOf"
'local edit' | Set-Content "$client\version.txt"
Check-Update $client 1 'Local program files have been changed'
if ((Get-Content "$client\version.txt") -ne 'local edit') {throw 'Local edit overwritten'}
Push-Location $client
git restore version.txt
git switch -c custom
Pop-Location
Check-Update $client 1 'Updates require the main branch'
Push-Location $client
git switch main
git config user.name 'Updater Test'
git config user.email 'updater@example.invalid'
'local commit' | Set-Content version.txt
git add version.txt
git commit -m local | Out-Null
Pop-Location
Check-Update $client 1 'local commits'
Push-Location $client
git remote set-url origin https://github.com/example/other.git
Pop-Location
Check-Update $client 1 'does not use the Idiot LoRa Builder'
$zip = Join-Path $root 'zip'
New-Item -ItemType Directory "$zip\scripts" | Out-Null
Copy-Item -LiteralPath "$source\scripts\update.ps1" -Destination "$zip\scripts"
'keep dataset' | Set-Content "$zip\dataset.txt"
Check-Update $zip 0 'Update complete'
if ((Get-Content "$zip\dataset.txt") -ne 'keep dataset') { throw 'ZIP original changed' }
Check-Update $zip 1 'An update folder already exists'
Push-Location $upstream
'{"name":"updater-test","version":"1.0.0","dependencies":{"missing-test-dependency":"file:./missing-folder"}}' | Set-Content package.json
git add package.json
git commit -m broken-install | Out-Null
Pop-Location
Check-Update "$root\Idiot-Lora-Builder-updated" 1 'npm.cmd failed'
Push-Location $upstream
'{"name":"updater-test","version":"1.0.0"}' | Set-Content package.json
git add package.json
git commit -m repair-install | Out-Null
Pop-Location
Check-Update "$root\Idiot-Lora-Builder-updated" 0 'Update complete'
Write-Host "All updater checks passed. Disposable fixtures: $root"



