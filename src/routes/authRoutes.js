import express from 'express';
import { register, login, getProfile } from '../controllers/authController.js';
import { verifyToken, requireAdminToRegister } from '../middleware/auth.js';

const router = express.Router();

// Public login endpoint
router.post('/login', login);

// Admin-only: Register staff members (only Admins can create staff)
router.post('/register', requireAdminToRegister, register);

// Protected profile route
router.get('/profile', verifyToken, getProfile);

export default router;

