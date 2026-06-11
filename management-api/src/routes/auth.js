const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

/**
 * Generate a project key with the format: rl_live_{random}
 */
function generateProjectKey() {
  const random = crypto.randomBytes(16).toString('base64url');
  return `rl_live_${random}`;
}

/**
 * POST /register
 *
 * Register a new tenant.
 * Body: { email, upstreamUrl, plan? }
 * Returns: { tenantId, projectKey, dashboardToken }
 */
router.post('/register', async (req, res) => {
  try {
    const { email, upstreamUrl, plan = 'free' } = req.body;

    // Validation
    if (!email || !upstreamUrl) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'email and upstreamUrl are required.',
      });
    }

    const validPlans = ['free', 'pro', 'enterprise'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid plan. Must be one of: ${validPlans.join(', ')}`,
      });
    }

    // Check for duplicate email
    const existing = await db.query('SELECT id FROM tenants WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A tenant with this email already exists.',
      });
    }

    // Generate project key
    const projectKey = generateProjectKey();

    // Insert tenant
    const result = await db.query(
      `INSERT INTO tenants (email, project_key, plan, upstream_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, plan, upstream_url, created_at`,
      [email, projectKey, plan, upstreamUrl]
    );

    const tenant = result.rows[0];

    // Generate JWT for dashboard access
    const dashboardToken = jwt.sign(
      {
        tenantId: tenant.id,
        email: tenant.email,
        role: 'tenant',
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      tenantId: tenant.id,
      projectKey,
      dashboardToken,
    });
  } catch (err) {
    console.error('[Auth] Registration error:', err.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register tenant.',
    });
  }
});

/**
 * POST /login
 *
 * Re-authenticate using email + project key.
 * Body: { email, projectKey }
 * Returns: { tenantId, dashboardToken }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, projectKey } = req.body;

    if (!email || !projectKey) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'email and projectKey are required.',
      });
    }

    const result = await db.query(
      'SELECT id, email, plan, status FROM tenants WHERE email = $1 AND project_key = $2',
      [email, projectKey]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or project key.',
      });
    }

    const tenant = result.rows[0];

    if (tenant.status === 'suspended') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This account has been suspended.',
      });
    }

    const dashboardToken = jwt.sign(
      {
        tenantId: tenant.id,
        email: tenant.email,
        role: 'tenant',
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      tenantId: tenant.id,
      dashboardToken,
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to authenticate.',
    });
  }
});

module.exports = router;
