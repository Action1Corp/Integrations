// config/helpers.js


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
