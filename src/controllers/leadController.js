import fs from 'fs';
import prisma from '../config/db.js';
import { parseLeadsFile } from '../utils/parser.js';

/**
 * Bulk Upload Leads
 * POST /api/leads/bulk-upload
 */
export const bulkUploadLeads = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'No file uploaded. Please upload a CSV (.csv) or Excel (.xlsx, .xls) file.'
      });
    }

    let leadsData = [];

    try {
      if (req.file.buffer) {
        leadsData = await parseLeadsFile(req.file.buffer, req.file.originalname);
      } else if (req.file.path) {
        leadsData = await parseLeadsFile(req.file.path);
      } else {
        throw new Error('No readable file buffer or path received.');
      }
    } catch (parseError) {
      console.error('[File Parse Error]:', parseError);
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Failed to parse file. Ensure it is a valid CSV or Excel spreadsheet.',
        error: parseError.message
      });
    } finally {
      if (req.file.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.warn('[Cleanup Notice] Could not delete temp upload file:', e.message);
        }
      }
    }

    if (leadsData.length === 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'No valid leads found in the uploaded file. Check headers and ensure phone/name is present.'
      });
    }

    const autoDistribute = req.body.auto_distribute === 'true' || req.body.auto_distribute === true;
    let activeStaffIds = [];

    if (autoDistribute) {
      const staffList = await prisma.user.findMany({
        where: { role: 'STAFF', isActive: true },
        select: { id: true },
        orderBy: { id: 'asc' }
      });
      activeStaffIds = staffList.map((s) => s.id);
    }

    const recordsToInsert = leadsData.map((lead, index) => {
      let assignedStaffId = null;
      if (autoDistribute && activeStaffIds.length > 0) {
        assignedStaffId = activeStaffIds[index % activeStaffIds.length];
      }

      return {
        fullName: lead.fullName,
        phone: lead.phone,
        email: lead.email,
        loanType: lead.loanType,
        loanAmount: lead.loanAmount,
        monthlyIncome: lead.monthlyIncome,
        creditScore: lead.creditScore,
        status: 'NEW',
        notes: lead.notes,
        assignedTo: assignedStaffId
      };
    });

    const result = await prisma.lead.createMany({
      data: recordsToInsert
    });

    return res.status(201).json({
      success: true,
      status: 201,
      message: `Successfully imported ${result.count} leads with status 'NEW'.`,
      data: {
        totalImported: result.count,
        autoDistributed: autoDistribute,
        staffCount: activeStaffIds.length
      }
    });
  } catch (error) {
    console.error('[Bulk Upload Leads Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Server error during bulk lead insertion.',
      error: error.message
    });
  }
};

const normalizeFilterKey = (val) =>
  String(val || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-&()]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const buildPresetFilter = (key) => {
  const presets = {
    active_pipeline: {
      OR: [
        { status: { equals: 'INTERESTED', mode: 'insensitive' } },
        { status: { equals: 'CALLBACK_SCHEDULED', mode: 'insensitive' } },
        { status: { equals: 'APPROVED', mode: 'insensitive' } },
        { documents: { some: {} } }
      ]
    },
    pending_verification: {
      documents: { some: { verificationStatus: { equals: 'PENDING', mode: 'insensitive' } } }
    },
    verified_approved: {
      OR: [
        { documents: { some: { verificationStatus: { equals: 'APPROVED', mode: 'insensitive' } } } },
        { status: { equals: 'APPROVED', mode: 'insensitive' } },
        { status: { equals: 'DISBURSED', mode: 'insensitive' } }
      ]
    },
    rejected: {
      OR: [
        { documents: { some: { verificationStatus: { equals: 'REJECTED', mode: 'insensitive' } } } },
        { status: { equals: 'REJECTED', mode: 'insensitive' } }
      ]
    },
    with_documents: {
      documents: { some: {} }
    },
    interested: {
      status: { equals: 'INTERESTED', mode: 'insensitive' }
    }
  };

  const aliases = {
    active: 'active_pipeline',
    pipeline: 'active_pipeline',
    pending: 'pending_verification',
    pending_docs: 'pending_verification',
    verified: 'verified_approved',
    verified_and_approved: 'verified_approved',
    rejected_action_needed: 'rejected',
    action_needed: 'rejected',
    has_documents: 'with_documents',
    documents: 'with_documents'
  };

  return presets[aliases[key] || key] || null;
};

export const formatLeadDocuments = (docs = []) => {
  const verifiedDocumentsCount = docs.filter(
    (doc) => doc.verificationStatus?.toUpperCase() === 'APPROVED'
  ).length;
  const pendingDocumentsCount = docs.filter(
    (doc) => doc.verificationStatus?.toUpperCase() === 'PENDING'
  ).length;
  const rejectedDocumentsCount = docs.filter(
    (doc) => doc.verificationStatus?.toUpperCase() === 'REJECTED'
  ).length;

  return {
    uploadedDocumentNames: docs.map((doc) => doc.originalName),
    uploadedDocumentTypes: [...new Set(docs.map((doc) => doc.docType))],
    verifiedDocumentsCount,
    pendingDocumentsCount,
    rejectedDocumentsCount,
    hasVerifiedDocuments: verifiedDocumentsCount > 0,
    hasPendingDocuments: pendingDocumentsCount > 0,
    hasRejectedDocuments: rejectedDocumentsCount > 0,
    uploadedDocuments: docs.map((doc) => ({
      id: doc.id,
      name: doc.originalName,
      docType: doc.docType,
      isVerified: doc.verificationStatus?.toUpperCase() === 'APPROVED',
      verificationStatus: doc.verificationStatus,
      fileUrl: `/uploads/${doc.fileName}`
    })),
    documents: docs.map((doc) => {
      const { fileData: _omitted, ...safeDoc } = doc;
      return {
        ...safeDoc,
        isVerified: doc.verificationStatus?.toUpperCase() === 'APPROVED',
        fileUrl: `/uploads/${doc.fileName}`
      };
    })
  };
};

export const buildLeadFilterWhere = (query = {}, user = {}) => {
  const {
    filter,
    tab,
    status,
    verification_status,
    doc_status,
    document_status,
    has_documents,
    with_documents,
    is_verified,
    verified,
    doc_type,
    assigned_staff,
    assigned_to,
    loan_type,
    search,
    q
  } = query;

  const andConditions = [];
  const allTokens = new Set(['all', 'all_floor_leads', 'all_leads']);

  const presetInput = filter ?? tab;
  if (presetInput !== undefined && String(presetInput).trim() !== '') {
    const presetKey = normalizeFilterKey(presetInput);
    if (!allTokens.has(presetKey)) {
      const presetCondition = buildPresetFilter(presetKey);
      if (presetCondition) {
        andConditions.push(presetCondition);
      }
    }
  }

  if (status !== undefined && String(status).trim() !== '') {
    const statusRaw = String(status).trim();
    const statusKey = normalizeFilterKey(statusRaw);
    if (!allTokens.has(statusKey)) {
      const presetCondition = buildPresetFilter(statusKey);
      if (presetCondition) {
        andConditions.push(presetCondition);
      } else if (statusRaw.includes(',')) {
        const statuses = statusRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (statuses.length > 0) {
          andConditions.push({
            OR: statuses.map((s) => ({ status: { equals: s, mode: 'insensitive' } }))
          });
        }
      } else {
        andConditions.push({ status: { equals: statusRaw, mode: 'insensitive' } });
      }
    }
  }

  const docVerifyParam = verification_status ?? doc_status ?? document_status;
  if (docVerifyParam !== undefined && String(docVerifyParam).trim() !== '') {
    const docVerifyKey = String(docVerifyParam).trim().toUpperCase();
    if (docVerifyKey === 'PENDING') {
      andConditions.push({
        documents: { some: { verificationStatus: { equals: 'PENDING', mode: 'insensitive' } } }
      });
    } else if (docVerifyKey === 'APPROVED' || docVerifyKey === 'VERIFIED') {
      andConditions.push({
        documents: { some: { verificationStatus: { equals: 'APPROVED', mode: 'insensitive' } } }
      });
    } else if (docVerifyKey === 'REJECTED') {
      andConditions.push({
        documents: { some: { verificationStatus: { equals: 'REJECTED', mode: 'insensitive' } } }
      });
    } else if (docVerifyKey === 'NONE' || docVerifyKey === 'UNUPLOADED') {
      andConditions.push({ documents: { none: {} } });
    }
  }

  const hasDocsParam = has_documents ?? with_documents;
  if (hasDocsParam !== undefined && String(hasDocsParam).trim() !== '') {
    const flag = String(hasDocsParam).trim().toLowerCase();
    if (flag === 'true' || flag === '1') {
      andConditions.push({ documents: { some: {} } });
    } else if (flag === 'false' || flag === '0') {
      andConditions.push({ documents: { none: {} } });
    }
  }

  const verifiedParam = is_verified ?? verified;
  if (verifiedParam !== undefined && String(verifiedParam).trim() !== '') {
    const flag = String(verifiedParam).trim().toLowerCase();
    if (flag === 'true' || flag === '1') {
      andConditions.push({
        documents: { some: { verificationStatus: { equals: 'APPROVED', mode: 'insensitive' } } }
      });
    } else if (flag === 'false' || flag === '0') {
      andConditions.push({
        documents: { some: { NOT: { verificationStatus: { equals: 'APPROVED', mode: 'insensitive' } } } }
      });
    }
  }

  if (doc_type !== undefined && String(doc_type).trim() !== '') {
    andConditions.push({
      documents: { some: { docType: { equals: String(doc_type).trim(), mode: 'insensitive' } } }
    });
  }

  const staffParam = assigned_staff ?? assigned_to;
  if (
    user?.role?.toUpperCase() !== 'STAFF' &&
    staffParam !== undefined &&
    String(staffParam).trim() !== ''
  ) {
    const parsedStaffId = parseInt(staffParam, 10);
    if (!isNaN(parsedStaffId)) {
      andConditions.push({ assignedTo: parsedStaffId });
    }
  }

  if (loan_type !== undefined && String(loan_type).trim() !== '') {
    andConditions.push({
      loanType: { contains: String(loan_type).trim(), mode: 'insensitive' }
    });
  }

  const searchInput = search ?? q;
  if (searchInput !== undefined && String(searchInput).trim() !== '') {
    const term = String(searchInput).trim();
    const searchOr = [
      { fullName: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { loanType: { contains: term, mode: 'insensitive' } }
    ];
    const cleanedId = term.replace(/^#/, '');
    if (/^\d+$/.test(cleanedId)) {
      searchOr.push({ id: parseInt(cleanedId, 10) });
    }
    andConditions.push({ OR: searchOr });
  }

  if (user?.role?.toUpperCase() === 'STAFF') {
    andConditions.push({ assignedTo: user.id });
  }

  return andConditions.length > 0 ? { AND: andConditions } : {};
};

/**
 * Get All Leads
 * GET /api/leads
 */
export const getAllLeads = async (req, res) => {
  try {
    const { page = 1, limit = 25 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * pageSize;

    const where = buildLeadFilterWhere(req.query, req.user);

    const [totalCount, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedStaff: {
            select: { id: true, name: true, email: true, phone: true }
          },
          documents: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              docType: true,
              fileName: true,
              originalName: true,
              fileType: true,
              fileSize: true,
              verificationStatus: true,
              verificationRemarks: true,
              uploadedBy: true,
              verifiedBy: true,
              createdAt: true
            }
          },
          _count: {
            select: { callLogs: true, documents: true }
          }
        }
      })
    ]);

    const formattedLeads = leads.map((lead) => ({
      id: lead.id,
      fullName: lead.fullName,
      phone: lead.phone,
      email: lead.email,
      loanType: lead.loanType,
      loanAmount: lead.loanAmount,
      monthlyIncome: lead.monthlyIncome,
      creditScore: lead.creditScore,
      status: lead.status,
      assignedTo: lead.assignedTo,
      assignedStaffName: lead.assignedStaff?.name || 'Unassigned',
      assignedStaffEmail: lead.assignedStaff?.email || null,
      followUpDate: lead.followUpDate,
      notes: lead.notes,
      totalCalls: lead._count.callLogs,
      totalDocuments: lead._count.documents,
      ...formatLeadDocuments(lead.documents),
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt
    }));

    return res.status(200).json({
      success: true,
      status: 200,
      data: {
        leads: formattedLeads,
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: pageSize,
          totalPages: Math.ceil(totalCount / pageSize)
        }
      }
    });
  } catch (error) {
    console.error('[Get All Leads Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to retrieve leads list.',
      error: error.message
    });
  }
};

/**
 * Get Single Lead Details
 * GET /api/leads/:id
 */
export const getLeadById = async (req, res) => {
  try {
    const leadId = parseInt(req.params.id, 10);

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        assignedStaff: {
          select: { id: true, name: true, email: true, phone: true }
        },
        callLogs: {
          orderBy: { createdAt: 'desc' },
          include: {
            staff: { select: { id: true, name: true } }
          }
        },
        documents: {
          orderBy: { createdAt: 'desc' },
          include: {
            uploader: { select: { id: true, name: true } },
            verifier: { select: { id: true, name: true } }
          }
        }
      }
    });

    if (!lead) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Lead not found.'
      });
    }

    if (req.user.role.toUpperCase() === 'STAFF' && lead.assignedTo !== req.user.id) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'Unauthorized: You can only view leads assigned to you.'
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      data: {
        ...lead,
        ...formatLeadDocuments(lead.documents)
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: error.message
    });
  }
};

/**
 * Create or Edit Lead Manually
 * POST /api/leads
 * If payload contains 'id' (or route has :id), edits/updates the existing lead.
 * Otherwise creates a new lead.
 */
export const createLead = async (req, res) => {
  try {
    const targetId = req.body.id || req.params.id;

    const {
      full_name,
      phone,
      email,
      loan_type,
      loan_amount,
      monthly_income,
      credit_score,
      status,
      assigned_to,
      notes,
      follow_up_date
    } = req.body;

    // --- EDIT / UPDATE EXISTING LEAD IF ID IS PRESENT ---
    if (targetId !== undefined && targetId !== null && targetId !== '') {
      const leadId = parseInt(targetId, 10);
      if (isNaN(leadId)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid lead ID provided.'
        });
      }

      const existingLead = await prisma.lead.findUnique({
        where: { id: leadId }
      });

      if (!existingLead) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: `Lead with ID ${leadId} not found to edit.`
        });
      }

      // Role check: Staff can only edit leads assigned to them
      if (req.user.role.toUpperCase() === 'STAFF' && existingLead.assignedTo !== req.user.id) {
        return res.status(403).json({
          success: false,
          status: 403,
          message: 'Unauthorized: You can only edit leads assigned to you.'
        });
      }

      const updateData = {};
      if (full_name !== undefined) updateData.fullName = full_name.trim();
      if (phone !== undefined) updateData.phone = phone.trim();
      if (email !== undefined) updateData.email = email ? email.trim() : null;
      if (loan_type !== undefined) updateData.loanType = loan_type.trim();
      if (loan_amount !== undefined) updateData.loanAmount = parseFloat(loan_amount) || 0.0;
      if (monthly_income !== undefined) updateData.monthlyIncome = parseFloat(monthly_income) || 0.0;
      if (credit_score !== undefined) updateData.creditScore = credit_score ? parseInt(credit_score, 10) : null;
      if (status !== undefined) updateData.status = status.toUpperCase();
      if (assigned_to !== undefined) updateData.assignedTo = assigned_to ? parseInt(assigned_to, 10) : null;
      if (notes !== undefined) updateData.notes = notes ? notes.trim() : null;
      if (follow_up_date !== undefined) updateData.followUpDate = follow_up_date ? new Date(follow_up_date) : null;

      const updatedLead = await prisma.lead.update({
        where: { id: leadId },
        data: updateData
      });

      return res.status(200).json({
        success: true,
        status: 200,
        message: 'Lead updated successfully.',
        data: updatedLead
      });
    }

    // --- CREATE NEW LEAD IF NO ID PROVIDED ---
    if (!full_name || !phone) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'full_name and phone are required fields for creating a new lead.'
      });
    }

    const assignedStaffId = assigned_to
      ? parseInt(assigned_to, 10)
      : req.user.role.toUpperCase() === 'STAFF'
      ? req.user.id
      : null;

    const newLead = await prisma.lead.create({
      data: {
        fullName: full_name.trim(),
        phone: phone.trim(),
        email: email ? email.trim() : null,
        loanType: loan_type ? loan_type.trim() : 'Personal Loan',
        loanAmount: parseFloat(loan_amount) || 0.0,
        monthlyIncome: parseFloat(monthly_income) || 0.0,
        creditScore: credit_score ? parseInt(credit_score, 10) : null,
        status: status ? status.toUpperCase() : 'NEW',
        assignedTo: assignedStaffId,
        notes: notes ? notes.trim() : null,
        followUpDate: follow_up_date ? new Date(follow_up_date) : null
      }
    });

    return res.status(201).json({
      success: true,
      status: 201,
      message: 'Lead created successfully.',
      data: newLead
    });
  } catch (error) {
    console.error('[Create/Edit Lead Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: error.message
    });
  }
};

export default {
  bulkUploadLeads,
  getAllLeads,
  getLeadById,
  createLead
};
