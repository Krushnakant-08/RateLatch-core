const express = require('express');
const db = require('../db');
const { invalidateTenantCache } = require('../redisClient');

const router = express.Router();

/**
 * GET /rules
 *
 * List all rules for the authenticated tenant, ordered by priority DESC.
 */
router.get('/', async (req, res) => {
  try {
    const { tenantId } = req.auth;

    const result = await db.query(
      `SELECT id, route, key_by, max_req, window_ms, priority, created_at
       FROM rate_rules
       WHERE tenant_id = $1
       ORDER BY priority DESC`,
      [tenantId]
    );

    res.json({ rules: result.rows });
  } catch (err) {
    console.error('[Rules] List error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch rules.' });
  }
});

/**
 * POST /rules
 *
 * Create a new rate rule for the authenticated tenant.
 * Body: { route, keyBy, maxReq, windowMs, priority }
 */
router.post('/', async (req, res) => {
  try {
    const { tenantId } = req.auth;
    const { route = '*', keyBy = 'ip', maxReq, windowMs, priority = 0 } = req.body;

    // Validation
    if (!maxReq || !windowMs) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'maxReq and windowMs are required.',
      });
    }

    if (maxReq < 1 || windowMs < 1000) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'maxReq must be >= 1, windowMs must be >= 1000 (1 second).',
      });
    }

    const validKeyBy = ['ip', 'api_key', 'user_id'];
    if (!validKeyBy.includes(keyBy)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid keyBy. Must be one of: ${validKeyBy.join(', ')}`,
      });
    }

    const result = await db.query(
      `INSERT INTO rate_rules (tenant_id, route, key_by, max_req, window_ms, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, route, key_by, max_req, window_ms, priority, created_at`,
      [tenantId, route, keyBy, maxReq, windowMs, priority]
    );

    // Invalidate cached rules so the gateway picks up the change
    await invalidateTenantCache(tenantId);

    res.status(201).json({ rule: result.rows[0] });
  } catch (err) {
    console.error('[Rules] Create error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create rule.' });
  }
});

/**
 * PUT /rules/:ruleId
 *
 * Update an existing rule.
 * Body: { route?, keyBy?, maxReq?, windowMs?, priority? }
 */
router.put('/:ruleId', async (req, res) => {
  try {
    const { tenantId } = req.auth;
    const { ruleId } = req.params;
    const { route, keyBy, maxReq, windowMs, priority } = req.body;

    // Verify the rule belongs to this tenant
    const existing = await db.query(
      'SELECT id FROM rate_rules WHERE id = $1 AND tenant_id = $2',
      [ruleId, tenantId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Rule not found or does not belong to your project.',
      });
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (route !== undefined) {
      updates.push(`route = $${paramIndex++}`);
      values.push(route);
    }
    if (keyBy !== undefined) {
      updates.push(`key_by = $${paramIndex++}`);
      values.push(keyBy);
    }
    if (maxReq !== undefined) {
      updates.push(`max_req = $${paramIndex++}`);
      values.push(maxReq);
    }
    if (windowMs !== undefined) {
      updates.push(`window_ms = $${paramIndex++}`);
      values.push(windowMs);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(priority);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'No fields to update.',
      });
    }

    values.push(ruleId, tenantId);
    const result = await db.query(
      `UPDATE rate_rules
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex}
       RETURNING id, route, key_by, max_req, window_ms, priority, created_at`,
      values
    );

    // Invalidate cache
    await invalidateTenantCache(tenantId);

    res.json({ rule: result.rows[0] });
  } catch (err) {
    console.error('[Rules] Update error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update rule.' });
  }
});

/**
 * DELETE /rules/:ruleId
 *
 * Delete a rule.
 */
router.delete('/:ruleId', async (req, res) => {
  try {
    const { tenantId } = req.auth;
    const { ruleId } = req.params;

    const result = await db.query(
      'DELETE FROM rate_rules WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [ruleId, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Rule not found or does not belong to your project.',
      });
    }

    // Invalidate cache
    await invalidateTenantCache(tenantId);

    res.json({ message: 'Rule deleted.', ruleId: result.rows[0].id });
  } catch (err) {
    console.error('[Rules] Delete error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to delete rule.' });
  }
});

module.exports = router;
