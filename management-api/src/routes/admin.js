const express = require('express');
const db = require('../db');
const { authenticate, requireOwner } = require('../middleware/authenticate');
const { PLAN_LIMITS, VALID_PLANS, getDowngradeImpact } = require('../planLimits');
const { invalidateTenantCache } = require('../redisClient');

const router = express.Router();

/**
 * GET /admin/stats
 *
 * Platform-wide statistics for the admin overview. Owner only.
 */
router.get('/stats', authenticate, requireOwner, async (req, res) => {
  try {
    // Total tenants by plan
    const tenantStats = await db.query(
      `SELECT plan, COUNT(*)::int AS count
       FROM tenants WHERE role != 'owner'
       GROUP BY plan`
    );

    const planBreakdown = { free: 0, pro: 0, enterprise: 0 };
    let totalTenants = 0;
    for (const row of tenantStats.rows) {
      planBreakdown[row.plan] = row.count;
      totalTenants += row.count;
    }

    // Total rules
    const ruleStats = await db.query('SELECT COUNT(*)::int AS count FROM rate_rules');
    const totalRules = ruleStats.rows[0].count;

    // Usage last 24h
    const usageStats = await db.query(
      `SELECT COALESCE(SUM(allowed), 0)::bigint AS total_allowed,
              COALESCE(SUM(blocked), 0)::bigint AS total_blocked
       FROM usage_logs
       WHERE hour >= now() - interval '24 hours'`
    );
    const totalAllowed = parseInt(usageStats.rows[0].total_allowed, 10);
    const totalBlocked = parseInt(usageStats.rows[0].total_blocked, 10);

    // Top tenants by usage (24h)
    const topTenants = await db.query(
      `SELECT t.id, t.email, t.plan,
              COALESCE(SUM(u.allowed), 0)::bigint AS allowed,
              COALESCE(SUM(u.blocked), 0)::bigint AS blocked,
              COUNT(DISTINCT r.id)::int AS rule_count
       FROM tenants t
       LEFT JOIN usage_logs u ON u.tenant_id = t.id AND u.hour >= now() - interval '24 hours'
       LEFT JOIN rate_rules r ON r.tenant_id = t.id
       WHERE t.role != 'owner'
       GROUP BY t.id, t.email, t.plan
       ORDER BY (COALESCE(SUM(u.allowed), 0) + COALESCE(SUM(u.blocked), 0)) DESC
       LIMIT 10`
    );

    res.json({
      totalTenants,
      planBreakdown,
      totalRules,
      usage24h: {
        allowed: totalAllowed,
        blocked: totalBlocked,
        total: totalAllowed + totalBlocked,
      },
      topTenants: topTenants.rows.map(t => ({
        ...t,
        allowed: parseInt(t.allowed, 10),
        blocked: parseInt(t.blocked, 10),
      })),
    });
  } catch (err) {
    console.error('[Admin] Stats error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /admin/tenants
 *
 * List all tenants with their rule counts. Owner only.
 */
router.get('/tenants', authenticate, requireOwner, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         t.id, t.email, t.plan, t.status, t.upstream_url, t.created_at, t.updated_at,
         COUNT(r.id)::int AS rule_count
       FROM tenants t
       LEFT JOIN rate_rules r ON r.tenant_id = t.id
       WHERE t.role != 'owner'
       GROUP BY t.id
       ORDER BY t.created_at DESC`
    );

    const tenants = result.rows.map(t => ({
      ...t,
      planLimits: PLAN_LIMITS[t.plan] || PLAN_LIMITS.free,
    }));

    res.json({ tenants });
  } catch (err) {
    console.error('[Admin] List tenants error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /admin/tenants/:tenantId
 *
 * Get a single tenant's details. Owner only.
 */
router.get('/tenants/:tenantId', authenticate, requireOwner, async (req, res) => {
  try {
    const { tenantId } = req.params;

    const result = await db.query(
      `SELECT
         t.id, t.email, t.plan, t.status, t.upstream_url, t.created_at, t.updated_at,
         COUNT(r.id)::int AS rule_count
       FROM tenants t
       LEFT JOIN rate_rules r ON r.tenant_id = t.id
       WHERE t.id = $1
       GROUP BY t.id`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenant = result.rows[0];
    tenant.planLimits = PLAN_LIMITS[tenant.plan] || PLAN_LIMITS.free;

    res.json({ tenant });
  } catch (err) {
    console.error('[Admin] Get tenant error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * PUT /admin/tenants/:tenantId/plan
 *
 * Override a tenant's plan (admin manual upgrade/downgrade).
 * Body: { plan: 'free' | 'pro' | 'enterprise', force?: boolean }
 *
 * If downgrading and force=true, excess rules are auto-deleted.
 * If downgrading and force=false (default), returns a preview of what would be deleted.
 */
router.put('/tenants/:tenantId/plan', authenticate, requireOwner, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { plan, force = false } = req.body;

    if (!plan || !VALID_PLANS.includes(plan)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid plan. Must be one of: ${VALID_PLANS.join(', ')}`,
      });
    }

    // Get current tenant
    const tenantResult = await db.query(
      'SELECT id, plan FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const currentPlan = tenantResult.rows[0].plan;
    const planOrder = { free: 0, pro: 1, enterprise: 2 };
    const isDowngrade = planOrder[plan] < planOrder[currentPlan];

    if (isDowngrade) {
      // Get rules and calculate impact
      const rulesResult = await db.query(
        `SELECT id, route, key_by, max_req, window_ms, priority
         FROM rate_rules WHERE tenant_id = $1
         ORDER BY priority ASC`,
        [tenantId]
      );

      const impact = getDowngradeImpact(rulesResult.rows, plan);

      if (impact.toDelete.length > 0 && !force) {
        // Return preview, don't actually downgrade
        return res.status(409).json({
          error: 'Downgrade requires rule cleanup',
          message: 'This downgrade would require deleting some rules. Set force=true to proceed.',
          preview: {
            targetPlan: plan,
            totalRules: rulesResult.rows.length,
            rulesToDelete: impact.toDelete,
            reasons: impact.reasons,
            rulesAfter: rulesResult.rows.length - impact.toDelete.length,
          },
        });
      }

      // Delete excess rules
      if (impact.toDelete.length > 0) {
        const idsToDelete = impact.toDelete.map(r => r.id);
        await db.query(
          `DELETE FROM rate_rules WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
          [idsToDelete, tenantId]
        );
      }
    }

    // Update plan
    await db.query(
      `UPDATE tenants SET plan = $1, updated_at = now() WHERE id = $2`,
      [plan, tenantId]
    );

    await invalidateTenantCache(tenantId);

    res.json({
      message: `Tenant plan updated to ${plan}.`,
      previousPlan: currentPlan,
      newPlan: plan,
    });
  } catch (err) {
    console.error('[Admin] Update plan error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /admin/tenants/:tenantId/downgrade-preview?targetPlan=free
 *
 * Preview rule deletions for an admin downgrade.
 */
router.get('/tenants/:tenantId/downgrade-preview', authenticate, requireOwner, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const targetPlan = req.query.targetPlan || 'free';

    if (!VALID_PLANS.includes(targetPlan)) {
      return res.status(400).json({ error: 'Invalid target plan.' });
    }

    const rulesResult = await db.query(
      `SELECT id, route, key_by, max_req, window_ms, priority
       FROM rate_rules WHERE tenant_id = $1
       ORDER BY priority ASC`,
      [tenantId]
    );

    const impact = getDowngradeImpact(rulesResult.rows, targetPlan);

    res.json({
      targetPlan,
      totalRules: rulesResult.rows.length,
      rulesToDelete: impact.toDelete,
      reasons: impact.reasons,
      rulesAfter: rulesResult.rows.length - impact.toDelete.length,
    });
  } catch (err) {
    console.error('[Admin] Downgrade preview error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
