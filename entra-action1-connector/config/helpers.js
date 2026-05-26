// config/helpers.js

// Action1 Public Repository Material
//
// Use of this file is subject to TERMS_OF_USE.md (https://github.com/Action1Corp/PSAction1/blob/main/TERMS_OF_USE.md) in this repository.
// Provided AS IS, without warranties.
// Use at your own risk.
// Review, test, and validate before production use.
// © Action1 Corporation. All rights reserved.

export function getSyncJobs(config) {
  const jobs = [];

  for (const tenant of config.tenants) {
    for (const target of tenant.targets) {
      for (const organizationId of target.organizationIds) {
        jobs.push({
          tenant,                 
          organizationId,       
          mappings: target.mappings
        });
      }
    }
  }

  return jobs;
}
