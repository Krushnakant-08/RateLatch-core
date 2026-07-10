const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../db');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const BCRYPT_ROUNDS = 12;

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
 * Body: { email, password, upstreamUrl, plan? }
 * Returns: { tenantId, projectKey, dashboardToken }
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, upstreamUrl, plan = 'free' } = req.body;

    // Validation
    if (!email || !password || !upstreamUrl) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'email, password, and upstreamUrl are required.',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password must be at least 8 characters.',
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

    // Hash password and generate project key
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const projectKey = generateProjectKey();

    // Insert tenant
    const result = await db.query(
      `INSERT INTO tenants (email, project_key, password_hash, plan, upstream_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, plan, upstream_url, created_at`,
      [email, projectKey, passwordHash, plan, upstreamUrl]
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
 * Authenticate using email + password.
 * Body: { email, password }
 * Returns: { tenantId, dashboardToken }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'email and password are required.',
      });
    }

    const result = await db.query(
      'SELECT id, email, plan, status, role, password_hash FROM tenants WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
      });
    }

    const tenant = result.rows[0];

    // Reject accounts that pre-date the password system
    if (!tenant.password_hash) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'This account was created before password login was enabled. Please re-register.',
      });
    }

    const passwordMatch = await bcrypt.compare(password, tenant.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
      });
    }

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
        role: tenant.role || 'tenant',
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

/**
 * GET /me
 *
 * Returns the current tenant's project key and upstream URL.
 * Requires JWT authentication.
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const { tenantId } = req.auth;

    const result = await db.query(
      'SELECT project_key, upstream_url FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: 'Tenant not found.' });
    }

    const { project_key, upstream_url } = result.rows[0];
    res.json({ projectKey: project_key, upstreamUrl: upstream_url });
  } catch (err) {
    console.error('[Auth] /me error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch profile.' });
  }
});

/**
 * PUT /me/upstream
 *
 * Update the current tenant's upstream (backend) URL.
 * Body: { upstreamUrl }
 * Requires JWT authentication.
 */
router.put('/me/upstream', authenticate, async (req, res) => {
  try {
    const { tenantId } = req.auth;
    const { upstreamUrl } = req.body;

    if (!upstreamUrl) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'upstreamUrl is required.',
      });
    }

    // Basic URL validation
    try {
      new URL(upstreamUrl);
    } catch {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'upstreamUrl must be a valid URL.',
      });
    }

    await db.query(
      'UPDATE tenants SET upstream_url = $1, updated_at = now() WHERE id = $2',
      [upstreamUrl, tenantId]
    );

    res.json({ message: 'Backend URL updated successfully.', upstreamUrl });
  } catch (err) {
    console.error('[Auth] /me/upstream error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update upstream URL.' });
  }
});

module.exports = router;
