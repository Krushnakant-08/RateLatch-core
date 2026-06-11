const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err.message));

// ─── Lua Script Loading ──────────────────────────────
let slidingWindowSHA = null;

/**
 * Load the sliding window Lua script into Redis at startup.
 * Stores the SHA hash for EVALSHA calls.
 */
async function loadLuaScript() {
  const luaPath = path.join(__dirname, 'lua', 'slidingWindow.lua');
  const luaScript = fs.readFileSync(luaPath, 'utf8');
  slidingWindowSHA = await redis.script('LOAD', luaScript);
  console.log(`[Redis] Lua script loaded, SHA: ${slidingWindowSHA}`);
  return slidingWindowSHA;
}

/**
 * Execute the sliding window rate limit check atomically.
 *
 * @param {string} key   - Redis key (e.g., rl:{tenantId}:ip:{ip})
 * @param {number} now   - Current timestamp in milliseconds
 * @param {number} windowMs - Window duration in milliseconds
 * @param {number} maxReq   - Max requests allowed in the window
 * @returns {Promise<{ allowed: boolean, remaining: number }>}
 */
async function evalSlidingWindow(key, now, windowMs, maxReq) {
  try {
    const result = await redis.evalsha(
      slidingWindowSHA,
      1,           // number of keys
      key,         // KEYS[1]
      now,         // ARGV[1]
      windowMs,    // ARGV[2]
      maxReq       // ARGV[3]
    );

    return {
      allowed: result[0] === 1,
      remaining: result[1],
    };
  } catch (err) {
    // If NOSCRIPT error, reload and retry once
    if (err.message.includes('NOSCRIPT')) {
      console.warn('[Redis] Lua script missing, reloading...');
      await loadLuaScript();
      return evalSlidingWindow(key, now, windowMs, maxReq);
    }
    throw err;
  }
}

module.exports = {
  redis,
  loadLuaScript,
  evalSlidingWindow,
};
