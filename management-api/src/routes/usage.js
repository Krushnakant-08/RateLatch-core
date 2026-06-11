const express = require('express');
const db = require('../db');

const router = express.Router();

/**
 * GET /usage
 *
 * Returns hourly allowed/blocked counts for the authenticated tenant.
 * Query params:
 *   - from: ISO date string (default: 24 hours ago)
 *   - to:   ISO date string (default: now)
 *   - hours: shortcut — last N hours (overrides from/to)
 */
router.get('/', async (req, res) => {
  try {
    const { tenantId } = req.auth;

    let fromDate, toDate;

    if (req.query.hours) {
      const hours = parseInt(req.query.hours, 10);
      toDate = new Date();
      fromDate = new Date(toDate.getTime() - hours * 60 * 60 * 1000);
    } else {
      toDate = req.query.to ? new Date(req.query.to) : new Date();
      fromDate = req.query.from
        ? new Date(req.query.from)
        : new Date(toDate.getTime() - 24 * 60 * 60 * 1000);
    }

    // Fetch hourly data
    const result = await db.query(
      `SELECT hour, allowed, blocked
       FROM usage_logs
       WHERE tenant_id = $1
         AND hour >= $2
         AND hour <= $3
       ORDER BY hour ASC`,
      [tenantId, fromDate.toISOString(), toDate.toISOString()]
    );

    const hourly = result.rows;

    // Compute summary
    const totalAllowed = hourly.reduce((sum, row) => sum + parseInt(row.allowed, 10), 0);
    const totalBlocked = hourly.reduce((sum, row) => sum + parseInt(row.blocked, 10), 0);
    const total = totalAllowed + totalBlocked;
    const blockRate = total > 0 ? ((totalBlocked / total) * 100).toFixed(2) + '%' : '0%';

    res.json({
      summary: {
        totalAllowed,
        totalBlocked,
        blockRate,
      },
      hourly,
    });
  } catch (err) {
    console.error('[Usage] Fetch error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch usage data.' });
  }
});

/**
 * GET /usage/routes
 *
 * Usage breakdown by route (requires route-level usage tracking in a future iteration).
 * For now, returns the aggregate data with a note.
 */
router.get('/routes', async (req, res) => {
  try {
    const { tenantId } = req.auth;
    const hours = parseInt(req.query.hours, 10) || 24;

    const fromDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    const result = await db.query(
      `SELECT hour, allowed, blocked
       FROM usage_logs
       WHERE tenant_id = $1 AND hour >= $2
       ORDER BY hour ASC`,
      [tenantId, fromDate.toISOString()]
    );

    res.json({
      message: 'Route-level breakdown requires per-route usage tracking (future enhancement).',
      aggregate: result.rows,
    });
  } catch (err) {
    console.error('[Usage] Routes error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch route usage.' });
  }
});

/**
 * GET /usage/top-ips
 *
 * Top IPs by request volume (requires per-IP usage tracking in a future iteration).
 * Placeholder endpoint.
 */
router.get('/top-ips', async (req, res) => {
  res.json({
    message: 'Per-IP breakdown requires per-IP usage tracking (future enhancement).',
    topIps: [],
  });
});

module.exports = router;
