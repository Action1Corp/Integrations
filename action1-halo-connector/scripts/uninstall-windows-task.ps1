[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$taskName = "Action1HaloPSAConnector"

Write-Host "Removing Windows Task Scheduler background task for the Action1 -> HaloPSA Connector..."

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Scheduled task '$taskName' does not exist. Nothing to remove."
    return
}

try {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
} catch {
    Write-Host "Task stop returned a non-fatal warning: $($_.Exception.Message)"
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false

Write-Host ""
Write-Host "Task removal completed."
Write-Host "Removed task : $taskName"
Write-Host "Connector files, data, logs, and configuration were not modified."
