/**
 * Razorpay SDK client wrapper.
 *
 * Provides helpers for customer, plan, and subscription management.
 * Requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment.
 */

const Razorpay = require('razorpay');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a Razorpay customer.
 *
 * @param {string} email
 * @param {string} tenantId - stored as notes for reference
 * @returns {Promise<object>} Razorpay customer object
 */
async function createCustomer(email, tenantId) {
  return razorpay.customers.create({
    name: email.split('@')[0],
    email,
    notes: { tenant_id: tenantId },
  });
}

/**
 * Create a Razorpay Plan (monthly subscription plan).
 * These are idempotent — call once, then store the plan ID.
 *
 * @param {string} planName - e.g. 'RateLatch Pro'
 * @param {number} amountPaise - amount in paise (3000 = ₹30)
 * @returns {Promise<object>} Razorpay plan object
 */
async function createPlan(planName, amountPaise) {
  return razorpay.plans.create({
    period: 'monthly',
    interval: 1,
    item: {
      name: planName,
      amount: amountPaise,
      currency: 'INR',
      description: `${planName} — Monthly subscription`,
    },
  });
}

/**
 * Create a Razorpay Subscription with autopay.
 *
 * @param {string} razorpayPlanId - Razorpay plan ID
 * @param {string} customerId - Razorpay customer ID
 * @param {number} totalCount - total billing cycles (12 = 1 year, 120 = 10 years)
 * @returns {Promise<object>} Razorpay subscription object
 */
async function createSubscription(razorpayPlanId, customerId, totalCount = 120) {
  return razorpay.subscriptions.create({
    plan_id: razorpayPlanId,
    customer_id: customerId,
    total_count: totalCount,
    customer_notify: 1,
    notes: {},
  });
}

/**
 * Cancel a Razorpay Subscription immediately.
 *
 * @param {string} subscriptionId - Razorpay subscription ID
 * @returns {Promise<object>}
 */
async function cancelSubscription(subscriptionId) {
  return razorpay.subscriptions.cancel(subscriptionId, { cancel_at_cycle_end: 0 });
}

/**
 * Fetch a Razorpay Subscription by ID.
 *
 * @param {string} subscriptionId
 * @returns {Promise<object>}
 */
async function fetchSubscription(subscriptionId) {
  return razorpay.subscriptions.fetch(subscriptionId);
}

/**
 * Verify Razorpay webhook signature.
 *
 * @param {string} body - raw request body string
 * @param {string} signature - X-Razorpay-Signature header
 * @param {string} secret - webhook secret
 * @returns {boolean}
 */
function verifyWebhookSignature(body, signature, secret) {
  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return expectedSignature === signature;
}

module.exports = {
  razorpay,
  createCustomer,
  createPlan,
  createSubscription,
  cancelSubscription,
  fetchSubscription,
  verifyWebhookSignature,
};
