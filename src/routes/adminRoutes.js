import express from 'express';
import {
  getDashboardStats,
  getEmployeesPerformance,
  distributeLeads,
  verifyDocument,
  manageSchemes
} from '../controllers/adminController.js';
import { uploadDocument } from '../controllers/staffController.js';
import { verifyToken, isAdmin } from '../middleware/auth.js';
import upload, { documentUpload } from '../middleware/upload.js';

const router = express.Router();

// All admin routes require valid JWT token and ADMIN role
router.use(verifyToken, isAdmin);

// 1. Dashboard analytics (Floor-wide stats vs 2,000 quota)
router.get('/dashboard-stats', getDashboardStats);

// 2. Employees performance tracking (calls completed today / 100)
router.get('/employees-performance', getEmployeesPerformance);

// 3. Lead distribution engine (manual or batch round-robin)
router.post('/distribute-leads', distributeLeads);

// 4. Document upload & approval / rejection verification
router.post('/upload-document/:leadId', documentUpload, uploadDocument);
router.put('/verify-document/:id', verifyDocument);
router.patch('/verify-document/:id', verifyDocument);
router.post('/verify-document/:id', verifyDocument);
router.put('/verify-document', verifyDocument);
router.patch('/verify-document', verifyDocument);
router.post('/verify-document', verifyDocument);

// 5. Partner Bank Schemes CRUD (HDFC, ICICI, SBI, etc.)
router.get('/schemes', manageSchemes.list);
router.post('/schemes', manageSchemes.create);
router.put('/schemes/:id', manageSchemes.update);
router.delete('/schemes/:id', manageSchemes.delete);

export default router;
