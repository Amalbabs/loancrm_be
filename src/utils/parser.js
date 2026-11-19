import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import csv from 'csv-parser';
import xlsx from 'xlsx';

/**
 * Maps raw CSV/Excel headers to normalized schema keys
 */
export const normalizeKey = (key) => {
  const clean = String(key || '').trim().toLowerCase().replace(/[\s\-_]+/g, '_');

  const headerMap = {
    name: 'fullName',
    full_name: 'fullName',
    customer_name: 'fullName',
    client_name: 'fullName',
    phone: 'phone',
    phone_number: 'phone',
    mobile: 'phone',
    contact: 'phone',
    email: 'email',
    email_id: 'email',
    loan_type: 'loanType',
    loan_product: 'loanType',
    type: 'loanType',
    amount: 'loanAmount',
    loan_amount: 'loanAmount',
    requested_amount: 'loanAmount',
    income: 'monthlyIncome',
    salary: 'monthlyIncome',
    monthly_income: 'monthlyIncome',
    cibil: 'creditScore',
    cibil_score: 'creditScore',
    credit_score: 'creditScore',
    notes: 'notes',
    remarks: 'notes'
  };

  return headerMap[clean] || clean;
};

/**
 * Parses CSV input streamingly from Buffer or file path
 */
export const parseCSVFile = (input) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const inputStream = Buffer.isBuffer(input)
      ? Readable.from(input)
      : fs.createReadStream(input);

    inputStream
      .pipe(csv({ mapHeaders: ({ header }) => normalizeKey(header) }))
      .on('data', (row) => {
        if (row.phone || row.fullName) {
          results.push({
            fullName: row.fullName ? String(row.fullName).trim() : 'Prospective Borrower',
            phone: row.phone ? String(row.phone).trim() : '',
            email: row.email ? String(row.email).trim() : null,
            loanType: row.loanType ? String(row.loanType).trim() : 'Personal Loan',
            loanAmount: parseFloat(row.loanAmount) || 0.0,
            monthlyIncome: parseFloat(row.monthlyIncome) || 0.0,
            creditScore: parseInt(row.creditScore, 10) || null,
            status: 'NEW',
            notes: row.notes ? String(row.notes).trim() : null
          });
        }
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
};

/**
 * Parses XLSX / XLS Excel files from Buffer or file path
 */
export const parseExcelFile = (input) => {
  const workbook = Buffer.isBuffer(input)
    ? xlsx.read(input, { type: 'buffer' })
    : xlsx.readFile(input);

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

  return rawRows
    .map((row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[normalizeKey(key)] = value;
      }

      if (!normalized.phone && !normalized.fullName) return null;

      return {
        fullName: normalized.fullName ? String(normalized.fullName).trim() : 'Prospective Borrower',
        phone: normalized.phone ? String(normalized.phone).trim() : '',
        email: normalized.email ? String(normalized.email).trim() : null,
        loanType: normalized.loanType ? String(normalized.loanType).trim() : 'Personal Loan',
        loanAmount: parseFloat(normalized.loanAmount) || 0.0,
        monthlyIncome: parseFloat(normalized.monthlyIncome) || 0.0,
        creditScore: parseInt(normalized.creditScore, 10) || null,
        status: 'NEW',
        notes: normalized.notes ? String(normalized.notes).trim() : null
      };
    })
    .filter(Boolean);
};

/**
 * Unified parser for CSV and Excel files (accepts Buffer or filePath)
 */
export const parseLeadsFile = async (input, filenameOrPath = '') => {
  const nameToCheck = typeof input === 'string' ? input : (filenameOrPath || '');
  const ext = path.extname(nameToCheck).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    return parseExcelFile(input);
  }
  return parseCSVFile(input);
};

export default {
  parseLeadsFile,
  normalizeKey
};
