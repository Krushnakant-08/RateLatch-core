/**
 * Plan Limits — Single source of truth for all plan constraints.
 *
 * Used by:
 *   - Rules API (server-side enforcement)
 *   - Billing routes (exposed to dashboard)
 *   - Admin routes (plan override validation)
 */

const PLAN_LIMITS = {
  free: {
    maxRoutes: 5,
    allowedKeyBy: ['ip'],
    priorityAllowed: false,
    maxReqCap: 10,
    priceInr: 0,
    razorpayAmountPaise: 0,
    label: 'Free',
    description: 'Get started with basic rate limiting',
  },
  pro: {
    maxRoutes: 25,
    allowedKeyBy: ['ip', 'api_key'],
    priorityAllowed: false,
    maxReqCap: 30,
    priceInr: 30,
    razorpayAmountPaise: 3000,
    label: 'Pro',
    description: 'For growing APIs with advanced controls',
  },
  enterprise: {
    maxRoutes: 100,
    allowedKeyBy: ['ip', 'api_key', 'user_id'],
    priorityAllowed: true,
    maxReqCap: null, // unlimited
    priceInr: 100,
    razorpayAmountPaise: 10000,
    label: 'Enterprise',
    description: 'Full power for high-traffic production APIs',
  },
};

const VALID_PLANS = Object.keys(PLAN_LIMITS);

/**
 * Get limits for a given plan, falling back to 'free'.
 * @param {string} plan
 * @returns {object}
 */
function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

/**
 * Validate that a rule configuration is allowed under a plan.
 * Returns an array of error messages (empty if valid).
 *
 * @param {string} plan
 * @param {{ keyBy: string, maxReq: number, priority: number }} ruleData
 * @param {number} currentRuleCount - only checked if isCreate is true
 * @param {boolean} isCreate
 * @returns {string[]}
 */
function validateRuleForPlan(plan, ruleData, currentRuleCount = 0, isCreate = true) {
  const limits = getPlanLimits(plan);
  const errors = [];

  // Route count check (only on create)
  if (isCreate && currentRuleCount >= limits.maxRoutes) {
    errors.push(
      `Your ${limits.label} plan allows a maximum of ${limits.maxRoutes} rules. ` +
      `Upgrade your plan to add more.`
    );
  }

  // keyBy check
  if (ruleData.keyBy && !limits.allowedKeyBy.includes(ruleData.keyBy)) {
    errors.push(
      `The "${ruleData.keyBy}" key strategy is not available on the ${limits.label} plan. ` +
      `Allowed: ${limits.allowedKeyBy.join(', ')}.`
    );
  }

  // Priority check
  if (ruleData.priority !== undefined && ruleData.priority !== 0 && !limits.priorityAllowed) {
    errors.push(
      `Custom rule priority is only available on the Enterprise plan.`
    );
  }

  // maxReq cap check
  if (limits.maxReqCap !== null && ruleData.maxReq > limits.maxReqCap) {
    errors.push(
      `Your ${limits.label} plan allows a maximum of ${limits.maxReqCap} requests per rule. ` +
      `Upgrade your plan for higher limits.`
    );
  }

  return errors;
}

/**
 * Given a downgrade from one plan to another, determine which rules
 * would need to be deleted.
 *
 * @param {Array} rules - all rules for the tenant, sorted by priority ASC
 * @param {string} targetPlan
 * @returns {{ toDelete: Array, reasons: string[] }}
 */
function getDowngradeImpact(rules, targetPlan) {
  const limits = getPlanLimits(targetPlan);
  const toDelete = [];
  const reasons = [];

  // Rules using disallowed keyBy values
  const invalidKeyByRules = rules.filter(r => !limits.allowedKeyBy.includes(r.key_by));
  if (invalidKeyByRules.length > 0) {
    toDelete.push(...invalidKeyByRules);
    reasons.push(
      `${invalidKeyByRules.length} rule(s) use key strategies not available on the ${limits.label} plan.`
    );
  }

  // Rules exceeding maxReqCap
  if (limits.maxReqCap !== null) {
    const overCapRules = rules.filter(
      r => r.max_req > limits.maxReqCap && !toDelete.find(d => d.id === r.id)
    );
    if (overCapRules.length > 0) {
      toDelete.push(...overCapRules);
      reasons.push(
        `${overCapRules.length} rule(s) exceed the ${limits.maxReqCap} max requests cap.`
      );
    }
  }

  // Rules with non-zero priority (if not allowed)
  if (!limits.priorityAllowed) {
    const priorityRules = rules.filter(
      r => r.priority !== 0 && !toDelete.find(d => d.id === r.id)
    );
    if (priorityRules.length > 0) {
      toDelete.push(...priorityRules);
      reasons.push(
        `${priorityRules.length} rule(s) use custom priority (Enterprise only).`
      );
    }
  }

  // Excess route count (delete lowest priority first)
  const remaining = rules.filter(r => !toDelete.find(d => d.id === r.id));
  if (remaining.length > limits.maxRoutes) {
    const excess = remaining.length - limits.maxRoutes;
    // Sort by priority ASC (lowest priority gets deleted first)
    const sorted = [...remaining].sort((a, b) => a.priority - b.priority);
    const excessRules = sorted.slice(0, excess);
    toDelete.push(...excessRules);
    reasons.push(
      `${excess} rule(s) exceed the ${limits.maxRoutes} route limit on the ${limits.label} plan.`
    );
  }

  return { toDelete, reasons };
}

module.exports = {
  PLAN_LIMITS,
  VALID_PLANS,
  getPlanLimits,
  validateRuleForPlan,
  getDowngradeImpact,
};
