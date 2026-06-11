# Action1 → HaloPSA Connector

**Version:**  1.0

Integrate Action1 with HaloPSA to automatically create, update, and manage HaloPSA tickets based on Action1 endpoint, vulnerability, update, and automation signals.

The connector is designed for MSPs and IT teams using HaloPSA as their service desk and Action1 for endpoint management, vulnerability management, patching, and automation workflows.

---

# Important Legal Notice

Use of all scripts, source code, binaries, installers, templates, dashboards, reports, integrations, connectors, containers, packages, documentation, and other materials in this repository is subject to [TERMS_OF_USE](./TERMS_OF_USE.md).

These materials may modify systems, install dependencies, connect to third-party services, transmit data, store credentials, create local databases, expose web interfaces, or otherwise impact production or non-production environments.

**Use at your own risk. Review the code. Test before production deployment.**

## Additional Notices

* [DISCLAIMER](./DISCLAIMER.md)
* [THIRD_PARTY_INTEGRATIONS](./THIRD_PARTY_INTEGRATIONS.md)
* [SECURITY_NOTICE](./SECURITY_NOTICE.md)
* [NOTICE](./NOTICE.md)
* [TERMS_OF_USE](./TERMS_OF_USE.md)

---

# Overview

The Action1 HaloPSA Connector synchronizes operational and security events from Action1 into HaloPSA tickets.

Supported use cases include:

* Missing updates
* Vulnerabilities
* Failed automations
* Offline endpoints
* Reboot-required endpoints

The connector can create tickets either:

* Per endpoint
* Per issue (grouped ticketing)

depending on the selected configuration.

---

# Configuration

See [CONFIGURATION.md](./CONFIGURATION.md) for step-by-step setup instructions.

---

# Key Features

## Ticket Lifecycle Management

The connector supports:

* Ticket creation
* Ticket updates
* Open-ticket correlation
* Duplicate prevention

## Grouped Ticketing

Grouped ticketing can automatically consolidate:

* Vulnerabilities
* Missing updates
* Failed automations

into a single HaloPSA ticket per issue.

Impacted endpoints are listed inside the ticket.

## Endpoint-Based Ticketing

Endpoint-specific signals can be tracked individually:

* Offline endpoints
* Reboot-required endpoints

## Scheduler

Built-in scheduler support allows periodic synchronization runs.

## Safe Correlation

The connector maintains ticket correlation state to prevent duplicate ticket creation and preserve lifecycle continuity.

---

# Requirements

## NodeJS

Node.js 24 LTS or later
Download the Windows Installer from the [official Node.js website](https://nodejs.org/en/download).
Make sure the selected version is marked as **LTS**.


## Action1

You will need:

* An Action1 tenant
* Action1 API credentials
* Access to the required Action1 organizations

## HaloPSA

You will need:

* A HaloPSA instance
* A HaloPSA API application
* HaloPSA API credentials
* Appropriate permissions to create and update tickets

---

# Installation

Clone the repository:

```bash
git clone https://github.com/Action1Corp/action1-halo-connector.git
```

Install dependencies:

```bash
npm install
```

Start the connector:

```bash
npm start
```

---

# Running the Connector

## Manual foreground mode

Use this mode for testing and first-time setup:

```powershell
npm start
```

Important notes:

* This runs the connector in the current terminal session.
* Closing the terminal stops the connector.
* Logging off may stop the process.
* This mode is not recommended for long-running production use.

## Background mode on Windows

Use Windows Task Scheduler for long-running standalone operation.

Script-based setup:

```powershell
.\scripts\install-windows-task.ps1
```

This creates or replaces a scheduled task named:

```text
Action1HaloPSAConnector
```

The task runs:

```text
node.exe src\main.js
```

from the connector root directory at system startup.

Management commands:

```powershell
Start-ScheduledTask -TaskName "Action1HaloPSAConnector"
Stop-ScheduledTask -TaskName "Action1HaloPSAConnector"
Get-ScheduledTask -TaskName "Action1HaloPSAConnector"
Get-ScheduledTaskInfo -TaskName "Action1HaloPSAConnector"
```

Uninstall:

```powershell
.\scripts\uninstall-windows-task.ps1
```

## Manual Task Scheduler fallback

If the install script does not work in your environment, create the task manually in Windows Task Scheduler.

General:

* Name: `Action1HaloPSAConnector`
* Run whether user is logged on or not
* Run with highest privileges
* User account: `NT AUTHORITY\SYSTEM` or another dedicated service account

Trigger:

* At startup

Action:

* Program/script: full path to `node.exe`
* Arguments: `src\main.js`
* Start in: connector root directory

Settings:

* Allow task to be run on demand
* If the task fails, restart every 1 minute
* Attempt restart several times
* Do not set a short execution time limit

Important notes:

* Install the latest Node.js LTS before creating the task.
* The task must use the connector directory as its working directory.
* The connector stores local runtime files in `data/` and logs in `logs/`.
* Ensure the selected task account has read/write access to the connector directory.

---

# Configuration

The connector includes a web-based configuration interface.

Configuration areas include:

* Action1 API settings
* HaloPSA API settings
* Organization mapping
* Ticket routing
* Ticket lifecycle settings
* Signal selection
* Scheduler configuration

---

# Supported Signals

| Signal             | Ticketing Mode      |
| ------------------ | ------------------- |
| Vulnerabilities    | Grouped or Endpoint |
| Missing Updates    | Grouped or Endpoint |
| Failed Automations | Grouped or Endpoint |
| Offline Endpoints  | Endpoint            |
| Reboot Required    | Endpoint            |

---

# Ticket Creation Modes

## Create Tickets Per Issue (Recommended)

Creates one HaloPSA ticket per:

* Vulnerability
* Missing update
* Failed automation

Impacted endpoints are listed within the ticket.

This mode reduces ticket volume and is the recommended default configuration.

## Create Tickets Per Endpoint

Creates one HaloPSA ticket for each affected endpoint.

This mode is useful when endpoint-level tracking is required.

---

# Current Version Scope

This repository currently provides the standalone connector implementation.

Included in this release:

* Ticket lifecycle management
* Grouped ticketing
* Endpoint-based ticketing
* Scheduler support
* HaloPSA organization mapping
* Action1 signal collection
* Ticket correlation and duplicate prevention

Not included in this release:

* Automatic Action1 organization provisioning
* Database-backed persistence
* Marketplace deployment packaging
* Multi-node clustering
* High-scale database architecture

---

# Logging

The connector provides two logging modes:

## Standard Operator Logs

Compact per-run logs are written automatically and provide:

* Run summary
* Organization statistics
* Signal counts
* Candidate totals
* Lifecycle results

## Debug Logging

Optional detailed logging can be enabled from the UI for troubleshooting purposes.

Enable debug logging only when required for troubleshooting.


## License

This project is licensed under the Apache License, Version 2.0.
See the LICENSE file for details.
