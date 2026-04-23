# Name: Action1_Microsoft_Defender_Reporting.ps1
# Description: This script will connect to the Microsoft Defender for Endpoint API to pull machine vulnerability data and correlate endpoints and vulnerabilities with the Action1 API.  Reports will be created and provided to the user as output or through email.
# Copyright (C) 2024 Action1 Corporation
# Documentation: https://github.com/Action1Corp/Integrations/blob/main/Vulnerability-Managers/Microsoft_Defender/README.md

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
    [string] $VulnerabilityManager = "Microsoft_Defender",

    # --- Microsoft Defender Configuration ---
    [string]$TenantId = '',
    [string]$DefenderClientId = '',
    [string]$DefenderClientSecret = '',
    [string]$DefenderBaseUrl = 'https://api.security.microsoft.com',


    # --- Action1 Configuration ---
    [string]$Action1APIKey = '',
    [string]$Action1APISecret = '',
    [string]$Action1OrgID = '',
    [string]$Action1Region = "NorthAmerica",

    # --- Output Directory ---
    [string]$OutputDirectory = "c:\action1",

    # --- Custom Attributes ---
    [switch]$SetCustomAttributes = $false,
    [string]$AttributeName = "Microsoft Defender Vulnerabilities",   # Attribute name must exist on endpoints

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

function Invoke-EmailResults {

    param(
        [switch]$SendEmail,
        [string]$SmtpServer,
        [int]$SmtpPort,
        [string]$SmtpUser,
        [string]$SmtpPassword,
        [string]$MailFrom,
        [string]$MailTo,
        [string]$MailSubject,
        [switch]$UseSsl,
        [string[]]$Attachments,
        [string]$VulnerabilityManager,
        [string]$OutputDirectory
    )

    if (-not $SendEmail) {
        Write-Log "Email flag not set — skipping email delivery."
        return
    }

    if (-not ($SmtpServer -and $MailTo -and $MailFrom)) {
        Write-Log "SMTP or email parameters not fully configured — skipping email delivery."
        return
    }

    Write-Log "Email flag detected — preparing to send reports."
    Write-Log "Preparing to send $($Attachments.Count) attachments..."

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
        -Attachments $Attachments `
        -UseSsl:$UseSsl
}

function Invoke-Action1CustomAttributeUpdate {

    param(
        [switch]$SetCustomAttributes,
        [array]$CsvData,
        [string]$CSVHostHeader,
        [string]$CSVSeverityHeader,
        [hashtable]$Action1Endpoints,
        [string]$AttributeName
    )

    if (-not $SetCustomAttributes) {
        Write-Log "Custom Attribute flag not set — skipping setting custom attribute."
        return
    }

    Write-Log "Counting vulnerabilities per endpoint by severity..."

    $endpointSeverityCounts = @{}

    foreach ($row in $CsvData) {

        $ep = Normalize-EndpointName $row.$CSVHostHeader
        if (-not $ep -or -not $Action1Endpoints.ContainsKey($ep)) { continue }

        if (-not $endpointSeverityCounts.ContainsKey($ep)) {
            $endpointSeverityCounts[$ep] = @{
                Critical = 0
                High     = 0
                Medium   = 0
                Low      = 0
            }
        }

        switch ($row.$CSVSeverityHeader.ToUpper()) {
            "CRITICAL" { $endpointSeverityCounts[$ep].Critical++ }
            "HIGH"     { $endpointSeverityCounts[$ep].High++ }
            "MEDIUM"   { $endpointSeverityCounts[$ep].Medium++ }
            "LOW"      { $endpointSeverityCounts[$ep].Low++ }
        }
    }

    Write-Log "Updating Action1 custom attribute with vulnerability counts..."

    foreach ($ep in $endpointSeverityCounts.Keys) {

        $a1Endpoint = $Action1Endpoints[$ep]
        if (-not $a1Endpoint) {
            Write-Warning "No Action1 endpoint match for CSV host: $ep"
            continue
        }

        $counts = $endpointSeverityCounts[$ep]

        $summaryValue = "Critical=$($counts.Critical); High=$($counts.High); Medium=$($counts.Medium); Low=$($counts.Low)"

        Update-Action1 Modify CustomAttribute `
            -Id $a1Endpoint.Id `
            -AttributeName $AttributeName `
            -AttributeValue $summaryValue | Out-Null

        Write-Host "Updated custom attribute for $($a1Endpoint.DeviceName)"
    }
}

function Invoke-EndpointAndCVEReporting {

    param(
        [string]$VulnerabilityManager,

        # Endpoint comparison
        [hashtable]$Action1Endpoints,      # normalizedName -> Action1 object
        [hashtable]$VMEndpoints,           # normalizedName -> VM object
        [hashtable]$EndpointCVEMap,        # normalizedName -> CVE list map

        # CVE lists
        [array]$CVEsForRemediation,
        [array]$CVEsWithNoPatch,
        [array]$CVEsNotRecognized,
        [hashtable]$CVEDetails,

        [string]$OutputDirectory
    )

    Write-Host "`n===================================="
    Write-Host "📊  Endpoint and CVE Report"
    Write-Host "===================================="

    # -------------------------------------------------
    # Endpoint comparison
    # -------------------------------------------------

    $vmEndpointKeys = $VMEndpoints.Keys
    $a1EndpointKeys = $Action1Endpoints.Keys

    $vmNotInAction1  = $vmEndpointKeys | Where-Object { $_ -notin $a1EndpointKeys }
    $a1NotInVM       = $a1EndpointKeys | Where-Object { $_ -notin $vmEndpointKeys }

    Write-Host "`nTotal $VulnerabilityManager endpoints not found in Action1: $($vmNotInAction1.Count)"
    if ($vmNotInAction1.Count -gt 0) {
        $vmNotInAction1 | ForEach-Object { Write-Host " - $_" }
    }

    Write-Host "`nTotal Action1 endpoints not found in $($VulnerabilityManager): $($a1NotInVM.Count)"
    if ($a1NotInVM.Count -gt 0) {
        $a1NotInVM | ForEach-Object { Write-Host " - $_" }
    }

    # -------------------------------------------------
    # CVE Reporting
    # -------------------------------------------------

    Show-CVEReport -Title "$VulnerabilityManager CVEs for Remediation" `
                   -CVEList $CVEsForRemediation `
                   -CVEDetails $CVEDetails `
                   -OutputDir $OutputDirectory

    Show-CVEReport -Title "$VulnerabilityManager CVEs with no patch available" `
                   -CVEList $CVEsWithNoPatch `
                   -CVEDetails $CVEDetails `
                   -OutputDir $OutputDirectory

    Show-CVEReport -Title "$VulnerabilityManager CVEs not recognized by Action1" `
                   -CVEList $CVEsNotRecognized `
                   -CVEDetails $CVEDetails `
                   -OutputDir $OutputDirectory

    Write-Host "`n====================================`n"
}

function Invoke-Action1CVEAnalysis {

    param(
        [hashtable]$EndpointCVEMap,   # normalizedEndpoint -> "CVE1,CVE2,..."
        [string]$VulnerabilityManager
    )

    Write-Log "Fetching Action1 vulnerability catalog..."

    # -------------------------------------------------
    # Build Action1 CVE → HasPatch Map
    # -------------------------------------------------

    $action1CVEMap = @{}

    Get-Action1 Vulnerabilities | ForEach-Object {

        $cveId = $_.cve_id
        if (-not $cveId) { return }

        $hasUpdates = $false

        foreach ($softwareItem in $_.software) {
            if ($softwareItem.available_updates -and
                $softwareItem.available_updates.Count -gt 0) {
                $hasUpdates = $true
                break
            }
        }

        $action1CVEMap[$cveId] = $hasUpdates
    }

    # -------------------------------------------------
    # Analyze CVEs from VM
    # -------------------------------------------------

    $cvesForRemediation = @()
    $cvesWithNoPatch    = @()
    $cvesNotRecognized  = @()
    $foundCVECount      = @{}
    $totalTime          = 0
    $remediationCount   = 0

    foreach ($endpoint in $EndpointCVEMap.Keys) {

        $sw = [Diagnostics.Stopwatch]::StartNew()

        $EndpointCVEMap[$endpoint].Split(',') | ForEach-Object {

            $cve = $_.Trim()
            if (-not $cve) { return }

            if ($action1CVEMap.ContainsKey($cve)) {

                if ($action1CVEMap[$cve]) {

                    if ($foundCVECount.ContainsKey($cve)) {
                        $foundCVECount[$cve] += 1
                    }
                    else {
                        $foundCVECount[$cve] = 1
                        $cvesForRemediation += $cve
                        $remediationCount++
                    }

                }
                else {
                    $cvesWithNoPatch += $cve
                }

            }
            else {
                $cvesNotRecognized += $cve
            }

        }

        $sw.Stop()
        $totalTime += $sw.Elapsed.TotalSeconds
    }

    if ($remediationCount -eq 0) {
        Write-Host "`nNo CVEs matched for remediation."
    }

    Write-Host "`nProcessing all endpoints required $([math]::Round($totalTime,2)) seconds"

    # -------------------------------------------------
    # Return structured result object
    # -------------------------------------------------

    return [PSCustomObject]@{
        CVEsForRemediation = $cvesForRemediation
        CVEsWithNoPatch    = $cvesWithNoPatch
        CVEsNotRecognized  = $cvesNotRecognized
        FoundCVECount      = $foundCVECount
        TotalProcessingSec = [math]::Round($totalTime,2)
    }
}

function Setup-Action1Environment {
    param(
        [string]$APIKey,
        [string]$APISecret,
        [string]$OrgID,
        [string]$Region
    )

    Write-Log "Configuring Action1 environment..."

    $ModuleName = 'PSAction1'
    if (-not (Get-InstalledModule -Name $ModuleName -ErrorAction SilentlyContinue)) {
        Write-Log "Installing $ModuleName..."
        Install-Module -Name $ModuleName -Force
    } else {
        Write-Log "$ModuleName already installed."
    }

    Set-Action1Credentials -APIKey $APIKey -Secret $APISecret
    Set-Action1DefaultOrg -Org_ID $OrgID
    Set-Action1Region -Region $Region
    Set-Action1Debug $false
    Set-Action1Interactive $false

    Write-Log "Action1 environment setup complete."
}

function Get-Action1Endpoints {
    param(
        [switch]$NormalizeNames = $true
    )

    Write-Log "Retrieving Action1 endpoints..."

    $a1eps = @{}

    try {
        $endpointResponse = Get-Action1 Endpoints

        $endpointResponse | ForEach-Object {
            $name = if ($NormalizeNames) { Normalize-EndpointName $_.device_name } else { $_.device_name }
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
        return $a1eps

    } catch {
        Write-Log "Error retrieving endpoints from Action1: $($_.Exception.Message)" "ERROR"
        return @{}
    }
}

function Initialize-Reporting {
    param(
        [string]$OutputDirectory,
        [string]$VulnerabilityManager
    )

    # Ensure output directory exists
    if (-not (Test-Path $OutputDirectory)) {
        New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    }

    # Create safe file name for CSVs
    $vmSafeName = $VulnerabilityManager -replace '\s+', '_'  # replace spaces with underscores
    $csvPath  = Join-Path $OutputDirectory "${vmSafeName}_vuln_export.csv"

    Write-Log "Output will be stored in: $OutputDirectory"
    Write-Log "CSV file:  $csvPath"

    # Initialize CSV headers and arrays
    $CSVHostHeader     = "Hostname"
    $CSVCVEHeader      = "CVEID"
    $CSVSeverityHeader = "Severity"
    $attachments       = @()
    $CVEDetails        = @{}

    # Return structured object with setup info
    return [PSCustomObject]@{
        CSVPath         = $csvPath
        CSVHostHeader   = $CSVHostHeader
        CSVCVEHeader    = $CSVCVEHeader
        CSVSeverityHeader = $CSVSeverityHeader
        Attachments     = $attachments
        CVEDetails      = $CVEDetails
        VMSafeName      = $vmSafeName
    }
}

function Build-EndpointCVEMap {
    param(
        [Parameter(Mandatory=$true)]
        [array]$CsvData,

        [Parameter(Mandatory=$true)]
        [string]$CSVHostHeader,

        [Parameter(Mandatory=$true)]
        [string]$CSVCVEHeader,

        [Parameter(Mandatory=$true)]
        [hashtable]$Action1Endpoints
    )

    Write-Log "Processing CSV data to map endpoints and CVEs (Action1 matched only)..."

    $endpointCVEMap = @{}

    foreach ($entry in $CsvData) {

        $hostValue = $entry.$CSVHostHeader
        if (-not $hostValue) { continue }

        $normalizedEndpoint = Normalize-EndpointName $hostValue
        if (-not $normalizedEndpoint) { continue }

        # ✅ Must exist in Action1
        if (-not $Action1Endpoints.ContainsKey($normalizedEndpoint)) { continue }

        $cveValue = $entry.$CSVCVEHeader
        if (-not $cveValue) { continue }

        $cveValue = $cveValue.Trim()

        if ($endpointCVEMap.ContainsKey($normalizedEndpoint)) {
            $endpointCVEMap[$normalizedEndpoint] += "$cveValue,"
        }
        else {
            $endpointCVEMap[$normalizedEndpoint] = "$cveValue,"
        }
    }

    Write-Log "Mapped CVEs for $($endpointCVEMap.Keys.Count) matched endpoints."

    return $endpointCVEMap
}

function Compare-EndpointsAndExportMissing {
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$SourceEndpoints,   # normalizedName -> object (e.g., CSV or VM source)
        
        [Parameter(Mandatory=$true)]
        [hashtable]$TargetEndpoints,   # normalizedName -> object (reference set)
        
        [Parameter(Mandatory=$true)]
        [string]$OutputDirectory,
        
        [Parameter(Mandatory=$true)]
        [string]$SourceName,           # e.g., "VM", or generic name
        [Parameter(Mandatory=$true)]
        [string]$TargetName,           # e.g., "Action1", "Inventory", or generic name
       
        [Parameter(Mandatory=$true)]
        [ref]$Attachments              # reference to the attachments array
    )

    Write-Log "Building missing endpoint reports for $SourceName → $TargetName..."

    # --- Source → Target missing ---
    $sourceNotInTarget = @()

    foreach ($hostKey in $SourceEndpoints.Keys) {
        if (-not $TargetEndpoints.ContainsKey($hostKey)) {
            $obj = $SourceEndpoints[$hostKey]

            # PowerShell-compatible null check
            if ($obj.PSObject.Properties.Match("DeviceName")) {
                $hostname = $obj.DeviceName
            } elseif ($obj.PSObject.Properties.Match("computerDnsName")) {
                $hostname = $obj.computerDnsName
            } else {
                $hostname = $hostKey
            }

            $sourceNotInTarget += [PSCustomObject]@{
                Hostname = $hostname
            }
        }
    }

    $sourceMissingPath = Join-Path $OutputDirectory "$($SourceName)_Hosts_Not_In_$($TargetName).csv"
    $sourceNotInTarget | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $sourceMissingPath
    $Attachments.Value += $sourceMissingPath

    Write-Log ("${SourceName} hosts not in ${TargetName}: $($sourceNotInTarget.Count)")

    # --- Target → Source missing ---
    $targetNotInSource = @()

    foreach ($hostKey in $TargetEndpoints.Keys) {
        if (-not $SourceEndpoints.ContainsKey($hostKey)) {
            $obj = $TargetEndpoints[$hostKey]

            if ($obj.PSObject.Properties.Match("DeviceName")) {
                $hostname = $obj.DeviceName
            } elseif ($obj.PSObject.Properties.Match("computerDnsName")) {
                $hostname = $obj.computerDnsName
            } else {
                $hostname = $hostKey
            }

            $targetNotInSource += [PSCustomObject]@{
                Hostname = $hostname
            }
        }
    }

    $targetMissingPath = Join-Path $OutputDirectory "$($TargetName)_Hosts_Not_In_$($SourceName).csv"
    $targetNotInSource | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $targetMissingPath
    $Attachments.Value += $targetMissingPath

    Write-Log ("${TargetName} endpoints not in ${SourceName}: $($targetNotInSource.Count)")

    # --- Console Summary ---
    Write-Host "`nEndpoint Sync Summary"
    Write-Host "--------------------------------"
    Write-Host "Total $SourceName endpoints:  $($SourceEndpoints.Count)"
    Write-Host "Total $TargetName endpoints:  $($TargetEndpoints.Count)"
    Write-Host "${SourceName} missing in ${TargetName}: $($sourceNotInTarget.Count)"
    Write-Host "${TargetName} missing in ${SourceName}: $($targetNotInSource.Count)"
}

function Save-VulnerabilitiesCsv {
    param(
        [Parameter(Mandatory=$true)] [array]$Vulnerabilities,
        [Parameter(Mandatory=$true)] [hashtable]$HostLookup,    # machineId -> hostname
        [Parameter(Mandatory=$true)] [string]$CsvHostHeader,
        [Parameter(Mandatory=$true)] [string]$CsvCVEHeader,
        [Parameter(Mandatory=$true)] [string]$CsvSeverityHeader,
        [Parameter(Mandatory=$true)] [string]$OutputPath,
        [Parameter(Mandatory=$true)] [ref]$Attachments,
        [Parameter(Mandatory=$true)] [string]$SourceName
    )

    Write-Log "Processing $($Vulnerabilities.Count) vulnerabilities for CSV output..."

    $outputRows = @()

    foreach ($vuln in $Vulnerabilities) {
        $hostname = $HostLookup[$vuln.machineId]
        if (-not $hostname -or -not $vuln.cveId) { continue }

        $outputRows += [PSCustomObject]@{
            $CsvHostHeader     = $hostname
            $CsvCVEHeader      = $vuln.cveId
            $CsvSeverityHeader = $vuln.severity
        }
    }

    if ($outputRows.Count -eq 0) {
        Write-Log "No vulnerability data to export for $SourceName." "WARN"
        return @()
    }

    # Sort and convert
    $csv = $outputRows |
        Sort-Object $CsvHostHeader, $CsvCVEHeader |
        ConvertTo-Csv -NoTypeInformation |
        ConvertFrom-Csv

    # Export to file
    $csv | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $OutputPath
    $Attachments.Value += $OutputPath

    Write-Log "Saved $SourceName CSV to $OutputPath"
    Write-Host "`nDone exporting $SourceName CSV!" -ForegroundColor Green

    return $csv
}


# =====================================================
# VALIDATION & SETUP
# =====================================================

$reportingSetup = Initialize-Reporting -OutputDirectory $OutputDirectory -VulnerabilityManager $VulnerabilityManager

$csvPath          = $reportingSetup.CSVPath
$CSVHostHeader    = $reportingSetup.CSVHostHeader
$CSVCVEHeader     = $reportingSetup.CSVCVEHeader
$CSVSeverityHeader= $reportingSetup.CSVSeverityHeader
$attachments      = $reportingSetup.Attachments
$CVEDetails       = $reportingSetup.CVEDetails
$vmSafeName       = $reportingSetup.VMSafeName


# =====================================================
# MICROSOFT DEFENDER AUTHENTICATION
# =====================================================

Write-Log "Authenticating to Microsoft Defender..."

$TokenBody = @{
    client_id     = $DefenderClientId
    scope         = "https://api.securitycenter.microsoft.com/.default"
    client_secret = $DefenderClientSecret
    grant_type    = "client_credentials"
}

try {
    $TokenResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" `
        -Body $TokenBody `
        -ContentType "application/x-www-form-urlencoded"
}
catch {
    Write-Log "Authentication failed: $($_.Exception.Message)" "ERROR"
    exit 1
}

$AccessToken = $TokenResponse.access_token
$Headers = @{ Authorization = "Bearer $AccessToken" }

Write-Log "Authentication successful."

# =====================================================
# GET DEFENDER MACHINES
# =====================================================

Write-Log "Retrieving machines..."

$Machines = @()
$Skip = 0
$PageSize = 500

do {
    $Uri = "$DefenderBaseUrl/api/machines?`$top=$PageSize&`$skip=$Skip"
    $Response = Invoke-RestMethod -Method Get -Uri $Uri -Headers $Headers

    if ($Response.value) {
        $Machines += $Response.value
        $Skip += $PageSize
    }
}
while ($Response.value.Count -eq $PageSize)

$MachineLookup = @{}
foreach ($Machine in $Machines) {
    if ($Machine.id -and $Machine.computerDnsName) {
        $MachineLookup[$Machine.id] = $Machine.computerDnsName
    }
}

Write-Log "Machines retrieved: $($Machines.Count)"

# =====================================================
# BUILD DEFENDER ENDPOINT MAP (ALL MACHINES)
# =====================================================

Write-Log "Building Defender endpoint map..."

$defenderHosts = @{}   # normalizedName -> full machine object

foreach ($machine in $Machines) {

    if (-not $machine.computerDnsName) { continue }

    $normalized = Normalize-EndpointName $machine.computerDnsName
    if (-not $normalized) { continue }

    if (-not $defenderHosts.ContainsKey($normalized)) {
        $defenderHosts[$normalized] = $machine
    }
}

Write-Log "Total unique Defender endpoints: $($defenderHosts.Count)"

# =====================================================
# GET DEFENDER MACHINE VULNERABILITIES
# =====================================================

Write-Log "Retrieving machine vulnerabilities..."

$AllVulns = @()
$Skip = 0

do {
    $Uri = "$DefenderBaseUrl/api/vulnerabilities/machinesVulnerabilities?`$top=$PageSize&`$skip=$Skip"
    $Response = Invoke-RestMethod -Method Get -Uri $Uri -Headers $Headers

    if ($Response.value) {
        $AllVulns += $Response.value
        $Skip += $PageSize
    }
}
while ($Response.value.Count -eq $PageSize)

Write-Log "Machine vulnerabilities retrieved: $($AllVulns.Count)"

# =====================================================
# Save & Print CSV Output
# =====================================================

$csvData = Save-VulnerabilitiesCsv `
    -Vulnerabilities $AllVulns `
    -HostLookup $MachineLookup `
    -CsvHostHeader $CSVHostHeader `
    -CsvCVEHeader $CSVCVEHeader `
    -CsvSeverityHeader $CSVSeverityHeader `
    -OutputPath $csvPath `
    -Attachments ([ref]$attachments) `
    -SourceName $VulnerabilityManager

# =====================================================
# Action1 Setup 
# =====================================================

Setup-Action1Environment -APIKey $Action1APIKey -APISecret $Action1APISecret -OrgID $Action1OrgID -Region $Action1Region

# =====================================================
# RETRIEVE ACTION1 ENDPOINTS
# =====================================================

$a1eps = Get-Action1Endpoints

# =====================================================
# Compare Endpoints & Build CVE Map
# =====================================================

$eps = Build-EndpointCVEMap `
            -CsvData $csvData `
            -CSVHostHeader $CSVHostHeader `
            -CSVCVEHeader $CSVCVEHeader `
            -Action1Endpoints $a1eps

# =====================================================
# IDENTIFY MISSING ASSETS / ENDPOINT REPORTS
# =====================================================

Compare-EndpointsAndExportMissing `
    -SourceEndpoints $defenderHosts `
    -TargetEndpoints $a1eps `
    -OutputDirectory $OutputDirectory `
    -SourceName "$VulnerabilityManager" `
    -TargetName "Action1" `
    -Attachments ([ref]$attachments)

# =====================================================
# Build CVE Lists
# =====================================================

$cveAnalysis = Invoke-Action1CVEAnalysis `
    -EndpointCVEMap $eps `
    -VulnerabilityManager $VulnerabilityManager

$cvesforremediation = $cveAnalysis.CVEsForRemediation
$cveswithnopatch    = $cveAnalysis.CVEsWithNoPatch
$cvesnotrecognized  = $cveAnalysis.CVEsNotRecognized

# =====================================================
# Custom Attribute
# =====================================================

Invoke-Action1CustomAttributeUpdate `
    -SetCustomAttributes:$SetCustomAttributes `
    -CsvData $csvData `
    -CSVHostHeader $CSVHostHeader `
    -CSVSeverityHeader $CSVSeverityHeader `
    -Action1Endpoints $a1eps `
    -AttributeName $AttributeName

# =====================================================
# Email Results
# =====================================================

Invoke-EmailResults `
    -SendEmail:$SendEmail `
    -SmtpServer $SmtpServer `
    -SmtpPort $SmtpPort `
    -SmtpUser $SmtpUser `
    -SmtpPassword $SmtpPassword `
    -MailFrom $MailFrom `
    -MailTo $MailTo `
    -MailSubject $MailSubject `
    -UseSsl:$UseSsl `
    -Attachments $attachments `
    -VulnerabilityManager $VulnerabilityManager `
    -OutputDirectory $OutputDirectory

# =====================================================
# Reporting
# =====================================================

Invoke-EndpointAndCVEReporting `
    -VulnerabilityManager $VulnerabilityManager `
    -Action1Endpoints $a1eps `
    -VMEndpoints $defenderHosts `
    -EndpointCVEMap $eps `
    -CVEsForRemediation $cvesforremediation `
    -CVEsWithNoPatch $cveswithnopatch `
    -CVEsNotRecognized $cvesnotrecognized `
    -CVEDetails $cveDetails `
    -OutputDirectory $OutputDirectory
