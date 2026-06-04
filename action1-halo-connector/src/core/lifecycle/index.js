// index.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
const {
  LINKED_TICKET_STATES,
  EXISTING_OPEN_TICKET_BEHAVIOR,
  LIFECYCLE_ACTIONS,
  LIFECYCLE_REASONS,
  decideLifecycleAction,
} = require("./decisionModel");
const { buildHaloCreateTicketPayload, resolveCategory1String } = require("./ticketPayloadBuilder");
const { createLifecycleWriteOrchestrator, hashPayload } = require("./lifecycleWriteOrchestrator");
const { buildTicketContentFromCandidate, buildAction1EndpointUrl } = require("./ticketContentBuilder");
const {
  buildGroupedTicketContentFromCandidate,
  buildGroupedPayloadHashInput,
  buildGroupedProblemUrl,
} = require("./groupedTicketContentBuilder");

module.exports = {
  LINKED_TICKET_STATES,
  EXISTING_OPEN_TICKET_BEHAVIOR,
  LIFECYCLE_ACTIONS,
  LIFECYCLE_REASONS,
  decideLifecycleAction,
  buildHaloCreateTicketPayload,
  resolveCategory1String,
  buildTicketContentFromCandidate,
  buildAction1EndpointUrl,
  buildGroupedTicketContentFromCandidate,
  buildGroupedPayloadHashInput,
  buildGroupedProblemUrl,
  createLifecycleWriteOrchestrator,
  hashPayload,
};
