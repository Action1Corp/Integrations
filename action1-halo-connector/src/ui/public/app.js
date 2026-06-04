// app.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
(function () {
  const ACTION1_REGION_OPTIONS = Object.freeze([
    {
      label: "Global / North America (https://app.action1.com/api/3.0)",
      baseUrl: "https://app.action1.com/api/3.0",
    },
    {
      label: "Europe (https://app.eu.action1.com/api/3.0)",
      baseUrl: "https://app.eu.action1.com/api/3.0",
    },
    {
      label: "Australia (https://app.au.action1.com/api/3.0)",
      baseUrl: "https://app.au.action1.com/api/3.0",
    },
  ]);

  const SIGNAL_LABELS = Object.freeze({
    severity: {
      CRITICAL: "Critical",
      HIGH: "High",
      MEDIUM: "Medium",
      LOW: "Low",
      IMPORTANT: "Important",
      MODERATE: "Moderate",
      UNSPECIFIED: "Unspecified",
    },
    remediation: {
      OVERDUE: "Overdue",
      DUE_SOON: "Due soon",
    },
  });

  const LIFECYCLE_RUN_CONFIRMATION = "RUN_LIFECYCLE_ONCE";
  const DEFAULT_SYNC_HISTORY_LIMIT = 10;
  const SYNC_RECENT_RUNS_VISIBLE_LIMIT = 10;
  const DEFAULT_MAX_OPEN_TICKETS_PER_ORG = 30;
  const SYNC_HISTORY_TIMEOUT_MS = 15000;
  const SYNC_SCHEDULER_TIMEOUT_MS = 15000;

  const state = {
    shell: null,
    config: null,
    discovery: null,
    ticketTypeDetail: null,
    activeTab: "connection",
    action1RegionSelectionTouched: false,
    action1RegionUnmappedSavedValue: "",
    closedStatusesDraft: [],
    configBaseline: null,
    configSaveState: {
      mode: "saved",
      detail: "",
    },
    mappingDraftRows: [],
    mappingBaselineRows: [],
    mappingSaveState: {
      mode: "saved",
      detail: "",
    },
    connectionUi: {
      haloExpanded: false,
      action1Expanded: false,
    },
    sync: {
      runInProgress: false,
      runError: "",
      history: [],
      historyLoading: false,
      historyError: "",
      historyRequestedOnce: false,
      advancedExpanded: false,
      advancedSaving: false,
      advancedSaveMessage: "",
      scheduler: {
        requestedOnce: false,
        loading: false,
        saving: false,
        error: "",
        status: null,
      },
      activeRun: {
        inProgress: false,
        trigger: "",
        startedAt: "",
      },
    },
  };

  const el = {
    tabs: document.getElementById("tabs"),
    globalStatus: document.getElementById("globalStatus"),
    connection: document.getElementById("tab-connection"),
    configuration: document.getElementById("tab-configuration"),
    mapping: document.getElementById("tab-mapping"),
    sync: document.getElementById("tab-sync"),
  };

  init().catch((error) => {
    setGlobalStatus(`Startup failed: ${error.message}`, "error");
  });

  async function init() {
    setGlobalStatus("Loading...", "info");
    const payload = await apiGet("/api/config/load");
    state.shell = payload.data.uiShell;
    state.config = payload.data.config;
    state.configBaseline = clone(payload.data.config);
    resetMappingDraftFromConfig();
    await loadDiscovery();
    renderApp();
    setGlobalStatus("Ready", "success");
  }

  function renderApp() {
    renderTabs();
    renderConnectionTab();
    renderConfigurationTab();
    renderMappingTab();
    renderSyncTab();
    syncTabVisibility();
  }

  function renderTabs() {
    const tabs = (state.shell && state.shell.tabs) || [];
    const labelMap = {
      connection: "Connection",
      configuration: "Configuration",
      mapping: "Tenant Mapping",
      sync: "Sync",
    };
    el.tabs.innerHTML = "";
    tabs.forEach((tab) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tab-text ${state.activeTab === tab.id ? "active" : ""}`;
      button.textContent = labelMap[tab.id] || tab.id;
      button.onclick = () => {
        state.activeTab = tab.id;
        renderApp();
      };
      el.tabs.appendChild(button);
    });
  }

  function syncTabVisibility() {
    togglePanel(el.connection, state.activeTab === "connection");
    togglePanel(el.configuration, state.activeTab === "configuration");
    togglePanel(el.mapping, state.activeTab === "mapping");
    togglePanel(el.sync, state.activeTab === "sync");
  }

  function renderConnectionTab() {
    const action1 = state.config.connections.action1 || {};
    const halo = state.config.connections.halo || {};
    const regionSelection = deriveAction1RegionSelection(action1.baseUrl);
    state.action1RegionSelectionTouched = false;
    state.action1RegionUnmappedSavedValue = regionSelection.matched ? "" : String(action1.baseUrl || "");
    const haloConfigured = isHaloConfigured();
    const action1Configured = isAction1Configured();
    const showHaloForm = !haloConfigured || state.connectionUi.haloExpanded;
    const showAction1Form = !action1Configured || state.connectionUi.action1Expanded;

    el.connection.innerHTML = `
      <div class="section config-card-section">
        <div class="config-card-block">
        <h2>HaloPSA API</h2>
        ${
          showHaloForm
            ? `<p class="section-subtitle">To allow Action1 to create and maintain tickets in HaloPSA, configure access to your Halo REST API.</p>
        <div class="field-col connection-form-column">
          <div class="field">
            <label>Resource Server</label>
            <input id="halo-resource-server" type="text" value="${escapeHtml(halo.resourceServer || "")}" placeholder="https://your-halo-instance.com/api" />
          </div>
          <div class="field">
            <label>Authorisation Server</label>
            <input id="halo-auth-server" type="text" value="${escapeHtml(halo.authorisationServer || "")}" placeholder="https://your-halo-instance.com/auth" />
          </div>
          <div class="field">
            <label>Client ID</label>
            <input id="halo-client-id" type="text" value="${escapeHtml(halo.clientId || "")}" placeholder="your-client-id" />
          </div>
          <div class="field">
            <label>Client Secret</label>
            <input id="halo-client-secret" type="password" placeholder="${halo.hasClientSecret ? "Saved (leave blank to keep)" : "Enter client secret"}" />
          </div>
        </div>
        <div class="actions">
          <button id="halo-save" class="btn-primary">Save</button>
          ${haloConfigured ? '<button id="halo-cancel" class="btn-secondary">Cancel</button>' : ""}
          <button id="halo-test" class="btn-secondary">Test Connection</button>
        </div>`
            : `<div class="connection-summary-card">
          <div class="connection-summary-title">HaloPSA connection configured</div>
          <div class="connection-summary-detail">Resource Server: ${escapeHtml(halo.resourceServer || "Configured")}</div>
          <div class="actions">
            <button id="halo-change-settings" class="btn-primary">Change Settings</button>
            <button id="halo-test" class="btn-secondary">Test Connection</button>
          </div>
        </div>`
        }
        <div id="halo-message" class="message"></div>
        </div>

        <div class="config-section-divider" aria-hidden="true"></div>

        <div class="config-card-block">
        <h2>Action1 API</h2>
        ${
          showAction1Form
            ? `<p class="section-subtitle">Enter your Action1 API credentials. These are used to read organizations, endpoints, and signal data from Action1.</p>
        <div class="field-col connection-form-column">
          <div class="field">
            <label>Region</label>
            <select id="a1-region-url">
              ${optionListFromRegionChoices(ACTION1_REGION_OPTIONS, regionSelection.selectedBaseUrl)}
            </select>
            ${regionSelection.matched ? "" : '<div class="small">Saved Action1 API URL does not match predefined regions. It will be preserved until you select a region and save.</div>'}
          </div>
          <div class="field">
            <label>Client ID</label>
            <input id="a1-client-id" type="text" value="${escapeHtml(action1.clientId || "")}" placeholder="your-client-id" />
          </div>
          <div class="field">
            <label>Client Secret</label>
            <input id="a1-client-secret" type="password" placeholder="${action1.hasClientSecret ? "Saved (leave blank to keep)" : "Enter client secret"}" />
          </div>
        </div>
        <div class="actions">
          <button id="a1-save" class="btn-primary">Save</button>
          ${action1Configured ? '<button id="a1-cancel" class="btn-secondary">Cancel</button>' : ""}
          <button id="a1-test" class="btn-secondary">Test Connection</button>
        </div>`
            : `<div class="connection-summary-card">
          <div class="connection-summary-title">Action1 connection configured</div>
          <div class="connection-summary-detail">${
            regionSelection.matched
              ? `Region: ${escapeHtml(regionLabelFromBaseUrl(action1.baseUrl))}`
              : `Base URL: ${escapeHtml(action1.baseUrl || "Configured")}`
          }</div>
          <div class="actions">
            <button id="a1-change-settings" class="btn-primary">Change Settings</button>
            <button id="a1-test" class="btn-secondary">Test Connection</button>
          </div>
        </div>`
        }
        <div id="a1-message" class="message"></div>
        </div>
      </div>
    `;

    const regionNode = document.getElementById("a1-region-url");
    if (regionNode) regionNode.onchange = onAction1RegionChange;

    const haloChangeNode = document.getElementById("halo-change-settings");
    if (haloChangeNode) {
      haloChangeNode.onclick = () => {
        state.connectionUi.haloExpanded = true;
        renderConnectionTab();
      };
    }
    const haloCancelNode = document.getElementById("halo-cancel");
    if (haloCancelNode) {
      haloCancelNode.onclick = () => {
        state.connectionUi.haloExpanded = false;
        renderConnectionTab();
      };
    }
    const a1ChangeNode = document.getElementById("a1-change-settings");
    if (a1ChangeNode) {
      a1ChangeNode.onclick = () => {
        state.connectionUi.action1Expanded = true;
        renderConnectionTab();
      };
    }
    const a1CancelNode = document.getElementById("a1-cancel");
    if (a1CancelNode) {
      a1CancelNode.onclick = () => {
        state.connectionUi.action1Expanded = false;
        renderConnectionTab();
      };
    }

    const haloSaveNode = document.getElementById("halo-save");
    if (haloSaveNode) {
      haloSaveNode.onclick = async () => {
        const errors = validateHaloConnection();
        if (errors.length > 0) {
          setMessage("halo-message", errors.join(" "), "error");
          return;
        }
        setMessage("halo-message", "Saving...", "info");
        const connection = readConnectionInputs().halo;
        try {
          await apiPost("/api/config/save", {
            connections: {
              halo: {
                resourceServer: connection.resourceServer,
                authorisationServer: connection.authorisationServer,
                clientId: connection.clientId,
                ...(connection.clientSecretTouched ? { clientSecret: connection.clientSecret } : {}),
              },
            },
          });
          await reloadConfigAndDiscovery();
          state.connectionUi.haloExpanded = false;
          setMessage("halo-message", "Saved.", "success");
          renderApp();
        } catch (error) {
          state.connectionUi.haloExpanded = true;
          setMessage("halo-message", `Save failed: ${error?.message || "unknown error"}`, "error");
        }
      };
    }

    document.getElementById("halo-test").onclick = async () => {
      const errors = validateHaloConnection({ allowMissingSecretIfStored: true, useStoredVisibleDefaults: !showHaloForm });
      if (errors.length > 0) {
        setMessage("halo-message", errors.join(" "), "error");
        return;
      }
      setMessage("halo-message", "Testing connection...", "info");
      const connection = readConnectionInputs().halo;
      const body = showHaloForm
        ? {
            connection: {
              resourceServer: connection.resourceServer,
              authorisationServer: connection.authorisationServer,
              clientId: connection.clientId,
              ...(connection.clientSecretTouched ? { clientSecret: connection.clientSecret } : {}),
            },
          }
        : {};
      const result = await apiPost(
        "/api/connection/halo/test",
        body,
        true
      );
      if (result.ok) {
        setMessage("halo-message", "Connection test succeeded.", "success");
      } else {
        setMessage("halo-message", `Connection test failed: ${result.data.message || "unknown error"}`, "error");
      }
    };

    const a1SaveNode = document.getElementById("a1-save");
    if (a1SaveNode) {
      a1SaveNode.onclick = async () => {
        const errors = validateAction1Connection();
        if (errors.length > 0) {
          setMessage("a1-message", errors.join(" "), "error");
          return;
        }
        setMessage("a1-message", "Saving...", "info");
        const connection = readConnectionInputs().action1;
        try {
          await apiPost("/api/config/save", {
            connections: {
              action1: {
                baseUrl: connection.baseUrl,
                clientId: connection.clientId,
                ...(connection.clientSecretTouched ? { clientSecret: connection.clientSecret } : {}),
              },
            },
          });
          await reloadConfigAndDiscovery();
          state.connectionUi.action1Expanded = false;
          setMessage("a1-message", "Saved.", "success");
          renderApp();
        } catch (error) {
          state.connectionUi.action1Expanded = true;
          setMessage("a1-message", `Save failed: ${error?.message || "unknown error"}`, "error");
        }
      };
    }

    document.getElementById("a1-test").onclick = async () => {
      const errors = validateAction1Connection({ allowMissingSecretIfStored: true, useStoredVisibleDefaults: !showAction1Form });
      if (errors.length > 0) {
        setMessage("a1-message", errors.join(" "), "error");
        return;
      }
      setMessage("a1-message", "Testing connection...", "info");
      const connection = readConnectionInputs().action1;
      const body = showAction1Form
        ? {
            connection: {
              baseUrl: connection.baseUrl,
              clientId: connection.clientId,
              ...(connection.clientSecretTouched ? { clientSecret: connection.clientSecret } : {}),
            },
          }
        : {};
      const result = await apiPost(
        "/api/connection/action1/test",
        body,
        true
      );
      if (result.ok) {
        setMessage("a1-message", "Connection test succeeded.", "success");
      } else {
        setMessage("a1-message", `Connection test failed: ${result.data.message || "unknown error"}`, "error");
      }
    };
  }

  function isHaloConfigured() {
    const halo = state.config?.connections?.halo || {};
    return Boolean(
      String(halo.resourceServer || "").trim() &&
        String(halo.authorisationServer || "").trim() &&
        String(halo.clientId || "").trim() &&
        Boolean(halo.hasClientSecret)
    );
  }

  function isAction1Configured() {
    const action1 = state.config?.connections?.action1 || {};
    return Boolean(
      String(action1.baseUrl || "").trim() && String(action1.clientId || "").trim() && Boolean(action1.hasClientSecret)
    );
  }

  function regionLabelFromBaseUrl(baseUrlRaw) {
    const baseUrl = String(baseUrlRaw || "").trim().toLowerCase();
    const match = ACTION1_REGION_OPTIONS.find((row) => String(row.baseUrl || "").trim().toLowerCase() === baseUrl);
    return match ? match.label : String(baseUrlRaw || "");
  }

  function onAction1RegionChange() {
    state.action1RegionSelectionTouched = true;
    state.action1RegionUnmappedSavedValue = "";
  }

  function renderConfigurationTab() {
    const cfg = state.config;
    const choices = deriveDestinationChoices();
    const saveState = getConfigurationSaveState(cfg);
    const saveStateView = saveStateViewModel(saveState);
    const saveDisabled = saveState.mode === "incomplete";
    state.closedStatusesDraft = Array.isArray(cfg.ticketDestination.closedStatusIds)
      ? cfg.ticketDestination.closedStatusIds.slice()
      : [];

    el.configuration.innerHTML = `
      <div class="section config-card-section configuration-shared-card">
        <div class="config-card-block">
        <h2>Ticket Routing & Lifecycle</h2>
        <p class="section-subtitle">Select a HaloPSA ticket type for Action1-created tickets. If Team, Status, or Category are left blank, the connector will use the defaults configured in HaloPSA.</p>

        <div class="routing-stack">
          <div class="grid-2">
            <div class="field">
              <label>Team (optional) ${infoTip("Optional. Leave blank to use the default team configured in HaloPSA for the selected ticket type.")}</label>
              <select id="cfg-team">${optionList(choices.teams, cfg.ticketDestination.teamId, null, "Use HaloPSA default team")}</select>
            </div>
            <div class="field">
              <label>Ticket Type ${infoTip("Required. Select the HaloPSA ticket type to use for Action1-created tickets. Recommended: create a dedicated Action1 ticket type in HaloPSA and configure its default team, category, workflow, and opening status there.")}</label>
              <select id="cfg-ticket-type">${optionList(choices.ticketTypes, cfg.ticketDestination.ticketTypeId)}</select>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label>New PSA Ticket Status (optional) ${infoTip("Optional. Leave blank to use the default opening status or workflow behavior configured in HaloPSA.")}</label>
              <select id="cfg-new-status">${optionList(choices.statuses, cfg.ticketDestination.newStatusId, null, "Use HaloPSA default status")}</select>
            </div>
            <div class="field">
              <label>Category (optional) ${infoTip("Optional. Leave blank to use the default category configured in HaloPSA. In this connector version, this field maps to HaloPSA Category 1 when set.")}</label>
              <select id="cfg-category">${optionList(choices.categories, cfg.ticketDestination.category1Id, null, "Use HaloPSA default category")}</select>
            </div>
          </div>

          <div class="field field-row">
            <label>Complete / Closed Statuses ${infoTip("Required. Select the HaloPSA statuses that should be treated as complete or closed by the connector. If a linked ticket is in one of these statuses, the connector will not reopen it.")}</label>
            ${renderClosedStatusesControl(choices.statuses, state.closedStatusesDraft)}
          </div>

          <div class="field field-row">
            <label>Existing Open Ticket Behavior ${infoTip("Required. Choose whether the connector should update existing open tickets when Action1 data changes, or leave already-created open tickets unchanged.")}</label>
            <div class="radio-group existing-open-behavior-group">
              <label class="radio-option">
                <input type="radio" name="cfg-open-behavior" value="update_existing_open" ${cfg.lifecycle.existingOpenTicketBehavior === "update_existing_open" ? "checked" : ""} />
                <span class="radio-content">
                  <span class="radio-title">Update existing open HaloPSA tickets</span>
                  <span class="radio-help">Keep linked open tickets current when the Action1 signal details change.</span>
                </span>
              </label>
              <label class="radio-option">
                <input type="radio" name="cfg-open-behavior" value="skip_existing_open" ${cfg.lifecycle.existingOpenTicketBehavior === "skip_existing_open" ? "checked" : ""} />
                <span class="radio-content">
                  <span class="radio-title">Skip updating existing open HaloPSA tickets</span>
                  <span class="radio-help">Create tickets initially, but do not modify linked open tickets after creation.</span>
                </span>
              </label>
            </div>
          </div>
        </div>
        </div>

        <div class="config-section-divider" aria-hidden="true"></div>

        <div class="config-card-block">
        <h2>Action1 Signals</h2>
        <p class="section-subtitle">Choose which Action1 endpoint signals should create or maintain HaloPSA tickets.</p>
        <div class="signals-vertical">
          <div class="signal-row">
            <label class="inline-label">
              <input id="offline-enabled" type="checkbox" ${cfg.signalFilters.offline.enabled ? "checked" : ""} />
              <span>Create ticket after endpoint is offline for at least (days)</span>
            </label>
            <input id="offline-days" type="number" min="1" value="${toInt(cfg.signalFilters.offline.thresholdDays, 7)}" class="days-input" />
          </div>
          <div class="signal-row">
            <label class="inline-label">
              <input id="reboot-enabled" type="checkbox" ${cfg.signalFilters.rebootRequired.enabled ? "checked" : ""} />
              <span>Create ticket for reboot required endpoints</span>
            </label>
          </div>
          <div class="signal-row">
            <label class="inline-label">
              <input id="automation-enabled" type="checkbox" ${cfg.signalFilters.automationFailed.enabled ? "checked" : ""} />
              <span>Create ticket for automation failures</span>
            </label>
          </div>
        </div>

        <div class="signal-split">
          <div class="signal-column soft-column">
            <h3>Vulnerabilities</h3>
            <div class="subheading">Severity</div>
            ${checkboxGroup("vuln-severity", ["CRITICAL", "HIGH", "MEDIUM", "LOW"], cfg.signalFilters.vulnerability.severities, SIGNAL_LABELS.severity)}
            <div class="severity-spacer" aria-hidden="true"></div>
            <div class="subheading">Remediation status</div>
            ${checkboxGroup("vuln-remediation", ["OVERDUE", "DUE_SOON"], cfg.signalFilters.vulnerability.remediationStatuses, SIGNAL_LABELS.remediation)}
          </div>
          <div class="signal-column soft-column">
            <h3>Missing Updates</h3>
            <div class="subheading">Severity</div>
            ${checkboxGroup("upd-severity", ["CRITICAL", "IMPORTANT", "MODERATE", "LOW", "UNSPECIFIED"], cfg.signalFilters.update.severities, SIGNAL_LABELS.severity)}
            <div class="subheading">Remediation status</div>
            ${checkboxGroup("upd-remediation", ["OVERDUE", "DUE_SOON"], cfg.signalFilters.update.remediationStatuses, SIGNAL_LABELS.remediation)}
          </div>
        </div>

        <div class="grouped-ticket-mode-panel">
          <div class="grouped-ticket-mode-header">
            <h3>Ticket creation mode ${infoTip("Choose how HaloPSA tickets are created for vulnerabilities, missing updates, and automation failures.")}</h3>
            <p class="section-subtitle grouped-ticket-mode-subtitle">Choose how HaloPSA tickets are created for vulnerabilities, missing updates, and automation failures.</p>
          </div>
          <div class="radio-group grouped-ticket-mode-radios">
            <label class="radio-option">
              <input type="radio" name="cfg-ticket-mode" value="grouped" ${deriveSharedTicketModel(cfg) === "grouped" ? "checked" : ""} />
              <span class="radio-content">
                <span class="radio-title">Create tickets per issue</span>
                <span class="radio-help">Creates one HaloPSA ticket per vulnerability, missing update, or automation run, with affected endpoints listed inside.</span>
              </span>
            </label>
            <label class="radio-option">
              <input type="radio" name="cfg-ticket-mode" value="endpoint" ${deriveSharedTicketModel(cfg) === "endpoint" ? "checked" : ""} />
              <span class="radio-content">
                <span class="radio-title">Create tickets per endpoint</span>
                <span class="radio-help">Creates one HaloPSA ticket for each affected endpoint.</span>
              </span>
            </label>
          </div>
          <div class="grouped-ticket-mode-divider"></div>
          <div class="grouped-ticket-mode-limit-row">
            <div class="field grouped-ticket-mode-limit-field">
              <label>Max endpoints shown in each grouped ticket ${infoTip("When more endpoints are affected, the ticket shows this many endpoints and links back to Action1 for the full list.")}</label>
              <div class="small">When more endpoints are affected, the ticket shows this many endpoints and links back to Action1 for the full list.</div>
            </div>
            <div class="field grouped-ticket-mode-limit-input-wrap">
              <input id="cfg-grouped-max-endpoints" type="number" min="1" max="100" value="${toInt(cfg.maxImpactedEndpointsInGroupedTicket, 25)}" ${deriveSharedTicketModel(cfg) === "grouped" ? "" : "disabled"} />
            </div>
            <div class="small grouped-ticket-mode-limit-note">Applies when "Create tickets per issue" is selected.</div>
          </div>
        </div>
        </div>
      </div>

      <div class="section bottom-actions">
        <div class="config-actions-stack">
          <div class="refresh-row">
            <button id="refresh-discovery" class="btn-secondary">Refresh Discovery</button>
            <span class="action-inline-help">${infoTip(
              "Refreshes the latest HaloPSA teams, ticket types, statuses, categories, and clients from the connected HaloPSA instance. This does not save configuration changes or create/update tickets."
            )}</span>
          </div>
          <div class="save-row">
            <button id="save-configuration" class="btn-primary" ${saveDisabled ? "disabled" : ""}>Save Configuration</button>
          </div>
        </div>
        <div id="configuration-save-state" class="config-save-state ${saveStateView.className}">
          <div class="config-save-title">${escapeHtml(saveStateView.title)}</div>
          <div class="config-save-detail">${escapeHtml(saveStateView.detail)}</div>
        </div>
        <div id="configuration-message" class="message"></div>
      </div>
    `;

    bindClosedStatusesControl();
    bindConfigurationDirtyListeners();

    document.getElementById("cfg-ticket-type").onchange = async (event) => {
      const ticketTypeId = String(event.target.value || "");
      const nextDraft = buildConfigurationDraftFromForm();
      nextDraft.ticketDestination.ticketTypeId = ticketTypeId;
      if (!ticketTypeId) {
        state.ticketTypeDetail = null;
        nextDraft.ticketDestination.newStatusId = "";
        nextDraft.ticketDestination.closedStatusIds = [];
        state.config = nextDraft;
        state.closedStatusesDraft = nextDraft.ticketDestination.closedStatusIds.slice();
        markConfigurationChanged();
        renderConfigurationTab();
        return;
      }

      setMessage("configuration-message", "Loading ticket type detail...", "info");
      try {
        const detail = await apiGet(`/api/discovery/ticket-type/${encodeURIComponent(ticketTypeId)}`);
        state.ticketTypeDetail = detail.data;
        const detailStatuses = normalizeStatusRows(detail.data?.allowedStatuses);
        const fallbackStatuses = normalizeStatusRows(state.discovery?.halo?.statuses);
        const statusPool = detailStatuses.length > 0 ? detailStatuses : fallbackStatuses;
        const allowedStatuses = new Set(statusPool.map((row) => String(row.id)));

        if (nextDraft.ticketDestination.newStatusId && !allowedStatuses.has(String(nextDraft.ticketDestination.newStatusId || ""))) {
          nextDraft.ticketDestination.newStatusId = "";
          setMessage("configuration-message", "Selected status is not available for the chosen ticket type.", "info");
        } else {
          setMessage("configuration-message", "Ticket type detail loaded.", "success");
        }

        if (allowedStatuses.size > 0) {
          nextDraft.ticketDestination.closedStatusIds = (nextDraft.ticketDestination.closedStatusIds || []).filter((id) =>
            allowedStatuses.has(String(id || ""))
          );
        }

        state.config = nextDraft;
        state.closedStatusesDraft = nextDraft.ticketDestination.closedStatusIds.slice();
        markConfigurationChanged();
        renderConfigurationTab();
      } catch (error) {
        setMessage("configuration-message", `Ticket type detail failed: ${error.message}`, "error");
      }
    };

    document.getElementById("refresh-discovery").onclick = async () => {
      setMessage("configuration-message", "Refreshing discovery...", "info");
      await loadDiscovery();
      const refreshOutcome = reconcileConfigurationWithDiscovery();
      if (refreshOutcome.changed) {
        state.configSaveState = {
          mode: "unsaved",
          detail: "Save configuration to apply these changes.",
        };
      }
      renderConfigurationTab();
      renderMappingTab();
      if (refreshOutcome.changed) {
        setMessage("configuration-message", refreshOutcome.message, "info");
      } else {
        setMessage("configuration-message", "Discovery refreshed.", "success");
      }
    };

    document.getElementById("save-configuration").onclick = async () => {
      const next = buildConfigurationDraftFromForm();
      state.config = next;

      const validation = validateConfiguration(next);
      if (validation.length > 0) {
        state.configSaveState = {
          mode: "incomplete",
          detail: validation.join(" "),
        };
        setMessage("configuration-message", validation.join(" "), "error");
        renderConfigurationTab();
        return;
      }

      setMessage("configuration-message", "Saving...", "info");
      try {
        await apiPost("/api/config/save", { config: next });
        await reloadConfigAndDiscovery({ updateBaseline: true });
        state.configSaveState = { mode: "saved", detail: "" };
        setMessage("configuration-message", "Configuration saved.", "success");
        renderConfigurationTab();
        renderMappingTab();
      } catch (error) {
        state.configSaveState = {
          mode: "failed",
          detail: error?.message || "Configuration could not be saved. Review the error and try again.",
        };
        setMessage("configuration-message", `Save failed: ${error?.message || "unknown error"}`, "error");
        renderConfigurationTab();
      }
    };
  }

  function renderMappingTab() {
    const orgs = (state.discovery && state.discovery.action1Organizations) || [];
    const clients = (state.discovery && state.discovery.halo && state.discovery.halo.clients) || [];
    const rows = state.mappingDraftRows || [];
    try {
      if (isDebugLoggingEnabled()) console.log("[halo-discovery-debug] mapping client options count:", clients.length);
    } catch (_) {
      // no-op diagnostic guard
    }

    const tableRows = rows
      .map(
        (row, idx) => `
          <tr>
            <td><select data-map-org="${idx}">${mappingOrgOptions(orgs, rows, idx)}</select></td>
            <td><select data-map-client="${idx}">${mappingClientOptions(clients, rows, idx)}</select></td>
            <td><button class="btn-secondary btn-small" data-map-remove="${idx}">Remove</button></td>
          </tr>
        `
      )
      .join("");

    const mappingState = getMappingSaveState(rows);
    const mappingStateView = mappingStateViewModel(mappingState);

    el.mapping.innerHTML = `
      <div class="section">
        <h2>Organization Mapping</h2>
        <p class="section-subtitle">Map Action1 organizations to HaloPSA clients so tickets are created under the correct customer account.</p>
        <table>
          <thead>
            <tr>
              <th>Action1 Organization</th>
              <th>HaloPSA Client</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows || `<tr><td colspan="3" class="small">No mappings added yet.</td></tr>`}
          </tbody>
        </table>
        <div class="actions">
          <button id="add-mapping-row" class="btn-secondary">Add Mapping Row</button>
          <button id="save-mappings" class="btn-primary">Save Mappings</button>
        </div>
        <div id="mapping-save-state" class="config-save-state ${mappingStateView.className}">
          <div class="config-save-title">${escapeHtml(mappingStateView.title)}</div>
          <div class="config-save-detail">${escapeHtml(mappingStateView.detail)}</div>
        </div>
        <div id="mapping-message" class="message"></div>
      </div>
    `;

    document.getElementById("add-mapping-row").onclick = () => {
      state.mappingDraftRows = normalizeMappingRows(readMappingRowsFromForm(rows)).concat({
        mappingId: createId(),
        action1OrgId: "",
        action1OrgName: "",
        haloClientId: "",
        haloClientName: "",
        allowHaloClientToCreateAction1Org: false,
      });
      markMappingChanged();
      renderMappingTab();
    };

    document.querySelectorAll("[data-map-org]").forEach((selectNode) => {
      selectNode.onchange = () => {
        state.mappingDraftRows = normalizeMappingRows(readMappingRowsFromForm(rows));
        markMappingChanged();
        renderMappingTab();
      };
    });

    document.querySelectorAll("[data-map-client]").forEach((selectNode) => {
      selectNode.onchange = () => {
        state.mappingDraftRows = normalizeMappingRows(readMappingRowsFromForm(rows));
        markMappingChanged();
        renderMappingTab();
      };
    });

    document.querySelectorAll("[data-map-remove]").forEach((button) => {
      button.onclick = () => {
        const idx = Number(button.getAttribute("data-map-remove"));
        state.mappingDraftRows.splice(idx, 1);
        markMappingChanged();
        renderMappingTab();
      };
    });

    document.getElementById("save-mappings").onclick = async () => {
      state.mappingDraftRows = normalizeMappingRows(readMappingRowsFromForm(rows));
      const validation = validateMappingRows(state.mappingDraftRows);
      if (validation.errors.length > 0) {
        state.mappingSaveState = { mode: "incomplete", detail: validation.errors.join(" ") };
        setMessage("mapping-message", validation.errors.join(" "), "error");
        renderMappingTab();
        return;
      }

      const next = clone(state.config);
      next.orgClientMappings = validation.persistRows;
      setMessage("mapping-message", "Saving...", "info");
      try {
        await apiPost("/api/config/save", { config: next });
        await reloadConfigAndDiscovery({ updateMappingBaseline: true });
        state.mappingSaveState = { mode: "saved", detail: "" };
        setMessage("mapping-message", "Mappings saved.", "success");
        renderMappingTab();
      } catch (error) {
        state.mappingSaveState = {
          mode: "failed",
          detail: error?.message || "Mappings could not be saved. Review the error and try again.",
        };
        setMessage("mapping-message", `Save failed: ${error?.message || "unknown error"}`, "error");
        renderMappingTab();
      }
    };
  }

  function renderSyncTab() {
    if (state.activeTab === "sync") {
      if (!state.sync.historyRequestedOnce && !state.sync.historyLoading) {
        void refreshSyncRunHistory({ force: false });
      }
      if (!state.sync.scheduler.requestedOnce && !state.sync.scheduler.loading) {
        void refreshSchedulerStatus({ force: false });
      }
    }

    const backendRunActive = Boolean(state.sync.activeRun.inProgress);
    const isRunActive = Boolean(state.sync.runInProgress || backendRunActive);
    const canRunNow = !isRunActive;
    const latestRun = Array.isArray(state.sync.history) && state.sync.history.length > 0 ? state.sync.history[0] : null;
    const currentStatus = deriveCurrentSyncStatus({
      running: isRunActive,
      latestRun,
      errorMessage: state.sync.runError,
    });
    const latestRunErrorSummary = deriveRunErrorSummary(latestRun);
    const safeguards = state.config?.operationalSafeguards || {};
    const debugEnabled = Boolean(safeguards.enableDebugLogging);
    const maxOpenTicketsPerOrg = parsePositiveInt(safeguards.maxOpenTicketsPerOrganization) || DEFAULT_MAX_OPEN_TICKETS_PER_ORG;
    const schedulerStatus = state.sync.scheduler.status || {
      enabled: false,
      intervalHours: 24,
      nextRunAt: "",
      running: false,
    };
    const schedulerLabel = schedulerStatus.enabled
      ? `Enabled, every ${schedulerStatus.intervalHours} hours`
      : "Disabled";
    const schedulerStatusLine = schedulerStatus.enabled
      ? `Scheduled sync is enabled every ${schedulerStatus.intervalHours} hours.`
      : "Scheduled sync is disabled.";

    el.sync.innerHTML = `
      <div class="sync-page">
        <section class="sync-card sync-card-status">
          <div class="sync-card-head">
            <div class="sync-card-title-wrap">
              <h3>Sync Status</h3>
            </div>
          </div>
          <div class="sync-status-body">
            <div class="sync-status-copy">
              <p>${isRunActive ? "Sync is currently running." : "Run now starts or continues the single active job."}</p>
              <p>${escapeHtml(schedulerStatusLine)}</p>
              ${latestRunErrorSummary ? `<p class="sync-last-error">Last error: ${escapeHtml(latestRunErrorSummary)}</p>` : ""}
            </div>
            <div class="sync-status-meta">
              <div class="sync-meta-row">
                <span class="sync-meta-label">Current status:</span>
                ${renderSyncStatusPill(currentStatus)}
              </div>
              <div class="sync-meta-row">
                <span class="sync-meta-label">Scheduled sync:</span>
                <span class="sync-pill ${schedulerStatus.enabled ? "sync-pill-success" : "sync-pill-disabled"}">${escapeHtml(
                  schedulerLabel
                )}</span>
              </div>
            </div>
          </div>
        </section>

        <section class="sync-card sync-card-last-run">
          <div class="sync-last-run-layout">
            <div class="sync-last-run-main">
              <div class="sync-card-title-wrap">
                <h3>Last completed run</h3>
              </div>
              ${renderLastCompletedRun(latestRun)}
              <div class="actions sync-run-actions">
                <button id="sync-run-once" class="btn-primary" ${canRunNow ? "" : "disabled"}>
                  ${isRunActive ? "Running..." : "Run now"}
                </button>
                <button id="sync-refresh-history" class="btn-secondary" ${state.sync.historyLoading ? "disabled" : ""}>
                  ${state.sync.historyLoading ? "Refreshing..." : "Refresh status"}
                </button>
              </div>
              ${state.sync.runError ? `<div class="message error">${escapeHtml(state.sync.runError)}</div>` : ""}
            </div>
            ${renderLastRunTotalsPanel(latestRun)}
          </div>
        </section>

        <section class="sync-card sync-card-scheduler">
          <div class="sync-card-title-wrap">
            <h3>Scheduler</h3>
          </div>
          <div class="field field-row">
            <label><input id="sync-scheduler-enabled" type="checkbox" ${schedulerStatus.enabled ? "checked" : ""} /> Enable scheduled sync</label>
          </div>
          <div class="field">
            <label>Run interval</label>
            <select id="sync-scheduler-interval-hours" ${schedulerStatus.enabled ? "" : "disabled"}>
              <option value="3" ${Number(schedulerStatus.intervalHours) === 3 ? "selected" : ""}>Every 3 hours</option>
              <option value="6" ${Number(schedulerStatus.intervalHours) === 6 ? "selected" : ""}>Every 6 hours</option>
              <option value="12" ${Number(schedulerStatus.intervalHours) === 12 ? "selected" : ""}>Every 12 hours</option>
              <option value="24" ${Number(schedulerStatus.intervalHours) === 24 ? "selected" : ""}>Every 24 hours</option>
            </select>
          </div>
          <div class="actions">
            <button id="sync-save-scheduler" class="btn-secondary" ${state.sync.scheduler.saving ? "disabled" : ""}>
              ${state.sync.scheduler.saving ? "Saving..." : "Save scheduler settings"}
            </button>
            <button id="sync-refresh-scheduler" class="btn-secondary" ${state.sync.scheduler.loading ? "disabled" : ""}>
              ${state.sync.scheduler.loading ? "Refreshing..." : "Refresh scheduler status"}
            </button>
          </div>
          <div class="small">Status: ${escapeHtml(schedulerLabel)}</div>
          <div class="small">Next run: ${escapeHtml(formatSchedulerNextRun(schedulerStatus.nextRunAt))}</div>
          ${
            schedulerStatus.lastSchedulerError
              ? `<div class="small">Last scheduler error: ${escapeHtml(String(schedulerStatus.lastSchedulerError || ""))}</div>`
              : ""
          }
          ${state.sync.scheduler.error ? `<div class="message error">${escapeHtml(state.sync.scheduler.error)}</div>` : ""}
        </section>

        <section class="sync-card sync-card-recent-runs">
          <div class="sync-card-title-wrap">
            <h3>Recent runs</h3>
          </div>
          ${state.sync.historyError ? `<div class="message error">${escapeHtml(state.sync.historyError)}</div>` : ""}
          ${renderLifecycleRunHistory(state.sync.history)}
        </section>

        <section class="sync-card sync-card-advanced">
          <button
            id="sync-advanced-toggle"
            type="button"
            class="sync-advanced-toggle"
            aria-expanded="${state.sync.advancedExpanded ? "true" : "false"}"
            aria-controls="sync-advanced-content"
          >
            <span class="sync-advanced-toggle-label">Advanced settings</span>
            <span class="sync-advanced-caret" aria-hidden="true">${state.sync.advancedExpanded ? "▾" : "▸"}</span>
          </button>
          <div id="sync-advanced-content" class="sync-advanced-content ${state.sync.advancedExpanded ? "" : "hidden"}">
            <div class="field field-row">
              <label><input id="sync-enable-debug-logging" type="checkbox" ${debugEnabled ? "checked" : ""} /> Enable debug logging</label>
              <div class="small">Adds detailed diagnostic information to logs/lifecycle.log.</div>
            </div>
            <div class="sync-advanced-divider"></div>
            <div class="field">
              <label>Max open tickets per organization</label>
              <input id="sync-max-open-tickets-per-org" class="sync-max-open-input" type="number" min="1" value="${escapeHtml(String(maxOpenTicketsPerOrg))}" />
              <div class="small">Limits how many connector-managed open tickets can exist per mapped organization at the same time.</div>
              <div class="small">Additional qualifying candidates are skipped until existing tickets are resolved or closed.</div>
            </div>
            <div class="actions sync-advanced-actions">
              <button id="sync-save-advanced" class="btn-secondary" ${state.sync.advancedSaving ? "disabled" : ""}>
                ${state.sync.advancedSaving ? "Saving..." : "Save advanced settings"}
              </button>
            </div>
            ${state.sync.advancedSaveMessage ? `<div class="small">${escapeHtml(state.sync.advancedSaveMessage)}</div>` : ""}
          </div>
        </section>

        <div class="sync-footer-note">All times are shown in your local time zone.</div>
      </div>
    `;

    const refreshHistoryButton = document.getElementById("sync-refresh-history");
    if (refreshHistoryButton) {
      refreshHistoryButton.onclick = () => {
        void refreshSyncStatus();
      };
    }

    const runOnceButton = document.getElementById("sync-run-once");
    if (runOnceButton) {
      runOnceButton.onclick = () => {
        void runSyncRunOnce();
      };
    }

    const advancedToggleButton = document.getElementById("sync-advanced-toggle");
    if (advancedToggleButton) {
      advancedToggleButton.onclick = () => {
        state.sync.advancedExpanded = !state.sync.advancedExpanded;
        renderSyncTab();
      };
    }

    const saveAdvancedButton = document.getElementById("sync-save-advanced");
    if (saveAdvancedButton) {
      saveAdvancedButton.onclick = () => {
        void saveSyncAdvancedSettings();
      };
    }

    const schedulerEnabledNode = document.getElementById("sync-scheduler-enabled");
    const schedulerIntervalNode = document.getElementById("sync-scheduler-interval-hours");
    if (schedulerEnabledNode && schedulerIntervalNode) {
      schedulerEnabledNode.onchange = () => {
        schedulerIntervalNode.disabled = !schedulerEnabledNode.checked;
      };
    }
    const saveSchedulerNode = document.getElementById("sync-save-scheduler");
    if (saveSchedulerNode) {
      saveSchedulerNode.onclick = () => {
        void saveSchedulerSettings();
      };
    }
    const refreshSchedulerNode = document.getElementById("sync-refresh-scheduler");
    if (refreshSchedulerNode) {
      refreshSchedulerNode.onclick = () => {
        void refreshSchedulerStatus({ force: true });
      };
    }
  }

  async function refreshSyncRunHistory(opts) {
    if (state.sync.historyLoading) return;
    if (!opts?.force && state.sync.historyRequestedOnce) return;

    state.sync.historyRequestedOnce = true;
    state.sync.historyLoading = true;
    state.sync.historyError = "";
    renderSyncTab();
    try {
      const payload = await withTimeout(
        apiGet(`/api/lifecycle/runs?limit=${DEFAULT_SYNC_HISTORY_LIMIT}`),
        SYNC_HISTORY_TIMEOUT_MS,
        "history_timeout"
      );
      state.sync.history = (Array.isArray(payload.runs) ? payload.runs : []).slice(0, DEFAULT_SYNC_HISTORY_LIMIT);
    } catch (error) {
      state.sync.historyError =
        error?.message === "history_timeout"
          ? "Run history request timed out. Try refreshing."
          : error?.message || "Failed to load lifecycle run history.";
    } finally {
      state.sync.historyLoading = false;
      renderSyncTab();
    }
  }

  async function refreshSyncStatus() {
    await refreshSyncRunHistory({ force: true });
    await refreshSchedulerStatus({ force: true });
  }

  async function runSyncRunOnce() {
    if (state.sync.runInProgress) return;

    state.sync.runInProgress = true;
    state.sync.runError = "";
    renderSyncTab();

    let payload;
    try {
      payload = await apiPost(
        "/api/lifecycle/run-once",
        {
          confirm: LIFECYCLE_RUN_CONFIRMATION,
        },
        true
      );
    } catch (error) {
      state.sync.runInProgress = false;
      state.sync.runError = error?.message || "Manual lifecycle run failed.";
      renderSyncTab();
      return;
    }

    state.sync.runInProgress = false;
    if (payload && payload.ok === false) {
      if (String(payload.error || "") === "lifecycle_run_in_progress") {
        state.sync.runError = "";
        state.sync.activeRun.inProgress = true;
      } else {
        state.sync.runError = payload.message || "Manual lifecycle run failed safely.";
      }
    } else {
      state.sync.runError = deriveTargetedLifecycleFailureMessage(payload?.summary);
      state.sync.activeRun.inProgress = false;
      void refreshSyncRunHistory({ force: true });
    }
    void refreshSchedulerStatus({ force: true });
    renderSyncTab();
  }

  async function refreshSchedulerStatus(opts) {
    if (state.sync.scheduler.loading) return;
    if (!opts?.force && state.sync.scheduler.requestedOnce) return;
    state.sync.scheduler.requestedOnce = true;
    state.sync.scheduler.loading = true;
    state.sync.scheduler.error = "";
    renderSyncTab();
    try {
      const payload = await withTimeout(apiGet("/api/scheduler/status"), SYNC_SCHEDULER_TIMEOUT_MS, "scheduler_timeout");
      state.sync.scheduler.status = payload.scheduler || null;
      state.sync.activeRun = {
        inProgress: Boolean(payload?.scheduler?.lifecycleRunInProgress),
        trigger: String(payload?.scheduler?.activeRunTrigger || ""),
        startedAt: String(payload?.scheduler?.activeRunStartedAt || ""),
      };
    } catch (error) {
      state.sync.scheduler.error =
        error?.message === "scheduler_timeout"
          ? "Scheduler status request timed out. Try refreshing."
          : error?.message || "Failed to load scheduler status.";
    } finally {
      state.sync.scheduler.loading = false;
      renderSyncTab();
    }
  }

  async function saveSchedulerSettings() {
    if (state.sync.scheduler.saving) return;
    const enabled = checked("sync-scheduler-enabled");
    const intervalHours = Number(value("sync-scheduler-interval-hours") || "24");
    if (enabled && ![3, 6, 12, 24].includes(intervalHours)) {
      state.sync.scheduler.error = "Interval must be one of 3, 6, 12, or 24 hours.";
      renderSyncTab();
      return;
    }
    state.sync.scheduler.saving = true;
    state.sync.scheduler.error = "";
    renderSyncTab();
    try {
      const payload = await apiPost("/api/scheduler/config", { enabled, intervalHours });
      state.sync.scheduler.status = payload.scheduler || null;
    } catch (error) {
      state.sync.scheduler.error = error?.message || "Failed to save scheduler settings.";
    } finally {
      state.sync.scheduler.saving = false;
      renderSyncTab();
    }
  }

  function formatSchedulerNextRun(raw) {
    const text = String(raw || "").trim();
    if (!text) return "Not scheduled";
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) return "Not scheduled";
    return formatDateTime(text);
  }

  async function saveSyncAdvancedSettings() {
    if (state.sync.advancedSaving) return;
    const enableDebugLoggingInput = checked("sync-enable-debug-logging");
    const maxOpenInput = parsePositiveInt(value("sync-max-open-tickets-per-org"));
    if (!maxOpenInput) {
      state.sync.advancedSaveMessage = "Max open tickets per organization must be a positive whole number.";
      renderSyncTab();
      return;
    }
    state.sync.advancedSaving = true;
    state.sync.advancedSaveMessage = "";
    renderSyncTab();
    try {
      const next = clone(state.config);
      if (!next.operationalSafeguards || typeof next.operationalSafeguards !== "object") {
        next.operationalSafeguards = {};
      }
      next.operationalSafeguards.enableDebugLogging = enableDebugLoggingInput;
      next.operationalSafeguards.maxOpenTicketsPerOrganization = maxOpenInput;
      await apiPost("/api/config/save", { config: next });
      await reloadConfigAndDiscovery({ updateBaseline: true });
      state.sync.advancedSaveMessage = "Advanced settings saved.";
    } catch (error) {
      state.sync.advancedSaveMessage = `Save failed: ${error?.message || "unknown error"}`;
    } finally {
      state.sync.advancedSaving = false;
      renderSyncTab();
    }
  }

  function renderLifecycleRunHistory(rows) {
    const items = (Array.isArray(rows) ? rows : []).slice(0, SYNC_RECENT_RUNS_VISIBLE_LIMIT);
    if (items.length === 0) {
      return '<div class="small">No recent runs yet.</div>';
    }
    return `
      <table class="sync-runs-table">
        <thead>
          <tr>
            <th>Started</th>
            <th>Result</th>
            <th>Created</th>
            <th>Updated</th>
            <th>Skipped</th>
            <th>Failed</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((row) => {
              const summary = row?.summary && typeof row.summary === "object" ? row.summary : {};
              return `<tr>
                <td>${escapeHtml(formatDateTime(row?.startedAt))}</td>
                <td>${renderRecentRunResultText(deriveRunResultLabel(row))}</td>
                <td>${Number(summary.created || 0)}</td>
                <td>${Number(summary.updated || 0)}</td>
                <td>${Number(summary.skipped || 0)}</td>
                <td>${Number(summary.failed || 0)}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  function deriveCurrentSyncStatus(input) {
    if (input?.running) return "Running";
    if (input?.errorMessage) return "Needs retry";
    if (!input?.latestRun) return "Not run";
    return deriveRunResultLabel(input.latestRun);
  }

  function deriveRunResultLabel(run) {
    if (!run) return "Not run";
    if (run.ok === true) return "Completed";
    return "Failed";
  }

  function renderLastCompletedRun(run) {
    if (!run) {
      return '<div class="small">No completed runs yet.</div>';
    }
    return `
      <div class="sync-last-run-meta">
        <div class="sync-kv-row"><span class="sync-kv-label">Finished:</span> <span>${escapeHtml(formatDateTime(run.finishedAt))}</span></div>
        <div class="sync-kv-row"><span class="sync-kv-label">Result:</span> ${renderSyncStatusPill(deriveRunResultLabel(run))}</div>
      </div>
    `;
  }

  function renderLastRunTotalsPanel(run) {
    const summary = run?.summary && typeof run.summary === "object" ? run.summary : {};
    return `
      <aside class="sync-totals-panel">
        <div class="sync-totals-title">Totals</div>
        <div class="sync-totals-grid">
          ${renderTotalMetric("Created", Number(summary.created || 0))}
          ${renderTotalMetric("Updated", Number(summary.updated || 0))}
          ${renderTotalMetric("Skipped", Number(summary.skipped || 0))}
          ${renderTotalMetric("Failed", Number(summary.failed || 0))}
        </div>
      </aside>
    `;
  }

  function renderTotalMetric(label, value) {
    return `
      <div class="sync-total-metric">
        <div class="sync-total-label">${escapeHtml(label)}</div>
        <div class="sync-total-value">${Number(value || 0)}</div>
      </div>
    `;
  }

  function renderSyncStatusPill(label) {
    const value = String(label || "Not run");
    const normalized = value.toLowerCase();
    let className = "sync-pill sync-pill-neutral";
    if (normalized.includes("completed")) className = "sync-pill sync-pill-success";
    else if (normalized.includes("running")) className = "sync-pill sync-pill-info";
    else if (normalized.includes("failed")) className = "sync-pill sync-pill-danger";
    else if (normalized.includes("retry")) className = "sync-pill sync-pill-warning";
    return `<span class="${className}">${escapeHtml(value)}</span>`;
  }

  function renderRecentRunResultText(label) {
    const value = String(label || "Not run");
    const normalized = value.toLowerCase();
    let className = "sync-run-result-text sync-run-result-neutral";
    if (normalized.includes("completed")) className = "sync-run-result-text sync-run-result-success";
    else if (normalized.includes("failed")) className = "sync-run-result-text sync-run-result-danger";
    else if (normalized.includes("retry")) className = "sync-run-result-text sync-run-result-warning";
    return `<span class="${className}">${escapeHtml(value)}</span>`;
  }

  function deriveRunErrorSummary(run) {
    if (!run) return "";
    const targetedFailure = deriveTargetedLifecycleFailureMessage(run?.summary);
    if (targetedFailure) return clampErrorSummary(targetedFailure);
    if (run.ok === true) return "";
    const err = run?.error;
    if (typeof err === "string") return clampErrorSummary(err);
    if (err && typeof err === "object") {
      const message = String(err.message || "").trim();
      if (message) return clampErrorSummary(message);
      const code = String(err.code || "").trim();
      if (code) return clampErrorSummary(humanizeErrorCode(code));
    }
    return "Run failed.";
  }

  function deriveTargetedLifecycleFailureMessage(summary) {
    const failedByReason =
      summary?.failuresByReason && typeof summary.failuresByReason === "object" ? summary.failuresByReason : {};
    const failureExamples =
      summary?.failureExamplesByReason && typeof summary.failureExamplesByReason === "object"
        ? summary.failureExamplesByReason
        : {};
    const rejectedCount = Number(failedByReason.halo_create_rejected || 0);
    if (rejectedCount < 1) return "";
    const example = String(failureExamples.halo_create_rejected || "").trim();
    const countLabel = rejectedCount === 1 ? "1 candidate" : `${rejectedCount} candidates`;
    if (example) {
      return `Halo rejected ticket creation for ${countLabel}. Example: ${example}`;
    }
    return `Halo rejected ticket creation for ${countLabel}. Check Ticket Type / Status / Team / Category compatibility.`;
  }

  function humanizeErrorCode(code) {
    return String(code || "")
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
  }

  function clampErrorSummary(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    return value.length > 140 ? `${value.slice(0, 137)}...` : value;
  }

  function parsePositiveInt(rawValue) {
    const n = Number(String(rawValue || "").trim());
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
  }

  function formatDateTime(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  async function reloadConfigAndDiscovery(opts) {
    const options = opts || {};
    const load = await apiGet("/api/config/load");
    state.config = load.data.config;
    if (options.updateBaseline) {
      state.configBaseline = clone(load.data.config);
    }
    if (options.updateMappingBaseline) {
      resetMappingDraftFromConfig();
    }
    await loadDiscovery();
  }

  async function loadDiscovery() {
    const ticketTypeId = state.config?.ticketDestination?.ticketTypeId || "";
    const url = ticketTypeId
      ? `/api/discovery?includeSites=true&ticketTypeId=${encodeURIComponent(ticketTypeId)}`
      : "/api/discovery?includeSites=true";
    const discovery = await apiGet(url);
    state.discovery = discovery.data;
    state.ticketTypeDetail = discovery.data.ticketTypeDetail || null;
    try {
      const haloData = state.discovery?.halo || {};
      const categoryCount = Array.isArray(haloData.categories) ? haloData.categories.length : 0;
      const clientCount = Array.isArray(haloData.clients) ? haloData.clients.length : 0;
      if (isDebugLoggingEnabled()) {
        console.log("[halo-discovery-debug] discovery keys:", Object.keys(state.discovery || {}));
        console.log("[halo-discovery-debug] discovery.halo keys:", Object.keys(haloData));
        console.log("[halo-discovery-debug] categories:", categoryCount, "clients:", clientCount);
      }
    } catch (_) {
      // no-op diagnostic guard
    }
  }

  function deriveDestinationChoices() {
    const discovery = state.discovery || { halo: {} };
    const detail = state.ticketTypeDetail || null;
    const teams = normalizeRows(discovery.halo.teams);
    const ticketTypes = normalizeRows(discovery.halo.ticketTypes);
    const globalStatuses = normalizeStatusRows(discovery.halo.statuses);
    const detailStatuses = detail ? normalizeStatusRows(detail.allowedStatuses) : [];
    const discoveredCategories = normalizeRows(discovery.halo.categories);
    const detailCategories = detail ? normalizeRows(detail.allowedCategories) : [];
    const out = {
      teams,
      ticketTypes,
      statuses: detailStatuses.length > 0 ? detailStatuses : globalStatuses,
      categories: discoveredCategories.length > 0 ? discoveredCategories : detailCategories,
    };
    try {
      if (isDebugLoggingEnabled()) console.log("[halo-discovery-debug] category options count:", out.categories.length);
    } catch (_) {
      // no-op diagnostic guard
    }
    return out;
  }

  function buildConfigurationDraftFromForm() {
    const next = clone(state.config);
    next.ticketDestination.teamId = value("cfg-team");
    next.ticketDestination.ticketTypeId = value("cfg-ticket-type");
    next.ticketDestination.category1Id = value("cfg-category");
    next.ticketDestination.newStatusId = value("cfg-new-status");
    next.ticketDestination.closedStatusIds = state.closedStatusesDraft.slice();
    next.lifecycle.existingOpenTicketBehavior = selectedRadioValue("cfg-open-behavior") || "update_existing_open";
    next.signalFilters.offline.enabled = checked("offline-enabled");
    next.signalFilters.offline.thresholdDays = toInt(value("offline-days"), 7);
    next.signalFilters.rebootRequired.enabled = checked("reboot-enabled");
    next.signalFilters.automationFailed.enabled = checked("automation-enabled");
    next.signalFilters.vulnerability.severities = checkedValues("vuln-severity");
    next.signalFilters.vulnerability.enabled = next.signalFilters.vulnerability.severities.length > 0;
    next.signalFilters.vulnerability.remediationStatuses = checkedValues("vuln-remediation");
    next.signalFilters.update.severities = checkedValues("upd-severity");
    next.signalFilters.update.enabled = next.signalFilters.update.severities.length > 0;
    next.signalFilters.update.remediationStatuses = checkedValues("upd-remediation");
    const sharedTicketModel = selectedRadioValue("cfg-ticket-mode") === "grouped" ? "grouped" : "endpoint";
    next.vulnerabilities = next.vulnerabilities || {};
    next.updates = next.updates || {};
    next.automationFailed = next.automationFailed || {};
    next.vulnerabilities.ticketModel = sharedTicketModel;
    next.updates.ticketModel = sharedTicketModel;
    next.automationFailed.ticketModel = sharedTicketModel;
    next.maxImpactedEndpointsInGroupedTicket = clampGroupedMaxEndpoints(toInt(value("cfg-grouped-max-endpoints"), 25));
    return next;
  }

  function bindConfigurationDirtyListeners() {
    const inputIds = [
      "cfg-team",
      "cfg-ticket-type",
      "cfg-new-status",
      "cfg-category",
      "offline-enabled",
      "offline-days",
      "reboot-enabled",
      "automation-enabled",
      "cfg-grouped-max-endpoints",
      "cfg-default-priority",
    ];
    inputIds.forEach((id) => {
      const node = document.getElementById(id);
      if (!node) return;
      node.onchange = () => markConfigurationChanged();
      if (node.tagName === "INPUT" && node.type === "number") {
        node.oninput = () => markConfigurationChanged();
      }
    });

    document.querySelectorAll("input[name='cfg-open-behavior']").forEach((node) => {
      node.onchange = () => markConfigurationChanged();
    });
    document.querySelectorAll("input[name='cfg-ticket-mode']").forEach((node) => {
      node.onchange = () => {
        const groupedSelected = selectedRadioValue("cfg-ticket-mode") === "grouped";
        const limitInput = document.getElementById("cfg-grouped-max-endpoints");
        if (limitInput) limitInput.disabled = !groupedSelected;
        markConfigurationChanged();
      };
    });

    ["vuln-severity", "vuln-remediation", "upd-severity", "upd-remediation"].forEach((groupName) => {
      document.querySelectorAll(`[data-group="${groupName}"]`).forEach((node) => {
        node.onchange = () => markConfigurationChanged();
      });
    });
  }

  function markConfigurationChanged() {
    const draft = buildConfigurationDraftFromForm();
    state.config = draft;
    const saveState = getConfigurationSaveState(draft);
    state.configSaveState = {
      mode: saveState.mode,
      detail: saveState.detail,
    };
    renderConfigurationSaveState(saveState);
  }

  function renderConfigurationSaveState(saveState) {
    const target = document.getElementById("configuration-save-state");
    if (!target) return;
    const view = saveStateViewModel(saveState);
    target.className = `config-save-state ${view.className}`;
    target.innerHTML = `<div class="config-save-title">${escapeHtml(view.title)}</div><div class="config-save-detail">${escapeHtml(
      view.detail
    )}</div>`;
    const saveButton = document.getElementById("save-configuration");
    if (saveButton) {
      saveButton.disabled = saveState.mode === "incomplete";
    }
  }

  function getConfigurationSaveState(configValue) {
    const validationErrors = validateConfiguration(configValue);
    if (validationErrors.length > 0) {
      return {
        mode: "incomplete",
        detail: "Select the required ticket routing and lifecycle fields before saving.",
      };
    }

    const configOwnedDraft = toConfigurationOwnedSubset(configValue);
    const configOwnedBaseline = toConfigurationOwnedSubset(state.configBaseline || {});
    if (!configsEquivalent(configOwnedDraft, configOwnedBaseline)) {
      return {
        mode: "unsaved",
        detail: "Save configuration to apply these changes.",
      };
    }

    if (state.configSaveState.mode === "failed") {
      return {
        mode: "failed",
        detail: state.configSaveState.detail || "Configuration could not be saved. Review the error and try again.",
      };
    }

    return {
      mode: "saved",
      detail: "Your ticket routing and signal settings are saved.",
    };
  }

  function reconcileConfigurationWithDiscovery() {
    const next = clone(state.config);
    const notes = [];
    let changed = false;
    const choices = deriveDestinationChoices();

    const teamIds = new Set((choices.teams || []).map((row) => String(row.id)));
    if (next.ticketDestination.teamId && !teamIds.has(String(next.ticketDestination.teamId))) {
      next.ticketDestination.teamId = "";
      changed = true;
      notes.push("Team");
    }

    const ticketTypeIds = new Set((choices.ticketTypes || []).map((row) => String(row.id)));
    if (next.ticketDestination.ticketTypeId && !ticketTypeIds.has(String(next.ticketDestination.ticketTypeId))) {
      next.ticketDestination.ticketTypeId = "";
      next.ticketDestination.category1Id = "";
      next.ticketDestination.newStatusId = "";
      next.ticketDestination.closedStatusIds = [];
      changed = true;
      notes.push("Ticket Type");
    }

    const statusIds = new Set((choices.statuses || []).map((row) => String(row.id)));
    if (next.ticketDestination.newStatusId && !statusIds.has(String(next.ticketDestination.newStatusId))) {
      next.ticketDestination.newStatusId = "";
      changed = true;
      notes.push("New PSA Ticket Status");
    }

    const filteredClosedStatuses = (next.ticketDestination.closedStatusIds || []).filter((id) =>
      statusIds.has(String(id || ""))
    );
    if (filteredClosedStatuses.length !== (next.ticketDestination.closedStatusIds || []).length) {
      next.ticketDestination.closedStatusIds = filteredClosedStatuses;
      changed = true;
      notes.push("Complete / Closed Statuses");
    }

    const categoryIds = new Set((choices.categories || []).map((row) => String(row.id)));
    if (
      next.ticketDestination.category1Id &&
      categoryIds.size > 0 &&
      !categoryIds.has(String(next.ticketDestination.category1Id))
    ) {
      next.ticketDestination.category1Id = "";
      changed = true;
      notes.push("Category");
    }

    if (changed) {
      state.config = next;
      state.closedStatusesDraft = next.ticketDestination.closedStatusIds.slice();
      return {
        changed: true,
        message: `Discovery refreshed. Some selected values are no longer available and were cleared: ${notes.join(
          ", "
        )}.`,
      };
    }

    return {
      changed: false,
      message: "",
    };
  }

  function toConfigurationOwnedSubset(configValue) {
    const cfg = configValue || {};
    return {
      ticketDestination: {
        teamId: String(cfg.ticketDestination?.teamId || ""),
        ticketTypeId: String(cfg.ticketDestination?.ticketTypeId || ""),
        category1Id: String(cfg.ticketDestination?.category1Id || ""),
        newStatusId: String(cfg.ticketDestination?.newStatusId || ""),
        closedStatusIds: Array.isArray(cfg.ticketDestination?.closedStatusIds)
          ? cfg.ticketDestination.closedStatusIds.map((id) => String(id || ""))
          : [],
      },
      lifecycle: {
        existingOpenTicketBehavior: String(cfg.lifecycle?.existingOpenTicketBehavior || ""),
      },
      signalFilters: {
        offline: {
          enabled: Boolean(cfg.signalFilters?.offline?.enabled),
          thresholdDays: Number(cfg.signalFilters?.offline?.thresholdDays || 0),
        },
        rebootRequired: {
          enabled: Boolean(cfg.signalFilters?.rebootRequired?.enabled),
        },
        automationFailed: {
          enabled: Boolean(cfg.signalFilters?.automationFailed?.enabled),
        },
        vulnerability: {
          enabled: Boolean(cfg.signalFilters?.vulnerability?.enabled),
          severities: Array.isArray(cfg.signalFilters?.vulnerability?.severities)
            ? cfg.signalFilters.vulnerability.severities.map((valueItem) => String(valueItem || ""))
            : [],
          remediationStatuses: Array.isArray(cfg.signalFilters?.vulnerability?.remediationStatuses)
            ? cfg.signalFilters.vulnerability.remediationStatuses.map((valueItem) => String(valueItem || ""))
            : [],
        },
        update: {
          enabled: Boolean(cfg.signalFilters?.update?.enabled),
          severities: Array.isArray(cfg.signalFilters?.update?.severities)
            ? cfg.signalFilters.update.severities.map((valueItem) => String(valueItem || ""))
            : [],
          remediationStatuses: Array.isArray(cfg.signalFilters?.update?.remediationStatuses)
            ? cfg.signalFilters.update.remediationStatuses.map((valueItem) => String(valueItem || ""))
            : [],
        },
      },
      vulnerabilities: {
        ticketModel: String(cfg.vulnerabilities?.ticketModel || "grouped"),
      },
      updates: {
        ticketModel: String(cfg.updates?.ticketModel || "grouped"),
      },
      automationFailed: {
        ticketModel: String(cfg.automationFailed?.ticketModel || "grouped"),
      },
      maxImpactedEndpointsInGroupedTicket: Number(cfg.maxImpactedEndpointsInGroupedTicket || 25),
    };
  }

  function deriveSharedTicketModel(cfg) {
    const vuln = String(cfg?.vulnerabilities?.ticketModel || "grouped").toLowerCase();
    const upd = String(cfg?.updates?.ticketModel || "grouped").toLowerCase();
    const automation = String(cfg?.automationFailed?.ticketModel || "grouped").toLowerCase();
    return vuln === "grouped" && upd === "grouped" && automation === "grouped" ? "grouped" : "endpoint";
  }

  function clampGroupedMaxEndpoints(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 25;
    const i = Math.trunc(n);
    if (i < 1) return 1;
    if (i > 100) return 100;
    return i;
  }

  function saveStateViewModel(saveState) {
    if (saveState.mode === "incomplete") {
      return {
        className: "config-state-incomplete",
        title: "Configuration incomplete",
        detail: saveState.detail,
      };
    }
    if (saveState.mode === "unsaved") {
      return {
        className: "config-state-unsaved",
        title: "Unsaved changes",
        detail: saveState.detail,
      };
    }
    if (saveState.mode === "failed") {
      return {
        className: "config-state-failed",
        title: "Save failed",
        detail: "Configuration could not be saved. Review the error and try again.",
      };
    }
    return {
      className: "config-state-saved",
      title: "Configuration saved",
      detail: saveState.detail,
    };
  }

  function resetMappingDraftFromConfig() {
    const rows = normalizeMappingRows(state.config?.orgClientMappings || []);
    state.mappingDraftRows = rows;
    state.mappingBaselineRows = clone(rows);
    state.mappingSaveState = { mode: "saved", detail: "" };
  }

  function markMappingChanged() {
    const saveState = getMappingSaveState(state.mappingDraftRows || []);
    state.mappingSaveState = {
      mode: saveState.mode,
      detail: saveState.detail,
    };
  }

  function getMappingSaveState(rows) {
    const validation = validateMappingRows(rows);
    if (validation.errors.length > 0) {
      return {
        mode: "incomplete",
        detail: validation.errors.join(" "),
      };
    }
    if (!configsEquivalent(validation.persistRows, state.mappingBaselineRows || [])) {
      return {
        mode: "unsaved",
        detail: "Save mappings to apply these changes.",
      };
    }
    if (state.mappingSaveState.mode === "failed") {
      return {
        mode: "failed",
        detail: state.mappingSaveState.detail || "Mappings could not be saved. Review the error and try again.",
      };
    }
    return {
      mode: "saved",
      detail: "Mappings saved.",
    };
  }

  function mappingStateViewModel(saveState) {
    if (saveState.mode === "incomplete") {
      return {
        className: "config-state-incomplete",
        title: "Mapping incomplete / duplicates found",
        detail: saveState.detail,
      };
    }
    if (saveState.mode === "unsaved") {
      return {
        className: "config-state-unsaved",
        title: "Unsaved changes",
        detail: "Save mappings to apply these changes.",
      };
    }
    if (saveState.mode === "failed") {
      return {
        className: "config-state-failed",
        title: "Save failed",
        detail: "Mappings could not be saved. Review the error and try again.",
      };
    }
    return {
      className: "config-state-saved",
      title: "Mappings saved",
      detail: "Action1 Organization and HaloPSA Client links are saved.",
    };
  }

  function mappingOrgOptions(orgs, rows, rowIndex) {
    const selectedInOtherRows = new Set(
      rows
        .filter((_, idx) => idx !== rowIndex)
        .map((row) => String(row.action1OrgId || ""))
        .filter(Boolean)
    );
    const current = String(rows[rowIndex]?.action1OrgId || "");
    const allowed = (orgs || []).filter((org) => {
      const id = String(org.id || "");
      if (!id) return false;
      if (id === current) return true;
      return !selectedInOtherRows.has(id);
    });
    return optionList(allowed, current, null, "-- Select --");
  }

  function mappingClientOptions(clients, rows, rowIndex) {
    const selectedInOtherRows = new Set(
      rows
        .filter((_, idx) => idx !== rowIndex)
        .map((row) => String(row.haloClientId || ""))
        .filter(Boolean)
    );
    const current = String(rows[rowIndex]?.haloClientId || "");
    const allowed = (clients || []).filter((client) => {
      const id = String(client.id || "");
      if (!id) return false;
      if (id === current) return true;
      return !selectedInOtherRows.has(id);
    });
    return optionList(allowed, current, null, "-- Select --");
  }

  function readMappingRowsFromForm(rows) {
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      out.push({
        mappingId: rows[i]?.mappingId || createId(),
        action1OrgId: valueBySelector(`[data-map-org="${i}"]`),
        haloClientId: valueBySelector(`[data-map-client="${i}"]`),
      });
    }
    return out;
  }

  function normalizeMappingRows(rows) {
    return (rows || []).map((row) => ({
      mappingId: String(row?.mappingId || createId()),
      action1OrgId: String(row?.action1OrgId || ""),
      action1OrgName: String(row?.action1OrgName || ""),
      haloClientId: String(row?.haloClientId || ""),
      haloClientName: String(row?.haloClientName || ""),
      allowHaloClientToCreateAction1Org: false,
    }));
  }

  function validateMappingRows(rows) {
    const errors = [];
    const orgSeen = new Set();
    const clientSeen = new Set();
    const persistRows = [];
    const draftRows = normalizeMappingRows(rows);
    const orgs = (state.discovery && state.discovery.action1Organizations) || [];
    const clients = (state.discovery && state.discovery.halo && state.discovery.halo.clients) || [];

    for (const row of draftRows) {
      const orgId = String(row.action1OrgId || "");
      const clientId = String(row.haloClientId || "");
      const isOrgEmpty = !orgId;
      const isClientEmpty = !clientId;
      if (isOrgEmpty && isClientEmpty) continue;
      if (isOrgEmpty !== isClientEmpty) {
        errors.push("Select both an Action1 organization and a HaloPSA client, or remove the incomplete row.");
        continue;
      }
      if (orgSeen.has(orgId)) {
        errors.push("Each Action1 organization can only be mapped once. Remove duplicate mappings before saving.");
      } else {
        orgSeen.add(orgId);
      }
      if (clientSeen.has(clientId)) {
        errors.push("Each HaloPSA client can only be mapped once. Remove duplicate mappings before saving.");
      } else {
        clientSeen.add(clientId);
      }
      const org = findById(orgs, orgId);
      const client = findById(clients, clientId);
      persistRows.push({
        mappingId: row.mappingId || createId(),
        action1OrgId: orgId,
        action1OrgName: org ? org.name : row.action1OrgName || "",
        haloClientId: clientId,
        haloClientName: client ? client.name : row.haloClientName || "",
        allowHaloClientToCreateAction1Org: false,
      });
    }

    return { errors: dedupeStrings(errors), persistRows };
  }

  function dedupeStrings(values) {
    return Array.from(new Set((values || []).map((valueItem) => String(valueItem))));
  }

  function configsEquivalent(a, b) {
    return stableStringify(a) === stableStringify(b);
  }

  function stableStringify(valueToSerialize) {
    return JSON.stringify(sortObjectKeys(valueToSerialize));
  }

  function sortObjectKeys(valueToSort) {
    if (Array.isArray(valueToSort)) {
      return valueToSort.map(sortObjectKeys);
    }
    if (!valueToSort || typeof valueToSort !== "object") {
      return valueToSort;
    }
    const out = {};
    Object.keys(valueToSort)
      .sort()
      .forEach((key) => {
        out[key] = sortObjectKeys(valueToSort[key]);
      });
    return out;
  }

  function validateAction1Connection(opts) {
    const allowStored = opts && opts.allowMissingSecretIfStored;
    const useStoredVisibleDefaults = opts && opts.useStoredVisibleDefaults;
    const current = readConnectionInputs().action1;
    const errors = [];
    const fallback = state.config?.connections?.action1 || {};
    const baseUrl = current.baseUrl || (useStoredVisibleDefaults ? String(fallback.baseUrl || "") : "");
    const clientId = current.clientId || (useStoredVisibleDefaults ? String(fallback.clientId || "") : "");
    if (!baseUrl) errors.push("Action1 Base URL is required.");
    if (!clientId) errors.push("Action1 Client ID is required.");
    if (!allowStored || !state.config.connections.action1.hasClientSecret) {
      if (!current.clientSecretTouched) errors.push("Action1 Client Secret is required.");
    }
    return errors;
  }

  function validateHaloConnection(opts) {
    const allowStored = opts && opts.allowMissingSecretIfStored;
    const useStoredVisibleDefaults = opts && opts.useStoredVisibleDefaults;
    const current = readConnectionInputs().halo;
    const errors = [];
    const fallback = state.config?.connections?.halo || {};
    const resourceServer =
      current.resourceServer || (useStoredVisibleDefaults ? String(fallback.resourceServer || "") : "");
    const authorisationServer =
      current.authorisationServer || (useStoredVisibleDefaults ? String(fallback.authorisationServer || "") : "");
    const clientId = current.clientId || (useStoredVisibleDefaults ? String(fallback.clientId || "") : "");
    if (!resourceServer) errors.push("Halo Resource Server is required.");
    if (!authorisationServer) errors.push("Halo Authorisation Server is required.");
    if (!clientId) errors.push("Halo Client ID is required.");
    if (!allowStored || !state.config.connections.halo.hasClientSecret) {
      if (!current.clientSecretTouched) errors.push("Halo Client Secret is required.");
    }
    return errors;
  }

  function validateConfiguration(next) {
    const errors = [];
    if (!next.ticketDestination.ticketTypeId) errors.push("Ticket Type is required.");
    if (!Array.isArray(next.ticketDestination.closedStatusIds) || next.ticketDestination.closedStatusIds.length === 0) {
      errors.push("At least one Complete / Closed Status is required.");
    }
    if (!next.lifecycle.existingOpenTicketBehavior) {
      errors.push("Existing Open Ticket Behavior is required.");
    }
    if (!Number.isFinite(Number(next.signalFilters.offline.thresholdDays)) || Number(next.signalFilters.offline.thresholdDays) <= 0) {
      errors.push("Offline threshold must be a positive number of days.");
    }
    return errors;
  }

  function readConnectionInputs() {
    const action1Secret = value("a1-client-secret");
    const haloSecret = value("halo-client-secret");
    const selectedRegionBaseUrl = value("a1-region-url");
    const action1BaseUrl =
      state.action1RegionUnmappedSavedValue && !state.action1RegionSelectionTouched
        ? state.action1RegionUnmappedSavedValue
        : selectedRegionBaseUrl;
    return {
      action1: {
        baseUrl: action1BaseUrl,
        clientId: value("a1-client-id"),
        clientSecret: action1Secret,
        clientSecretTouched: action1Secret.length > 0,
      },
      halo: {
        resourceServer: value("halo-resource-server"),
        authorisationServer: value("halo-auth-server"),
        clientId: value("halo-client-id"),
        clientSecret: haloSecret,
        clientSecretTouched: haloSecret.length > 0,
      },
    };
  }

  async function apiGet(url) {
    const response = await fetch(url, { method: "GET" });
    const json = await response.json();
    if (!response.ok || json.ok === false) {
      throw new Error(json.message || json.error || `Request failed (${response.status})`);
    }
    return json;
  }

  async function apiPost(url, body, allowFailure) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const json = await response.json();
    if (!response.ok || json.ok === false) {
      if (allowFailure) return json;
      throw new Error(json.message || json.error || `Request failed (${response.status})`);
    }
    return json;
  }

  async function withTimeout(promise, timeoutMs, code) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code || "timeout")), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function optionList(rows, selectedId, selectedMany, placeholderLabel) {
    const selectedSet = new Set(Array.isArray(selectedMany) ? selectedMany.map(String) : []);
    const placeholder = placeholderLabel ? String(placeholderLabel) : "-- Select --";
    const options = [`<option value="">${escapeHtml(placeholder)}</option>`];
    (rows || []).forEach((row) => {
      const id = String(row.id || "");
      if (!id) return;
      const selected = selectedSet.size > 0 ? (selectedSet.has(id) ? "selected" : "") : (String(selectedId || "") === id ? "selected" : "");
      options.push(`<option value="${escapeHtml(id)}" ${selected}>${escapeHtml(row.name || id)}</option>`);
    });
    return options.join("");
  }

  function optionListFromRegionChoices(choices, selectedBaseUrl) {
    return (choices || [])
      .map((choice) => {
        const valueItem = String(choice.baseUrl || "");
        const selected = valueItem === String(selectedBaseUrl || "") ? "selected" : "";
        return `<option value="${escapeHtml(valueItem)}" ${selected}>${escapeHtml(choice.label || valueItem)}</option>`;
      })
      .join("");
  }

  function checkboxGroup(groupName, values, selectedValues, labelMap) {
    const selected = new Set((selectedValues || []).map(String));
    return `
      <div class="checkbox-list">
        ${values
          .map((valueItem) => {
            const checkedAttr = selected.has(valueItem) ? "checked" : "";
            const label = labelMap && labelMap[valueItem] ? labelMap[valueItem] : valueItem;
            return `<label><input type="checkbox" data-group="${groupName}" value="${valueItem}" ${checkedAttr} /> ${escapeHtml(label)}</label>`;
          })
          .join("")}
      </div>
    `;
  }

  function checkedValues(groupName) {
    const out = [];
    document.querySelectorAll(`[data-group="${groupName}"]`).forEach((node) => {
      if (node.checked) out.push(String(node.value));
    });
    return out;
  }

  function selectedRadioValue(name) {
    const node = document.querySelector(`input[name="${name}"]:checked`);
    return node ? String(node.value || "") : "";
  }

  function checked(id) {
    const node = document.getElementById(id);
    return Boolean(node && node.checked);
  }

  function value(id) {
    const node = document.getElementById(id);
    return node ? String(node.value || "").trim() : "";
  }

  function valueBySelector(selector) {
    const node = document.querySelector(selector);
    return node ? String(node.value || "").trim() : "";
  }

  function normalizeRows(rows) {
    return (rows || [])
      .map((row) => ({
        id: String(row?.id || ""),
        name: String(row?.name || ""),
      }))
      .filter((row) => row.id && row.name);
  }

  function normalizeStatusRows(rows) {
    return (rows || [])
      .map((row) => ({
        id: String(row?.id || ""),
        name: String(row?.name || ""),
        isClosed: row?.isClosed === undefined ? undefined : Boolean(row.isClosed),
      }))
      .filter((row) => row.id && row.name);
  }

  function deriveAction1RegionSelection(baseUrl) {
    const normalized = String(baseUrl || "").trim().toLowerCase();
    const matched = ACTION1_REGION_OPTIONS.find((choice) => String(choice.baseUrl || "").trim().toLowerCase() === normalized);
    if (matched) {
      return {
        matched: true,
        selectedBaseUrl: matched.baseUrl,
      };
    }
    return {
      matched: false,
      selectedBaseUrl: ACTION1_REGION_OPTIONS[0].baseUrl,
    };
  }

  function renderClosedStatusesControl(rows, selectedIds) {
    const selectedSet = new Set((selectedIds || []).map(String));
    const selectedRows = (rows || []).filter((row) => selectedSet.has(String(row.id || "")));
    const chips = selectedRows
      .map(
        (row) => `<span class="chip">
          <span>${escapeHtml(row.name || row.id || "")}</span>
          <button type="button" class="chip-remove" data-chip-remove="${escapeHtml(String(row.id || ""))}" aria-label="Remove ${escapeHtml(row.name || row.id || "")}">x</button>
        </span>`
      )
      .join("");

    const options = (rows || [])
      .map((row) => {
        const id = String(row.id || "");
        if (!id) return "";
        const checkedAttr = selectedSet.has(id) ? "checked" : "";
        return `<label class="dropdown-option"><input type="checkbox" data-closed-status-option="${escapeHtml(id)}" ${checkedAttr} /> <span>${escapeHtml(row.name || id)}</span></label>`;
      })
      .join("");

    return `
      <div class="chip-select" id="closed-status-chip-select">
        <div role="button" tabindex="0" class="chip-select-trigger" id="closed-status-trigger" aria-label="Select complete and closed statuses">
          <span class="chip-list">${chips || '<span class="chip-placeholder">Select one or more statuses</span>'}</span>
          <span class="chip-caret">⌄</span>
        </div>
        <div class="chip-select-menu hidden" id="closed-status-menu">
          ${options || '<div class="small">No statuses available.</div>'}
        </div>
      </div>
    `;
  }

  function bindClosedStatusesControl() {
    const root = document.getElementById("closed-status-chip-select");
    const trigger = document.getElementById("closed-status-trigger");
    const menu = document.getElementById("closed-status-menu");
    if (!root || !trigger || !menu) return;

    trigger.onclick = () => {
      menu.classList.toggle("hidden");
    };
    trigger.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        menu.classList.toggle("hidden");
      }
    };

    root.querySelectorAll("[data-closed-status-option]").forEach((node) => {
      node.onchange = () => {
        const id = String(node.getAttribute("data-closed-status-option") || "");
        if (!id) return;
        const selected = new Set(state.closedStatusesDraft.map(String));
        if (node.checked) selected.add(id);
        else selected.delete(id);
        state.closedStatusesDraft = Array.from(selected);
        rerenderClosedStatusesControl();
        markConfigurationChanged();
      };
    });

    root.querySelectorAll("[data-chip-remove]").forEach((node) => {
      node.onclick = (event) => {
        event.stopPropagation();
        const id = String(node.getAttribute("data-chip-remove") || "");
        state.closedStatusesDraft = state.closedStatusesDraft.filter((valueItem) => String(valueItem) !== id);
        rerenderClosedStatusesControl();
        markConfigurationChanged();
      };
    });

    document.addEventListener(
      "click",
      (event) => {
        if (!root.contains(event.target)) {
          menu.classList.add("hidden");
        }
      },
      { once: true }
    );
  }

  function rerenderClosedStatusesControl() {
    const host = document.getElementById("closed-status-chip-select");
    if (!host) return;
    const choices = deriveDestinationChoices();
    host.outerHTML = renderClosedStatusesControl(choices.statuses, state.closedStatusesDraft);
    bindClosedStatusesControl();
  }

  function infoTip(text) {
    return `<span class="info-tip" tabindex="0" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}">i</span>`;
  }

  function setGlobalStatus(message, type) {
    el.globalStatus.textContent = String(message || "");
    el.globalStatus.className = `status ${type || "info"}`;
  }

  function setMessage(id, message, type) {
    const target = document.getElementById(id);
    if (!target) return;
    target.textContent = message || "";
    target.className = `message ${type || ""}`;
  }

  function togglePanel(node, visible) {
    node.classList.toggle("hidden", !visible);
  }

  function clone(valueToClone) {
    return JSON.parse(JSON.stringify(valueToClone));
  }

  function findById(rows, id) {
    const target = String(id || "");
    return (rows || []).find((row) => String(row.id || "") === target) || null;
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `map-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function toInt(raw, fallback) {
    const n = Number.parseInt(String(raw || ""), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
  }

  function isDebugLoggingEnabled() {
    return Boolean(state.config?.operationalSafeguards?.enableDebugLogging);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();

