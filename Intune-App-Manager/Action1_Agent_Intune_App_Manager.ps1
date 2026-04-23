# Name: Action1_Agent_Intune_App_Manager.ps1
# Description: This script will download the organization-specific Action1 Agent MSI, checks Intune for existing Win32 LOB app, compares versions, and creates or updates the Intune app as needed.
# Copyright (C) 2024 Action1 Corporation
# Documentation: https://github.com/Action1Corp/Integrations/blob/main/Intune-App-Manager/README.md

# Use Action1 Roadmap system (https://roadmap.action1.com/) to submit feedback or enhancement requests.

# WARNING: Carefully study the provided scripts and components before using them. Test in your non-production lab first.

# LIMITATION OF LIABILITY. IN NO EVENT SHALL ACTION1 OR ITS SUPPLIERS, OR THEIR RESPECTIVE
# OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE WITH RESPECT TO THE WEBSITE OR
# THE COMPONENTS OR THE SERVICES UNDER ANY CONTRACT, NEGLIGENCE, TORT, STRICT
# LIABILITY OR OTHER LEGAL OR EQUITABLE THEORY (I)FOR ANY AMOUNT IN THE AGGREGATE IN
# EXCESS OF THE GREATER OF FEES PAID BY YOU THEREFOR OR $100; (II) FOR ANY INDIRECT,
# INCIDENTAL, PUNITIVE, OR CONSEQUENTIAL DAMAGES OF ANY KIND WHATSOEVER; (III) FOR
# DATA LOSS OR COST OF PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; OR (IV) FOR ANY
# MATTER BEYOND ACTION1'S REASONABLE CONTROL. SOME STATES DO NOT ALLOW THE
# EXCLUSION OR LIMITATION OF INCIDENTAL OR CONSEQUENTIAL DAMAGES, SO THE ABOVE
# LIMITATIONS AND EXCLUSIONS MAY NOT APPLY TO YOU.

param(

    # =====================================
    # Action1 Configuration
    # =====================================
    [string]$AgentId = "",
    [string]$OrgName = "",

    # =====================================
    # Microsoft Graph / Intune Authentication
    # =====================================
    [string]$TenantId = "",
    [string]$ClientId = "",
    [string]$ClientSecret = "",

    # =====================================
    # File Paths
    # =====================================
    [string]$OutputFolder = "C:\tmp\action1-intune",

    # =====================================
    # Application Metadata
    # =====================================
    [string]$ImageURI = "https://www.action1.com/wp-content/uploads/2025/03/Action1_2560x1600.png",
    [string]$InformationURL = "https://www.action1.com/documentation/",
    [string]$PrivacyURL = "https://www.action1.com/legal/privacy-policy/"
)

# =====================================
# Paths
# =====================================
$MSIFile = "agent($OrgName).msi"
$MSIPath = Join-Path $OutputFolder $MSIFile
$ImageFileName = "Icon.png"

# =====================================
# Install required modules
# =====================================
Import-Module PowerShellGet -ErrorAction Stop

if (-not (Get-Module -ListAvailable -Name "Microsoft.Graph")) {
    Install-Module -Name Microsoft.Graph -Scope CurrentUser -Force
}
Import-Module Microsoft.Graph.DeviceManagement -ErrorAction Stop
Import-Module Microsoft.Graph.DeviceManagement.Enrollment -ErrorAction Stop

if (-not (Get-Module -ListAvailable -Name "IntuneWin32App")) {
    Install-Module -Name "IntuneWin32App" -Scope CurrentUser -Force
}

Write-Host "Required modules loaded."

# =====================================
# Connect to Microsoft Graph
# =====================================
$SecureSecret = ConvertTo-SecureString $ClientSecret -AsPlainText -Force
$Credential = New-Object System.Management.Automation.PSCredential ($ClientId, $SecureSecret)
Connect-MgGraph -TenantId $TenantId -ClientSecretCredential $Credential
Connect-MSIntuneGraph -TenantID $TenantId -ClientID $ClientId -ClientSecret $ClientSecret
Write-Host "Connected to Microsoft Graph successfully."

# =====================================
# Download the customer-specific MSI
# =====================================
if (!(Test-Path $OutputFolder)) { New-Item -ItemType Directory -Path $OutputFolder -Force | Out-Null }

$DownloadUrl = "https://app.action1.com/agent/$AgentId/Windows/$MSIFile"
Invoke-WebRequest -Uri $DownloadUrl -OutFile $MSIPath -UseBasicParsing
Write-Host "Downloaded MSI to $MSIPath"

# =====================================
# Read MSI version
# =====================================
if (-not (Test-Path $MSIPath)) { throw "MSI file not found at $MSIPath" }

function Get-MsiProperty {
    param([string]$MsiPath, [string]$Property)
    $msi = New-Object -ComObject WindowsInstaller.Installer
    $database = $msi.GetType().InvokeMember("OpenDatabase", "InvokeMethod", $null, $msi, @($MsiPath, 0))
    $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, ("SELECT Value FROM Property WHERE Property='$Property'"))
    $view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null)
    $record = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)
    $value = $record.GetType().InvokeMember("StringData", "GetProperty", $null, $record, 1)
    return $value
}

$LatestProductVersion = Get-MsiProperty -MsiPath $MSIPath -Property "ProductVersion"
Write-Host "Latest Product Version: $LatestProductVersion"

# =====================================
# Helper function: Package, Add, Assign Intune Win32 App
# =====================================
function Publish-IntuneWin32App {
    param(
        [string]$MSIPath,
        [string]$MSIFile,
        [string]$OutputFolder,
        [string]$ImageURI,
        [string]$ImageFileName,
        [string]$InformationURL,
        [string]$PrivacyURL
    )

    # Package MSI as .intunewin
    $Win32AppPackage = New-IntuneWin32AppPackage -SourceFolder $OutputFolder -SetupFile $MSIFile -OutputFolder $OutputFolder -Verbose -Force
    $IntuneWinFile = $Win32AppPackage.Path
    $IntuneWinMetaData = Get-IntuneWin32AppMetaData -FilePath $IntuneWinFile

    $DisplayName = $IntuneWinMetaData.ApplicationInfo.Name
    $AppVersion = $IntuneWinMetaData.ApplicationInfo.MsiInfo.MsiProductVersion
    $Publisher = $IntuneWinMetaData.ApplicationInfo.MsiInfo.MsiPublisher

    # Requirement and detection rules
    $RequirementRule = New-IntuneWin32AppRequirementRule -Architecture "x64x86" -MinimumSupportedWindowsRelease "W10_20H2"
    $DetectionRule = New-IntuneWin32AppDetectionRuleMSI -ProductCode $IntuneWinMetaData.ApplicationInfo.MsiInfo.MsiProductCode -ProductVersionOperator "greaterThanOrEqual" -ProductVersion $AppVersion

    # Custom return code
    $ReturnCode = New-IntuneWin32AppReturnCode -ReturnCode 1337 -Type "retry"

    # Download icon
    Invoke-WebRequest -Uri $ImageURI -OutFile "$OutputFolder\$ImageFileName"
    $Icon = New-IntuneWin32AppIcon -FilePath "$OutputFolder\$ImageFileName"

    # Add app
    $Win32App = Add-IntuneWin32App -FilePath $IntuneWinFile -DisplayName $DisplayName -Description "Action1 Agent" -Publisher $Publisher `
        -InstallExperience "system" -RestartBehavior "suppress" -DetectionRule $DetectionRule -RequirementRule $RequirementRule -ReturnCode $ReturnCode `
        -Icon $Icon -AppVersion $AppVersion -InformationURL $InformationURL -PrivacyURL $PrivacyURL -Verbose

    # Assign to all users
    Add-IntuneWin32AppAssignmentAllUsers -ID $Win32App.id -Intent "available" -Notification "showAll" -Verbose

    Write-Host "App '$DisplayName' version $AppVersion published to Intune successfully."
}

# =====================================
# Get Intune Win32 App
# =====================================
$Win32MobileApps = Invoke-MgGraphRequest `
  -Method GET `
  -Uri "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps?`$filter=isof('microsoft.graph.win32LobApp') and contains(displayName,'Action1 Agent')"

# =====================================
# Compare and Publish
# =====================================
if (-not $Win32MobileApps.value -or $Win32MobileApps.value.Count -eq 0) {
    Write-Host "LOB app not found in Intune. Creating a new app..."
    Publish-IntuneWin32App -MSIPath $MSIPath -MSIFile $MSIFile -MSIDir $OutputFolder -OutputFolder $OutputFolder -ImageURI $ImageURI -ImageFileName $ImageFileName -InformationURL $InformationURL -PrivacyURL $PrivacyURL
} else {
    $ExistingApp = $Win32MobileApps.value[0]
    $AppId = $ExistingApp.id
    $CurrentVersion = if ($ExistingApp.displayVersion) { $ExistingApp.displayVersion } else { "0.0.0.0" }
    Write-Host "Installed Intune app version: $CurrentVersion"

    # Ensure versions are strings
    $LatestProductVersion = -join $LatestProductVersion
    $CurrentVersion = -join $CurrentVersion

    # Compare versions
    function Compare-Version {
        param($v1, $v2)
        if ([string]::IsNullOrEmpty($v1)) { $v1 = "0.0.0.0" }
        if ([string]::IsNullOrEmpty($v2)) { $v2 = "0.0.0.0" }
        [Version]$ver1 = [Version]$v1
        [Version]$ver2 = [Version]$v2
        return $ver1.CompareTo($ver2)
    }

    $cmp = Compare-Version -v1 $LatestProductVersion -v2 $CurrentVersion

    if ($cmp -le 0) {
        Write-Host "No update required. Intune app version ($CurrentVersion) is up to date."
    } else {
        Write-Host "Newer version detected. Removing old Intune app and creating new app with version $LatestProductVersion"
        try { Remove-IntuneWin32App -ID $AppId -Verbose; Write-Host "Old Intune app removed." }
        catch { Write-Warning "Failed to remove old Intune app: $_" }

        Publish-IntuneWin32App -MSIPath $MSIPath -MSIFile $MSIFile -MSIDir $OutputFolder -OutputFolder $OutputFolder -ImageURI $ImageURI -ImageFileName $ImageFileName -InformationURL $InformationURL -PrivacyURL $PrivacyURL
    }
}

# Remove only known generated files
$filesToRemove = @(
    "$OutputFolder\*.intunewin",
    "$OutputFolder\$ImageFileName",
    "$OutputFolder\$MSIFile"
)

foreach ($pattern in $filesToRemove) {
    Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}

Write-Host "Selective cleanup completed."

Write-Host "Script execution completed."