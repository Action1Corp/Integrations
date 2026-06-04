// signals.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const SIGNAL_TYPES = Object.freeze({
  OFFLINE: "OFFLINE",
  REBOOT_REQUIRED: "REBOOT_REQUIRED",
  AUTOMATION_FAILED: "AUTOMATION_FAILED",
  VULNERABILITY: "VULNERABILITY",
  UPDATE: "UPDATE",
});

const SIGNAL_TYPE_VALUES = Object.freeze(Object.values(SIGNAL_TYPES));

const VULNERABILITY_SEVERITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
const UPDATE_SEVERITIES = Object.freeze(["CRITICAL", "IMPORTANT", "MODERATE", "LOW", "UNSPECIFIED"]);
const REMEDIATION_STATUSES = Object.freeze(["OVERDUE", "DUE_SOON"]);

module.exports = {
  SIGNAL_TYPES,
  SIGNAL_TYPE_VALUES,
  VULNERABILITY_SEVERITIES,
  UPDATE_SEVERITIES,
  REMEDIATION_STATUSES,
};
