// haloTicketsClient.stub.js
//
// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.
function createHaloTicketsClientStub() {
  return {
    async createTicket() {
      throw new Error("Halo ticket create is not implemented in Stage 2");
    },
    async updateTicket() {
      throw new Error("Halo ticket update is not implemented in Stage 2");
    },
    async getTicket() {
      throw new Error("Halo ticket read is not implemented in Stage 2");
    },
    async setTicketStatus() {
      throw new Error("Halo ticket status update is not implemented in Stage 2");
    },
  };
}

module.exports = {
  createHaloTicketsClientStub,
};
