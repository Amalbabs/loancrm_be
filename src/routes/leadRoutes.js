import express from 'express';
import {
  bulkUploadLeads,
  getAllLeads,
  getLeadById,
  createLead
} from '../controllers/leadController.js';
import { verifyToken, isAdmin } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();

// All lead routes require authentication
router.use(verifyToken);

// 1. Bulk upload CSV/Excel leads (Admin only)
router.post('/bulk-upload', isAdmin, upload.single('file'), bulkUploadLeads);

// 2. Paginated and filtered list of leads
router.get('/', getAllLeads);

// 3. Single lead details
router.get('/:id', getLeadById);

// 4. Create or edit lead (If payload contains 'id' or PUT has :id, edits the lead; otherwise creates)
router.post('/', createLead);
router.put('/:id', createLead);
router.put('/', createLead);

export default router;
