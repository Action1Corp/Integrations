# Action1 → HaloPSA Connector Configuration Guide

This guide explains how to install and configure the Action1 → HaloPSA Connector.

The connector creates, updates, and manages HaloPSA tickets based on Action1 signals, including vulnerabilities, missing updates, failed automations, offline endpoints, and reboot-required endpoints.

---

# Prerequisites

Before configuring the connector, make sure you have:

* Node.js 24 LTS or later
  Download the Windows Installer from the [official Node.js website](https://nodejs.org/en/download).
  Make sure the selected version is marked as **LTS**.

* A HaloPSA instance
* Access to create or modify HaloPSA API applications
* An Action1 tenant
* Action1 API credentials
* Network access from the connector host to:

  * Action1 API
  * HaloPSA API

---

## Step 1: Install and Verify the Connector

Download or clone the connector repository to the Windows machine where it will run.

Open a terminal in the connector directory.

Install dependencies:

```bash
npm install
```

Start the connector:

```bash
npm start
```

Open the connector web interface in your browser and complete the initial configuration.

At this stage, verify that:

* The connector starts successfully.
* The web interface is accessible.
* You can save the configuration.
* Action1 and HaloPSA connection tests succeed.
* Discovery data loads correctly.

### Manual Foreground Mode

Running the connector with:

```bash
npm start
```

starts the connector in the current terminal session.

This mode is recommended for:

* Initial installation
* Configuration
* Testing
* Troubleshooting

Important notes:

* Closing the terminal stops the connector.
* Signing out of Windows may stop the connector.
* Restarting the machine stops the connector until it is started again.
* This mode is not recommended for long-running production deployments.

---

## Configure Background Operation on Windows

After verifying that the connector runs correctly in manual mode, configure it to run automatically in the background using Windows Task Scheduler.

The connector includes a PowerShell installation script that creates and configures the scheduled task automatically.

### Script-Based Installation (Recommended)

Open **Windows PowerShell as Administrator**.

Navigate to the connector directory:

```powershell
cd C:\Path\To\action1-halo-connector
```

Run:

```powershell
.\scripts\install-windows-task.ps1
```

The script automatically:

* Creates a scheduled task named `Action1HaloPSAConnector`
* Configures the task to start automatically when Windows starts
* Runs the connector under the built-in `NT AUTHORITY\SYSTEM` account
* Enables automatic restart if the connector process exits unexpectedly
* Starts the connector immediately (unless the script is executed with `-NoStart`)

Once installed, the connector operates in the background and does not require an open terminal window.

The connector continues running:

* When all users log off
* After Windows reboots
* Independently of interactive user sessions

The connector's internal scheduler continues to operate normally while the background process is running.

### Scheduled Task Management

Check task status:

```powershell
Get-ScheduledTask -TaskName "Action1HaloPSAConnector"
Get-ScheduledTaskInfo -TaskName "Action1HaloPSAConnector"
```

Manually start the task:

```powershell
Start-ScheduledTask -TaskName "Action1HaloPSAConnector"
```

Manually stop the task:

```powershell
Stop-ScheduledTask -TaskName "Action1HaloPSAConnector"
```

Remove the task:

```powershell
.\scripts\uninstall-windows-task.ps1
```

---

## Manual Task Scheduler Setup (Fallback)

If the installation script cannot be used in your environment, the task can be created manually.

Open:

```text
Task Scheduler
```

and select:

```text
Create Task
```

### General Tab

Configure:

* Name: `Action1HaloPSAConnector`
* Run whether user is logged on or not
* Run with highest privileges
* User account: `NT AUTHORITY\SYSTEM`

### Triggers Tab

Create a new trigger:

```text
Begin the task: At startup
Enabled: Yes
```

### Actions Tab

Create a new action:

Program/script:

```text
C:\Program Files\nodejs\node.exe
```

(Use the actual location of node.exe if installed elsewhere.)

Add arguments:

```text
src\main.js
```

Start in:

```text
C:\Path\To\action1-halo-connector
```

The **Start in** directory is important and must point to the connector root directory.

### Settings Tab

Recommended settings:

* Allow task to be run on demand
* Run task as soon as possible after a scheduled start is missed
* If the task fails, restart every 1 minute
* Attempt restart several times
* Do not configure a short execution time limit

### Final Verification

After creating the task:

1. Start the task manually.
2. Confirm the connector web interface is accessible.
3. Close all terminal windows.
4. Confirm the connector remains available.
5. Reboot the machine and verify the connector starts automatically.

### Additional Notes

* Install the latest Node.js LTS release before creating the task.
* The connector stores runtime data in the `data/` directory.
* Connector logs are written to the `logs/` directory.
* The task account must have read/write access to the connector directory.
* If Node.js is upgraded or moved to a different location, recreate the scheduled task using the installation script.

# Step 2: Register a New HaloPSA Application Integration

1. Log into your HaloPSA instance.

2. Navigate to:

```text
Configuration > Integrations > HaloPSA API
```

3. Take note of your:

* Resource Server
* Authorisation Server

These values will be required later when configuring the connector.

4. Under the Applications menu, select:

```text
View Applications
```

5. Select:

```text
New
```

at the top right.

---

# Step 3: Create and Configure the HaloPSA API Application

Complete the following configuration options to generate an appropriate API key.

## Application Name

For the Application Name, enter your desired name.

Recommended value:

```text
Action1 HaloPSA Connector
```

## Active

Ensure that the **Active** checkbox is checked on.

## Authorization Method

For the Authorization Method, select:

```text
Client ID and Secret (Services)
```

## Client ID and Client Secret

Copy your:

* Client ID
* Client Secret

**Important:** The Client Secret will not be visible after this step.

## Login Type

For Login Type, select:

```text
Agent
```

## Agent to Log In As

For the Agent to log in as, select a system administrator within your HaloPSA instance.

Alternatively, you may create a dedicated integration agent and configure the required Agent Role Permissions for that agent.

## Why Login Type as Agent?

The connector creates and manages HaloPSA tickets on behalf of a HaloPSA user account. For that reason, the integration should authenticate as an Agent rather than a Vendor or Customer.

Using the Agent login type provides access to the ticketing functionality and related entities required by the connector

**Important:** The selected agent should have sufficient permissions to create, update, and view tickets, as well as access the HaloPSA clients. For initial deployment, using an administrator account is recommended. Alternatively, you may create a dedicated integration agent with a custom role that grants the required permissions.

---

# Step 4: Enable Permissions for the HaloPSA Application Integration

1. Navigate to the Permissions tab at the top.

2. Select the first option for:

```text
All
```

or enable the permission by ticking:

```text
read:tickets, edit:tickets, read:customers and admin
```

3. Select the Save button to confirm your changes.

There is no need to modify the Security tab of the API area. You may skip this part.

---

# Step 5: Generate Action1 API Credentials

In Action1, create or locate the API access configuration that will be used by the HaloPSA Connector.

Make sure you have:

* Client ID
* Client Secret
* Access to the Action1 organizations you want to sync
* Required minimum API roles for read access

Recommended Action1 permissions:

| Permission                   | Purpose                                                                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| View Endpoints               | View endpoints and their details, including missing updates, vulnerabilities, installed software, and automation history in the specified scope.                                                                      |
| View Automations and History | View automations and their history, including automation instances, in the specified scope.                                                                                                                           |
| View Vulnerabilities         | View vulnerabilities and CVE descriptions in the specified scope.                                                                                                                                                     |
| View Dashboards              | View dashboards in the specified scope. This may implicitly include permissions such as View Endpoints, View Updates, View Vulnerabilities, View Installed Software, and View Advanced Settings for the SLA category. |

If the API credentials do not have access to the organizations you intend to map, the connector may not be able to discover them or process their data correctly.

---

# Step 6: Configure the HaloPSA API Connection in the Connector

At this point, you should have the following HaloPSA values:

* Resource Server
* Authorisation Server
* Client ID
* Client Secret

Open the connector web interface.

Navigate to the Connection or Configuration section.

In the HaloPSA API section, enter:

* Resource Server URL
* Authorisation Server URL
* Client ID
* Client Secret

Use the full URLs, including the `https://` prefix.

Click:

```text
Test Connection
```

Confirm that the connection succeeds.

Then click:

```text
Save
```

---

# Step 7: Configure the Action1 API Connection in the Connector

In the connector web interface, open the Action1 API section.

Enter:

* Action1 Base URL
* Client ID
* Client Secret

Click:

```text
Test Connection
```

Confirm that the connection succeeds.

Then click:

```text
Save
```

At this stage, the goal is to confirm that the connector can connect to both Action1 and HaloPSA and that the API credentials are valid.

---

# Step 8: Map Action1 Organizations to HaloPSA Clients

Once both API connections are configured, map Action1 Organizations to HaloPSA Clients.

Open the Mapping section in the connector web interface.

For each Action1 Organization you want to sync:

1. Select the Action1 Organization.
2. Select the corresponding HaloPSA Client.
3. Save the mapping.

Only mapped Action1 Organizations will be processed by the connector.

Example:

| Action1 Organization | HaloPSA Client |
| -------------------- | -------------- |
| Contoso              | Contoso        |
| Fabrikam             | Fabrikam       |

---

# Step 9: Configure Ticket Routing and Lifecycle Settings

Open the Configuration section in the connector web interface.

Configure the HaloPSA ticket settings that should be used when the connector creates or updates tickets.

## Team

Select the team that should initially own tickets created by the connector.

## Ticket Type

Select the HaloPSA ticket type that should be used for connector-created tickets.

The ticket type determines which tabs, fields, workflows, and tools are available on the ticket.

**Important:** Some HaloPSA ticket types may require additional mandatory fields. The connector creates tickets using the fields it is configured to provide. If the selected ticket type requires additional mandatory fields, HaloPSA may reject ticket creation.

If ticket creation fails, review the selected Ticket Type, required fields, Status, Team, and Category configuration in HaloPSA.

## New Ticket Status

Select the status that should be assigned when a new ticket is created.

Example:

```text
New
```

## Closed Ticket Statuses

Select the statuses that indicate a ticket is resolved, completed, or closed.

When the connector detects that an existing linked ticket is in one of these statuses, it will treat that ticket as closed for lifecycle purposes.

If the same issue appears again later, the connector may create a new ticket instead of updating the closed ticket.

## Category

Select the HaloPSA category that should be assigned to tickets created by the connector, if applicable.

---

# Step 10: Configure Ticket Creation Mode

The connector supports two ticket creation modes.

## Create Tickets Per Issue

This is the recommended mode for most environments.

The connector creates one HaloPSA ticket per:

* Vulnerability
* Missing update
* Failed automation run

Affected endpoints are listed inside the ticket.

This mode reduces ticket volume and makes it easier to track issue-level remediation.

## Create Tickets Per Endpoint

The connector creates one HaloPSA ticket for each affected endpoint.

This mode may be useful when each endpoint must be tracked separately.

---

# Step 11: Configure Action1 Signals

Select which Action1 signals should create or update HaloPSA tickets.

Supported signals:

## Vulnerabilities

Creates tickets for endpoints affected by selected vulnerability severities and remediation states.

## Missing Updates

Creates tickets for endpoints missing selected update types or severities.

## Failed Automations

Creates tickets for failed Action1 automation runs.

## Offline Endpoints

Creates tickets for endpoints that have not checked in within the configured threshold.

## Reboot Required

Creates tickets for endpoints that require reboot.

Disabled signals are ignored during synchronization.

---

# Step 12: Configure Existing Open Ticket Behavior

Configure what the connector should do when it detects that a matching open HaloPSA ticket already exists.

The default behavior is to update existing open tickets rather than creating duplicates.

This helps keep Action1 issue state and HaloPSA ticket state aligned.

---

# Step 13: Configure Advanced Settings

## Max Open Tickets Per Organization

Default:

```text
30
```

This limits how many open connector-managed tickets can exist for a single mapped Action1 Organization.

When the limit is reached, additional create actions may be skipped until existing connector-managed tickets are closed or updated.

## Enable Debug Logging

Default:

```text
Disabled
```

Enable debug logging only when troubleshooting.

Debug logging writes detailed diagnostic information such as API collection details, retry behavior, and lifecycle decision traces.

---

# Step 14: Configure Scheduler

The scheduler is disabled by default.

If you want the connector to run automatically:

1. Open the Sync section.
2. Enable the scheduler.
3. Select the synchronization interval.
4. Save the scheduler configuration.

Available intervals may include:

* 3 hours
* 6 hours
* 12 hours
* 24 hours

Start with a longer interval, such as 24 hours, until the initial configuration is validated.

---

# Step 15: Run the First Sync

Open the Sync section.

Click:

```text
Run Now
```

Review the run status and summary.

After the run completes, verify:

* Action1 Organizations were processed
* Candidates were detected
* HaloPSA tickets were created, updated, skipped, or closed as expected
* No ticket creation failures occurred

---

# Logs

The connector writes local logs on the connector host.

## Per-Run Logs

Per-run logs are written to:

```text
logs/lifecycle-runs/
```

These logs provide a compact summary of each sync run.

They include:

* Run start and finish
* Mapped organizations
* Signal counts
* Candidate totals
* Created, updated, skipped, closed, and failed ticket counts

## Debug Log

Detailed debug logging is written to:

```text
logs/lifecycle.log
```

Debug logging is controlled by the Enable Debug Logging setting.

When debug logging is disabled, the connector keeps only high-level lifecycle information.

When debug logging is enabled, the connector writes detailed diagnostic information.

---

# Local Data Storage

The connector stores local runtime data under:

```text
data/
```

This may include:

* Connector configuration
* Stored API secrets
* Ticket correlation state
* Scheduler state
* Signal watermarks
* Lifecycle run history

Do not commit the `data/` folder or `logs/` folder to source control.

Recommended `.gitignore` entries:

```text
data/
logs/
```

---

# Troubleshooting

## HaloPSA Ticket Creation Fails

If HaloPSA rejects ticket creation, check:

* Ticket Type
* Required custom fields
* Team
* Status
* Category
* Agent permissions
* API application permissions

Some HaloPSA ticket types require mandatory fields that the connector does not provide.

In that case, select a different ticket type or adjust the required fields in HaloPSA.

## Action1 Organizations Are Missing

Check that the Action1 API credentials have access to the organizations you want to sync.

Also verify that the credentials include the required read permissions.

## Connection Test Fails

Check:

* URLs
* Client ID
* Client Secret
* API permissions
* Network connectivity
* Firewall or proxy rules

## No Tickets Are Created

Check:

* Organization mappings
* Enabled signals
* Ticket creation mode
* Max open tickets per organization
* Existing open linked tickets
* Ticket routing settings
* Closed status configuration

---

# Recommended First-Run Checklist

Before enabling the scheduler:

1. Configure HaloPSA API access.
2. Configure Action1 API access.
3. Test both API connections.
4. Map at least one Action1 Organization to a HaloPSA Client.
5. Configure ticket routing.
6. Select ticket creation mode.
7. Enable desired Action1 signals.
8. Run manually with Run Now.
9. Review the per-run log.
10. Verify tickets in HaloPSA.
11. Enable the scheduler only after successful validation.
