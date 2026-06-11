const { resolveTenant } = require('./tenantResolver');
const { loadRules, matchRule } = require('./ruleLoader');
const { evalSlidingWindow } = require('./redisClient');
const { trackUsage } = require('./usageTracker');
const { forwardRequest } = require('./forwarder');

/**
 * Core rate limiting middleware.
 *
 * Flow:
 *   1. Resolve tenant from X-Project-Key
 *   2. Check if tenant is suspended
 *   3. Load rules (cached in Redis)
 *   4. Match the best rule for this route
 *   5. Build the Redis key based on keyBy
 *   6. Execute sliding window check (atomic Lua)
 *   7. Set rate limit response headers
 *   8. If allowed → forward to upstream, track usage
 *   9. If blocked → 429, track usage
 */
async function rateLimiterMiddleware(req, res) {
  try {
    // ─── Step 1: Resolve tenant ────────────────────────
    const tenant = await resolveTenant(req);

    if (!tenant) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid X-Project-Key header',
      });
    }

    // ─── Step 2: Check suspended status ────────────────
    if (tenant.status === 'suspended') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This project has been suspended. Contact support.',
      });
    }

    // Attach tenant to request for downstream use
    req.tenant = tenant;

    // ─── Step 3: Load rules ────────────────────────────
    const rules = await loadRules(tenant.id);

    // ─── Step 4: Match rule for this route ─────────────
    const rule = matchRule(rules, req.path, tenant.plan);

    // ─── Step 5: Build Redis key ───────────────────────
    const identifier = resolveIdentifier(req, rule.keyBy);
    let redisKey;

    if (rule.route && rule.route !== '*') {
      redisKey = `rl:${tenant.id}:route:${rule.route}:${rule.keyBy}:${identifier}`;
    } else {
      redisKey = `rl:${tenant.id}:${rule.keyBy}:${identifier}`;
    }

    // ─── Step 6: Execute rate limit check ──────────────
    const now = Date.now();
    const result = await evalSlidingWindow(redisKey, now, rule.windowMs, rule.maxReq);

    // ─── Step 7: Set response headers ──────────────────
    res.set('X-RateLimit-Limit', String(rule.maxReq));
    res.set('X-RateLimit-Remaining', String(result.remaining));
    res.set('X-RateLimit-Window-Ms', String(rule.windowMs));

    // ─── Step 8/9: Forward or block ────────────────────
    if (result.allowed) {
      // Track allowed request (fire-and-forget)
      trackUsage(tenant.id, true);

      // Forward to upstream
      forwardRequest(req, res);
    } else {
      // Track blocked request (fire-and-forget)
      trackUsage(tenant.id, false);

      const retryAfterSec = Math.ceil(rule.windowMs / 1000);
      res.set('Retry-After', String(retryAfterSec));

      res.status(429).json({
        error: 'Too Many Requests',
        retryAfter: retryAfterSec,
        message: `Rate limit exceeded. Try again in ${retryAfterSec}s`,
      });
    }
  } catch (err) {
    console.error('[RateLimiter] Error:', err.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Rate limiter encountered an unexpected error',
    });
  }
}

/**
 * Resolve the identifier for rate limiting based on the keyBy strategy.
 *
 * @param {import('express').Request} req
 * @param {string} keyBy - 'ip', 'api_key', or 'user_id'
 * @returns {string}
 */
function resolveIdentifier(req, keyBy) {
  switch (keyBy) {
    case 'api_key':
      return req.headers['x-api-key'] || req.ip;
    case 'user_id':
      // Future: extract from JWT in Authorization header
      return req.headers['x-user-id'] || req.ip;
    case 'ip':
    default:
      // X-Real-IP is injected by Nginx, fallback to req.ip
      return req.headers['x-real-ip'] || req.ip;
  }
}

module.exports = { rateLimiterMiddleware };
