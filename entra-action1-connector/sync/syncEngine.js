// sync/syncEngine.js

import { getSyncJobs } from '../config/helpers.js';
import { listDevicesWithGroups } from '../entra/entraClient.js';

import {
  getAccessToken as getAction1AccessToken,
  listManagedEndpoints,
  patchManagedEndpoint,
} from '../action1/action1Client.js';

import { mapDevicesToPatches } from '../mapping/deviceMapper.js';

/**
 * @typedef {Object} SyncOptions
 * @property {boolean} [dryRun=true] If true - no PATCH calls.
 * @property {number}  [maxPatchesPerJob=50] Safety limit per job.
 * @property {number}  [maxTotalPatches=200] Safety limit across all jobs.
 * @property {boolean} [stopOnJobError=false] If true - abort on first job failure.
 * @property {boolean} [stopOnPatchError=false] If true - abort job on first PATCH failure.
 * @property {number}  [endpointPageSize=200] Action1 paging.
 * @property {boolean} [cacheEntraDevices=true] Reuse Entra devices per tenant within one run.
 */

function normalizeOptions(options = {}) {
  return {
    dryRun: options.dryRun !== undefined ? Boolean(options.dryRun) : true,
    cacheEntraDevices: options.cacheEntraDevices !== undefined ? Boolean(options.cacheEntraDevices) : true,
    maxPatchesPerJob: Number.isFinite(options.maxPatchesPerJob) ? options.maxPatchesPerJob : 50,
    maxTotalPatches: Number.isFinite(options.maxTotalPatches) ? options.maxTotalPatches : 200,
    stopOnJobError: Boolean(options.stopOnJobError),
    stopOnPatchError: Boolean(options.stopOnPatchError),
    endpointPageSize: Number.isFinite(options.endpointPageSize) ? options.endpointPageSize : 50,
  };
}

/**
 * Runs sync for all jobs derived from config.
 * Returns a structured summary (useful for CLI + tests).
 *
 * @param {Object} config Validated config object from loadConfig()
 * @param {Object} logger Logger instance
 * @param {SyncOptions} [options]
 */
export async function runSync(config, logger, options) {
  const opts = normalizeOptions(options);

  const jobs = getSyncJobs(config);
  logger.info(`[sync] Starting sync. Jobs=${jobs.length}. dryRun=${opts.dryRun}`);

  // Shared Action1 token across all jobs (same Action1 app creds).
  const action1Token = await getAction1AccessToken(config.action1, logger);

  const jobResults = [];

  // Cache Entra devices per tenant within one run (optional).
  const entraDevicesCache = opts.cacheEntraDevices ? new Map() : null;

  let totalPlannedPatches = 0;
  let totalAppliedPatches = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const jobLabel = `[job ${i + 1}/${jobs.length}] tenant="${job.tenant.name}" org="${job.organizationId}"`;

    logger.info(`[sync] ${jobLabel} Starting`);

    try {
      // 1) Fetch Entra devices (with groups)
      let entraDevices;

      if (!entraDevicesCache) {
        // caching disabled
        entraDevices = await listDevicesWithGroups(job.tenant, logger);
      } else {
        // caching enabled
        //const tenantKey = `${job.tenant.tenantId}:${job.tenant.clientId}`;
        const baseKey = `${job.tenant.tenantId}:${job.tenant.clientId}`;

// TEST MODE: make cache different for Tenant A vs Tenant B by including tenant.name
const includeName = process.env.CACHE_KEY_INCLUDE_TENANT_NAME === '1';
const tenantNameSafe = String(job.tenant.name || '')
  .trim()
  .replace(/\s+/g, '_')
  .replace(/[^a-zA-Z0-9._-]/g, '');

const tenantKey = includeName ? `${baseKey}:${tenantNameSafe}` : baseKey;

        entraDevices = entraDevicesCache.get(tenantKey);
        if (!entraDevices) {
          entraDevices = await listDevicesWithGroups(job.tenant, logger);
          entraDevicesCache.set(tenantKey, entraDevices);
          logger.info(`[sync] ${jobLabel} Entra cache: stored devices for ${tenantKey}`);
        } else {
          logger.info(`[sync] ${jobLabel} Entra cache: reused devices for ${tenantKey}`);
        }
      }

      logger.info(`[sync] ${jobLabel} Entra devices=${entraDevices.length}`);

      // 2) Fetch Action1 endpoints
      const endpoints = await listManagedEndpoints(
        config.action1,
        action1Token,
        job.organizationId,
        { limit: opts.endpointPageSize },
        logger
      );
      logger.info(`[sync] ${jobLabel} Action1 endpoints=${endpoints.length}`);

      // 3) Map -> patches
      const mappingResult = mapDevicesToPatches(entraDevices, endpoints, job.mappings);

      const planned = mappingResult?.patches?.length || 0;
      totalPlannedPatches += planned;

      // Safety limits
      let patchesToProcess = mappingResult?.patches ? [...mappingResult.patches] : [];
      let limitedBy = null;

      if (patchesToProcess.length > opts.maxPatchesPerJob) {
        patchesToProcess = patchesToProcess.slice(0, opts.maxPatchesPerJob);
        limitedBy = `maxPatchesPerJob=${opts.maxPatchesPerJob}`;
      }

      if (totalAppliedPatches + patchesToProcess.length > opts.maxTotalPatches) {
        const allowed = Math.max(0, opts.maxTotalPatches - totalAppliedPatches);
        patchesToProcess = patchesToProcess.slice(0, allowed);
        limitedBy = limitedBy
          ? `${limitedBy}, maxTotalPatches=${opts.maxTotalPatches}`
          : `maxTotalPatches=${opts.maxTotalPatches}`;
      }

      logger.info(
        `[sync] ${jobLabel} matched=${mappingResult?.matched?.length || 0}, ` +
          `unmatchedEntra=${mappingResult?.unmatchedEntra?.length || 0}, ` +
          `ambiguous=${mappingResult?.ambiguous?.length || 0}, ` +
          `patchesPlanned=${planned}, patchesToProcess=${patchesToProcess.length}` +
          (limitedBy ? ` (LIMITED by ${limitedBy})` : '')
      );

      // 4) Apply patches (or dry run)
      const applied = [];
      const patchErrors = [];

      if (!opts.dryRun) {
        for (const p of patchesToProcess) {
          try {
            if (!p || !p.endpointId || !p.patch || typeof p.patch !== 'object') {
              throw new Error('Invalid patch item: missing endpointId or patch object');
            }

            if (Object.keys(p.patch).length === 0) {
              logger.debug(`[sync] ${jobLabel} Skipping empty patch endpointId=${p.endpointId}`);
              continue;
            }

            await patchManagedEndpoint(
              config.action1,
              action1Token,
              job.organizationId,
              p.endpointId,
              p.patch,
              logger
            );

            applied.push(p.endpointId);
            totalAppliedPatches += 1;

            logger.info(
              `[sync] ${jobLabel} PATCH ok endpointId=${p.endpointId} keys=${Object.keys(p.patch).length}`
            );
          } catch (err) {
            const msg = err?.message ? err.message : String(err);
            patchErrors.push({ endpointId: p?.endpointId, error: msg });
            logger.error(`[sync] ${jobLabel} PATCH failed endpointId=${p?.endpointId}: ${msg}`);

            if (opts.stopOnPatchError) break;
          }
        }
      }

      const jobResult = {
        tenantName: job.tenant.name,
        organizationId: job.organizationId,
        entraDevices: entraDevices.length,
        action1Endpoints: endpoints.length,
        matched: mappingResult?.matched?.length || 0,
        unmatchedEntra: mappingResult?.unmatchedEntra?.length || 0,
        ambiguous: mappingResult?.ambiguous?.length || 0,
        patchesPlanned: planned,
        patchesToProcess: patchesToProcess.length,
        patchesApplied: opts.dryRun ? 0 : applied.length,
        patchErrors,
        limitedBy,
        dryRun: opts.dryRun,
        samplePatches: (mappingResult?.patches || []).slice(0, 3),
      };

      jobResults.push(jobResult);

      logger.info(`[sync] ${jobLabel} Done`);
    } catch (err) {
      const msg = err?.message ? err.message : String(err);
      logger.error(`[sync] ${jobLabel} Failed: ${msg}`);

      jobResults.push({
        tenantName: job.tenant.name,
        organizationId: job.organizationId,
        error: msg,
        dryRun: opts.dryRun,
      });

      if (opts.stopOnJobError) {
        logger.error('[sync] Aborting due to stopOnJobError=true');
        break;
      }
    }
  }

  const summary = {
    dryRun: opts.dryRun,
    jobs: jobs.length,
    totalPlannedPatches,
    totalAppliedPatches,
    results: jobResults,
  };

  logger.info(
    `[sync] Finished. jobs=${summary.jobs}, totalPlannedPatches=${summary.totalPlannedPatches}, totalAppliedPatches=${summary.totalAppliedPatches}, dryRun=${summary.dryRun}`
  );

  return summary;
}
