/**
 * Capital Account API Routes
 * Endpoints for capital account statements and data
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { Structure, User, FirmSettings } = require('../models/supabase');
const { requireInvestmentManagerAccess, getUserContext, ROLES } = require('../middleware/rbac');
const { generateCapitalAccountStatementPDF } = require('../services/capitalAccountGenerator');
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

const router = express.Router();

/**
 * @route   GET /api/capital-account/:investorId/statement
 * @desc    Generate Capital Account Statement PDF
 * @access  Private (requires authentication)
 */
router.get('/:investorId/statement', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { investorId } = req.params;
  const { structureId, startDate, endDate } = req.query;

  validate(structureId, 'Structure ID is required');
  validate(startDate, 'Start date is required');
  validate(endDate, 'End date is required');

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Access control: Investment managers can see any investor, LPs can only see their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  } else if (userRole !== ROLES.ROOT) {
    // LP user - can only see their own account
    validate(investorId === userId, 'Unauthorized access to capital account');
  }

  // Get investor profile
  const investor = await User.findById(investorId);
  validate(investor, 'Investor not found');

  // Get investor commitment from investors table
  const { data: investorRecord } = await getSupabase()
    .from('investors')
    .select('*')
    .eq('user_id', investorId)
    .eq('structure_id', structureId)
    .single();

  const investorWithCommitment = {
    ...investor,
    commitment: investorRecord?.commitment || investorRecord?.total_commitment || 0,
    totalCommitment: investorRecord?.commitment || investorRecord?.total_commitment || 0,
  };

  // Get capital call allocations
  const { data: callAllocations } = await getSupabase()
    .from('capital_call_allocations')
    .select('*, capital_call:capital_calls(*)')
    .eq('user_id', investorId)
    .eq('capital_call.structure_id', structureId)
    .order('created_at', { ascending: true });

  // Get distribution allocations
  const { data: distAllocations } = await getSupabase()
    .from('distribution_allocations')
    .select('*, distribution:distributions(*)')
    .eq('user_id', investorId)
    .eq('distribution.structure_id', structureId)
    .order('created_at', { ascending: true });

  const firmName = await getFirmNameForUser(userId);

  // Generate PDF
  const pdfBuffer = await generateCapitalAccountStatementPDF(
    investorWithCommitment,
    structure,
    callAllocations || [],
    distAllocations || [],
    { startDate, endDate },
    { firmName, currency: structure.currency }
  );

  const investorNameClean = (investor.name || 'Investor').replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Capital_Account_${investorNameClean}_${startDate}_${endDate}.pdf"`);
  res.setHeader('Content-Length', pdfBuffer.length);

  res.send(pdfBuffer);
}));

/**
 * @route   GET /api/capital-account/:investorId/data
 * @desc    Get capital account data as JSON
 * @access  Private (requires authentication)
 */
router.get('/:investorId/data', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { investorId } = req.params;
  const { structureId, startDate, endDate } = req.query;

  validate(structureId, 'Structure ID is required');

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Access control
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  } else if (userRole !== ROLES.ROOT) {
    validate(investorId === userId, 'Unauthorized access to capital account');
  }

  const investor = await User.findById(investorId);
  validate(investor, 'Investor not found');

  // Get investor commitment
  const { data: investorRecord } = await getSupabase()
    .from('investors')
    .select('*')
    .eq('user_id', investorId)
    .eq('structure_id', structureId)
    .single();

  const commitment = investorRecord?.commitment || investorRecord?.total_commitment || 0;

  // Get capital call allocations
  const { data: callAllocations } = await getSupabase()
    .from('capital_call_allocations')
    .select('*, capital_call:capital_calls(*)')
    .eq('user_id', investorId)
    .eq('capital_call.structure_id', structureId)
    .order('created_at', { ascending: true });

  // Get distribution allocations
  const { data: distAllocations } = await getSupabase()
    .from('distribution_allocations')
    .select('*, distribution:distributions(*)')
    .eq('user_id', investorId)
    .eq('distribution.structure_id', structureId)
    .order('created_at', { ascending: true });

  const allCalls = callAllocations || [];
  const allDists = distAllocations || [];

  // Filter by period if dates provided
  const filterByPeriod = (items, dateField, parentKey) => {
    if (!startDate || !endDate) return items;
    return items.filter(item => {
      const date = item[parentKey]?.[dateField] || item[dateField];
      return date >= startDate && date <= endDate;
    });
  };

  const periodCalls = filterByPeriod(allCalls, 'callDate', 'capital_call');
  const periodDists = filterByPeriod(allDists, 'distributionDate', 'distribution');

  const priorCalls = startDate ? allCalls.filter(a => {
    const d = a.capital_call?.callDate || a.callDate;
    return d < startDate;
  }) : [];
  const priorDists = startDate ? allDists.filter(a => {
    const d = a.distribution?.distributionDate || a.distributionDate;
    return d < startDate;
  }) : [];

  const totalCalled = allCalls.reduce((sum, a) => sum + (a.total_due || 0), 0);
  const totalDistributed = allDists.reduce((sum, a) => sum + (a.allocated_amount || 0), 0);
  const totalFees = allCalls.reduce((sum, a) => sum + (a.management_fee_net || 0), 0);
  const totalVAT = allCalls.reduce((sum, a) => sum + (a.vat_amount || 0), 0);

  const priorCalledTotal = priorCalls.reduce((sum, a) => sum + (a.total_due || 0), 0);
  const priorDistTotal = priorDists.reduce((sum, a) => sum + (a.allocated_amount || 0), 0);

  res.status(200).json({
    success: true,
    data: {
      investor: {
        id: investor.id,
        name: investor.name,
        email: investor.email,
        commitment,
      },
      structure: {
        id: structure.id,
        name: structure.name,
        currency: structure.currency,
      },
      summary: {
        commitment,
        totalCalled,
        totalDistributed,
        totalFees,
        totalVAT,
        uncalled: commitment - totalCalled,
        netAccountValue: totalCalled - totalDistributed,
        openingBalance: priorCalledTotal - priorDistTotal,
        closingBalance: totalCalled - totalDistributed,
      },
      capitalCalls: periodCalls.map(a => ({
        date: a.capital_call?.callDate || a.callDate,
        callNumber: a.capital_call?.callNumber || a.callNumber,
        principal: a.principal_amount || 0,
        managementFee: a.management_fee_net || 0,
        vat: a.vat_amount || 0,
        total: a.total_due || 0,
      })),
      distributions: periodDists.map(a => ({
        date: a.distribution?.distributionDate || a.distributionDate,
        distributionNumber: a.distribution?.distributionNumber || a.distributionNumber,
        returnOfCapital: a.return_of_capital || 0,
        income: a.income_amount || 0,
        capitalGain: a.capital_gain || 0,
        total: a.allocated_amount || 0,
      })),
    }
  });
}));

/**
 * @route   GET /api/capital-account/health
 * @desc    Health check
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Capital Account API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
