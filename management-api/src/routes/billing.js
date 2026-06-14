const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/authenticate');
const { PLAN_LIMITS, VALID_PLANS, getPlanLimits, getDowngradeImpact } = require('../planLimits');
const {
  createCustomer,
  createPlan,
  createSubscription,
  cancelSubscription,
} = require('../razorpayClient');

const router = express.Router();

/**
 * GET /billing/plans
 *
 * Returns available plans with limits and pricing. Public endpoint.
 */
router.get('/plans', (req, res) => {
  const plans = Object.entries(PLAN_LIMITS).map(([key, limits]) => ({
    id: key,
    label: limits.label,
    description: limits.description,
    priceInr: limits.priceInr,
    maxRoutes: limits.maxRoutes,
    allowedKeyBy: limits.allowedKeyBy,
    priorityAllowed: limits.priorityAllowed,
    maxReqCap: limits.maxReqCap,
  }));

  res.json({ plans });
});

/**
 * GET /billing/subscription
 *
 * Returns the current tenant's active subscription, or null.
 */
router.get('/subscription', authenticate, async (req, res) => {
  try {
    const { tenantId } = req.auth;

    // Get tenant plan
    const tenantResult = await db.query(
      'SELECT plan FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const currentPlan = tenantResult.rows[0].plan;

    // Get active subscription
    const subResult = await db.query(
      `SELECT id, razorpay_sub_id, razorpay_plan_id, plan, status, current_start, current_end, created_at
       FROM subscriptions
       WHERE tenant_id = $1 AND status IN ('created', 'authenticated', 'active', 'pending')
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId]
    );

    res.json({
      currentPlan,
      subscription: subResult.rows[0] || null,
    });
  } catch (err) {
    console.error('[Billing] Subscription fetch error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch subscription.' });
  }
});

/**
 * POST /billing/subscribe
 *
 * Creates a Razorpay subscription for upgrade.
 * Body: { plan: 'pro' | 'enterprise' }
 * Returns: { subscriptionId, razorpayKeyId } for Razorpay Checkout
 */
router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const { tenantId, email } = req.auth;
    const { plan } = req.body;

    if (!plan || !['pro', 'enterprise'].includes(plan)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Plan must be "pro" or "enterprise".',
      });
    }

    // Check current plan
    const tenantResult = await db.query(
      'SELECT plan, razorpay_customer_id FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenant = tenantResult.rows[0];

    if (tenant.plan === plan) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `You are already on the ${plan} plan.`,
      });
    }

    // Cancel any existing active subscription
    const existingSub = await db.query(
      `SELECT razorpay_sub_id FROM subscriptions
       WHERE tenant_id = $1 AND status IN ('created', 'authenticated', 'active', 'pending')`,
      [tenantId]
    );

    for (const sub of existingSub.rows) {
      try {
        await cancelSubscription(sub.razorpay_sub_id);
      } catch (cancelErr) {
        console.error('[Billing] Failed to cancel old subscription:', cancelErr.message);
      }
      await db.query(
        `UPDATE subscriptions SET status = 'cancelled', updated_at = now()
         WHERE razorpay_sub_id = $1`,
        [sub.razorpay_sub_id]
      );
    }

    // Ensure Razorpay customer exists
    let customerId = tenant.razorpay_customer_id;
    if (!customerId) {
      const customer = await createCustomer(email, tenantId);
      customerId = customer.id;
      await db.query(
        'UPDATE tenants SET razorpay_customer_id = $1 WHERE id = $2',
        [customerId, tenantId]
      );
    }

    // Get or create Razorpay plan
    const planLimits = getPlanLimits(plan);
    let razorpayPlanId = await getRazorpayPlanId(plan);

    if (!razorpayPlanId) {
      const rzpPlan = await createPlan(
        `RateLatch ${planLimits.label}`,
        planLimits.razorpayAmountPaise
      );
      razorpayPlanId = rzpPlan.id;
      // Store the plan ID for reuse
      await db.query(
        `INSERT INTO subscriptions (tenant_id, razorpay_sub_id, razorpay_plan_id, plan, status)
         VALUES ($1, $2, $3, $4, 'plan_reference')
         ON CONFLICT DO NOTHING`,
        [tenantId, `plan_ref_${plan}`, razorpayPlanId, plan]
      );
    }

    // Create subscription
    const subscription = await createSubscription(razorpayPlanId, customerId);

    // Store in DB
    await db.query(
      `INSERT INTO subscriptions (tenant_id, razorpay_sub_id, razorpay_plan_id, plan, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, subscription.id, razorpayPlanId, plan, subscription.status]
    );

    res.status(201).json({
      subscriptionId: subscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      plan,
      amount: planLimits.razorpayAmountPaise,
    });
  } catch (err) {
    console.error('[Billing] Subscribe error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create subscription.' });
  }
});

/**
 * POST /billing/cancel
 *
 * Cancels the active subscription. Tenant will be downgraded to free
 * after confirming rule cleanup via /confirm-downgrade.
 */
router.post('/cancel', authenticate, async (req, res) => {
  try {
    const { tenantId } = req.auth;

    const subResult = await db.query(
      `SELECT razorpay_sub_id FROM subscriptions
       WHERE tenant_id = $1 AND status IN ('authenticated', 'active', 'pending')
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    );

    if (subResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No active subscription found.',
      });
    }

    const subId = subResult.rows[0].razorpay_sub_id;

    try {
      await cancelSubscription(subId);
    } catch (cancelErr) {
      console.error('[Billing] Razorpay cancel error:', cancelErr.message);
    }

    await db.query(
      `UPDATE subscriptions SET status = 'cancelled', updated_at = now()
       WHERE razorpay_sub_id = $1`,
      [subId]
    );

    // Downgrade to free
    await db.query(
      `UPDATE tenants SET plan = 'free', updated_at = now() WHERE id = $1`,
      [tenantId]
    );

    res.json({ message: 'Subscription cancelled. Plan downgraded to Free.' });
  } catch (err) {
    console.error('[Billing] Cancel error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to cancel subscription.' });
  }
});

/**
 * GET /billing/downgrade-preview?targetPlan=free
 *
 * Returns which rules would be deleted if downgrading to the target plan.
 */
router.get('/downgrade-preview', authenticate, async (req, res) => {
  try {
    const { tenantId } = req.auth;
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
    console.error('[Billing] Downgrade preview error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /billing/confirm-downgrade
 *
 * Deletes excess rules and downgrades the plan.
 * Body: { targetPlan: 'free' | 'pro' }
 */
router.post('/confirm-downgrade', authenticate, async (req, res) => {
  try {
    const { tenantId } = req.auth;
    const { targetPlan } = req.body;

    if (!targetPlan || !VALID_PLANS.includes(targetPlan)) {
      return res.status(400).json({ error: 'Invalid target plan.' });
    }

    // Get current plan
    const tenantResult = await db.query('SELECT plan FROM tenants WHERE id = $1', [tenantId]);
    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const currentPlan = tenantResult.rows[0].plan;
    const planOrder = { free: 0, pro: 1, enterprise: 2 };

    if (planOrder[targetPlan] >= planOrder[currentPlan]) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Target plan must be lower than current plan for downgrade.',
      });
    }

    // Get rules and calculate impact
    const rulesResult = await db.query(
      `SELECT id, route, key_by, max_req, window_ms, priority
       FROM rate_rules WHERE tenant_id = $1
       ORDER BY priority ASC`,
      [tenantId]
    );

    const impact = getDowngradeImpact(rulesResult.rows, targetPlan);

    // Delete excess rules
    if (impact.toDelete.length > 0) {
      const idsToDelete = impact.toDelete.map(r => r.id);
      await db.query(
        `DELETE FROM rate_rules WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        [idsToDelete, tenantId]
      );
    }

    // Update plan
    await db.query(
      `UPDATE tenants SET plan = $1, updated_at = now() WHERE id = $2`,
      [targetPlan, tenantId]
    );

    // Invalidate cache
    const { invalidateTenantCache } = require('../redisClient');
    await invalidateTenantCache(tenantId);

    res.json({
      message: `Plan downgraded to ${targetPlan}. ${impact.toDelete.length} rule(s) removed.`,
      deletedRules: impact.toDelete.length,
      remainingRules: rulesResult.rows.length - impact.toDelete.length,
    });
  } catch (err) {
    console.error('[Billing] Confirm downgrade error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── Helper ─────────────────────────────────────────

/**
 * Look up a previously-created Razorpay plan ID from the DB.
 * We store plan references as a special subscription row.
 */
async function getRazorpayPlanId(plan) {
  const result = await db.query(
    `SELECT razorpay_plan_id FROM subscriptions
     WHERE razorpay_sub_id = $1 LIMIT 1`,
    [`plan_ref_${plan}`]
  );
  return result.rows[0]?.razorpay_plan_id || null;
}

module.exports = router;
