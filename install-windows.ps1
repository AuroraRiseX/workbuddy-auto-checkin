param([string]$WorkBuddyExe)
$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:LOCALAPPDATA 'WorkBuddyAutoCheckin'
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node -or [int]((& $node -p 'process.versions.node.split(String.fromCharCode(46))[0]') | Select-Object -Last 1) -lt 18) {
    throw 'Install Node.js 18+ LTS from https://nodejs.org and restart this installer.'
}
$candidates = @($WorkBuddyExe,
    "$env:LOCALAPPDATA\Programs\WorkBuddy\WorkBuddy.exe",
    "$env:LOCALAPPDATA\WorkBuddy\WorkBuddy.exe",
    "$env:ProgramFiles\WorkBuddy\WorkBuddy.exe")
# Resolve the real path from a normal Start Menu shortcut, including custom install folders.
$wsh = New-Object -ComObject WScript.Shell
foreach ($menu in @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs")) {
    Get-ChildItem $menu -Filter '*WorkBuddy*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $candidates += $wsh.CreateShortcut($_.FullName).TargetPath
    }
}
$exe = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $exe) {
    $exe = (Read-Host 'Enter the full installed WorkBuddy.exe path').Trim('"')
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'WorkBuddy.exe was not found.' }
}
New-Item -ItemType Directory -Force $dest | Out-Null
if ((Join-Path $PSScriptRoot 'checkin.cjs') -ne (Join-Path $dest 'checkin.cjs')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'checkin.cjs') -Destination $dest -Force
}
# Store only executable/config paths, never login tokens or passwords.
$launch = @'
$ErrorActionPreference = 'Stop'
$env:WORKBUDDY_EXE = '__EXE__'
$env:WORKBUDDY_CONFIG_DIR = '__CONFIG__'
& '__NODE__' '__SCRIPT__' 1>$null 2>$null
exit $LASTEXITCODE
'@
$launch = $launch.Replace('__EXE__', $exe.Replace("'", "''")).Replace('__CONFIG__', (Join-Path $HOME '.workbuddy').Replace("'", "''")).Replace('__NODE__', $node.Replace("'", "''")).Replace('__SCRIPT__', (Join-Path $dest 'checkin.cjs').Replace("'", "''"))
$runner = Join-Path $dest 'run.ps1'
Set-Content -LiteralPath $runner -Value $launch -Encoding UTF8
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '"')
# Interactive token supports a locked session; no Windows password is saved.
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
Register-ScheduledTask -TaskName 'WorkBuddy-DailyCheckin' -Action $action -Trigger @($hourly,$logon) -Principal $principal -Settings $settings -Description 'Checks and claims the current daily WorkBuddy reward using local IPC. No passwords stored.' -Force | Out-Null
Start-ScheduledTask -TaskName 'WorkBuddy-DailyCheckin'
Write-Host "Installed: checks now, at login and hourly. Log: $dest\checkin.log"
