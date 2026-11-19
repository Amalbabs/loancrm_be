import prisma from '../config/db.js';

/**
 * Floor-wide Analytics
 * GET /api/admin/dashboard-stats
 */
export const getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalLeads,
      newLeadsToday,
      totalStaffCount,
      activeStaffCount,
      callsTodayGroups,
      interestedCallsToday,
      disbursedAgg,
      totalRequestedAgg,
      statusGroups
    ] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { role: 'STAFF' } }),
      prisma.user.count({ where: { role: 'STAFF', isActive: true } }),
      prisma.callLog.groupBy({
        by: ['leadId', 'staffId'],
        where: { createdAt: { gte: today } },
        _count: { id: true }
      }),
      prisma.lead.count({
        where: {
          status: { equals: 'INTERESTED', mode: 'insensitive' },
          OR: [
            { updatedAt: { gte: today } },
            { createdAt: { gte: today } }
          ]
        }
      }),
      prisma.lead.aggregate({
        where: {
          OR: [{ status: 'DISBURSED' }, { status: 'APPROVED' }, { status: 'Approved' }]
        },
        _sum: { loanAmount: true },
        _count: { id: true }
      }),
      prisma.lead.aggregate({
        _sum: { loanAmount: true }
      }),
      prisma.lead.groupBy({
        by: ['status'],
        _count: { id: true }
      })
    ]);

    const callsToday = callsTodayGroups.length;

    // 20 call-centre employees with 100 calls each = 2,000 daily floor quota
    const staffCount = activeStaffCount || 20;
    const floorDailyQuota = staffCount * 100;
    const floorQuotaAchievedPercentage = floorDailyQuota > 0
      ? Math.min(100, parseFloat(((callsToday / floorDailyQuota) * 100).toFixed(2)))
      : 0;

    const disbursedCount = disbursedAgg._count.id || 0;
    const conversionRate = totalLeads > 0
      ? parseFloat(((disbursedCount / totalLeads) * 100).toFixed(2))
      : 0;

    return res.status(200).json({
      success: true,
      status: 200,
      data: {
        totalLeads,
        newLeadsToday,
        floorWideQuota: {
          totalStaff: staffCount,
          callsCompletedToday: callsToday,
          targetDailyQuota: floorDailyQuota,
          quotaPercentage: `${floorQuotaAchievedPercentage}%`,
          remainingCallsNeeded: Math.max(0, floorDailyQuota - callsToday)
        },
        conversionRate: `${conversionRate}%`,
        totalDisbursedAmount: disbursedAgg._sum.loanAmount || 0,
        totalRequestedAmount: totalRequestedAgg._sum.loanAmount || 0,
        disbursedLeadsCount: disbursedCount,
        interestedCallsToday,
        statusBreakdown: statusGroups.map((g) => ({
          status: g.status,
          count: g._count.id
        }))
      }
    });
  } catch (error) {
    console.error('[Admin Dashboard Stats Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to aggregate floor-wide statistics.',
      error: error.message
    });
  }
};

/**
 * Employees Performance Tracker
 * GET /api/admin/employees-performance
 */
export const getEmployeesPerformance = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const staffMembers = await prisma.user.findMany({
      where: { role: 'STAFF' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        dailyCallTarget: true,
        isActive: true,
        _count: {
          select: { leads: true }
        },
        callLogs: {
          where: { createdAt: { gte: today } },
          select: { id: true, leadId: true, callDisposition: true }
        },
        leads: {
          where: {
            OR: [
              { status: { equals: 'DISBURSED', mode: 'insensitive' } },
              { status: { equals: 'APPROVED', mode: 'insensitive' } },
              { status: { equals: 'INTERESTED', mode: 'insensitive' } }
            ]
          },
          select: { id: true, status: true, createdAt: true, updatedAt: true }
        }
      }
    });

    const performanceReport = staffMembers.map((staff) => {
      const callsToday = new Set(staff.callLogs.map((c) => c.leadId)).size;
      const target = staff.dailyCallTarget || 100;
      const interestedCount = staff.leads.filter(
        (l) =>
          l.status?.toUpperCase() === 'INTERESTED' &&
          ((l.updatedAt && l.updatedAt >= today) || (l.createdAt && l.createdAt >= today))
      ).length;
      const progressPercent = Math.min(100, Math.round((callsToday / target) * 100));

      let performanceStatus = 'BEHIND_TARGET';
      if (progressPercent >= 100) {
        performanceStatus = 'TARGET_ACHIEVED';
      } else if (progressPercent >= 50) {
        performanceStatus = 'ON_TRACK';
      }

      return {
        staffId: staff.id,
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        isActive: staff.isActive,
        dailyTarget: target,
        callsCompletedToday: callsToday,
        callTargetDisplay: `${callsToday} / ${target}`,
        progressPercentage: `${progressPercent}%`,
        interestedCallsToday: interestedCount,
        convertedLeadsCount: staff.leads.filter((l) => {
          const st = l.status?.toUpperCase();
          return st === 'DISBURSED' || st === 'APPROVED';
        }).length,
        totalAssignedLeads: staff._count.leads,
        performanceStatus
      };
    });

    return res.status(200).json({
      success: true,
      status: 200,
      totalStaff: performanceReport.length,
      data: performanceReport
    });
  } catch (error) {
    console.error('[Admin Employee Performance Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to fetch employee performance metrics.',
      error: error.message
    });
  }
};

/**
 * Lead Distribution Engine
 * POST /api/admin/distribute-leads
 */
export const distributeLeads = async (req, res) => {
  try {
    const { mode = 'round_robin', lead_ids, staff_id, batch_size = 50 } = req.body;

    if (mode === 'manual') {
      if (!staff_id || !lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Manual distribution requires staff_id and a non-empty array of lead_ids.'
        });
      }

      const parsedStaffId = parseInt(staff_id, 10);
      const staffExists = await prisma.user.findFirst({
        where: { id: parsedStaffId, role: 'STAFF', isActive: true }
      });

      if (!staffExists) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'Active staff member not found with the specified ID.'
        });
      }

      const updateResult = await prisma.lead.updateMany({
        where: { id: { in: lead_ids.map((id) => parseInt(id, 10)) } },
        data: { assignedTo: parsedStaffId }
      });

      return res.status(200).json({
        success: true,
        status: 200,
        message: `Manually assigned ${updateResult.count} leads to staff "${staffExists.name}".`,
        assignedCount: updateResult.count
      });
    }

    const activeStaff = await prisma.user.findMany({
      where: { role: 'STAFF', isActive: true },
      select: { id: true, name: true },
      orderBy: { id: 'asc' }
    });

    if (activeStaff.length === 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'No active staff members available for lead assignment.'
      });
    }

    const unassignedLeads = await prisma.lead.findMany({
      where: { assignedTo: null },
      take: parseInt(batch_size, 10) || 50,
      orderBy: { createdAt: 'asc' },
      select: { id: true }
    });

    if (unassignedLeads.length === 0) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'No unassigned leads available in the pool.',
        distributedCount: 0
      });
    }

    await prisma.$transaction(
      unassignedLeads.map((lead, idx) => {
        const staff = activeStaff[idx % activeStaff.length];
        return prisma.lead.update({
          where: { id: lead.id },
          data: { assignedTo: staff.id }
        });
      })
    );

    return res.status(200).json({
      success: true,
      status: 200,
      message: `Equally distributed ${unassignedLeads.length} leads across ${activeStaff.length} active staff members in round-robin fashion.`,
      distributedCount: unassignedLeads.length,
      staffCount: activeStaff.length
    });
  } catch (error) {
    console.error('[Admin Distribute Leads Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to distribute leads.',
      error: error.message
    });
  }
};

/**
 * Verify Customer KYC / Financial Document
 * PUT / PATCH / POST /api/admin/verify-document/:id
 */
export const verifyDocument = async (req, res) => {
  try {
    const rawDocumentId = req.params.id || req.params.documentId || req.body?.documentId || req.body?.id;
    const documentId = parseInt(rawDocumentId, 10);
    if (isNaN(documentId)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid document ID.'
      });
    }

    const {
      status,
      verification_status,
      verificationStatus,
      remarks,
      verification_remarks,
      verificationRemarks,
      comment
    } = req.body || {};
    const normalizedStatus = String(
      status ?? verification_status ?? verificationStatus ?? ''
    ).trim().toUpperCase();
    const rawRemarks = remarks ?? verification_remarks ?? verificationRemarks ?? comment;

    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid verification status. Must be APPROVED, REJECTED, or PENDING.'
      });
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Document record not found.'
      });
    }

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        verificationStatus: normalizedStatus,
        verificationRemarks: rawRemarks !== undefined ? (rawRemarks ? String(rawRemarks).trim() : null) : document.verificationRemarks,
        verifiedBy: normalizedStatus === 'PENDING' ? null : req.user.id
      },
      include: {
        lead: {
          select: { id: true, fullName: true, phone: true }
        },
        verifier: {
          select: { id: true, name: true }
        }
      }
    });

    const { fileData: _omittedFileData, ...safeDocument } = updatedDocument;

    return res.status(200).json({
      success: true,
      status: 200,
      message: `Document status updated to ${normalizedStatus}.`,
      data: {
        ...safeDocument,
        isVerified: safeDocument.verificationStatus === 'APPROVED',
        fileUrl: `/uploads/${safeDocument.fileName}`
      }
    });
  } catch (error) {
    console.error('[Admin Verify Document Error]:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to verify document.',
      error: error.message
    });
  }
};

/**
 * Partner Bank Schemes CRUD
 */
export const manageSchemes = {
  list: async (req, res) => {
    try {
      const { bank_name, loan_type, is_active } = req.query;
      const where = {};

      if (bank_name) {
        where.bankName = { contains: bank_name, mode: 'insensitive' };
      }
      if (loan_type) {
        where.loanType = { contains: loan_type, mode: 'insensitive' };
      }
      if (is_active !== undefined) {
        where.isActive = is_active === 'true';
      }

      const schemes = await prisma.bankScheme.findMany({
        where,
        orderBy: [{ bankName: 'asc' }, { roi: 'asc' }]
      });

      return res.status(200).json({
        success: true,
        status: 200,
        count: schemes.length,
        data: schemes
      });
    } catch (error) {
      return res.status(500).json({ success: false, status: 500, message: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const {
        bank_name,
        scheme_name,
        loan_type,
        roi,
        processing_fee = 0,
        min_credit_score = 650,
        min_tenure_months = 12,
        max_tenure_months = 84,
        max_amount = 0
      } = req.body;

      if (!bank_name || !scheme_name || !loan_type || roi === undefined) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'bank_name, scheme_name, loan_type, and roi are required fields.'
        });
      }

      const newScheme = await prisma.bankScheme.create({
        data: {
          bankName: bank_name.trim(),
          schemeName: scheme_name.trim(),
          loanType: loan_type.trim(),
          roi: parseFloat(roi),
          processingFee: parseFloat(processing_fee) || 0.0,
          minCreditScore: parseInt(min_credit_score, 10) || 650,
          minTenureMonths: parseInt(min_tenure_months, 10) || 12,
          maxTenureMonths: parseInt(max_tenure_months, 10) || 84,
          maxAmount: parseFloat(max_amount) || 0.0,
          isActive: true
        }
      });

      return res.status(201).json({
        success: true,
        status: 201,
        message: 'Partner bank scheme created successfully.',
        data: newScheme
      });
    } catch (error) {
      return res.status(500).json({ success: false, status: 500, message: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const {
        bank_name,
        scheme_name,
        loan_type,
        roi,
        processing_fee,
        min_credit_score,
        min_tenure_months,
        max_tenure_months,
        max_amount,
        is_active
      } = req.body;

      const updated = await prisma.bankScheme.update({
        where: { id },
        data: {
          ...(bank_name !== undefined && { bankName: bank_name.trim() }),
          ...(scheme_name !== undefined && { schemeName: scheme_name.trim() }),
          ...(loan_type !== undefined && { loanType: loan_type.trim() }),
          ...(roi !== undefined && { roi: parseFloat(roi) }),
          ...(processing_fee !== undefined && { processingFee: parseFloat(processing_fee) }),
          ...(min_credit_score !== undefined && { minCreditScore: parseInt(min_credit_score, 10) }),
          ...(min_tenure_months !== undefined && { minTenureMonths: parseInt(min_tenure_months, 10) }),
          ...(max_tenure_months !== undefined && { maxTenureMonths: parseInt(max_tenure_months, 10) }),
          ...(max_amount !== undefined && { maxAmount: parseFloat(max_amount) }),
          ...(is_active !== undefined && { isActive: Boolean(is_active) })
        }
      });

      return res.status(200).json({
        success: true,
        status: 200,
        message: 'Partner bank scheme updated successfully.',
        data: updated
      });
    } catch (error) {
      return res.status(500).json({ success: false, status: 500, message: error.message });
    }
  },

  delete: async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await prisma.bankScheme.delete({ where: { id } });
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'Partner bank scheme deleted successfully.'
      });
    } catch (error) {
      return res.status(500).json({ success: false, status: 500, message: error.message });
    }
  }
};

export default {
  getDashboardStats,
  getEmployeesPerformance,
  distributeLeads,
  verifyDocument,
  manageSchemes
};
