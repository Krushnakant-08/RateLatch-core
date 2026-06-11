const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

/**
 * Express middleware to verify JWT from Authorization header.
 * Attaches decoded payload (tenantId, email, role) to req.auth.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
    });
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = {
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role || 'tenant',
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token has expired. Please log in again.',
      });
    }
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid token.',
    });
  }
}

/**
 * Middleware that requires the authenticated user to be an owner.
 */
function requireOwner(req, res, next) {
  if (req.auth?.role !== 'owner') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Owner access required.',
    });
  }
  next();
}

module.exports = { authenticate, requireOwner };
