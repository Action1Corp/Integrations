// decisionModel.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const LINKED_TICKET_STATES = Object.freeze({
  NONE: "none",
  OPEN: "open",
  CLOSED: "closed",
  MISSING: "missing",
});

const EXISTING_OPEN_TICKET_BEHAVIOR = Object.freeze({
  UPDATE_EXISTING_OPEN: "update_existing_open",
  SKIP_EXISTING_OPEN: "skip_existing_open",
});

const LIFECYCLE_ACTIONS = Object.freeze({
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  CLOSE: "CLOSE",
  SKIP: "SKIP",
});

const LIFECYCLE_REASONS = Object.freeze({
  NO_LINKED_TICKET: "NO_LINKED_TICKET",
  LINKED_TICKET_MISSING: "LINKED_TICKET_MISSING",
  LINKED_TICKET_CLOSED_CREATE_NEW: "LINKED_TICKET_CLOSED_CREATE_NEW",
  OPEN_TICKET_PAYLOAD_CHANGED: "OPEN_TICKET_PAYLOAD_CHANGED",
  OPEN_TICKET_UNCHANGED: "OPEN_TICKET_UNCHANGED",
  OPEN_TICKET_UPDATE_DISABLED: "OPEN_TICKET_UPDATE_DISABLED",
  SIGNAL_CLEARED_CLOSE_LINKED_OPEN: "SIGNAL_CLEARED_CLOSE_LINKED_OPEN",
  SIGNAL_CLEARED_NO_ACTION: "SIGNAL_CLEARED_NO_ACTION",
});

/**
 * @typedef {Object} LifecycleDecisionInput
 * @property {boolean} signalQualifies
 * @property {"none"|"open"|"closed"|"missing"} linkedTicketState
 * @property {"update_existing_open"|"skip_existing_open"} existingOpenTicketBehavior
 * @property {boolean} payloadChanged
 * @property {boolean} closeWhenSignalClears
 */

/**
 * @typedef {Object} LifecycleDecision
 * @property {"CREATE"|"UPDATE"|"CLOSE"|"SKIP"} action
 * @property {string} reason
 * @property {boolean} shouldWriteCorrelation
 * @property {boolean} shouldClearCorrelation
 */

/**
 * Locked v1 lifecycle policy:
 * - closed linked tickets are not reopened
 * - closed linked tickets become CREATE when signal still qualifies
 * - existing open ticket update behavior is config-driven
 *
 * @param {LifecycleDecisionInput} input
 * @returns {LifecycleDecision}
 */
function decideLifecycleAction(input) {
  const normalized = normalizeDecisionInput(input);

  if (normalized.signalQualifies) {
    if (normalized.linkedTicketState === LINKED_TICKET_STATES.NONE) {
      return {
        action: LIFECYCLE_ACTIONS.CREATE,
        reason: LIFECYCLE_REASONS.NO_LINKED_TICKET,
        shouldWriteCorrelation: true,
        shouldClearCorrelation: false,
      };
    }

    if (normalized.linkedTicketState === LINKED_TICKET_STATES.MISSING) {
      return {
        action: LIFECYCLE_ACTIONS.CREATE,
        reason: LIFECYCLE_REASONS.LINKED_TICKET_MISSING,
        shouldWriteCorrelation: true,
        shouldClearCorrelation: false,
      };
    }

    if (normalized.linkedTicketState === LINKED_TICKET_STATES.CLOSED) {
      return {
        action: LIFECYCLE_ACTIONS.CREATE,
        reason: LIFECYCLE_REASONS.LINKED_TICKET_CLOSED_CREATE_NEW,
        shouldWriteCorrelation: true,
        shouldClearCorrelation: false,
      };
    }

    if (normalized.existingOpenTicketBehavior === EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN) {
      return {
        action: LIFECYCLE_ACTIONS.SKIP,
        reason: LIFECYCLE_REASONS.OPEN_TICKET_UPDATE_DISABLED,
        shouldWriteCorrelation: false,
        shouldClearCorrelation: false,
      };
    }

    if (!normalized.payloadChanged) {
      return {
        action: LIFECYCLE_ACTIONS.SKIP,
        reason: LIFECYCLE_REASONS.OPEN_TICKET_UNCHANGED,
        shouldWriteCorrelation: false,
        shouldClearCorrelation: false,
      };
    }

    return {
      action: LIFECYCLE_ACTIONS.UPDATE,
      reason: LIFECYCLE_REASONS.OPEN_TICKET_PAYLOAD_CHANGED,
      shouldWriteCorrelation: true,
      shouldClearCorrelation: false,
    };
  }

  if (normalized.linkedTicketState === LINKED_TICKET_STATES.OPEN && normalized.closeWhenSignalClears) {
    return {
      action: LIFECYCLE_ACTIONS.CLOSE,
      reason: LIFECYCLE_REASONS.SIGNAL_CLEARED_CLOSE_LINKED_OPEN,
      shouldWriteCorrelation: false,
      shouldClearCorrelation: true,
    };
  }

  return {
    action: LIFECYCLE_ACTIONS.SKIP,
    reason: LIFECYCLE_REASONS.SIGNAL_CLEARED_NO_ACTION,
    shouldWriteCorrelation: false,
    shouldClearCorrelation: false,
  };
}

/**
 * @param {Partial<LifecycleDecisionInput>} input
 * @returns {LifecycleDecisionInput}
 */
function normalizeDecisionInput(input) {
  const linkedTicketState = String(input?.linkedTicketState || LINKED_TICKET_STATES.NONE).toLowerCase();
  const behavior = String(
    input?.existingOpenTicketBehavior || EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN
  ).toLowerCase();

  return {
    signalQualifies: Boolean(input?.signalQualifies),
    linkedTicketState: Object.values(LINKED_TICKET_STATES).includes(linkedTicketState)
      ? linkedTicketState
      : LINKED_TICKET_STATES.NONE,
    existingOpenTicketBehavior:
      behavior === EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN
        ? EXISTING_OPEN_TICKET_BEHAVIOR.SKIP_EXISTING_OPEN
        : EXISTING_OPEN_TICKET_BEHAVIOR.UPDATE_EXISTING_OPEN,
    payloadChanged: input?.payloadChanged === undefined ? true : Boolean(input?.payloadChanged),
    closeWhenSignalClears: input?.closeWhenSignalClears === undefined ? true : Boolean(input?.closeWhenSignalClears),
  };
}

module.exports = {
  LINKED_TICKET_STATES,
  EXISTING_OPEN_TICKET_BEHAVIOR,
  LIFECYCLE_ACTIONS,
  LIFECYCLE_REASONS,
  decideLifecycleAction,
};
