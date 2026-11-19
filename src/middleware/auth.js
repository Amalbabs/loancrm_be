import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';

/**
 * JWT Authentication Middleware
 * Verifies the Bearer token in the Authorization header.
 */
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      status: 401,
      message: 'Access denied. No authentication token provided.'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretjwtkey_loan_crm_2026_secure');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      status: 401,
      message: 'Invalid, malformed, or expired token.',
      error: error.message
    });
  }
};

/**
 * Role-Based Access Control: ADMIN only
 */
export const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role.toUpperCase() !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      status: 403,
      message: 'Forbidden: Admin access required.'
    });
  }
  next();
};

/**
 * Role-Based Access Control: STAFF only
 */
export const isStaff = (req, res, next) => {
  if (!req.user || req.user.role.toUpperCase() !== 'STAFF') {
    return res.status(403).json({
      success: false,
      status: 403,
      message: 'Forbidden: Staff access required.'
    });
  }
  next();
};

/**
 * Role-Based Access Control: STAFF or ADMIN
 */
export const isStaffOrAdmin = (req, res, next) => {
  const role = req.user?.role?.toUpperCase();
  if (!req.user || (role !== 'STAFF' && role !== 'ADMIN')) {
    return res.status(403).json({
      success: false,
      status: 403,
      message: 'Forbidden: Staff or Admin access required.'
    });
  }
  next();
};

/**
 * Registration Guard: Only Admins can create staff accounts
 * Allows initial setup only if no Admin exists in the database.
 */
export const requireAdminToRegister = async (req, res, next) => {
  try {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (adminCount === 0) {
      return next(); // Bootstrap initial admin setup
    }
    return verifyToken(req, res, () => {
      isAdmin(req, res, next);
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to verify admin registration privileges.',
      error: error.message
    });
  }
};

export default {
  verifyToken,
  isAdmin,
  isStaff,
  isStaffOrAdmin,
  requireAdminToRegister
};
