# Entra → Action1 Connector

**Version:** 1.0.0

A lightweight connector that synchronizes device data from Microsoft Entra ID into Action1, enabling dynamic grouping and automation in Action1 based on Entra ID device group membership.

## What It Does

The Entra → Action1 Connector:

- Reads devices and their group membership from Microsoft Entra ID
- Matches devices to endpoints in Action1
- Writes Entra-related data into Action1 endpoint custom attributes
- Enables dynamic grouping and automation in Action1

## Typical Use Case

- Devices are members of groups in Entra ID (for example: Marketing, Production Servers)
- Group membership is written to Action1 custom attributes
- Action1 dynamic groups automatically include the correct endpoints
- Automation and targeting stay aligned with Entra ID

## Device Matching

Devices are matched using:

- Entra ID Device Display Name
- Action1 Endpoint Name

Device names must match between Entra ID and Action1.

## Getting Started

This repository contains the connector source code.  
A step-by-step configuration and deployment guide is provided separately.

See the full documentation:

- `docs/Entra_Groups_Action1_Connector_Guide.pdf`

## Platform Support

- Windows
- Linux
- macOS

The connector is a Node.js–based application.

## Security Notes

- Read-only access to Entra ID
- Writes only to Action1 endpoint custom attributes

## License

This project is licensed under the Apache License, Version 2.0.
See the LICENSE file for details.
