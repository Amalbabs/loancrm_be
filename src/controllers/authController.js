import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';

/**
 * Generate standard JWT token with 7-day expiration
 */
export const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.toUpperCase()
    },
    process.env.JWT_SECRET || 'supersecretjwtkey_loan_crm_2026_secure',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

/**
 * Login Controller: Authenticates Admin / Staff
 * POST /api/auth/login
 */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Email and password are required.'
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid credentials. User not found.'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'Account is deactivated. Please contact the administrator.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid credentials. Password mismatch.'
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Logged in successfully.',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role.toUpperCase(),
          dailyCallTarget: user.dailyCallTarget
        }
      }
    });
  } catch (error) {
    console.error('[Auth Login Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Server error during authentication.',
      error: error.message
    });
  }
};

/**
 * Register Controller: Create Staff / Admin user
 * POST /api/auth/register
 * Defaults daily call target to 100 calls for staff
 */
export const register = async (req, res) => {
  try {
    const { name, email, password, role = 'STAFF', phone, daily_call_target } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Name, email, and password are required fields.'
      });
    }

    const normalizedRole = role.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'STAFF';
    const normalizedEmail = email.toLowerCase().trim();

    // Check if account already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'An account with this email address already exists.'
      });
    }

    // Call quota rules:
    // Staff callers have a strict target of 100 calls/day (or custom passed value).
    // Admins manage the floor and ALWAYS have 0 calling target.
    let target = 0;
    if (normalizedRole === 'STAFF') {
      target = (daily_call_target !== undefined && daily_call_target !== null && !isNaN(parseInt(daily_call_target, 10)))
        ? parseInt(daily_call_target, 10)
        : 100;
    } else {
      target = 0; // Strictly 0 for Admin
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role: normalizedRole,
        phone: phone ? phone.trim() : null,
        dailyCallTarget: target
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        dailyCallTarget: true,
        isActive: true,
        createdAt: true
      }
    });

    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      status: 201,
      message: `${normalizedRole} account created successfully.`,
      data: {
        user: newUser,
        token
      }
    });
  } catch (error) {
    console.error('[Auth Register Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Server error during user registration.',
      error: error.message
    });
  }
};

/**
 * Current User Profile
 * GET /api/auth/profile
 */
export const getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        dailyCallTarget: true,
        isActive: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'User not found.'
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      data: user
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: error.message
    });
  }
};

export default {
  login,
  register,
  getProfile
};
