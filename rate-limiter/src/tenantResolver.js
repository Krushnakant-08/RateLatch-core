const { redis } = require('./redisClient');
const db = require('./db');

const PROJECT_KEY_CACHE_TTL = parseInt(process.env.PROJECT_KEY_CACHE_TTL_SEC, 10) || 300;

/**
 * Resolve a tenant from the X-Project-Key header.
 *
 * Flow:
 *   1. Extract project key from request header
 *   2. Check Redis cache: auth:projectkey:{key}
 *   3. On cache miss, query PostgreSQL
 *   4. Cache the result with TTL
 *
 * @param {import('express').Request} req
 * @returns {Promise<object|null>} Tenant record or null
 */
async function resolveTenant(req) {
  const projectKey = req.headers['x-project-key'];

  if (!projectKey) {
    return null;
  }

  const cacheKey = `auth:projectkey:${projectKey}`;

  // Step 1: Check Redis cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Step 2: Query PostgreSQL
  const result = await db.query(
    'SELECT id, email, plan, upstream_url, status FROM tenants WHERE project_key = $1',
    [projectKey]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const tenant = result.rows[0];

  // Step 3: Cache in Redis
  await redis.setex(cacheKey, PROJECT_KEY_CACHE_TTL, JSON.stringify(tenant));

  return tenant;
}

module.exports = { resolveTenant };
