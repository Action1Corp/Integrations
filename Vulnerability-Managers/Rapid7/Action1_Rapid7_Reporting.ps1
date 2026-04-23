# Name: Action1_Rapid7_Reporting.ps1
# Description: This script will connect to the Rapid7 InsightVM API to pull Rapid7 InsightVM data in order to correlate the endpoints and vulnerabilities within the Rapid7 InsightVM platform with the Action1 API.  Reports will be created and provided to the user as output or through email.
# Copyright (C) 2024 Action1 Corporation
# Documentation: https://github.com/Action1Corp/Integrations/blob/main/Vulnerability-Managers/Rapid7/README.md

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
    [string] $VulnerabilityManager = "Rapid7_InsightVM",

    # --- Rapid7 Configuration ---
    [string]$Rapid7ApiKey = '',
    [string]$Rapid7Region = '',

    # --- Action1 Configuration ---
    [string]$Action1APIKey = '',
    [string]$Action1APISecret = '',
    [string]$Action1OrgID = '',
    [string]$Action1Region = "NorthAmerica",

    # --- Output Directory ---
    [string]$OutputDirectory = "c:\action1",

    # --- Custom Attributes ---
    [switch]$SetCustomAttributes = $false,
    [string]$AttributeName = "Rapid7 Vulnerabilities",   # Attribute name must exist on endpoints

    # --- SMTP / Email Settings ---
    [switch]$SendEmail = $false,
    [string]$SmtpServer = "",
    [int]$SmtpPort = 587,
    [string]$SmtpUser = "",
    [string]$SmtpPassword = "",
    [string]$MailFrom = "",
    [string]$MailTo = "",
    [string]$MailSubject = "Action1 Vulnerability Reports",
    [switch]$UseSsl = $true
)

# =====================================================
# FUNCTIONS
# =====================================================

function Write-Log {
    param($Message, $Level = "INFO")
    $ts = (Get-Date).ToString("s")
    Write-Host "[$ts][$Level] $Message"
}

function Normalize-EndpointName {
    param (
        [string]$Name
    )

    if (-not $Name) { return $null }

    # Trim, lowercase, strip FQDN → short hostname
    return ($Name.Trim().Split('.')[0]).ToLower()
}

function Show-CVEReport {
    param(
        [string]$Title,
        [array]$CVEList,
        [hashtable]$CVEDetails,
        [string]$OutputDir = "."
    )

    if (-not (Test-Path $OutputDir)) {
        New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    }

    Write-Host "`nTotal unique ${Title}: $(($CVEList | Sort-Object -Unique).Count)"

    if (-not $CVEList -or $CVEList.Count -eq 0) {
        Write-Host "No CVEs found for $Title." -ForegroundColor Yellow
        return
    }

    Write-Host "`n📋 $Title" -ForegroundColor Cyan
    Write-Host "----------------------------------------"

    $reportData = @()
    foreach ($cve in ($CVEList | Sort-Object -Unique)) {
        if ($CVEDetails.ContainsKey($cve)) {
            $info = $CVEDetails[$cve]
            $reportData += [PSCustomObject]@{
                CVE         = $cve
                Severity    = $info.Severity
                Plugin      = $info.PluginName
                Description = if ($info.Description.Length -gt 100) { 
                                  $info.Description.Substring(0, 100) + "..." 
                              } else { 
                                  $info.Description 
                              }
                Solution    = if ($info.Solution.Length -gt 100) { 
                                  $info.Solution.Substring(0, 100) + "..." 
                              } else { 
                                  $info.Solution 
                              }
            }
        }
        else {
            $reportData += [PSCustomObject]@{
                CVE         = $cve
                #Severity    = "Unknown"
                #Plugin      = "(Not found)"
                #Description = "(No description available)"
                #Solution    = "(No solution available)"
            }
        }
    }

    $reportData | Sort-Object Severity -Descending | Format-Table -AutoSize

    $reportPath = Join-Path $OutputDir "$($Title.Replace(' ', '_')).csv"
    $reportData | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $reportPath
    if ($script:attachments) { $script:attachments += $reportPath }
    Write-Host "✅ Detailed CVE table exported to $reportPath`n" -ForegroundColor Green
}

function Send-EmailReport {
    param(
        [string]$SmtpServer,
        [int]$SmtpPort,
        [string]$SmtpUser,
        [string]$SmtpPassword,
        [string]$MailFrom,
        [string]$MailTo,
        [string]$MailSubject,
        [string]$MailBody,
        [string[]]$Attachments,
        [switch]$UseSsl
    )

    Write-Log "Preparing email report..."

    try {
        $smtpClient = New-Object System.Net.Mail.SmtpClient($SmtpServer, $SmtpPort)
        $smtpClient.EnableSsl = $UseSsl
        if ($SmtpUser -and $SmtpPassword) {
            $smtpClient.Credentials = New-Object System.Net.NetworkCredential($SmtpUser, $SmtpPassword)
        } else {
            $smtpClient.UseDefaultCredentials = $true
        }

        $mailMessage = New-Object System.Net.Mail.MailMessage
        $mailMessage.From = $MailFrom
        $MailTo.Split(',') | ForEach-Object { $mailMessage.To.Add($_.Trim()) }
        $mailMessage.Subject = $MailSubject
        $mailMessage.Body = $MailBody
        $mailMessage.IsBodyHtml = $false

        foreach ($file in $Attachments) {
            if (Test-Path $file) {
                Write-Log "Attaching file: $file"
                $attachment = New-Object System.Net.Mail.Attachment($file)
                $mailMessage.Attachments.Add($attachment)
            } else {
                Write-Log "Attachment not found: $file" "WARN"
            }
        }

        Write-Log "Sending email to $MailTo via $SmtpServer..."
        $smtpClient.Send($mailMessage)
        Write-Host "📧 Email sent successfully to $MailTo" -ForegroundColor Green
    } catch {
        Write-Host "❌ Failed to send email: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# =====================================================
# VALIDATION & SETUP
# =====================================================

if (-not (Test-Path $OutputDirectory)) {
    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
}

$vmSafeName = $VulnerabilityManager -replace '\s+', '_'  # replace spaces with underscores

$csvPath  = Join-Path $OutputDirectory "${vmSafeName}_vuln_export.csv"

Write-Log "Output will be stored in: $OutputDirectory"
Write-Log "CSV file:  $csvPath"

$CSVHostHeader = "Hostname"
$CSVCVEHeader = "CVEID"
$CSVSeverityHeader = "Severity"
$attachments = @()
$CVEDetails = @{}

# =====================================================
# RAPID7 SETUP
# =====================================================

$BaseUrl = "https://$Rapid7Region.api.insight.rapid7.com/vm/v4"
$Headers = @{
    "X-Api-Key"    = $Rapid7ApiKey
    "Accept"       = "application/json"
    "Content-Type" = "application/json"
}

################################################################################
# 1) Retrieve All Assets
################################################################################

Write-Host "`nFetching all assets..." -ForegroundColor Cyan

$allAssets = @()
$pageNumber = 0
$pageSize = 500

do {
    $assetSearchUri = "$BaseUrl/integration/assets?page=$pageNumber&size=$pageSize"

    try {
        $response = Invoke-RestMethod -Method POST -Uri $assetSearchUri -Headers $Headers

        if ($response.data) {
            $allAssets += $response.data
            Write-Host "Retrieved page $pageNumber ($($response.data.Count) assets)"
        }

        # Use metadata for pagination
        $totalPages = $response.metadata.totalPages
        if (-not $totalPages) { $totalPages = $response.metadata.total_pages }

        $pageNumber++
    }
    catch {
        $err = $_.Exception.Message
        Write-Warning ("Error retrieving assets page {0}: {1}" -f $pageNumber, $err)
        break
    }

} while ($pageNumber -lt $totalPages)

Write-Host "Total assets fetched: $($allAssets.Count)`n" -ForegroundColor Green

################################################################################
# BUILD COMPLETE RAPID7 HOSTNAME SET (ALL ASSETS - EVEN WITHOUT VULNS)
################################################################################

Write-Host "Building full Rapid7 hostname set..." -ForegroundColor Cyan

$rapid7Hosts = @()

foreach ($asset in $allAssets) {

    if (-not $asset.host_name) { continue }

    $normalized = Normalize-EndpointName $asset.host_name
    if (-not $normalized) { continue }

    if ($rapid7Hosts -notcontains $normalized) {
        $rapid7Hosts += $normalized
    }
}

$rapid7Hosts = $rapid7Hosts | Sort-Object -Unique

Write-Host "Total unique Rapid7 hostnames (ALL assets): $($rapid7Hosts.Count)" -ForegroundColor Green


################################################################################
# 2) Collect vulnerabilities per hostname
################################################################################

Write-Host "`nCollecting vulnerabilities for each host..." -ForegroundColor Cyan

$hostVulnMap = @{}

foreach ($asset in $allAssets) {
    $assetId  = $asset.id
    $hostname = $asset.host_name

    $uri = "$BaseUrl/integration/assets/$assetId" + "?includeSame=true"

    try {
        $detail = Invoke-RestMethod -Method GET -Uri $uri -Headers $Headers

        $vulnIDs = @()
        if ($null -ne $detail.same) {
            $vulnIDs = $detail.same | ForEach-Object { $_.vulnerability_id }
        }

        if ($vulnIDs.Count -gt 0) {
            if (-not $hostVulnMap.ContainsKey($hostname)) {
                $hostVulnMap[$hostname] = @()
            }
            $hostVulnMap[$hostname] += $vulnIDs
        }
    }
    catch {
        Write-Warning "Failed collecting vulnerabilities for asset '$hostname' ($assetId)"
    }
}

# Deduplicate per-host vulnerabilities safely
foreach ($hostname in @($hostVulnMap.Keys)) {
    $hostVulnMap[$hostname] = ($hostVulnMap[$hostname] | Sort-Object -Unique)
}


################################################################################
# 3) Lookup vulnerability details for each host + vuln ID
################################################################################

Write-Host "`nFetching vulnerability details..." -ForegroundColor Cyan

$outputRows = @()

foreach ($asset in $hostVulnMap.Keys) {

    $vulnIDs = $hostVulnMap[$asset]

    foreach ($vID in $vulnIDs) {

        $vulnSearchUri = "$BaseUrl/integration/vulnerabilities?size=500"

        $bodyObject = @{
            "vulnerability" = "id = '$vID'"
        }
        $bodyJson = $bodyObject | ConvertTo-Json -Depth 5

        try {
            $vResponse = Invoke-RestMethod -Method POST -Uri $vulnSearchUri -Headers $Headers -Body $bodyJson

            # The vulnerability API returns the vulnerability object directly
            if ($vResponse.data) {
                $outputRows += [PSCustomObject]@{
                    $CSVHostHeader        = $asset
                    VulnerabilityID = $vResponse.data.id
                    $CSVSeverityHeader        = $vResponse.data.cvss_v3_integrity_impact
                    $CSVCVEHeader            = ($vResponse.data.cves -join ", ")
                }
            }
        }
        catch {
            Write-Warning "Lookup failed for vulnerability $vID on host $host"
        }
    }
}

################################################################################
# 4) Save CSV Output
################################################################################

$csv = $outputRows |
    Sort-Object Hostname, VulnerabilityID |
    ConvertTo-Csv -NoTypeInformation |
    ConvertFrom-Csv

$csv | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $csvPath
Write-Log "Saved $($VulnerabilityManager) CSV to $csvPath"

Write-Host "`nDone!" -ForegroundColor Green

# =====================================================
# Action1 Setup
# =====================================================

Write-Log "Configuring Action1 environment..."

$ModuleName = 'PSAction1'
if (-not (Get-InstalledModule -Name $ModuleName -ErrorAction SilentlyContinue)) {
    Write-Log "Installing $ModuleName..."
    Install-Module -Name $ModuleName -Force
} else {
    Write-Log "$ModuleName already installed."
}

Set-Action1Credentials -APIKey $Action1APIKey -Secret $Action1APISecret
Set-Action1DefaultOrg -Org_ID $Action1OrgID
Set-Action1Region -Region $Action1Region
Set-Action1Debug $false
Set-Action1Interactive $false

# =====================================================
# RETRIEVE ACTION1 ENDPOINTS
# =====================================================

Write-Log "Retrieving Action1 endpoints..."

try {
    $endpointResponse = Get-Action1 Endpoints
    $a1eps = @{}

	$endpointResponse | ForEach-Object {
    $name = Normalize-EndpointName $_.device_name
    if (-not $name) { return }

    if (-not $a1eps.ContainsKey($name)) {
        $a1eps[$name] = [PSCustomObject]@{
            Id         = $_.id
            DeviceName = $_.device_name
            IPv4       = $_.address
            OS         = $_.OS
            MAC        = $_.Mac
        }
    }
}
    Write-Log "Retrieved $($a1eps.Count) Action1 endpoints."
} catch {
    Write-Log "Error retrieving endpoints from Action1: $($_.Exception.Message)" "ERROR"
    exit 1
}

# =====================================================
# Compare Endpoints & Build CVE Map
# =====================================================

Write-Log "Processing CSV data to map endpoints and CVEs..."

$eps = @{}                # endpoint -> comma-separated CVEs
$csvHosts = @()           # unique CSV hostnames (normalized)

foreach ($entry in $csv) {
    if (-not $entry.$CSVHostHeader) { continue }

    $ep = Normalize-EndpointName $entry.$CSVHostHeader
    if (-not $ep) { continue }
    if (-not ($csvHosts -contains $ep)) {$csvHosts += $ep}

    $cve = $entry.$CSVCVEHeader
    if (-not $cve) { continue }
    $cve = $cve.Trim()

    if ($eps.ContainsKey($ep)) { $eps[$ep] += "$cve," }
    else { $eps[$ep] = "$cve," }

    #Write-Host "✅ Mapped CVE $cve to endpoint $ep"
}

Write-Log "Mapped CVEs for $($eps.Keys.Count) endpoints."


# =====================================================
# IDENTIFY MISSING ASSETS / ENDPOINT REPORTS
# =====================================================

Write-Log "Building missing-assets and endpoint reports using ALL Rapid7 assets..."

# Action1 hostname set (already normalized in $a1eps keys)
$action1Hosts = $a1eps.Keys | Sort-Object -Unique

# Rapid7 hostname set (built earlier from ALL assets)
# $rapid7Hosts already normalized

# 1️⃣ Rapid7 hosts NOT in Action1
$rapid7NotInAction1 = $rapid7Hosts | Where-Object { $_ -notin $action1Hosts }

# 2️⃣ Action1 endpoints NOT in Rapid7
$action1NotInRapid7 = $action1Hosts | Where-Object { $_ -notin $rapid7Hosts }

# --- Export Reports (Hostnames Only) ---

# Rapid7 hosts missing in Action1
$rapid7NotInAction1Path = Join-Path $OutputDirectory "$($vmSafeName)_Hosts_Not_In_Action1.csv"
$rapid7NotInAction1 |
    ForEach-Object { [PSCustomObject]@{ Hostname = $_ } } |
    Export-Csv -NoTypeInformation -Encoding UTF8 -Path $rapid7NotInAction1Path -Force

$attachments += $rapid7NotInAction1Path

# Action1 endpoints missing in Rapid7
$action1NotInRapid7Path = Join-Path $OutputDirectory "Action1_Endpoints_Not_In_$($vmSafeName).csv"
$action1NotInRapid7 |
    ForEach-Object { [PSCustomObject]@{ Hostname = $_ } } |
    Export-Csv -NoTypeInformation -Encoding UTF8 -Path $action1NotInRapid7Path -Force

$attachments += $action1NotInRapid7Path

Write-Log "Rapid7 hosts not in Action1: $($rapid7NotInAction1.Count)"
Write-Log "Action1 endpoints not in Rapid7: $($action1NotInRapid7.Count)"

# Console Summary
Write-Host "`nEndpoint sync summary:"
Write-Host " - Total Action1 endpoints: $($action1Hosts.Count)"
Write-Host " - Total Rapid7 assets:     $($rapid7Hosts.Count)"
Write-Host " - Rapid7 hosts missing in Action1: $($rapid7NotInAction1.Count)"
Write-Host " - Action1 endpoints missing in Rapid7: $($action1NotInRapid7.Count)"



# =====================================================
# Build CVE Lists
# =====================================================

$cves = @{}
$cvesforremediation = @()
$cveswithnopatch = @()
$cvesnotrecognized = @()
$foundcve = @{}
$totaltime = 0

Write-Log "Fetching Action1 vulnerability catalog..."
Get-Action1 Vulnerabilities | ForEach-Object {
    $cveId = $_.cve_id
    $hasUpdates = $false
    foreach ($softwareItem in $_.software) {
        if ($softwareItem.available_updates -and $softwareItem.available_updates.Count -gt 0) {
            $hasUpdates = $true
            break
        }
    }
    $cves[$cveId] = $hasUpdates
}

$count = 0

foreach ($ep in $eps.Keys) {
    $sw = [Diagnostics.Stopwatch]::StartNew()

    $eps[$ep].Split(',') | ForEach-Object {
        $cve = $_.Trim()
        if (-not $cve) { return }

        if ($cves.ContainsKey($cve)) {
            if ($cves[$cve]) {
                if ($foundcve.ContainsKey($cve)) {
                    $foundcve[$cve] += 1
                } else {
                    $foundcve[$cve] = 1
                    $cvesforremediation += $cve
                    $count++
                }
            } else {
                $cveswithnopatch += $cve
            }
        } else {
            $cvesnotrecognized += $cve
        }
    }

    $sw.Stop()
    $totaltime += $sw.Elapsed.TotalSeconds
}

if ($count -eq 0) {Write-Host "`nNo CVEs matched for remediation."}

Write-Host "`nProcessing all endpoints required $([math]::Round($totaltime,2)) seconds"

# =====================================================
# Custom Attribute
# =====================================================

if ($SetCustomAttributes) {
    Write-Log "Counting vulnerabilities per endpoint by severity..."

    $endpointSeverityCounts = @{}

    $csv | ForEach-Object {
        $ep = Normalize-EndpointName $_.$CSVHostHeader
        if (-not $ep -or -not $a1eps.ContainsKey($ep)) { return }

        if (-not $endpointSeverityCounts.ContainsKey($ep)) {
            $endpointSeverityCounts[$ep] = @{
                Critical = 0
                High     = 0
                Medium   = 0
                Low      = 0
            }
        }

        switch ($_.($CSVSeverityHeader).ToUpper()) {
            "CRITICAL" { $endpointSeverityCounts[$ep].Critical++ }
            "HIGH"     { $endpointSeverityCounts[$ep].High++ }
            "MEDIUM"   { $endpointSeverityCounts[$ep].Medium++ }
            "LOW"      { $endpointSeverityCounts[$ep].Low++ }
        }
    }

    Write-Log "Updating Action1 custom attribute with vulnerability counts..."

    foreach ($ep in $endpointSeverityCounts.Keys) {
        $a1Endpoint = $a1eps[$ep]
        $counts = $endpointSeverityCounts[$ep]

        $summaryValue = "Critical=$($counts.Critical); High=$($counts.High); Medium=$($counts.Medium); Low=$($counts.Low)"

        $severityCounts = @{
            VulnCritical = $counts.Critical
            VulnHigh     = $counts.High
            VulnMedium   = $counts.Medium
            VulnLow      = $counts.Low
        }

        if ($a1Endpoint) {
            Update-Action1 Modify CustomAttribute `
                -Id $a1Endpoint.Id `
                -AttributeName "$AttributeName" `
                -AttributeValue "$summaryValue" | Out-Null

            Write-Host "Updated custom attribute for $($a1Endpoint.DeviceName)"
        }
        else {
            Write-Warning "No Action1 endpoint match for CSV host: $ep"
        }
    }
}
else {
    Write-Log "Custom Attribute flag not set — skipping setting custom attribute."
}


# =====================================================
# Email Results
# =====================================================

if ($SendEmail) {
    if ($SmtpServer -and $MailTo -and $MailFrom) {
        Write-Log "Email flag detected — preparing to send reports."

        # Attach any CSVs created during the run
        Write-Log "Preparing to send $($attachments.Count) attachments..."
        $body = @"
Hello,

Attached are the latest $VulnerabilityManager → Action1 vulnerability reports.

Generated on: $(Get-Date)
Output directory: $OutputDirectory

Regards,
Action1 Automation Script
"@

        Send-EmailReport `
            -SmtpServer $SmtpServer `
            -SmtpPort $SmtpPort `
            -SmtpUser $SmtpUser `
            -SmtpPassword $SmtpPassword `
            -MailFrom $MailFrom `
            -MailTo $MailTo `
            -MailSubject $MailSubject `
            -MailBody $body `
            -Attachments $attachments `
            -UseSsl:$UseSsl
    } else {
        Write-Log "SMTP or email parameters not fully configured — skipping email delivery."
    }
} else {
    Write-Log "Email flag not set — skipping email delivery."
}

# =====================================================
# Reporting
# =====================================================

Write-Host "`n===================================="
Write-Host "📊  Endpoint and CVE Report"
Write-Host "===================================="

$csvEndpoints = $eps.Keys
$A1NotInCSV = $a1eps.Keys | Where-Object { $_ -notin $csvEndpoints }

Write-Host "`nTotal Action1 endpoints not found in $($VulnerabilityManager): $($A1NotInCSV.Count)"
if ($A1NotInCSV.Count -gt 0) { $A1NotInCSV | ForEach-Object { Write-Host " - $_" } }

Write-Host "`nTotal $VulnerabilityManager endpoints not found in Action1: $($rapid7NotInAction1.Count)"
if ($rapid7NotInAction1.Count -gt 0) { $rapid7NotInAction1 | ForEach-Object { Write-Host " - $_" } }

Show-CVEReport -Title "$VulnerabilityManager CVEs for Remediation" `
               -CVEList $cvesforremediation `
               -CVEDetails $cveDetails `
               -OutputFilePrefix "Remediation" `
               -OutputDir $OutputDirectory

Show-CVEReport -Title "$VulnerabilityManager CVEs with no patch available" `
               -CVEList $cveswithnopatch `
               -CVEDetails $cveDetails `
               -OutputFilePrefix "NoPatch" `
               -OutputDir $OutputDirectory

Show-CVEReport -Title "$VulnerabilityManager CVEs not recognized by Action1" `
               -CVEList $cvesnotrecognized `
               -CVEDetails $cveDetails `
               -OutputFilePrefix "NotRecognized" `
               -OutputDir $OutputDirectory

Write-Host "`n====================================`n"
