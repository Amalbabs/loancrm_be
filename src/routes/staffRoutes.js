import express from 'express';
import {
  getAssignedLeads,
  logCall,
  uploadDocument,
  getPersonalPerformance
} from '../controllers/staffController.js';
import { verifyToken, isStaff, isStaffOrAdmin } from '../middleware/auth.js';
import upload, { documentUpload } from '../middleware/upload.js';

const router = express.Router();

// All staff routes require valid JWT token
router.use(verifyToken);

// 1. Fetch leads assigned specifically to logged-in staff
router.get('/assigned-leads', isStaff, getAssignedLeads);

// 2. Log call outcome (INTERESTED, CALLBACK_SCHEDULED, NOT_INTERESTED)
router.post('/log-call', isStaff, logCall);

// 3. Upload customer KYC / financial documents (Staff & Admin)
router.post('/upload-document/:leadId', isStaffOrAdmin, documentUpload, uploadDocument);

// 4. Personal daily performance metrics (completed / 100 quota)
router.get('/personal-performance', isStaff, getPersonalPerformance);

export default router;
