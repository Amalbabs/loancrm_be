import multer from 'multer';
import path from 'path';

// Multer In-Memory Storage Configuration (Stores files in RAM as Buffer, no disk/uploads folder needed)
const storage = multer.memoryStorage();

// File filter supporting KYC documents (PAN, Aadhaar, Bank Statement, Salary Slip, ITR) and bulk CSV/XLSX
const fileFilter = (req, file, cb) => {
  const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.csv', '.xlsx', '.xls'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type "${ext}". Allowed document types are: PDF, JPG, PNG, CSV, and XLSX/XLS.`
      ),
      false
    );
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB file size limit
  }
});

/**
 * Flexible middleware that accepts a document under 'document', 'file', or any multipart field name
 */
export const documentUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: err.message
      });
    }
    if (!req.file && Array.isArray(req.files) && req.files.length > 0) {
      req.file = req.files[0];
    }
    next();
  });
};

export default upload;
