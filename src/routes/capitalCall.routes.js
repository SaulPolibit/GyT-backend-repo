/**
 * Capital Call API Routes
 * Endpoints for managing capital calls and investor allocations
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { CapitalCall, Structure, User, FirmSettings } = require('../models/supabase');
const ApprovalHistory = require('../models/supabase/approvalHistory');
const { requireInvestmentManagerAccess, getUserContext, ROLES } = require('../middleware/rbac');
const { generateCapitalCallNoticePDF, generateIndividualLPNoticePDF } = require('../services/documentGenerator');
const { sendEmail } = require('../utils/emailSender');
const { sendCapitalCallNotice } = require('../utils/notificationHelper');

/**
 * Helper to get firm name for whitelabeling
 * Uses firm settings from database, falls back to default
 */
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
 * @route   POST /api/capital-calls
 * @desc    Create a new capital call
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);

  const {
    structureId,
    callNumber,
    callDate,
    dueDate,
    noticeDate,
    deadlineDate,
    totalCallAmount,
    purpose,
    notes,
    investmentId,
    createAllocations,
    // ILPA Fee Configuration
    managementFeeBase,
    managementFeeRate,
    vatRate,
    vatApplicable,
    feePeriod,
    approvalStatus,
    // Proximity Dual-Rate Fee Fields
    feeRateOnNic,
    feeRateOnUnfunded
  } = req.body;

  // Validate required fields
  validate(structureId, 'Structure ID is required');
  validate(callNumber, 'Call number is required');
  validate(totalCallAmount !== undefined && totalCallAmount > 0, 'Total call amount must be positive');

  // Validate structure exists
  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Root can create capital calls for any structure, Admin only for their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Structure does not belong to user');
  }

  // Create capital call
  const capitalCallData = {
    structureId,
    callNumber: typeof callNumber === 'string' ? callNumber.trim() : callNumber,
    callDate: callDate || new Date().toISOString(),
    dueDate: dueDate || deadlineDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days default
    noticeDate: noticeDate || null, // Date when email notification will be sent
    deadlineDate: deadlineDate || dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    totalCallAmount,
    totalPaidAmount: 0,
    totalUnpaidAmount: totalCallAmount,
    status: 'Draft',
    purpose: purpose?.trim() || '',
    notes: notes?.trim() || '',
    investmentId: investmentId || null,
    // ILPA Fee Configuration
    managementFeeBase: managementFeeBase || structure.managementFeeBase || 'committed',
    managementFeeRate: managementFeeRate !== undefined ? managementFeeRate : structure.managementFee || 2.0,
    vatRate: vatRate !== undefined ? vatRate : parseFloat(structure.vatRate) || 0,
    vatApplicable: vatApplicable !== undefined ? vatApplicable : true,
    feePeriod: feePeriod || 'quarterly',
    approvalStatus: approvalStatus || 'draft',
    // Proximity Dual-Rate Fee Fields (default from structure if not provided)
    feeRateOnNic: feeRateOnNic !== undefined ? feeRateOnNic : structure.feeRateOnNic || null,
    feeRateOnUnfunded: feeRateOnUnfunded !== undefined ? feeRateOnUnfunded : structure.feeRateOnUnfunded || null,
    createdBy: userId
  };

  const capitalCall = await CapitalCall.create(capitalCallData);

  // Optionally create allocations for all investors in structure
  let allocations = null;
  if (createAllocations === true) {
    allocations = await CapitalCall.createAllocationsForStructure(capitalCall.id, structureId);
  }

  res.status(201).json({
    success: true,
    message: 'Capital call created successfully',
    data: {
      capitalCall,
      allocations: allocations || []
    }
  });
}));

/**
 * @route   GET /api/capital-calls
 * @desc    Get all capital calls (role-based filtering applied)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId, status } = req.query;

  let filter = {};

  // Role-based filtering: Root sees all, Admin sees only their own
  if (userRole === ROLES.ADMIN) {
    filter.createdBy = userId;
  }
  // Root (role 0) sees all capital calls, so no userId filter

  if (structureId) filter.structureId = structureId;
  if (status) filter.status = status;

  const capitalCalls = await CapitalCall.find(filter);

  res.status(200).json({
    success: true,
    count: capitalCalls.length,
    data: capitalCalls
  });
}));

/**
 * @route   GET /api/capital-calls/payments
 * @desc    Get all capital call payments (allocations where paid_amount > 0) for approvals
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/payments', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { getSupabase } = require('../config/database');
  const supabase = getSupabase();

  // Fetch allocations with paid_amount > 0, join with capital_calls
  // Using * for allocations to be resilient to missing columns before migration
  const { data: allocations, error } = await supabase
    .from('capital_call_allocations')
    .select(`
      *,
      capital_calls (
        id,
        call_number,
        call_date,
        due_date,
        purpose,
        status,
        structure_id,
        approval_status,
        total_call_amount
      )
    `)
    .gt('paid_amount', 0)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Error fetching capital call payments: ${error.message}`);
  }

  // Enrich with user and structure data
  const enrichedPayments = [];

  for (const alloc of (allocations || [])) {
    const capitalCall = alloc.capital_calls;
    if (!capitalCall) continue;

    // Get user info
    let investorName = 'Unknown';
    let investorEmail = '';
    if (alloc.user_id) {
      const { data: user } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .eq('id', alloc.user_id)
        .single();
      if (user) {
        investorName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
        investorEmail = user.email;
      }
    }

    // Get structure info
    let structureName = 'N/A';
    let structureType = '';
    if (capitalCall.structure_id) {
      const { data: struct } = await supabase
        .from('structures')
        .select('id, name, type')
        .eq('id', capitalCall.structure_id)
        .single();
      if (struct) {
        structureName = struct.name;
        structureType = struct.type || '';
      }
    }

    enrichedPayments.push({
      id: alloc.id,
      capitalCallId: capitalCall.id,
      callNumber: capitalCall.call_number,
      callDate: capitalCall.call_date,
      dueDate: capitalCall.due_date,
      purpose: capitalCall.purpose,
      capitalCallStatus: capitalCall.status,
      structureId: capitalCall.structure_id,
      structureName,
      structureType,
      investorId: alloc.user_id,
      investorName,
      investorEmail,
      allocatedAmount: parseFloat(alloc.allocated_amount) || 0,
      totalDue: parseFloat(alloc.total_due) || 0,
      paidAmount: parseFloat(alloc.paid_amount) || 0,
      capitalPaid: parseFloat(alloc.capital_paid) || 0,
      feesPaid: parseFloat(alloc.fees_paid) || 0,
      vatPaid: parseFloat(alloc.vat_paid) || 0,
      outstanding: (parseFloat(alloc.total_due) || 0) - (parseFloat(alloc.paid_amount) || 0),
      status: alloc.status,
      paymentApprovalStatus: alloc.payment_approval_status || (alloc.status === 'Paid' || alloc.status === 'Partially Paid' ? 'approved' : null),
      paymentMethod: alloc.payment_method || 'bank_transfer',
      paymentReference: alloc.payment_reference || '',
      paymentDate: alloc.payment_date || alloc.updated_at,
      createdAt: alloc.created_at,
      updatedAt: alloc.updated_at,
    });
  }

  // Calculate stats based on payment_approval_status
  const stats = {
    total: enrichedPayments.length,
    pending: enrichedPayments.filter(p => p.paymentApprovalStatus === 'pending').length,
    approved: enrichedPayments.filter(p => p.paymentApprovalStatus === 'approved').length,
    rejected: enrichedPayments.filter(p => p.paymentApprovalStatus === 'rejected').length,
    totalPaidAmount: enrichedPayments.reduce((sum, p) => sum + p.paidAmount, 0),
  };

  res.status(200).json({
    success: true,
    count: enrichedPayments.length,
    stats,
    data: enrichedPayments,
  });
}));

/**
 * @route   PATCH /api/capital-calls/payments/:allocationId/approve
 * @desc    Approve an investor's capital call payment (confirm payment was received)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/payments/:allocationId/approve', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { getSupabase } = require('../config/database');
  const supabase = getSupabase();
  const { allocationId } = req.params;
  const { notes } = req.body;

  // Get the allocation
  const { data: allocation, error: fetchError } = await supabase
    .from('capital_call_allocations')
    .select('*, capital_calls(*)')
    .eq('id', allocationId)
    .single();

  if (fetchError || !allocation) {
    return res.status(404).json({ success: false, message: 'Allocation not found' });
  }

  if (allocation.payment_approval_status !== 'pending') {
    return res.status(400).json({ success: false, message: `Payment is already ${allocation.payment_approval_status || 'not pending'}` });
  }

  // Determine the allocation status based on paid amounts
  const totalDue = parseFloat(allocation.total_due) || 0;
  const paidAmount = parseFloat(allocation.paid_amount) || 0;
  const outstanding = totalDue - paidAmount;

  let newStatus = allocation.status;
  if (outstanding <= 0.01) {
    newStatus = 'Paid';
  } else if (paidAmount > 0) {
    newStatus = 'Partially Paid';
  }

  // Update allocation: approve payment and set proper status
  const { error: updateError } = await supabase
    .from('capital_call_allocations')
    .update({
      payment_approval_status: 'approved',
      status: newStatus,
      updated_at: new Date().toISOString()
    })
    .eq('id', allocationId);

  if (updateError) {
    throw new Error(`Error approving payment: ${updateError.message}`);
  }

  // Now update capital call totals since payment is confirmed
  const capitalCallId = allocation.capital_call_id;
  const { data: allAllocations } = await supabase
    .from('capital_call_allocations')
    .select('paid_amount, total_due, payment_approval_status')
    .eq('capital_call_id', capitalCallId);

  // Only count approved payments toward totals
  const approvedAllocations = (allAllocations || []).filter(a => a.payment_approval_status === 'approved');
  const totalPaid = approvedAllocations.reduce((sum, a) => sum + (parseFloat(a.paid_amount) || 0), 0);
  const totalAmount = (allAllocations || []).reduce((sum, a) => sum + (parseFloat(a.total_due) || 0), 0);

  let ccStatus = allocation.capital_calls?.status || 'Sent';
  if (totalPaid >= totalAmount) {
    ccStatus = 'Paid';
  } else if (totalPaid > 0) {
    ccStatus = 'Partially Paid';
  }

  await supabase
    .from('capital_calls')
    .update({
      total_paid_amount: totalPaid,
      total_unpaid_amount: totalAmount - totalPaid,
      status: ccStatus,
      updated_at: new Date().toISOString()
    })
    .eq('id', capitalCallId);

  console.log(`[Payment Approval] Allocation ${allocationId} approved. Status: ${newStatus}`);

  res.status(200).json({
    success: true,
    message: 'Payment approved successfully',
    data: { allocationId, status: newStatus, paymentApprovalStatus: 'approved' }
  });
}));

/**
 * @route   PATCH /api/capital-calls/payments/:allocationId/reject
 * @desc    Reject an investor's capital call payment (payment not received/invalid)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/payments/:allocationId/reject', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { getSupabase } = require('../config/database');
  const supabase = getSupabase();
  const { allocationId } = req.params;
  const { reason } = req.body;

  // Get the allocation
  const { data: allocation, error: fetchError } = await supabase
    .from('capital_call_allocations')
    .select('*')
    .eq('id', allocationId)
    .single();

  if (fetchError || !allocation) {
    return res.status(404).json({ success: false, message: 'Allocation not found' });
  }

  if (allocation.payment_approval_status !== 'pending') {
    return res.status(400).json({ success: false, message: `Payment is already ${allocation.payment_approval_status || 'not pending'}` });
  }

  // Reject: revert paid amounts back to 0 and clear payment data
  const { error: updateError } = await supabase
    .from('capital_call_allocations')
    .update({
      payment_approval_status: 'rejected',
      paid_amount: 0,
      capital_paid: 0,
      fees_paid: 0,
      vat_paid: 0,
      // Keep payment_method/reference/date for audit trail
      updated_at: new Date().toISOString()
    })
    .eq('id', allocationId);

  if (updateError) {
    throw new Error(`Error rejecting payment: ${updateError.message}`);
  }

  console.log(`[Payment Rejection] Allocation ${allocationId} rejected. Reason: ${reason || 'none'}`);

  res.status(200).json({
    success: true,
    message: 'Payment rejected',
    data: { allocationId, paymentApprovalStatus: 'rejected', reason: reason || null }
  });
}));

/**
 * @route   GET /api/capital-calls/:id
 * @desc    Get a single capital call by ID
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);

  validate(capitalCall, 'Capital call not found');

  // Root can access any capital call, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  res.status(200).json({
    success: true,
    data: capitalCall
  });
}));

/**
 * @route   GET /api/capital-calls/:id/with-allocations
 * @desc    Get capital call with investor allocations
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/with-allocations', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  // Use find() with id filter - exact same query pattern as list page
  const results = await CapitalCall.find({ id });
  const capitalCallWithAllocations = results[0];
  validate(capitalCallWithAllocations, 'Capital call not found');

  // Root can access any capital call, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCallWithAllocations.createdBy === userId, 'Unauthorized access to capital call');
  }

  res.status(200).json({
    success: true,
    data: capitalCallWithAllocations
  });
}));

/**
 * @route   GET /api/capital-calls/structure/:structureId/summary
 * @desc    Get capital call summary for a structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/structure/:structureId/summary', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.params;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Root can access any structure, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const summary = await CapitalCall.getSummary(structureId);

  res.status(200).json({
    success: true,
    data: summary
  });
}));

/**
 * @route   GET /api/capital-calls/structure/:structureId/history
 * @desc    Get historical capital calls for a structure with cumulative data
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/structure/:structureId/history', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.params;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Root can access any structure, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  // Get historical capital calls with allocations
  const history = await CapitalCall.getHistoryByStructure(structureId);

  // Get cumulative called amounts per investor
  const cumulativeCalled = await CapitalCall.getCumulativeCalledByStructure(structureId);

  // Calculate totals using total_drawdown from allocations (includes fees + VAT for ProximityParks methodology)
  const totalCalled = history.reduce((sum, call) => {
    // Sum total_drawdown from all allocations, fallback to totalDue, then totalCallAmount
    const callDrawdown = (call.allocations || []).reduce((allocSum, alloc) => {
      return allocSum + (alloc.totalDrawdown || alloc.totalDue || 0);
    }, 0);
    return sum + (callDrawdown || call.totalCallAmount || 0);
  }, 0);
  const totalPaid = history.reduce((sum, call) => sum + (call.totalPaidAmount || 0), 0);

  res.status(200).json({
    success: true,
    data: {
      history,
      cumulativeCalled,
      summary: {
        totalCalls: history.length,
        totalCalled,
        totalPaid,
        totalUnpaid: totalCalled - totalPaid,
        structureTotalCommitment: structure.totalCommitment || 0,
        percentCalled: structure.totalCommitment > 0
          ? ((totalCalled / structure.totalCommitment) * 100).toFixed(2)
          : 0
      }
    }
  });
}));

/**
 * @route   GET /api/capital-calls/investor/:investorId
 * @desc    Get all capital calls for a specific investor
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/investor/:investorId', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { investorId } = req.params;

  validate(investorId, 'Investor ID is required');

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(investorId), 'Invalid investor ID format');

  const capitalCalls = await CapitalCall.findByInvestorId(investorId);

  // Role-based filtering: Root sees all, Admin sees only their own
  const userCapitalCalls = userRole === ROLES.ROOT
    ? capitalCalls
    : capitalCalls.filter(call => call.createdBy === userId);

  res.status(200).json({
    success: true,
    count: userCapitalCalls.length,
    data: userCapitalCalls
  });
}));

/**
 * @route   PUT /api/capital-calls/:id
 * @desc    Update a capital call
 * @access  Private (requires authentication, Root/Admin only)
 */
router.put('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const updateData = {};
  const allowedFields = [
    'callDate', 'dueDate', 'totalCallAmount', 'purpose', 'notes', 'status',
    // ILPA Fee Configuration
    'managementFeeBase', 'managementFeeRate', 'vatRate', 'vatApplicable', 'feePeriod', 'approvalStatus',
    // Proximity Dual-Rate Fee Fields
    'feeRateOnNic', 'feeRateOnUnfunded'
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const updatedCapitalCall = await CapitalCall.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Capital call updated successfully',
    data: updatedCapitalCall
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/send
 * @desc    Mark capital call as sent and notify investors
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/send', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { urgent } = req.body; // Optional: mark as urgent capital call

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }
  validate(capitalCall.status === 'Draft', 'Capital call must be in Draft status to send');

  const updatedCapitalCall = await CapitalCall.markAsSent(id);

  // Get structure for notification
  const structure = await Structure.findById(capitalCall.structureId);

  // Send notifications to all investors in the structure
  sendCapitalCallNotice(updatedCapitalCall, structure, userId, urgent === true)
    .then(notifications => {
      console.log(`[CapitalCall] Sent ${notifications.length} notifications for capital call:`, id);
    })
    .catch(error => {
      console.error('[CapitalCall] Error sending notifications:', error.message);
    });

  res.status(200).json({
    success: true,
    message: 'Capital call marked as sent',
    data: updatedCapitalCall
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/mark-paid
 * @desc    Mark capital call as fully paid
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/mark-paid', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const updatedCapitalCall = await CapitalCall.markAsPaid(id);

  res.status(200).json({
    success: true,
    message: 'Capital call marked as paid',
    data: updatedCapitalCall
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/update-payment
 * @desc    Update payment amounts for capital call
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/update-payment', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { paidAmount } = req.body;

  validate(paidAmount !== undefined && paidAmount > 0, 'Paid amount must be positive');

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const updatedCapitalCall = await CapitalCall.updatePaymentAmounts(id, paidAmount);

  res.status(200).json({
    success: true,
    message: 'Payment amounts updated successfully',
    data: updatedCapitalCall
  });
}));

/**
 * @route   POST /api/capital-calls/:id/create-allocations
 * @desc    Create allocations for all investors in structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/:id/create-allocations', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const structure = await Structure.findById(capitalCall.structureId);
  validate(structure, 'Structure not found');

  const allocations = await CapitalCall.createAllocationsForStructure(id, capitalCall.structureId);

  res.status(201).json({
    success: true,
    message: 'Allocations created successfully',
    data: allocations
  });
}));

/**
 * @route   DELETE /api/capital-calls/:id
 * @desc    Delete a capital call
 * @access  Private (requires authentication, Root/Admin only)
 */
router.delete('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can delete any capital call, Admin can only delete their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  await CapitalCall.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Capital call deleted successfully'
  });
}));

/**
 * @route   GET /api/capital-calls/:id/generate-notice
 * @desc    Generate ILPA Capital Call Notice PDF
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/generate-notice', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const defaultFirmName = await getFirmNameForUser(userId);
  const { firmName = defaultFirmName } = req.query;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can access any capital call, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const structure = await Structure.findById(capitalCall.structureId);
  validate(structure, 'Structure not found');

  // Get allocations
  const capitalCallWithAllocations = await CapitalCall.findWithAllocations(id);

  // Generate PDF
  const pdfBuffer = await generateCapitalCallNoticePDF(
    { ...capitalCall, allocations: capitalCallWithAllocations?.capital_call_allocations || [] },
    structure,
    { firmName, bankDetails: structure.bankDetails }
  );

  // Set response headers for PDF download
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ILPA_Capital_Call_${capitalCall.callNumber}.pdf"`);
  res.setHeader('Content-Length', pdfBuffer.length);

  res.send(pdfBuffer);
}));

/**
 * @route   GET /api/capital-calls/:id/generate-lp-notice/:investorId
 * @desc    Generate Individual LP ILPA Notice PDF
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/generate-lp-notice/:investorId', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id, investorId } = req.params;
  const defaultFirmName = await getFirmNameForUser(userId);
  const { firmName = defaultFirmName } = req.query;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can access any capital call, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const structure = await Structure.findById(capitalCall.structureId);
  validate(structure, 'Structure not found');

  // Get allocations
  const capitalCallWithAllocations = await CapitalCall.findWithAllocations(id);
  const allocations = capitalCallWithAllocations?.capital_call_allocations || [];

  // Find the specific investor's allocation
  const allocation = allocations.find(a => a.user_id === investorId);
  validate(allocation, 'Investor allocation not found');

  // Get investor details
  const investor = await User.findById(investorId);

  // Generate individual LP PDF
  const pdfBuffer = await generateIndividualLPNoticePDF(
    capitalCall,
    allocation,
    structure,
    investor,
    { firmName, bankDetails: structure.bankDetails }
  );

  const investorName = investor?.name || allocation.investorName || 'Investor';

  // Set response headers for PDF download
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ILPA_Capital_Call_${capitalCall.callNumber}_${investorName.replace(/\s+/g, '_')}.pdf"`);
  res.setHeader('Content-Length', pdfBuffer.length);

  res.send(pdfBuffer);
}));

/**
 * @route   POST /api/capital-calls/:id/send-notices
 * @desc    Send ILPA Capital Call Notices to all investors via email
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/:id/send-notices', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const defaultFirmName = await getFirmNameForUser(userId);
  const { firmName = defaultFirmName, subject, bodyText, bodyHtml } = req.body;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can access any capital call, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const structure = await Structure.findById(capitalCall.structureId);
  validate(structure, 'Structure not found');

  // Get allocations with investor details
  const capitalCallWithAllocations = await CapitalCall.findWithAllocations(id);
  const allocations = capitalCallWithAllocations?.capital_call_allocations || [];

  validate(allocations.length > 0, 'No investor allocations found');

  const results = [];
  const errors = [];

  // Generate and send individual notices
  for (const allocation of allocations) {
    try {
      const investorId = allocation.user_id;
      const investor = allocation.user || await User.findById(investorId);

      if (!investor?.email) {
        errors.push({
          investorId,
          investorName: investor?.name || 'Unknown',
          error: 'No email address found'
        });
        continue;
      }

      // Generate individual LP PDF
      const pdfBuffer = await generateIndividualLPNoticePDF(
        capitalCall,
        allocation,
        structure,
        investor,
        { firmName, bankDetails: structure.bankDetails }
      );

      // Prepare email content
      const defaultSubject = `Capital Call Notice #${capitalCall.callNumber} - ${structure.name}`;
      const defaultBodyText = `Dear ${investor.name},\n\nPlease find attached your Capital Call Notice #${capitalCall.callNumber} for ${structure.name}.\n\nPayment Due Date: ${new Date(capitalCall.dueDate).toLocaleDateString()}\n\nPlease review the attached notice for payment instructions.\n\nBest regards,\n${firmName}`;
      const defaultBodyHtml = `
        <p>Dear ${investor.name},</p>
        <p>Please find attached your Capital Call Notice #${capitalCall.callNumber} for <strong>${structure.name}</strong>.</p>
        <p><strong>Payment Due Date:</strong> ${new Date(capitalCall.dueDate).toLocaleDateString()}</p>
        <p>Please review the attached notice for payment instructions.</p>
        <p>Best regards,<br/>${firmName}</p>
      `;

      // Send email with PDF attachment
      await sendEmail(userId, {
        to: [investor.email],
        subject: subject || defaultSubject,
        bodyText: bodyText || defaultBodyText,
        bodyHtml: bodyHtml || defaultBodyHtml,
        attachments: [{
          filename: `ILPA_Capital_Call_${capitalCall.callNumber}_${investor.name.replace(/\s+/g, '_')}.pdf`,
          content: pdfBuffer.toString('base64'),
          encoding: 'base64',
          contentType: 'application/pdf'
        }]
      });

      results.push({
        investorId,
        investorName: investor.name,
        email: investor.email,
        status: 'sent'
      });
    } catch (error) {
      errors.push({
        investorId: allocation.user_id,
        investorName: allocation.user?.name || 'Unknown',
        error: error.message
      });
    }
  }

  // Update capital call status if all notices were sent
  if (errors.length === 0 && results.length > 0) {
    await CapitalCall.markAsSent(id);
  }

  res.status(200).json({
    success: true,
    message: `Notices sent to ${results.length} investor(s)${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
    data: {
      sent: results,
      failed: errors,
      capitalCallStatus: errors.length === 0 ? 'Sent' : capitalCall.status
    }
  });
}));

// ==========================================
// APPROVAL WORKFLOW ENDPOINTS
// ==========================================

/**
 * @route   GET /api/capital-calls/:id/approval-history
 * @desc    Get approval history for a capital call
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/approval-history', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can access any capital call, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const history = await ApprovalHistory.findByEntity('capital_call', id);

  res.status(200).json({
    success: true,
    data: history
  });
}));

/**
 * @route   GET /api/capital-calls/pending-approval
 * @desc    Get all capital calls pending approval
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/pending/approval', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { status } = req.query;

  let filter = {};

  // Filter by approval status - default to pending_cfo (simplified workflow)
  if (status) {
    filter.approvalStatus = status;
  } else {
    // Get all pending CFO approval items (simplified workflow)
    filter.approvalStatusIn = ['pending_cfo'];
  }

  // Role-based filtering: Root sees all, Admin sees only their own
  if (userRole === ROLES.ADMIN) {
    filter.createdBy = userId;
  }

  const capitalCalls = await CapitalCall.findByApprovalStatus(filter);

  res.status(200).json({
    success: true,
    count: capitalCalls.length,
    data: capitalCalls
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/submit-for-review
 * @desc    Submit capital call for CFO approval (draft -> pending_cfo)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/submit-for-review', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { notes } = req.body;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }
  validate(capitalCall.approvalStatus === 'draft', 'Capital call must be in draft status to submit for review');

  // Get user details for history
  const user = await User.findById(userId);

  // Update approval status - go directly to pending_cfo (simplified workflow)
  const updatedCapitalCall = await CapitalCall.findByIdAndUpdate(id, {
    approvalStatus: 'pending_cfo'
  });

  // Log approval action
  await ApprovalHistory.logAction({
    entityType: 'capital_call',
    entityId: id,
    action: 'submitted',
    fromStatus: 'draft',
    toStatus: 'pending_cfo',
    userId,
    userName: user?.name || 'Unknown',
    notes,
    metadata: { callNumber: capitalCall.callNumber }
  });

  // Send email notification to CFO/approvers (Root users)
  try {
    const rootUsers = await User.findByRole(0); // Root users are CFO/approvers
    const firmName = await getFirmNameForUser(userId);
    const structure = await Structure.findById(capitalCall.structureId);

    for (const approver of rootUsers) {
      if (approver?.email && approver.id !== userId) {
        await sendEmail(userId, {
          to: [approver.email],
          subject: `CFO Approval Required: Capital Call #${capitalCall.callNumber} - ${structure?.name || 'Fund'}`,
          bodyText: `Dear ${approver.name},\n\nA capital call has been submitted for your approval.\n\nCapital Call #${capitalCall.callNumber}\nFund: ${structure?.name || 'N/A'}\nAmount: $${capitalCall.totalCallAmount.toLocaleString()}\nSubmitted by: ${user?.name || 'Unknown'}\n\nPlease log in to review and approve.\n\nBest regards,\n${firmName}`,
          bodyHtml: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <div style="background-color: #d1ecf1; padding: 15px; border-left: 4px solid #17a2b8; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #0c5460;">CFO Approval Required</h2>
              </div>
              <p>Dear ${approver.name},</p>
              <p>A capital call has been submitted for your review and approval.</p>
              <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>Capital Call:</strong> #${capitalCall.callNumber}</p>
                <p style="margin: 5px 0;"><strong>Fund:</strong> ${structure?.name || 'N/A'}</p>
                <p style="margin: 5px 0;"><strong>Amount:</strong> $${capitalCall.totalCallAmount.toLocaleString()}</p>
                <p style="margin: 5px 0;"><strong>Submitted by:</strong> ${user?.name || 'Unknown'}</p>
              </div>
              <p>Please log in to the portal to review and approve this capital call.</p>
              <p>Best regards,<br/>${firmName}</p>
            </div>
          `
        });
      }
    }
  } catch (emailError) {
    console.warn('Failed to send approval notification:', emailError.message);
  }

  res.status(200).json({
    success: true,
    message: 'Capital call submitted for CFO approval',
    data: updatedCapitalCall
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/approve
 * @desc    Approve capital call (legacy endpoint - redirects to cfo-approve for simplified workflow)
 * @access  Private (requires authentication, Root/Admin only)
 * @deprecated Use cfo-approve endpoint instead. This is kept for backwards compatibility.
 */
router.patch('/:id/approve', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { notes } = req.body;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can approve any capital call, Admin can only approve their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  // With simplified workflow, this endpoint now handles pending_cfo status
  validate(
    capitalCall.approvalStatus === 'pending_cfo',
    'Capital call must be pending CFO approval'
  );

  // Only Root (CFO) can approve
  validate(userRole === ROLES.ROOT, 'Only CFO can approve capital calls');

  // Get user details for history
  const user = await User.findById(userId);

  // Update approval status directly to approved
  const updatedCapitalCall = await CapitalCall.findByIdAndUpdate(id, {
    approvalStatus: 'approved'
  });

  // Log approval action
  await ApprovalHistory.logAction({
    entityType: 'capital_call',
    entityId: id,
    action: 'cfo_approved',
    fromStatus: 'pending_cfo',
    toStatus: 'approved',
    userId,
    userName: user?.name || 'Unknown',
    notes,
    metadata: { callNumber: capitalCall.callNumber }
  });

  // Send email notification to submitter
  try {
    const firmName = await getFirmNameForUser(userId);
    const structure = await Structure.findById(capitalCall.structureId);
    const creator = await User.findById(capitalCall.createdBy);

    if (creator?.email) {
      await sendEmail(userId, {
        to: [creator.email],
        subject: `Approved: Capital Call #${capitalCall.callNumber} - ${structure?.name || 'Fund'}`,
        bodyText: `Dear ${creator.name},\n\nGreat news! Your capital call has been approved.\n\nCapital Call #${capitalCall.callNumber}\nFund: ${structure?.name || 'N/A'}\nAmount: $${capitalCall.totalCallAmount.toLocaleString()}\nApproved by: ${user?.name || 'Unknown'}\n\nYou can now proceed to send notices to investors.\n\nBest regards,\n${firmName}`,
        bodyHtml: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <div style="background-color: #d4edda; padding: 15px; border-left: 4px solid #28a745; margin-bottom: 20px;">
              <h2 style="margin: 0; color: #155724;">Capital Call Approved</h2>
            </div>
            <p>Dear ${creator.name},</p>
            <p>Great news! Your capital call has been approved and is ready for the next step.</p>
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Capital Call:</strong> #${capitalCall.callNumber}</p>
              <p style="margin: 5px 0;"><strong>Fund:</strong> ${structure?.name || 'N/A'}</p>
              <p style="margin: 5px 0;"><strong>Amount:</strong> $${capitalCall.totalCallAmount.toLocaleString()}</p>
              <p style="margin: 5px 0;"><strong>Approved by:</strong> ${user?.name || 'Unknown'}</p>
            </div>
            <p><strong>Next Steps:</strong> You can now send capital call notices to investors.</p>
            <p>Best regards,<br/>${firmName}</p>
          </div>
        `
      });
    }
  } catch (emailError) {
    console.warn('Failed to send approval notification:', emailError.message);
  }

  res.status(200).json({
    success: true,
    message: 'Capital call approved',
    data: updatedCapitalCall
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/cfo-approve
 * @desc    CFO final approval (pending_cfo -> approved)
 * @access  Private (requires authentication, Root only - CFO)
 */
router.patch('/:id/cfo-approve', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { notes } = req.body;

  // Only Root (CFO) can do final approval
  validate(userRole === ROLES.ROOT, 'Only CFO can provide final approval');

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');
  validate(
    capitalCall.approvalStatus === 'pending_cfo',
    'Capital call must be pending CFO approval'
  );

  // Get user details for history
  const user = await User.findById(userId);

  // Update approval status
  const updatedCapitalCall = await CapitalCall.findByIdAndUpdate(id, {
    approvalStatus: 'approved'
  });

  // Log approval action
  await ApprovalHistory.logAction({
    entityType: 'capital_call',
    entityId: id,
    action: 'cfo_approved',
    fromStatus: 'pending_cfo',
    toStatus: 'approved',
    userId,
    userName: user?.name || 'Unknown',
    notes,
    metadata: { callNumber: capitalCall.callNumber }
  });

  // Send email notification to submitter
  try {
    const firmName = await getFirmNameForUser(userId);
    const structure = await Structure.findById(capitalCall.structureId);
    const creator = await User.findById(capitalCall.createdBy);

    if (creator?.email) {
      await sendEmail(userId, {
        to: [creator.email],
        subject: `CFO Approved: Capital Call #${capitalCall.callNumber} - ${structure?.name || 'Fund'}`,
        bodyText: `Dear ${creator.name},\n\nGreat news! Your capital call has received final CFO approval.\n\nCapital Call #${capitalCall.callNumber}\nFund: ${structure?.name || 'N/A'}\nAmount: $${capitalCall.totalCallAmount.toLocaleString()}\nCFO Approved by: ${user?.name || 'Unknown'}\n\nYou can now proceed to send notices to investors.\n\nBest regards,\n${firmName}`,
        bodyHtml: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <div style="background-color: #d4edda; padding: 15px; border-left: 4px solid #28a745; margin-bottom: 20px;">
              <h2 style="margin: 0; color: #155724;">CFO Approval Confirmed</h2>
            </div>
            <p>Dear ${creator.name},</p>
            <p>Great news! Your capital call has received final CFO approval and is now ready to be sent to investors.</p>
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Capital Call:</strong> #${capitalCall.callNumber}</p>
              <p style="margin: 5px 0;"><strong>Fund:</strong> ${structure?.name || 'N/A'}</p>
              <p style="margin: 5px 0;"><strong>Amount:</strong> $${capitalCall.totalCallAmount.toLocaleString()}</p>
              <p style="margin: 5px 0;"><strong>CFO Approved by:</strong> ${user?.name || 'Unknown'}</p>
            </div>
            <p><strong>Next Steps:</strong> You can now send capital call notices to all investors.</p>
            <p>Best regards,<br/>${firmName}</p>
          </div>
        `
      });
    }
  } catch (emailError) {
    console.warn('Failed to send CFO approval notification:', emailError.message);
  }

  res.status(200).json({
    success: true,
    message: 'Capital call approved by CFO',
    data: updatedCapitalCall
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/reject
 * @desc    Reject capital call (any pending status -> rejected)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/reject', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { reason } = req.body;

  validate(reason?.trim(), 'Rejection reason is required');

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can reject any, Admin can only reject their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }
  validate(
    capitalCall.approvalStatus === 'pending_cfo',
    'Capital call must be pending CFO approval to reject'
  );

  // Only Root (CFO) can reject
  validate(userRole === ROLES.ROOT, 'Only CFO can reject capital calls');

  // Get user details for history
  const user = await User.findById(userId);

  // Update approval status
  const updatedCapitalCall = await CapitalCall.findByIdAndUpdate(id, {
    approvalStatus: 'rejected'
  });

  // Log approval action
  await ApprovalHistory.logAction({
    entityType: 'capital_call',
    entityId: id,
    action: 'rejected',
    fromStatus: capitalCall.approvalStatus,
    toStatus: 'rejected',
    userId,
    userName: user?.name || 'Unknown',
    notes: reason,
    metadata: { callNumber: capitalCall.callNumber }
  });

  // Send email notification to submitter
  try {
    const firmName = await getFirmNameForUser(userId);
    const structure = await Structure.findById(capitalCall.structureId);
    const creator = await User.findById(capitalCall.createdBy);

    if (creator?.email) {
      await sendEmail(userId, {
        to: [creator.email],
        subject: `Rejected: Capital Call #${capitalCall.callNumber} - ${structure?.name || 'Fund'}`,
        bodyText: `Dear ${creator.name},\n\nUnfortunately, your capital call has been rejected.\n\nCapital Call #${capitalCall.callNumber}\nFund: ${structure?.name || 'N/A'}\nAmount: $${capitalCall.totalCallAmount.toLocaleString()}\nRejected by: ${user?.name || 'Unknown'}\n\nReason for Rejection:\n${reason}\n\nPlease review the feedback and create a new capital call with the necessary corrections.\n\nBest regards,\n${firmName}`,
        bodyHtml: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <div style="background-color: #f8d7da; padding: 15px; border-left: 4px solid #dc3545; margin-bottom: 20px;">
              <h2 style="margin: 0; color: #721c24;">Capital Call Rejected</h2>
            </div>
            <p>Dear ${creator.name},</p>
            <p>Unfortunately, your capital call has been rejected and cannot proceed at this time.</p>
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Capital Call:</strong> #${capitalCall.callNumber}</p>
              <p style="margin: 5px 0;"><strong>Fund:</strong> ${structure?.name || 'N/A'}</p>
              <p style="margin: 5px 0;"><strong>Amount:</strong> $${capitalCall.totalCallAmount.toLocaleString()}</p>
              <p style="margin: 5px 0;"><strong>Rejected by:</strong> ${user?.name || 'Unknown'}</p>
            </div>
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 4px; margin: 20px 0;">
              <h4 style="margin: 0 0 10px 0; color: #856404;">Reason for Rejection</h4>
              <p style="margin: 0; color: #856404;">${reason}</p>
            </div>
            <p>Please review the feedback and create a new capital call with the necessary corrections.</p>
            <p>Best regards,<br/>${firmName}</p>
          </div>
        `
      });
    }
  } catch (emailError) {
    console.warn('Failed to send rejection notification:', emailError.message);
  }

  res.status(200).json({
    success: true,
    message: 'Capital call rejected',
    data: updatedCapitalCall
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/request-changes
 * @desc    Request changes on capital call (pending -> draft)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/request-changes', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { notes } = req.body;

  validate(notes?.trim(), 'Change request notes are required');

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can request changes on any, Admin can only on their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }
  validate(
    capitalCall.approvalStatus === 'pending_cfo',
    'Capital call must be pending CFO approval to request changes'
  );

  // Only Root (CFO) can request changes
  validate(userRole === ROLES.ROOT, 'Only CFO can request changes on capital calls');

  // Get user details for history
  const user = await User.findById(userId);

  // Update approval status back to draft
  const updatedCapitalCall = await CapitalCall.findByIdAndUpdate(id, {
    approvalStatus: 'draft'
  });

  // Log approval action
  await ApprovalHistory.logAction({
    entityType: 'capital_call',
    entityId: id,
    action: 'changes_requested',
    fromStatus: capitalCall.approvalStatus,
    toStatus: 'draft',
    userId,
    userName: user?.name || 'Unknown',
    notes,
    metadata: { callNumber: capitalCall.callNumber }
  });

  // Send email notification to creator about requested changes
  try {
    const creator = await User.findById(capitalCall.createdBy);
    if (creator?.email) {
      const firmName = await getFirmNameForUser(userId);
      await sendEmail(userId, {
        to: [creator.email],
        subject: `Changes Requested: Capital Call #${capitalCall.callNumber}`,
        bodyText: `Changes have been requested on Capital Call #${capitalCall.callNumber}.\n\nReviewer Notes:\n${notes}\n\nPlease review and resubmit.`,
        bodyHtml: `
          <p>Changes have been requested on <strong>Capital Call #${capitalCall.callNumber}</strong>.</p>
          <h4>Reviewer Notes:</h4>
          <p style="background-color: #fff3cd; padding: 12px; border-radius: 4px;">${notes}</p>
          <p>Please review and resubmit.</p>
          <p>Best regards,<br/>${firmName}</p>
        `
      });
    }
  } catch (emailError) {
    console.warn('Failed to send change request notification:', emailError.message);
  }

  res.status(200).json({
    success: true,
    message: 'Changes requested on capital call',
    data: updatedCapitalCall
  });
}));

/**
 * @route   POST /api/capital-calls/trigger-reminders
 * @desc    Manually trigger capital call reminder job (for testing)
 * @access  Private (requires authentication, Root only)
 */
router.post('/trigger-reminders', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Only Root users can trigger this
  validate(userRole === ROLES.ROOT, 'Only administrators can trigger reminder jobs');

  try {
    const { runCapitalCallReminderJob } = require('../jobs/capitalCallReminders');
    await runCapitalCallReminderJob();

    res.status(200).json({
      success: true,
      message: 'Capital call reminder job triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to run reminder job',
      error: error.message
    });
  }
}));

/**
 * @route   GET /api/capital-calls/health
 * @desc    Health check for Capital Call API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Capital Call API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
