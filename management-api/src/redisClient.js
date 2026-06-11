const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => console.log('[Redis] Management API connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err.message));

/**
 * Invalidate the cached rules for a tenant.
 * Called after any rule mutation (create, update, delete).
 *
 * @param {string} tenantId
 */
async function invalidateTenantCache(tenantId) {
  await redis.del(`config:tenant:${tenantId}`);
}

/**
 * Invalidate the cached project key lookup for a tenant.
 * Called when a project key is rotated or tenant is deleted.
 *
 * @param {string} projectKey
 */
async function invalidateProjectKeyCache(projectKey) {
  await redis.del(`auth:projectkey:${projectKey}`);
}

module.exports = { redis, invalidateTenantCache, invalidateProjectKeyCache };
