// shell.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const UI_TABS = Object.freeze({
  CONNECTION: "connection",
  CONFIGURATION: "configuration",
  MAPPING: "mapping",
  SYNC: "sync",
});

const UI_TAB_ORDER = Object.freeze([UI_TABS.CONNECTION, UI_TABS.CONFIGURATION, UI_TABS.MAPPING, UI_TABS.SYNC]);

const UI_SHELL_MODEL = Object.freeze({
  connectionModel: {
    action1: {
      fields: [
        { key: "baseUrl", label: "Base URL" },
        { key: "clientId", label: "Client ID" },
        { key: "clientSecret", label: "Client Secret", secret: true },
      ],
    },
    halo: {
      fields: [
        { key: "resourceServer", label: "Resource Server" },
        { key: "authorisationServer", label: "Authorisation Server" },
        { key: "tenant", label: "Tenant" },
        { key: "clientId", label: "Client ID" },
        { key: "clientSecret", label: "Client Secret", secret: true },
      ],
    },
  },
  tabs: [
    {
      id: UI_TABS.CONNECTION,
      title: "Connection",
      sections: [
        { id: "action1-connection", title: "Action1 Connection" },
        { id: "halo-connection", title: "HaloPSA Connection" },
        { id: "connection-tests", title: "Connection Tests" },
      ],
    },
    {
      id: UI_TABS.CONFIGURATION,
      title: "Configuration",
      sections: [
        { id: "ticket-destination", title: "Ticket Destination" },
        { id: "lifecycle-behavior", title: "Lifecycle" },
        { id: "signal-filters", title: "Signal Filters" },
        { id: "priority-mappings", title: "Priority Mapping" },
      ],
    },
    {
      id: UI_TABS.MAPPING,
      title: "Mapping",
      sections: [
        { id: "org-client-mappings", title: "Action1 Org to Halo Client" },
        { id: "client-org-provisioning", title: "Halo Client to Action1 Org" },
      ],
    },
    {
      id: UI_TABS.SYNC,
      title: "Sync",
      sections: [
        { id: "sync-schedule", title: "Sync Schedule" },
        { id: "sync-manual", title: "Manual Run" },
        { id: "sync-status", title: "Last Sync Status" },
        { id: "sync-diagnostics", title: "Diagnostics" },
        { id: "sync-maintenance", title: "Maintenance" },
      ],
    },
  ],
  apiBoundaries: {
    connection: {
      testAction1: "/api/connection/action1/test",
      testHalo: "/api/connection/halo/test",
    },
    configuration: {
      load: "/api/config/load",
      save: "/api/config/save",
      discovery: "/api/discovery",
    },
    mapping: {
      loadMappings: "/api/mapping/load",
      saveMappings: "/api/mapping/save",
      previewProvisioning: "/api/mapping/provisioning/preview",
      executeProvisioning: "/api/mapping/provisioning/execute",
    },
  },
});

function getUiShellModel() {
  return UI_SHELL_MODEL;
}

module.exports = {
  UI_TABS,
  UI_TAB_ORDER,
  UI_SHELL_MODEL,
  getUiShellModel,
};
