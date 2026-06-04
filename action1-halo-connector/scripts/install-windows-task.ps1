[CmdletBinding()]
param(
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$taskName = "Action1HaloPSAConnector"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$connectorRoot = Split-Path -Parent $scriptDirectory
$entryPointRelativePath = "src\main.js"
$entryPointPath = Join-Path $connectorRoot $entryPointRelativePath

Write-Host "Installing Windows Task Scheduler background task for the Action1 -> HaloPSA Connector..."

if (-not (Test-Path -LiteralPath $entryPointPath)) {
    throw "Could not find '$entryPointRelativePath' under '$connectorRoot'. Run this script from the connector repository."
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $nodeCommand) {
    throw "Unable to locate node.exe. Install the latest Node.js LTS and ensure it is available on PATH before creating the scheduled task."
}

$nodePath = $nodeCommand.Source

$actionParameters = @{
    Execute  = $nodePath
    Argument = $entryPointRelativePath
}

$actionCommand = Get-Command New-ScheduledTaskAction -ErrorAction Stop
$workingDirectorySupported = $actionCommand.Parameters.ContainsKey("WorkingDirectory")

if ($workingDirectorySupported) {
    $actionParameters.WorkingDirectory = $connectorRoot
}

$action = New-ScheduledTaskAction @actionParameters

$trigger = New-ScheduledTaskTrigger -AtStartup

$principal = New-ScheduledTaskPrincipal `
    -UserId "NT AUTHORITY\SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

$settingsParameters = @{
    AllowStartIfOnBatteries    = $true
    DontStopIfGoingOnBatteries = $true
    StartWhenAvailable         = $true
    MultipleInstances          = "IgnoreNew"
}

$settingsCommand = Get-Command New-ScheduledTaskSettingsSet -ErrorAction Stop

if ($settingsCommand.Parameters.ContainsKey("AllowHardTerminate")) {
    $settingsParameters.AllowHardTerminate = $true
}
if ($settingsCommand.Parameters.ContainsKey("RestartCount")) {
    $settingsParameters.RestartCount = 5
}
if ($settingsCommand.Parameters.ContainsKey("RestartInterval")) {
    $settingsParameters.RestartInterval = (New-TimeSpan -Minutes 1)
}
if ($settingsCommand.Parameters.ContainsKey("ExecutionTimeLimit")) {
    $settingsParameters.ExecutionTimeLimit = [TimeSpan]::Zero
}

$settings = New-ScheduledTaskSettingsSet @settingsParameters

$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($existingTask) {
    Write-Host "Existing scheduled task found. Replacing '$taskName'..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$task = Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Runs the Action1 -> HaloPSA Connector in the background at system startup." `
    -Force

if (-not $NoStart) {
    Start-ScheduledTask -TaskName $taskName
}

Write-Host ""
Write-Host "Task installation completed."
Write-Host "Task name      : $taskName"
Write-Host "Node path      : $nodePath"
Write-Host "Connector root : $connectorRoot"
Write-Host "Entry point    : $entryPointRelativePath"
Write-Host "Started now    : $([bool](-not $NoStart))"

if (-not $workingDirectorySupported) {
    Write-Host "Working dir    : not set by script (this Windows version does not expose -WorkingDirectory on New-ScheduledTaskAction)"
    Write-Host "Manual fallback: recreate the task manually and set the action Start in folder to '$connectorRoot'"
} else {
    Write-Host "Working dir    : $connectorRoot"
}

Write-Host ""
Write-Host "Management commands:"
Write-Host "  Start-ScheduledTask -TaskName `"$taskName`""
Write-Host "  Stop-ScheduledTask -TaskName `"$taskName`""
Write-Host "  Get-ScheduledTask -TaskName `"$taskName`""
Write-Host "  Get-ScheduledTaskInfo -TaskName `"$taskName`""
Write-Host ""
Write-Host "If the task fails to start, confirm that:"
Write-Host "  1. Node.js LTS is installed"
Write-Host "  2. The task account can read/write '$connectorRoot'"
Write-Host "  3. The task action uses '$nodePath' with working directory '$connectorRoot'"