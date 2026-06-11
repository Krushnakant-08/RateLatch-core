const db = require('./db');

/**
 * Track a request in the usage_logs table.
 * Uses INSERT ... ON CONFLICT DO UPDATE for atomic upserts.
 * Runs asynchronously — does not block the request pipeline.
 *
 * @param {string} tenantId
 * @param {boolean} allowed - Whether the request was allowed (true) or blocked (false)
 */
function trackUsage(tenantId, allowed) {
  // Truncate to the current hour
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const hour = now.toISOString();

  const column = allowed ? 'allowed' : 'blocked';

  // Fire-and-forget: don't await this in the request handler
  db.query(
    `INSERT INTO usage_logs (tenant_id, hour, ${column})
     VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, hour)
     DO UPDATE SET ${column} = usage_logs.${column} + 1`,
    [tenantId, hour]
  ).catch((err) => {
    console.error('[UsageTracker] Error logging usage:', err.message);
  });
}

module.exports = { trackUsage };
