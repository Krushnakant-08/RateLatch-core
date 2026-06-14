require('dotenv').config();

const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const rulesRoutes = require('./routes/rules');
const usageRoutes = require('./routes/usage');
const billingRoutes = require('./routes/billing');
const webhookRoutes = require('./routes/webhook');
const adminRoutes = require('./routes/admin');
const { authenticate } = require('./middleware/authenticate');
const { PLAN_LIMITS } = require('./planLimits');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Webhook route (needs raw body BEFORE express.json) ──
app.use('/manage/webhook', webhookRoutes);

// ─── Middleware ─────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Health Check ───────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'management-api', timestamp: new Date().toISOString() });
});

// ─── Public Routes (no auth required) ───────────────
app.use('/manage', authRoutes);
app.use('/manage/billing', billingRoutes);

// ─── Protected Routes (require JWT) ─────────────────
app.use('/manage/rules', authenticate, rulesRoutes);
app.use('/manage/usage', authenticate, usageRoutes);

// ─── Plan Info (authenticated) ──────────────────────
app.get('/manage/plan-info', authenticate, async (req, res) => {
  try {
    const { tenantId } = req.auth;

    const tenantResult = await db.query(
      'SELECT plan FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const plan = tenantResult.rows[0].plan;
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    const countResult = await db.query(
      'SELECT COUNT(*)::int AS count FROM rate_rules WHERE tenant_id = $1',
      [tenantId]
    );

    res.json({
      plan,
      limits,
      ruleCount: countResult.rows[0].count,
    });
  } catch (err) {
    console.error('[PlanInfo] Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── Admin Routes (owner only) ──────────────────────
app.use('/admin', adminRoutes);

// ─── 404 Handler ────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found.`,
  });
});

// ─── Error Handler ──────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred.',
  });
});

// ─── Start Server ───────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Management API] Running on :${PORT}`);
});
