require('dotenv').config();

const express = require('express');
const { loadLuaScript } = require('./redisClient');
const { rateLimiterMiddleware } = require('./rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy headers (X-Forwarded-For, X-Real-IP) from Nginx
app.set('trust proxy', true);

// Health check endpoint (not proxied to upstream)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'rate-limiter', timestamp: new Date().toISOString() });
});

// All other routes go through the rate limiter
app.all('*', rateLimiterMiddleware);

// ─── Startup ─────────────────────────────────────────
async function start() {
  try {
    // Load Lua script into Redis before accepting traffic
    await loadLuaScript();

    app.listen(PORT, () => {
      console.log(`[Gateway] Rate limiter running on :${PORT}`);
    });
  } catch (err) {
    console.error('[Gateway] Failed to start:', err.message);
    process.exit(1);
  }
}

start();
