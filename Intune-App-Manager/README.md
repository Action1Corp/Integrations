# Action1 -- Intune Agent Application Manager

## Overview

The **Action1 -- Intune Agent Application Manager** script automates the deployment and lifecycle management of the Action1 Agent within Microsoft Intune, ensuring endpoints always have the latest agent version installed.

This integration allows IT and security teams to:

- Automatically download the latest organization-specific Action1 Agent
- Maintain an up-to-date Win32 Action1 application in Intune
- Eliminate manual packaging and version tracking
- Ensure consistent deployment across all users

This guide explains what the script does, how to configure required credentials, and how to execute it.

---

## What the Integration Does

The PowerShell script performs the following actions:

- Downloads the latest Action1 Agent MSI for your organization
- Extracts the MSI product version
- Connects to Microsoft Graph and Intune APIs
- Queries Intune for an existing **Action1 Agent** Win32 LOB application
- Compares versions between:
  - Existing Intune application
  - Newly downloaded MSI
- Determines appropriate action:
  - **If no app exists:** Creates and publishes a new application
  - **If app exists and is current:** No action taken
  - **If a newer version is available:**
    - Removes the existing app
    - Publishes a new updated version
- Assigns the application to all users as **Available**

---

## Prerequisites

Before running the script:

- PowerShell **5.1 or later**
- Microsoft Intune environment configured
- Azure AD App Registration with:
  - `DeviceManagementApps.ReadWrite.All`
  - `DeviceManagementManagedDevices.ReadWrite.All`
- Network access to:
  - `https://graph.microsoft.com`
  - `https://app.action1.com` 

### Required PowerShell Modules

The script will automatically install missing modules if needed:

- `Microsoft.Graph`
- `Microsoft.Graph.DeviceManagement`
- `Microsoft.Graph.DeviceManagement.Enrollment`
- `IntuneWin32App`

---

## Getting Action1 Agent Information

1. Log in to Action1: https://app.action1.com  
2. Locate your **Agent ID**
	- Click "+Install Agent -> Other Options..."
	- The Agent ID is the GUID in the URLs provided
3. Identify your **Organization Name**

Use these values in the script:

```powershell
$AgentId   = "<your_agent_id>"
$OrgName = "<your_organization_name>"
```

## Getting Microsoft Intune API Credentials

1. Go to Azure Portal  
2. Navigate to **Azure Active Directory > App Registrations**  
3. Create a new application  
4. Assign API permissions:
   - `DeviceManagementApps.ReadWrite.All`
   - `DeviceManagementManagedDevices.ReadWrite.All`
5. Grant admin consent  
6. Create a client secret  

Use these values in the script:

```powershell
$TenantId     = "<your_tenant_id>"
$ClientId     = "<your_client_id>"
$ClientSecret = "<your_client_secret>"
```

## Running the Script

Update the parameters before running the script.

### Parameters

| Parameter        | Description |
|-----------------|------------|
| AgentId         | Action1 Agent ID |
| OrgName         | Action1 organization name |
| TenantId        | Azure AD tenant ID |
| ClientId        | Azure application (client) ID |
| ClientSecret    | Azure application client secret |
| OutputFolder    | Directory where MSI will be downloaded  and`.intunewin` package will be created |
| ImageURI        | URL for application icon |
| InformationURL  | Application information URL |
| PrivacyURL      | Application privacy policy URL |

---

## How It Works

### 1. Authentication

- Connects to Microsoft Graph using client credentials  
- Establishes a session with Intune APIs  

### 2. MSI Download

- Downloads the organization-specific Action1 Agent MSI:


https://app.action1.com/agent/<AgentId>/Windows/agent(<OrgName>).msi


### 3. Version Extraction

- Uses Windows Installer COM object to extract:
  - `ProductVersion`

### 4. Intune App Lookup

- Queries Microsoft Graph for existing Win32 applications matching:
  - `"Action1 Agent"`

### 5. Version Comparison

- Compares:
  - Existing Intune app version  
  - Latest MSI version  

### 6. Application Packaging and Deployment

- Packages MSI into `.intunewin`  
- Configures:
  - Detection rule (MSI Product Code + Version)  
  - Requirement rule (Windows 10 20H2+)  
  - Return code handling  
  - Application icon  

### 7. Decision Logic

| Scenario | Action |
|----------|--------|
| No app exists | Create new Intune application |
| App exists and is up to date | Do nothing |
| Newer version available | Remove old app and create new one |

### 8. Assignment

- Assigns application to **All Users**  
- Deployment type: **Available**  
- Notifications enabled  

---

## Output

| Output | Description |
|--------|-------------|
| Console output | Execution logs and status messages |

---

## Notes

- Existing Intune app is removed before publishing a new version  
- Application is assigned as **Available**, not required  
- Custom return code `1337` is configured as retry  
- Minimum supported OS: **Windows 10 20H2**  
- Script uses **Graph API endpoint** for app lookup  

---

## Recommendations

- Test in a non-production environment before deployment  
- Schedule periodic execution (e.g., daily, weekly) to keep agent updated  
- Monitor Intune deployment status after updates  
- Implement logging or alerting for production usage  
