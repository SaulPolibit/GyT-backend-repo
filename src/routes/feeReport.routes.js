/**
 * Fee & Expense Report API Routes
 * Endpoints for fee reports with fund-level and per-investor breakdowns
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { Structure, User, FirmSettings } = require('../models/supabase');
const { requireInvestmentManagerAccess, getUserContext, ROLES } = require('../middleware/rbac');
const { generateFeeReportPDF, generateFeeReportExcel } = require('../services/feeReportGenerator');
const { getSupabase } = require('../config/database');

async function getFirmNameForUser(userId) {
  try {
    const firmSettings = await FirmSettings.findByUserId(userId);
    return firmSettings?.firmName || 'Investment Manager';
  } catch (error) {
    console.warn('Could not fetch firm settings:', error.message);
    return 'Investment Manager';
  }
}

/**
 * Aggregate fee data from capital call allocations for a structure in a period
 */
async function aggregateFeeData(structureId, startDate, endDate) {
  // Get all capital calls for the structure in the period
  let query = getSupabase()
    .from('capital_calls')
    .select('id, callNumber, callDate, structure_id')
    .eq('structure_id', structureId);

  if (startDate) query = query.gte('callDate', startDate);
  if (endDate) query = query.lte('callDate', endDate);

  const { data: capitalCalls } = await query;

  if (!capitalCalls || capitalCalls.length === 0) {
    return {
      summary: { totalFeesGross: 0, totalDiscounts: 0, totalFeesNet: 0, totalVAT: 0, totalFeesCollected: 0 },
      investors: [],
      isDualRate: false
    };
  }

  const callIds = capitalCalls.map(cc => cc.id);

  // Get all allocations for those capital calls
  const { data: allocations } = await getSupabase()
    .from('capital_call_allocations')
    .select('*, user:users(id, name, email)')
    .in('capital_call_id', callIds);

  if (!allocations || allocations.length === 0) {
    return {
      summary: { totalFeesGross: 0, totalDiscounts: 0, totalFeesNet: 0, totalVAT: 0, totalFeesCollected: 0 },
      investors: [],
      isDualRate: false
    };
  }

  // Aggregate per investor
  const investorMap = {};

  allocations.forEach(alloc => {
    const investorId = alloc.user_id;
    if (!investorMap[investorId]) {
      investorMap[investorId] = {
        investorId,
        investorName: alloc.user?.name || 'Unknown',
        commitment: alloc.commitment || 0,
        grossFee: 0,
        discount: 0,
        netFee: 0,
        vat: 0,
        total: 0,
        nicFeeAmount: 0,
        unfundedFeeAmount: 0,
        feeOffsetAmount: 0,
        callCount: 0,
      };
    }

    const inv = investorMap[investorId];
    inv.grossFee += alloc.management_fee_gross || 0;
    inv.discount += alloc.management_fee_discount || 0;
    inv.netFee += alloc.management_fee_net || 0;
    inv.vat += alloc.vat_amount || 0;
    inv.total += (alloc.management_fee_net || 0) + (alloc.vat_amount || 0);
    inv.nicFeeAmount += alloc.nic_fee_amount || 0;
    inv.unfundedFeeAmount += alloc.unfunded_fee_amount || 0;
    inv.feeOffsetAmount += alloc.fee_offset_amount || 0;
    inv.callCount += 1;
    // Take the max commitment (latest value)
    if ((alloc.commitment || 0) > inv.commitment) {
      inv.commitment = alloc.commitment;
    }
  });

  const investors = Object.values(investorMap);
  const isDualRate = investors.some(i => i.nicFeeAmount > 0 || i.unfundedFeeAmount > 0);

  const summary = {
    totalFeesGross: investors.reduce((sum, i) => sum + i.grossFee, 0),
    totalDiscounts: investors.reduce((sum, i) => sum + i.discount, 0),
    totalFeesNet: investors.reduce((sum, i) => sum + i.netFee, 0),
    totalVAT: investors.reduce((sum, i) => sum + i.vat, 0),
    totalFeesCollected: investors.reduce((sum, i) => sum + i.total, 0),
  };

  return { summary, investors, isDualRate };
}

const router = express.Router();

/**
 * @route   GET /api/fee-reports/:structureId/generate
 * @desc    Generate Fee & Expense Report (PDF or Excel)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:structureId/generate', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.params;
  const { format = 'pdf', startDate, endDate } = req.query;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const firmName = await getFirmNameForUser(userId);
  const feeData = await aggregateFeeData(structureId, startDate, endDate);
  const period = {
    startDate: startDate || 'Inception',
    endDate: endDate || new Date().toISOString().split('T')[0]
  };

  if (format === 'excel') {
    const buffer = await generateFeeReportExcel(structure, feeData, period, { firmName });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Fee_Report_${structure.name?.replace(/\s+/g, '_')}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  }

  // Default: PDF
  const pdfBuffer = await generateFeeReportPDF(structure, feeData, period, { firmName });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Fee_Report_${structure.name?.replace(/\s+/g, '_')}.pdf"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.send(pdfBuffer);
}));

/**
 * @route   GET /api/fee-reports/:structureId/data
 * @desc    Get fee report data as JSON
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:structureId/data', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.params;
  const { startDate, endDate } = req.query;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const feeData = await aggregateFeeData(structureId, startDate, endDate);

  res.status(200).json({
    success: true,
    data: {
      structure: {
        id: structure.id,
        name: structure.name,
        currency: structure.currency,
      },
      period: {
        startDate: startDate || 'Inception',
        endDate: endDate || new Date().toISOString().split('T')[0],
      },
      ...feeData
    }
  });
}));

/**
 * @route   GET /api/fee-reports/:structureId/investor/:investorId
 * @desc    Get per-investor fee detail
 * @access  Private (requires authentication)
 */
router.get('/:structureId/investor/:investorId', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId, investorId } = req.params;
  const { startDate, endDate } = req.query;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Access control
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  } else if (userRole !== ROLES.ROOT) {
    // LP user can only see their own fees
    validate(investorId === userId, 'Unauthorized access to fee data');
  }

  // Get capital calls for the structure
  let query = getSupabase()
    .from('capital_calls')
    .select('id')
    .eq('structure_id', structureId);

  if (startDate) query = query.gte('callDate', startDate);
  if (endDate) query = query.lte('callDate', endDate);

  const { data: capitalCalls } = await query;
  const callIds = (capitalCalls || []).map(cc => cc.id);

  if (callIds.length === 0) {
    return res.status(200).json({
      success: true,
      data: { fees: [], summary: { totalGross: 0, totalDiscount: 0, totalNet: 0, totalVAT: 0, totalDue: 0 } }
    });
  }

  // Get allocations for this investor
  const { data: allocations } = await getSupabase()
    .from('capital_call_allocations')
    .select('*, capital_call:capital_calls(callNumber, callDate)')
    .eq('user_id', investorId)
    .in('capital_call_id', callIds)
    .order('created_at', { ascending: true });

  const fees = (allocations || []).map(a => ({
    callNumber: a.capital_call?.callNumber || '',
    callDate: a.capital_call?.callDate || '',
    principal: a.principal_amount || 0,
    managementFeeGross: a.management_fee_gross || 0,
    managementFeeDiscount: a.management_fee_discount || 0,
    managementFeeNet: a.management_fee_net || 0,
    nicFeeAmount: a.nic_fee_amount || 0,
    unfundedFeeAmount: a.unfunded_fee_amount || 0,
    feeOffsetAmount: a.fee_offset_amount || 0,
    vatAmount: a.vat_amount || 0,
    totalDue: a.total_due || 0,
  }));

  const summary = {
    totalGross: fees.reduce((s, f) => s + f.managementFeeGross, 0),
    totalDiscount: fees.reduce((s, f) => s + f.managementFeeDiscount, 0),
    totalNet: fees.reduce((s, f) => s + f.managementFeeNet, 0),
    totalVAT: fees.reduce((s, f) => s + f.vatAmount, 0),
    totalDue: fees.reduce((s, f) => s + f.totalDue, 0),
  };

  res.status(200).json({
    success: true,
    data: { fees, summary }
  });
}));

/**
 * @route   GET /api/fee-reports/health
 * @desc    Health check
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Fee Report API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
