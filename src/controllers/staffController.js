import path from 'path';
import prisma from '../config/db.js';
import { formatLeadDocuments, buildLeadFilterWhere } from './leadController.js';

/**
 * Get Leads Assigned to the Logged-in Staff Member
 * GET /api/staff/assigned-leads
 */
export const getAssignedLeads = async (req, res) => {
  try {
    const staffId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * pageSize;

    const where = buildLeadFilterWhere(req.query, { id: staffId, role: 'STAFF' });

    const [totalLeads, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ followUpDate: 'asc' }, { updatedAt: 'desc' }],
        include: {
          callLogs: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              callDisposition: true,
              remarks: true,
              createdAt: true
            }
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

    const formatted = leads.map((lead) => ({
      id: lead.id,
      fullName: lead.fullName,
      phone: lead.phone,
      email: lead.email,
      loanType: lead.loanType,
      loanAmount: lead.loanAmount,
      monthlyIncome: lead.monthlyIncome,
      creditScore: lead.creditScore,
      status: lead.status,
      followUpDate: lead.followUpDate,
      notes: lead.notes,
      totalCallsLogged: lead._count.callLogs,
      documentsCount: lead._count.documents,
      ...formatLeadDocuments(lead.documents),
      lastCall: lead.callLogs[0] || null,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt
    }));

    return res.status(200).json({
      success: true,
      status: 200,
      data: {
        leads: formatted,
        pagination: {
          total: totalLeads,
          page: pageNum,
          limit: pageSize,
          totalPages: Math.ceil(totalLeads / pageSize)
        }
      }
    });
  } catch (error) {
    console.error('[Staff Get Assigned Leads Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to fetch assigned leads.',
      error: error.message
    });
  }
};

/**
 * Log Call Disposition & Activity
 * POST /api/staff/log-call
 */
export const logCall = async (req, res) => {
  try {
    const staffId = req.user.id;
    const {
      lead_id,
      call_disposition,
      remarks,
      callback_date,
      rejection_reason,
      call_duration_seconds = 0
    } = req.body;

    if (!lead_id || !call_disposition) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'lead_id and call_disposition are required fields.'
      });
    }

    const leadId = parseInt(lead_id, 10);
    const disposition = call_disposition.toUpperCase().trim();

    const validDispositions = ['INTERESTED', 'CALLBACK_SCHEDULED', 'NOT_INTERESTED'];
    if (!validDispositions.includes(disposition)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `Invalid call_disposition. Must be one of: ${validDispositions.join(', ')}`
      });
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId }
    });

    if (!lead) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Lead not found.'
      });
    }

    let parsedCallback = null;
    if (disposition === 'CALLBACK_SCHEDULED') {
      if (!callback_date) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'callback_date is required when call_disposition is CALLBACK_SCHEDULED.'
        });
      }
      parsedCallback = new Date(callback_date);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingCallToday = await prisma.callLog.findFirst({
      where: {
        leadId,
        staffId,
        createdAt: { gte: today }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    const trimmedRemarks = remarks ? remarks.trim() : null;
    const callLogData = {
      callStatus: 'COMPLETED',
      callDisposition: disposition,
      callDurationSeconds: parseInt(call_duration_seconds, 10) || 0,
      remarks: trimmedRemarks,
      callbackDate: parsedCallback,
      rejectionReason: disposition === 'NOT_INTERESTED' ? rejection_reason || 'Not Interested' : null
    };

    const callLog = existingCallToday
      ? await prisma.callLog.update({
          where: { id: existingCallToday.id },
          data: callLogData
        })
      : await prisma.callLog.create({
          data: {
            leadId,
            staffId,
            ...callLogData
          }
        });

    let updatedNotes = lead.notes;
    if (trimmedRemarks) {
      if (!lead.notes) {
        updatedNotes = `[Call Note]: ${trimmedRemarks}`;
      } else if (
        lead.notes === trimmedRemarks ||
        lead.notes.endsWith(`[Call Note]: ${trimmedRemarks}`)
      ) {
        updatedNotes = lead.notes;
      } else if (trimmedRemarks.startsWith(lead.notes)) {
        updatedNotes = trimmedRemarks;
      } else {
        updatedNotes = `${lead.notes}\n[Call Note]: ${trimmedRemarks}`;
      }
    }

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: disposition,
        followUpDate: parsedCallback || null,
        notes: updatedNotes
      }
    });

    return res.status(201).json({
      success: true,
      status: 201,
      message: existingCallToday
        ? `Call log updated successfully as ${disposition}.`
        : `Call logged successfully as ${disposition}.`,
      data: {
        callLog,
        leadStatus: updatedLead.status,
        followUpDate: updatedLead.followUpDate
      }
    });
  } catch (error) {
    console.error('[Staff Log Call Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to record call log.',
      error: error.message
    });
  }
};

/**
 * Upload Customer KYC / Financial Document
 * POST /api/staff/upload-document/:leadId | POST /api/admin/upload-document/:leadId
 */
export const uploadDocument = async (req, res) => {
  try {
    const rawLeadId = req.params.leadId || req.params.id || req.body?.leadId;
    const leadId = parseInt(rawLeadId, 10);
    if (isNaN(leadId)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid lead ID.'
      });
    }

    const uploaderId = req.user?.id || null;
    const isAdminUser = req.user?.role?.toUpperCase() === 'ADMIN';
    const {
      doc_type,
      docType,
      documentType,
      type,
      status,
      verification_status,
      verificationStatus,
      remarks,
      verification_remarks,
      verificationRemarks,
      comment
    } = req.body || {};

    if (!req.file) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'No file received. Please attach a document to upload.'
      });
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId }
    });

    if (!lead) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Lead not found.'
      });
    }

    const validDocTypes = ['PAN', 'AADHAAR', 'BANK_STATEMENT', 'SALARY_SLIP', 'ITR', 'OTHER'];
    const rawDocType = String(
      doc_type ?? docType ?? documentType ?? type ?? 'OTHER'
    ).trim().toUpperCase();
    const normalizedDocType = validDocTypes.includes(rawDocType) ? rawDocType : 'OTHER';

    const requestedStatus = String(
      status ?? verification_status ?? verificationStatus ?? ''
    ).trim().toUpperCase();
    const shouldAdminVerify = isAdminUser && ['APPROVED', 'REJECTED'].includes(requestedStatus);
    const rawRemarks = remarks ?? verification_remarks ?? verificationRemarks ?? comment;

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const cleanBaseName = path.basename(req.file.originalname || 'document', ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const generatedFileName = req.file.filename || `${cleanBaseName}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

    const documentRecord = await prisma.document.create({
      data: {
        leadId,
        uploadedBy: uploaderId,
        docType: normalizedDocType,
        fileName: generatedFileName,
        originalName: req.file.originalname || generatedFileName,
        filePath: null,
        fileType: req.file.mimetype || 'application/octet-stream',
        fileSize: req.file.size || (req.file.buffer ? req.file.buffer.length : 0),
        fileData: req.file.buffer || null,
        verificationStatus: shouldAdminVerify ? requestedStatus : 'PENDING',
        verificationRemarks: shouldAdminVerify && rawRemarks ? String(rawRemarks).trim() : null,
        verifiedBy: shouldAdminVerify ? uploaderId : null
      },
      select: {
        id: true,
        leadId: true,
        uploadedBy: true,
        docType: true,
        fileName: true,
        originalName: true,
        filePath: true,
        fileType: true,
        fileSize: true,
        verificationStatus: true,
        verificationRemarks: true,
        verifiedBy: true,
        createdAt: true
      }
    });

    return res.status(201).json({
      success: true,
      status: 201,
      message: `${normalizedDocType} document uploaded successfully for lead ${lead.fullName}.`,
      data: {
        ...documentRecord,
        isVerified: documentRecord.verificationStatus === 'APPROVED',
        fileUrl: `/uploads/${documentRecord.fileName}`
      }
    });
  } catch (error) {
    console.error('[Upload Document Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to upload lead document.',
      error: error.message
    });
  }
};

/**
 * Get Personal Performance Stats
 * GET /api/staff/personal-performance
 */
export const getPersonalPerformance = async (req, res) => {
  try {
    const staffId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const user = await prisma.user.findUnique({
      where: { id: staffId },
      select: { dailyCallTarget: true, name: true }
    });

    const dailyTarget = user?.dailyCallTarget || 100;

    const [
      todaysCallLogs,
      totalAssignedLeads,
      interestedLeads,
      approvedLeads
    ] = await Promise.all([
      prisma.callLog.findMany({
        where: { staffId, createdAt: { gte: today } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { leadId: true, callDisposition: true }
      }),
      prisma.lead.count({
        where: { assignedTo: staffId }
      }),
      prisma.lead.count({
        where: { assignedTo: staffId, status: { equals: 'INTERESTED', mode: 'insensitive' } }
      }),
      prisma.lead.count({
        where: {
          assignedTo: staffId,
          OR: [{ status: 'APPROVED' }, { status: 'DISBURSED' }, { status: 'Approved' }]
        }
      })
    ]);

    const latestCallByLead = new Map();
    for (const log of todaysCallLogs) {
      if (!latestCallByLead.has(log.leadId)) {
        latestCallByLead.set(log.leadId, log.callDisposition?.toUpperCase());
      }
    }

    const callsCompletedToday = latestCallByLead.size;
    let interestedCallsToday = 0;
    let callbacksScheduledToday = 0;
    let notInterestedToday = 0;
    for (const disp of latestCallByLead.values()) {
      if (disp === 'INTERESTED') interestedCallsToday += 1;
      else if (disp === 'CALLBACK_SCHEDULED') callbacksScheduledToday += 1;
      else if (disp === 'NOT_INTERESTED') notInterestedToday += 1;
    }

    const progressPercentage = Math.min(
      100,
      Math.round((callsCompletedToday / dailyTarget) * 100)
    );

    let quotaStatus = 'BEHIND_TARGET';
    if (progressPercentage >= 100) {
      quotaStatus = 'TARGET_ACHIEVED';
    } else if (progressPercentage >= 50) {
      quotaStatus = 'ON_TRACK';
    }

    return res.status(200).json({
      success: true,
      status: 200,
      data: {
        agentName: user?.name,
        dailyTarget,
        callsCompletedToday,
        callTargetDisplay: `${callsCompletedToday} / ${dailyTarget}`,
        remainingCallsNeeded: Math.max(0, dailyTarget - callsCompletedToday),
        progressPercentage: `${progressPercentage}%`,
        quotaStatus,
        breakdownToday: {
          interested: interestedCallsToday,
          callbackScheduled: callbacksScheduledToday,
          notInterested: notInterestedToday
        },
        pipelineStats: {
          totalAssignedLeads,
          interestedLeads,
          approvedOrDisbursedLeads: approvedLeads
        }
      }
    });

  } catch (error) {
    console.error('[Staff Performance Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to calculate personal performance stats.',
      error: error.message
    });
  }
};

export default {
  getAssignedLeads,
  logCall,
  uploadDocument,
  getPersonalPerformance
};
