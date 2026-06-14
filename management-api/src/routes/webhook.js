const express = require('express');
const db = require('../db');
const { verifyWebhookSignature } = require('../razorpayClient');
const { invalidateTenantCache } = require('../redisClient');

const router = express.Router();

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

/**
 * POST /webhook/razorpay
 *
 * Handles Razorpay subscription webhook events.
 * No JWT auth — uses Razorpay signature verification.
 *
 * Events handled:
 *   - subscription.authenticated — subscription is authenticated
 *   - subscription.activated — first payment succeeded, upgrade tenant
 *   - subscription.charged — recurring payment succeeded
 *   - subscription.pending — payment pending
 *   - subscription.halted — payment failed repeatedly → downgrade
 *   - subscription.cancelled — cancelled → downgrade
 */
router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    // Verify signature (skip in dev if no secret set)
    if (WEBHOOK_SECRET && signature) {
      const isValid = verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET);
      if (!isValid) {
        console.error('[Webhook] Invalid Razorpay signature');
        return res.status(400).json({ error: 'Invalid signature' });
      }
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.event;
    const payload = event.payload?.subscription?.entity;

    if (!payload) {
      console.warn('[Webhook] No subscription entity in payload');
      return res.status(200).json({ status: 'ignored' });
    }

    const razorpaySubId = payload.id;
    console.log(`[Webhook] Event: ${eventType}, Sub: ${razorpaySubId}`);

    // Look up our subscription record
    const subResult = await db.query(
      `SELECT s.id, s.tenant_id, s.plan, s.status
       FROM subscriptions s
       WHERE s.razorpay_sub_id = $1`,
      [razorpaySubId]
    );

    if (subResult.rows.length === 0) {
      console.warn(`[Webhook] Unknown subscription: ${razorpaySubId}`);
      return res.status(200).json({ status: 'unknown_subscription' });
    }

    const sub = subResult.rows[0];
    const tenantId = sub.tenant_id;

    switch (eventType) {
      case 'subscription.authenticated':
        await updateSubscriptionStatus(razorpaySubId, 'authenticated', payload);
        break;

      case 'subscription.activated':
        await updateSubscriptionStatus(razorpaySubId, 'active', payload);
        // Upgrade the tenant's plan
        await db.query(
          `UPDATE tenants SET plan = $1, updated_at = now() WHERE id = $2`,
          [sub.plan, tenantId]
        );
        await invalidateTenantCache(tenantId);
        console.log(`[Webhook] Tenant ${tenantId} upgraded to ${sub.plan}`);
        break;

      case 'subscription.charged':
        await updateSubscriptionStatus(razorpaySubId, 'active', payload);
        // Ensure plan is still active (in case it was changed)
        await db.query(
          `UPDATE tenants SET plan = $1, updated_at = now() WHERE id = $2`,
          [sub.plan, tenantId]
        );
        break;

      case 'subscription.pending':
        await updateSubscriptionStatus(razorpaySubId, 'pending', payload);
        break;

      case 'subscription.halted':
        await updateSubscriptionStatus(razorpaySubId, 'halted', payload);
        // Downgrade to free
        await db.query(
          `UPDATE tenants SET plan = 'free', updated_at = now() WHERE id = $1`,
          [tenantId]
        );
        await invalidateTenantCache(tenantId);
        console.log(`[Webhook] Tenant ${tenantId} downgraded due to payment failure`);
        break;

      case 'subscription.cancelled':
        await updateSubscriptionStatus(razorpaySubId, 'cancelled', payload);
        // Downgrade to free
        await db.query(
          `UPDATE tenants SET plan = 'free', updated_at = now() WHERE id = $1`,
          [tenantId]
        );
        await invalidateTenantCache(tenantId);
        console.log(`[Webhook] Tenant ${tenantId} subscription cancelled, downgraded to free`);
        break;

      case 'subscription.completed':
        await updateSubscriptionStatus(razorpaySubId, 'completed', payload);
        break;

      case 'subscription.expired':
        await updateSubscriptionStatus(razorpaySubId, 'expired', payload);
        // Downgrade to free
        await db.query(
          `UPDATE tenants SET plan = 'free', updated_at = now() WHERE id = $1`,
          [tenantId]
        );
        await invalidateTenantCache(tenantId);
        break;

      default:
        console.log(`[Webhook] Unhandled event: ${eventType}`);
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    // Always return 200 to prevent Razorpay retries on our errors
    res.status(200).json({ status: 'error', message: err.message });
  }
});

/**
 * Update subscription status and timestamps in the database.
 */
async function updateSubscriptionStatus(razorpaySubId, status, payload) {
  await db.query(
    `UPDATE subscriptions
     SET status = $1,
         current_start = $2,
         current_end = $3,
         updated_at = now()
     WHERE razorpay_sub_id = $4`,
    [
      status,
      payload.current_start ? new Date(payload.current_start * 1000) : null,
      payload.current_end ? new Date(payload.current_end * 1000) : null,
      razorpaySubId,
    ]
  );
}

module.exports = router;
