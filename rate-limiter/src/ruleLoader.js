const { redis } = require('./redisClient');
const db = require('./db');

const RULE_CACHE_TTL = parseInt(process.env.RULE_CACHE_TTL_SEC, 10) || 60;

// Default plan limits (fallbacks when no rule matches)
const PLAN_DEFAULTS = {
  free: {
    maxReq: parseInt(process.env.DEFAULT_FREE_MAX_REQ, 10) || 100,
    windowMs: parseInt(process.env.DEFAULT_FREE_WINDOW_MS, 10) || 60000,
  },
  pro: {
    maxReq: parseInt(process.env.DEFAULT_PRO_MAX_REQ, 10) || 1000,
    windowMs: parseInt(process.env.DEFAULT_PRO_WINDOW_MS, 10) || 60000,
  },
  enterprise: {
    maxReq: parseInt(process.env.DEFAULT_ENTERPRISE_MAX_REQ, 10) || 10000,
    windowMs: parseInt(process.env.DEFAULT_ENTERPRISE_WINDOW_MS, 10) || 60000,
  },
};

/**
 * Load rules for a tenant from cache or database.
 *
 * @param {string} tenantId
 * @returns {Promise<Array>} Rules ordered by priority DESC
 */
async function loadRules(tenantId) {
  const cacheKey = `config:tenant:${tenantId}`;

  // Check Redis cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Query PostgreSQL
  const result = await db.query(
    'SELECT id, route, key_by, max_req, window_ms, priority FROM rate_rules WHERE tenant_id = $1 ORDER BY priority DESC',
    [tenantId]
  );

  const rules = result.rows;

  // Cache with TTL
  await redis.setex(cacheKey, RULE_CACHE_TTL, JSON.stringify(rules));

  return rules;
}

/**
 * Match the best rule for a given request.
 * Priority order: route-specific > wildcard > plan default.
 *
 * @param {Array} rules   - Tenant's rules sorted by priority DESC
 * @param {string} route  - Request path
 * @param {string} plan   - Tenant's plan (free/pro/enterprise)
 * @returns {{ maxReq: number, windowMs: number, keyBy: string, route: string }}
 */
function matchRule(rules, route, plan) {
  for (const rule of rules) {
    // Exact route match
    if (rule.route === route) {
      return {
        maxReq: rule.max_req,
        windowMs: rule.window_ms,
        keyBy: rule.key_by,
        route: rule.route,
      };
    }

    // Wildcard route match (e.g., /api/* matches /api/users)
    if (rule.route.endsWith('/*')) {
      const prefix = rule.route.slice(0, -1); // Remove the *
      if (route.startsWith(prefix)) {
        return {
          maxReq: rule.max_req,
          windowMs: rule.window_ms,
          keyBy: rule.key_by,
          route: rule.route,
        };
      }
    }

    // Catch-all wildcard
    if (rule.route === '*') {
      return {
        maxReq: rule.max_req,
        windowMs: rule.window_ms,
        keyBy: rule.key_by,
        route: rule.route,
      };
    }
  }

  // No matching rule — use plan default
  const defaults = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.free;
  return {
    maxReq: defaults.maxReq,
    windowMs: defaults.windowMs,
    keyBy: 'ip',
    route: '*',
  };
}

module.exports = { loadRules, matchRule };
