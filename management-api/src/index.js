require('dotenv').config();

const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const rulesRoutes = require('./routes/rules');
const usageRoutes = require('./routes/usage');
const { authenticate } = require('./middleware/authenticate');

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ─────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Health Check ───────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'management-api', timestamp: new Date().toISOString() });
});

// ─── Public Routes (no auth required) ───────────────
app.use('/manage', authRoutes);

// ─── Protected Routes (require JWT) ─────────────────
app.use('/manage/rules', authenticate, rulesRoutes);
app.use('/manage/usage', authenticate, usageRoutes);

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
