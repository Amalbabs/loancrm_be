import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import prisma, { connectDB } from './src/config/db.js';
import authRoutes from './src/routes/authRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import leadRoutes from './src/routes/leadRoutes.js';
import staffRoutes from './src/routes/staffRoutes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Standard Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global Response Interceptor: Always append corresponding HTTP status code to JSON response bodies
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (body) {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const isSuccess = body.success !== undefined ? body.success : res.statusCode < 400;
      const { success, status, ...rest } = body;
      body = {
        success: isSuccess,
        status: typeof status === 'number' ? status : res.statusCode,
        ...rest
      };
    }
    return originalJson.call(this, body);
  };
  next();
});

// Document File Streaming Endpoint (Streams binary fileData from PostgreSQL database)
app.get('/uploads/:fileName', async (req, res) => {
  try {
    const { fileName } = req.params;
    const document = await prisma.document.findFirst({
      where: { fileName },
      select: {
        fileName: true,
        originalName: true,
        fileType: true,
        fileSize: true,
        fileData: true
      }
    });

    if (document && document.fileData) {
      res.setHeader('Content-Type', document.fileType || 'application/octet-stream');
      res.setHeader('Content-Length', document.fileData.length);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(document.originalName || document.fileName)}"`
      );
      return res.end(document.fileData);
    }

    // Disk fallback for legacy uploaded files
    const diskPath = path.join(__dirname, 'uploads', fileName);
    if (fs.existsSync(diskPath)) {
      return res.sendFile(diskPath);
    }

    return res.status(404).json({
      success: false,
      status: 404,
      message: 'Document file not found.'
    });
  } catch (error) {
    console.error('[Document Stream Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to stream document file.',
      error: error.message
    });
  }
});

// Direct Document Stream by ID (/api/documents/:id or /api/documents/:id/download)
app.get(['/api/documents/:id/download', '/api/documents/:id/view', '/api/documents/:id'], async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, status: 400, message: 'Invalid document ID.' });
    }
    const document = await prisma.document.findUnique({
      where: { id },
      select: {
        fileName: true,
        originalName: true,
        fileType: true,
        fileSize: true,
        fileData: true
      }
    });

    if (!document || !document.fileData) {
      return res.status(404).json({ success: false, status: 404, message: 'Document file not found in database.' });
    }

    const isDownload = req.path.includes('/download');
    res.setHeader('Content-Type', document.fileType || 'application/octet-stream');
    res.setHeader('Content-Length', document.fileData.length);
    res.setHeader(
      'Content-Disposition',
      `${isDownload ? 'attachment' : 'inline'}; filename="${encodeURIComponent(document.originalName || document.fileName)}"`
    );
    return res.end(document.fileData);
  } catch (error) {
    console.error('[Document ID Stream Error]:', error);
    return res.status(500).json({ success: false, status: 500, message: error.message });
  }
});

// Legacy static directory fallback
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount API Routers
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/staff', staffRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 200,
    service: 'Loan Sales & Call Centre CRM API',
    timestamp: new Date().toISOString()
  });
});

// 404 Handler for unmatched API endpoints (Express 5 compatible)
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    status: 404,
    message: 'API route not found'
  });
});

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]:', err.stack || err.message);
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message: err.message || 'Internal Server Error'
  });
});

// Start application
app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`  Loan Sales & Call Centre CRM API running on port ${PORT}`);
  console.log(`  Health Check:   http://localhost:${PORT}/api/health`);
  console.log(`  Auth Routes:    http://localhost:${PORT}/api/auth/*`);
  console.log(`  Admin Routes:   http://localhost:${PORT}/api/admin/*`);
  console.log(`  Lead Routes:    http://localhost:${PORT}/api/leads/*`);
  console.log(`  Staff Routes:   http://localhost:${PORT}/api/staff/*`);
  console.log(`=======================================================`);

  // Verify Prisma database connectivity
  await connectDB();
});

export default app;
