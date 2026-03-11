/**
 * Structure API Routes
 * Endpoints for managing investment structures (Funds, SA/LLC, Fideicomiso, Private Debt)
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { Structure, StructureAdmin, User, CapitalCall, StructureInvestor, Notification, NotificationSettings } = require('../models/supabase');
const SmartContract = require('../models/supabase/smartContract');
const {
  requireInvestmentManagerAccess,
  getUserContext,
  ROLES,
  canAccessStructure,
  canEditStructure,
  getUserStructureIds
} = require('../middleware/rbac');
const { handleStructureBannerUpload } = require('../middleware/upload');
const { uploadToSupabase } = require('../utils/fileUpload');

const router = express.Router();

/**
 * Helper function to enrich structure with smart contract data
 * @param {Object} structure - Structure object
 * @returns {Promise<Object>} Structure with smart contract data
 */
async function enrichStructureWithSmartContract(structure) {
  if (!structure) return structure;

  try {
    const smartContract = await SmartContract.findOne({ structureId: structure.id });
    return {
      ...structure,
      smartContract: smartContract || null
    };
  } catch (error) {
    console.error(`Error fetching smart contract for structure ${structure.id}:`, error.message);
    return {
      ...structure,
      smartContract: null
    };
  }
}

/**
 * Helper function to enrich multiple structures with smart contract data
 * @param {Array} structures - Array of structure objects
 * @returns {Promise<Array>} Structures with smart contract data
 */
async function enrichStructuresWithSmartContracts(structures) {
  if (!structures || !Array.isArray(structures)) return structures;

  return Promise.all(
    structures.map(structure => enrichStructureWithSmartContract(structure))
  );
}

/**
 * Helper function to enrich structure with capital call summary data
 * @param {Object} structure - Structure object
 * @returns {Promise<Object>} Structure with capital call summary
 */
async function enrichStructureWithCapitalCallSummary(structure) {
  if (!structure) return structure;

  try {
    // Get all capital calls for this structure
    const capitalCalls = await CapitalCall.findByStructureId(structure.id);

    // Calculate summary metrics using total_drawdown from allocations (includes fees + VAT for ProximityParks methodology)
    const totalCalled = capitalCalls.reduce((sum, cc) => {
      // Sum total_drawdown from all allocations, fallback to total_due, then totalCallAmount
      const callDrawdown = (cc.allocations || []).reduce((allocSum, alloc) => {
        return allocSum + (alloc.total_drawdown || alloc.totalDrawdown || alloc.total_due || alloc.totalDue || 0);
      }, 0);
      return sum + (callDrawdown || cc.totalCallAmount || 0);
    }, 0);
    const totalPaid = capitalCalls.reduce((sum, cc) => sum + (cc.totalPaidAmount || 0), 0);
    const callCount = capitalCalls.length;
    const lastCall = capitalCalls[0]; // Already sorted by date desc from findByStructureId

    // Determine if capital calls are enabled for this structure type
    const capitalCallsEnabled = structure.type === 'fund' ||
                                structure.type === 'fideicomiso' ||
                                structure.managementFeeBase === 'nic_plus_unfunded' ||
                                callCount > 0;

    return {
      ...structure,
      capitalCallSummary: {
        enabled: capitalCallsEnabled,
        totalCalled,
        totalPaid,
        totalUnpaid: totalCalled - totalPaid,
        callCount,
        percentageCalled: structure.totalCommitment > 0
          ? parseFloat(((totalCalled / structure.totalCommitment) * 100).toFixed(2))
          : 0,
        lastCallDate: lastCall?.callDate || null,
        lastCallNumber: lastCall?.callNumber || null,
        lastCallStatus: lastCall?.status || null
      }
    };
  } catch (error) {
    console.error(`Error fetching capital call summary for structure ${structure.id}:`, error.message);
    return {
      ...structure,
      capitalCallSummary: null
    };
  }
}

/**
 * Helper function to enrich multiple structures with capital call summary data
 * @param {Array} structures - Array of structure objects
 * @returns {Promise<Array>} Structures with capital call summaries
 */
async function enrichStructuresWithCapitalCallSummaries(structures) {
  if (!structures || !Array.isArray(structures)) return structures;

  return Promise.all(
    structures.map(structure => enrichStructureWithCapitalCallSummary(structure))
  );
}

/**
 * @route   POST /api/structures
 * @desc    Create a new structure (with optional banner image)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/', authenticate, requireInvestmentManagerAccess, handleStructureBannerUpload, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  const {
    name,
    type,
    subtype,
    status,
    description,
    parentStructureId,
    totalCommitment,
    managementFee,
    carriedInterest,
    hurdleRate,
    waterfallType,
    inceptionDate,
    termYears,
    extensionYears,
    gp,
    fundAdmin,
    legalCounsel,
    auditor,
    taxAdvisor,
    bankAccounts,
    baseCurrency,
    taxJurisdiction,
    regulatoryStatus,
    investmentStrategy,
    targetReturns,
    riskProfile,
    stage,
    performanceFee,
    performanceMethodology,
    preferredReturn,
    plannedInvestments,
    investors,
    managementControl,
    capitalContributions,
    allocationsDistributions,
    limitedPartnerObligations,
    limitedPartnerRights,
    lockUpPeriod,
    withdrawalConditions,
    withdrawalProcess,
    generalProhibition,
    permittedTransfers,
    transferRequirements,
    quarterlyReports,
    annualReports,
    taxForms,
    capitalCallDistributionsNotices,
    additionalCommunications,
    limitedLiability,
    exceptionsLiability,
    maximumExposure,
    indemnifiesPartnership,
    lpIndemnifiesPartnership,
    indemnifiesProcedures,
    amendments,
    dissolution,
    disputesResolution,
    governingLaw,
    additionalProvisions,
    minimumTicket,
    maximumTicket,
    strategyInstrumentType,
    localBankName,
    localAccountBank,
    localRoutingBank,
    localAccountHolder,
    localBankAddress,
    internationalBankName,
    internationalAccountBank,
    internationalSwift,
    internationalHolderName,
    internationalBankAddress,
    blockchainNetwork,
    walletAddress,
    debtGrossInterestRate,
    debtInterestRate,
    parentStructureOwnershipPercentage,
    enableCapitalCalls,
    capitalCallNoticePeriod,
    capitalCallPaymentDeadline,
    distributionFrequency,
    witholdingDividendTaxRateNaturalPersons,
    witholdingDividendTaxRateLegalEntities,
    incomeDebtTaxRateNaturalPersons,
    incomeEquityTaxRateNaturalPersons,
    incomeDebtTaxRateLegalEntities,
    incomeEquityTaxRateLegalEntities,
    walletOwnerAddress,
    operatingAgreementHash,
    incomeFlowTarget,
    vatRate,
    vatRateNaturalPersons,
    vatRateLegalEntities,
    defaultTaxRate,
    determinedTier,
    calculatedIssuances,
    capitalCallDefaultPercentage,
    fundType,
    contractTemplateUrlNational,
    contractTemplateUrlInternational,
    // ILPA Fee Configuration
    managementFeeBase,
    gpCatchUpRate,
    // Proximity Dual-Rate Fee Fields
    feeRateOnNic,
    feeRateOnUnfunded,
    gpPercentage,
    maxInvestorRestriction
  } = req.body;

  // Validate required fields
  validate(name, 'Structure name is required');
  validate(type, 'Structure type is required');
  // validate(['Fund', 'SA/LLC', 'Fideicomiso', 'Private Debt'].includes(type), 'Invalid structure type');

  // Validate parent structure if provided
  if (parentStructureId) {
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    validate(uuidRegex.test(parentStructureId), 'Invalid parent structure ID format');

    const parentStructure = await Structure.findById(parentStructureId);
    validate(parentStructure, 'Parent structure not found');
    validate(parentStructure.createdBy === userId, 'Parent structure does not belong to user');
    validate(parentStructure.hierarchyLevel < 5, 'Maximum hierarchy level (5) reached');
  }

  // Helper function to sanitize numeric values (handles string "null")
  const sanitizeNumber = (value, defaultValue = null) => {
    if (value === null || value === undefined || value === 'null' || value === '') {
      return defaultValue;
    }
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  };

  // Handle banner image upload if provided
  let bannerImageUrl = null;
  if (req.file) {
    try {
      const fileName = `structure-banner-${userId}-${Date.now()}.${req.file.mimetype.split('/')[1]}`;
      const uploadResult = await uploadToSupabase(req.file.buffer, fileName, req.file.mimetype, 'image/jpeg', 'structure-banners');
      bannerImageUrl = uploadResult.publicUrl;
      console.log('Banner image uploaded to Supabase:', bannerImageUrl);
    } catch (error) {
      console.error('Error uploading banner image:', error);
      // Continue without banner image if upload fails
    }
  }

  // Create structure
  const structureData = {
    name: name.trim(),
    type,
    subtype: subtype?.trim() || '',
    description: description?.trim() || '',
    status: status || 'Active',
    parentStructureId: parentStructureId || null,
    hierarchyLevel: parentStructureId ? null : 1, // Will be calculated by DB trigger
    totalCommitment: sanitizeNumber(totalCommitment, 0),
    totalCalled: 0,
    totalDistributed: 0,
    totalInvested: 0,
    managementFee: sanitizeNumber(managementFee, 2.0),
    carriedInterest: sanitizeNumber(carriedInterest, 20.0),
    hurdleRate: sanitizeNumber(hurdleRate, 8.0),
    waterfallType: waterfallType || 'American',
    inceptionDate: inceptionDate || new Date().toISOString(),
    termYears: sanitizeNumber(termYears, 10),
    extensionYears: sanitizeNumber(extensionYears, 2),
    gp: gp?.trim() || '',
    fundAdmin: fundAdmin?.trim() || '',
    legalCounsel: legalCounsel?.trim() || '',
    auditor: auditor?.trim() || '',
    taxAdvisor: taxAdvisor?.trim() || '',
    bankAccounts: bankAccounts || {},
    baseCurrency: baseCurrency || 'USD',
    taxJurisdiction: taxJurisdiction?.trim() || '',
    regulatoryStatus: regulatoryStatus?.trim() || '',
    investmentStrategy: investmentStrategy?.trim() || '',
    targetReturns: sanitizeNumber(targetReturns, null),
    riskProfile: riskProfile?.trim() || '',
    stage: stage?.trim() || '',
    performanceFee: sanitizeNumber(performanceFee, null),
    performanceMethodology: performanceMethodology?.trim() || '',
    preferredReturn: sanitizeNumber(preferredReturn, null),
    plannedInvestments: sanitizeNumber(plannedInvestments, null),
    investors: sanitizeNumber(investors, 0),
    bannerImage: bannerImageUrl || '',
    managementControl: managementControl?.trim() || '',
    capitalContributions: capitalContributions?.trim() || '',
    allocationsDistributions: allocationsDistributions?.trim() || '',
    limitedPartnerObligations: limitedPartnerObligations?.trim() || '',
    limitedPartnerRights: limitedPartnerRights?.trim() || '',
    lockUpPeriod: lockUpPeriod?.trim() || '',
    withdrawalConditions: withdrawalConditions?.trim() || '',
    withdrawalProcess: withdrawalProcess?.trim() || '',
    generalProhibition: generalProhibition?.trim() || '',
    permittedTransfers: permittedTransfers?.trim() || '',
    transferRequirements: transferRequirements?.trim() || '',
    quarterlyReports: quarterlyReports?.trim() || '',
    annualReports: annualReports?.trim() || '',
    taxForms: taxForms?.trim() || '',
    capitalCallDistributionsNotices: capitalCallDistributionsNotices?.trim() || '',
    additionalCommunications: additionalCommunications?.trim() || '',
    limitedLiability: limitedLiability?.trim() || '',
    exceptionsLiability: exceptionsLiability?.trim() || '',
    maximumExposure: maximumExposure?.trim() || '',
    indemnifiesPartnership: indemnifiesPartnership?.trim() || '',
    lpIndemnifiesPartnership: lpIndemnifiesPartnership?.trim() || '',
    indemnifiesProcedures: indemnifiesProcedures?.trim() || '',
    amendments: amendments?.trim() || '',
    dissolution: dissolution?.trim() || '',
    disputesResolution: disputesResolution?.trim() || '',
    governingLaw: governingLaw?.trim() || '',
    additionalProvisions: additionalProvisions?.trim() || '',
    minimumTicket: sanitizeNumber(minimumTicket, null),
    maximumTicket: sanitizeNumber(maximumTicket, null),
    strategyInstrumentType: strategyInstrumentType?.trim() || '',
    localBankName: localBankName?.trim() || '',
    localAccountBank: localAccountBank?.trim() || '',
    localRoutingBank: localRoutingBank?.trim() || '',
    localAccountHolder: localAccountHolder?.trim() || '',
    localBankAddress: localBankAddress?.trim() || '',
    internationalBankName: internationalBankName?.trim() || '',
    internationalAccountBank: internationalAccountBank?.trim() || '',
    internationalSwift: internationalSwift?.trim() || '',
    internationalHolderName: internationalHolderName?.trim() || '',
    internationalBankAddress: internationalBankAddress?.trim() || '',
    blockchainNetwork: blockchainNetwork?.trim() || '',
    walletAddress: walletAddress?.trim() || '',
    debtGrossInterestRate: sanitizeNumber(debtGrossInterestRate, null),
    debtInterestRate: sanitizeNumber(debtInterestRate, null),
    parentStructureOwnershipPercentage: sanitizeNumber(parentStructureOwnershipPercentage, null),
    enableCapitalCalls: enableCapitalCalls === true || enableCapitalCalls === 'true',
    capitalCallNoticePeriod: sanitizeNumber(capitalCallNoticePeriod, null),
    capitalCallPaymentDeadline: sanitizeNumber(capitalCallPaymentDeadline, null),
    distributionFrequency: distributionFrequency?.trim() || '',
    witholdingDividendTaxRateNaturalPersons: sanitizeNumber(witholdingDividendTaxRateNaturalPersons, null),
    witholdingDividendTaxRateLegalEntities: sanitizeNumber(witholdingDividendTaxRateLegalEntities, null),
    incomeDebtTaxRateNaturalPersons: sanitizeNumber(incomeDebtTaxRateNaturalPersons, null),
    incomeEquityTaxRateNaturalPersons: sanitizeNumber(incomeEquityTaxRateNaturalPersons, null),
    incomeDebtTaxRateLegalEntities: sanitizeNumber(incomeDebtTaxRateLegalEntities, null),
    incomeEquityTaxRateLegalEntities: sanitizeNumber(incomeEquityTaxRateLegalEntities, null),
    walletOwnerAddress: walletOwnerAddress?.trim() || '',
    operatingAgreementHash: operatingAgreementHash?.trim() || '',
    incomeFlowTarget: incomeFlowTarget?.trim() || '',
    vatRate: sanitizeNumber(vatRate, null),
    vatRateNaturalPersons: sanitizeNumber(vatRateNaturalPersons, null),
    vatRateLegalEntities: sanitizeNumber(vatRateLegalEntities, null),
    defaultTaxRate: sanitizeNumber(defaultTaxRate, null),
    determinedTier: sanitizeNumber(determinedTier, null),
    calculatedIssuances: sanitizeNumber(calculatedIssuances, null),
    capitalCallDefaultPercentage: sanitizeNumber(capitalCallDefaultPercentage, null),
    fundType: fundType?.trim() || '',
    contractTemplateUrlNational: contractTemplateUrlNational?.trim() || '',
    contractTemplateUrlInternational: contractTemplateUrlInternational?.trim() || '',
    // ILPA Fee Configuration
    managementFeeBase: managementFeeBase?.trim() || 'committed',
    gpCatchUpRate: sanitizeNumber(gpCatchUpRate, 100),
    // Proximity Dual-Rate Fee Fields
    feeRateOnNic: sanitizeNumber(feeRateOnNic, null),
    feeRateOnUnfunded: sanitizeNumber(feeRateOnUnfunded, null),
    gpPercentage: sanitizeNumber(gpPercentage, null),
    maxInvestorRestriction: sanitizeNumber(maxInvestorRestriction, null),
    createdBy: userId
  };

  const structure = await Structure.create(structureData);

  // Enrich with smart contract data
  const enrichedStructure = await enrichStructureWithSmartContract(structure);

  // Create notifications for investors (role 3) based on their notification settings
  try {
    const investors = await User.find({ role: ROLES.INVESTOR });
    if (investors && investors.length > 0) {
      // Filter investors based on their notification settings
      const investorsToNotify = [];

      for (const investor of investors) {
        try {
          const settings = await NotificationSettings.findByUserId(investor.id);
          // Default to sending if no settings found or newStructureNotifications is not explicitly false
          const shouldNotify = !settings || settings.newStructureNotifications !== false;

          if (shouldNotify) {
            investorsToNotify.push(investor);
          } else {
            console.log(`[Structure] User ${investor.id} has newStructureNotifications disabled, skipping`);
          }
        } catch (settingsError) {
          // If error checking settings, include investor by default
          console.log(`[Structure] Error checking settings for ${investor.id}, including by default`);
          investorsToNotify.push(investor);
        }
      }

      if (investorsToNotify.length > 0) {
        console.log(`[Structure] Notifying ${investorsToNotify.length} of ${investors.length} investors about new structure`);

        const notificationsData = investorsToNotify.map(investor => ({
          userId: investor.id,
          notificationType: 'new_investment',
          channel: 'portal',
          title: 'New Investment Opportunity',
          message: `A new investment structure "${structure.name}" is now available. Check the marketplace for details.`,
          priority: 'normal',
          relatedEntityType: 'structure',
          relatedEntityId: structure.id,
          senderId: userId,
          actionUrl: `/lp-portal/marketplace/${structure.id}`,
          metadata: {
            structureId: structure.id,
            structureName: structure.name,
            structureType: structure.type
          }
        }));

        await Notification.createMany(notificationsData);
        console.log(`[Structure] Created ${notificationsData.length} notifications for new structure ${structure.id}`);
      }
    }
  } catch (notifyError) {
    // Log error but don't fail structure creation
    console.error('[Structure] Error creating notifications:', notifyError.message);
  }

  res.status(201).json({
    success: true,
    message: 'Structure created successfully',
    data: enrichedStructure
  });
}));

/**
 * @route   GET /api/structures
 * @desc    Get all structures with optional filters
 * @access  Private (requires authentication)
 * @query   createdBy?: string - Filter by creator user ID
 * @query   type?: string - Filter by structure type
 * @query   status?: string - Filter by status
 * @query   parentId?: string - Filter by parent structure ID
 * @query   includeCapitalCalls?: string - Include capital call summary data ('true' to enable)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const { createdBy, type, status, parentId, includeCapitalCalls } = req.query;

  // Build filter object based on query parameters
  const filter = {};
  if (createdBy) filter.createdBy = createdBy;
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (parentId) filter.parentStructureId = parentId;

  // Get structures with filters
  const structures = await Structure.find(filter);

  // Enrich with smart contract data
  let enrichedStructures = await enrichStructuresWithSmartContracts(structures);

  // Optionally enrich with capital call summary data
  if (includeCapitalCalls === 'true') {
    enrichedStructures = await enrichStructuresWithCapitalCallSummaries(enrichedStructures);
  }

  res.status(200).json({
    success: true,
    count: enrichedStructures.length,
    data: enrichedStructures
  });
}));

/**
 * @route   GET /api/structures/root
 * @desc    Get all root structures (no parent) with role-based filtering
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/root', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);

  let structures;

  if (userRole === ROLES.ROOT) {
    // Root sees all root structures
    const allStructures = await Structure.find({ parentStructureId: null });
    structures = allStructures;
  } else {
    // Admin sees only their root structures
    structures = await Structure.findRootStructures(userId);
  }

  // Enrich with smart contract data
  const enrichedStructures = await enrichStructuresWithSmartContracts(structures);

  res.status(200).json({
    success: true,
    count: enrichedStructures.length,
    data: enrichedStructures
  });
}));

/**
 * @route   GET /api/structures/:id
 * @desc    Get a single structure by ID
 * @access  Private (requires authentication)
 * @query   includeCapitalCalls?: string - Include capital call summary data ('true' to enable)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { includeCapitalCalls } = req.query;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Enrich with smart contract data
  let enrichedStructure = await enrichStructureWithSmartContract(structure);

  // Optionally enrich with capital call summary data
  if (includeCapitalCalls === 'true') {
    enrichedStructure = await enrichStructureWithCapitalCallSummary(enrichedStructure);
  }

  res.status(200).json({
    success: true,
    data: enrichedStructure
  });
}));

/**
 * @route   GET /api/structures/:id/children
 * @desc    Get child structures
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/children', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Read access: requireInvestmentManagerAccess gate is sufficient

  const children = await Structure.findChildStructures(id);

  // Enrich with smart contract data
  const enrichedChildren = await enrichStructuresWithSmartContracts(children);

  res.status(200).json({
    success: true,
    count: enrichedChildren.length,
    data: enrichedChildren
  });
}));

/**
 * @route   GET /api/structures/:id/with-investors
 * @desc    Get structure with all investors
 * @access  Private (requires authentication, Root/Admin/Guest)
 */
router.get('/:id/with-investors', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  // Only allow Root, Admin, and Guest roles
  validate(
    [ROLES.ROOT, ROLES.ADMIN, ROLES.GUEST].includes(userRole),
    'Unauthorized: Only Root, Admin, and Guest roles can access this endpoint'
  );

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Read access: role gate above is sufficient (matches GET /:id behavior)

  const structureWithInvestors = await Structure.findWithInvestors(id);

  // Enrich with smart contract data
  const enrichedStructure = await enrichStructureWithSmartContract(structureWithInvestors);

  res.status(200).json({
    success: true,
    data: enrichedStructure
  });
}));

/**
 * @route   GET /api/structures/:id/investors
 * @desc    Get all investors for a structure with their commitment and ownership data
 * @access  Private (requires authentication, Root/Admin/Guest)
 */
router.get('/:id/investors', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  // Only allow Root, Admin, and Guest roles
  validate(
    [ROLES.ROOT, ROLES.ADMIN, ROLES.GUEST].includes(userRole),
    'Unauthorized: Only Root, Admin, and Guest roles can access this endpoint'
  );

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Read access: role gate above is sufficient (matches GET /:id behavior)

  // Get all investors for this structure from structure_investors junction table
  const structureInvestors = await StructureInvestor.findByStructureId(id);

  // Get capital calls for this structure to calculate called capital per investor
  const capitalCalls = await CapitalCall.find({ structureId: id });

  // Transform the data to match what the frontend expects
  const investors = structureInvestors.map(si => {
    // Get user data from the joined users table
    const user = si.user || {};

    // Calculate called capital for this investor from all capital calls
    let calledCapital = 0;
    if (capitalCalls && capitalCalls.length > 0) {
      capitalCalls.forEach(call => {
        // CapitalCall model returns investorAllocations (not allocations)
        const allocs = call.investorAllocations || call.allocations;
        if (allocs) {
          const allocation = allocs.find(a => a.investorId === si.userId || a.userId === si.userId);
          if (allocation && call.status !== 'draft') {
            calledCapital += allocation.callAmount || 0;
          }
        }
      });
    }

    // Build investor name based on available data
    const name = user.first_name && user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.email || 'Unknown Investor';

    return {
      id: si.id,
      name: name,
      email: user.email,
      type: user.investor_type || 'individual',
      userId: si.userId,
      structureId: si.structureId,
      commitment: si.commitment || 0,
      ownershipPercent: si.ownershipPercent || 0,
      calledCapital: calledCapital,
      uncalledCapital: (si.commitment || 0) - calledCapital,
      feeDiscount: si.feeDiscount || 0,
      vatExempt: si.vatExempt || false,
      customTerms: si.customTerms,
      status: si.status || 'active',
      // Include fundOwnerships array for compatibility with capital call wizard
      fundOwnerships: [{
        fundId: id,
        commitment: si.commitment || 0,
        ownershipPercent: si.ownershipPercent || 0,
        calledCapital: calledCapital,
        uncalledCapital: (si.commitment || 0) - calledCapital,
        feeDiscount: si.feeDiscount || 0,
        vatExempt: si.vatExempt || false,
      }]
    };
  });

  res.status(200).json({
    success: true,
    data: investors,
    meta: {
      structureId: id,
      structureName: structure.name,
      totalInvestors: investors.length,
      totalCommitment: investors.reduce((sum, inv) => sum + (inv.commitment || 0), 0)
    }
  });
}));

/**
 * @route   PUT /api/structures/:id
 * @desc    Update a structure (with optional banner image)
 * @access  Private (Root/Admin only - Support cannot edit structures)
 */
router.put('/:id', authenticate, requireInvestmentManagerAccess, handleStructureBannerUpload, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Check if user can edit this structure (Admin/Root only, Support cannot)
  const canEdit = await canEditStructure(structure, userRole, userId, StructureAdmin);
  validate(canEdit, 'Unauthorized: Only admins can edit structures');

  // Handle banner image upload if provided
  let bannerImageUrl = null;
  if (req.file) {
    try {
      const fileName = `structure-banner-${userId}-${Date.now()}.${req.file.mimetype.split('/')[1]}`;
      const uploadResult = await uploadToSupabase(req.file.buffer, fileName, req.file.mimetype, 'image/jpeg', 'structure-banners');
      bannerImageUrl = uploadResult.publicUrl;
      console.log('Banner image uploaded to Supabase:', bannerImageUrl);
    } catch (error) {
      console.error('Error uploading banner image:', error);
      // Continue without banner image if upload fails
    }
  }

  const updateData = {};
  const allowedFields = [
    'name', 'description', 'status', 'subtype', 'totalCommitment', 'managementFee',
    'carriedInterest', 'hurdleRate', 'waterfallType', 'termYears',
    'extensionYears', 'finalDate', 'gp', 'fundAdmin', 'legalCounsel',
    'auditor', 'taxAdvisor', 'bankAccounts', 'baseCurrency',
    'taxJurisdiction', 'regulatoryStatus', 'investmentStrategy',
    'targetReturns', 'riskProfile', 'stage', 'performanceFee', 'performanceMethodology',
    'preferredReturn', 'plannedInvestments', 'investors', 'bannerImage',
    'managementControl', 'capitalContributions', 'allocationsDistributions',
    'limitedPartnerObligations', 'limitedPartnerRights', 'lockUpPeriod',
    'withdrawalConditions', 'withdrawalProcess', 'generalProhibition',
    'permittedTransfers', 'transferRequirements', 'quarterlyReports',
    'annualReports', 'taxForms', 'capitalCallDistributionsNotices',
    'additionalCommunications', 'limitedLiability', 'exceptionsLiability',
    'maximumExposure', 'indemnifiesPartnership', 'lpIndemnifiesPartnership',
    'indemnifiesProcedures', 'amendments', 'dissolution', 'disputesResolution',
    'governingLaw', 'additionalProvisions', 'minimumTicket', 'maximumTicket',
    'strategyInstrumentType', 'localBankName', 'localAccountBank', 'localRoutingBank',
    'localAccountHolder', 'localBankAddress', 'internationalBankName',
    'internationalAccountBank', 'internationalSwift', 'internationalHolderName',
    'internationalBankAddress', 'blockchainNetwork', 'walletAddress',
    'debtGrossInterestRate', 'debtInterestRate', 'parentStructureOwnershipPercentage',
    'enableCapitalCalls', 'capitalCallNoticePeriod', 'capitalCallPaymentDeadline', 'distributionFrequency',
    'witholdingDividendTaxRateNaturalPersons', 'witholdingDividendTaxRateLegalEntities',
    'incomeDebtTaxRateNaturalPersons', 'incomeEquityTaxRateNaturalPersons',
    'incomeDebtTaxRateLegalEntities', 'incomeEquityTaxRateLegalEntities',
    'walletOwnerAddress', 'operatingAgreementHash', 'incomeFlowTarget', 'vatRate',
    'vatRateNaturalPersons', 'vatRateLegalEntities', 'defaultTaxRate', 'determinedTier',
    'calculatedIssuances', 'capitalCallDefaultPercentage', 'fundType',
    'contractTemplateUrlNational', 'contractTemplateUrlInternational',
    // ILPA Fee Configuration
    'managementFeeBase', 'gpCatchUpRate',
    // Proximity Dual-Rate Fee Fields
    'feeRateOnNic', 'feeRateOnUnfunded', 'gpPercentage',
    'maxInvestorRestriction'
  ];

  // Fields that are numeric in the database and must not receive empty strings
  const numericFields = new Set([
    'totalCommitment', 'managementFee', 'carriedInterest', 'hurdleRate',
    'termYears', 'extensionYears', 'performanceFee', 'preferredReturn',
    'plannedInvestments', 'investors', 'minimumTicket', 'maximumTicket',
    'targetReturns', 'debtGrossInterestRate', 'debtInterestRate',
    'parentStructureOwnershipPercentage', 'capitalCallNoticePeriod',
    'capitalCallPaymentDeadline', 'vatRate', 'vatRateNaturalPersons',
    'vatRateLegalEntities', 'defaultTaxRate', 'determinedTier',
    'calculatedIssuances', 'capitalCallDefaultPercentage',
    'witholdingDividendTaxRateNaturalPersons', 'witholdingDividendTaxRateLegalEntities',
    'incomeDebtTaxRateNaturalPersons', 'incomeEquityTaxRateNaturalPersons',
    'incomeDebtTaxRateLegalEntities', 'incomeEquityTaxRateLegalEntities',
    'gpCatchUpRate',
    'feeRateOnNic', 'feeRateOnUnfunded', 'gpPercentage',
    'maxInvestorRestriction'
  ]);

  const sanitizeUpdateNumber = (value) => {
    if (value === null || value === undefined || value === 'null' || value === '') {
      return null;
    }
    const num = Number(value);
    return isNaN(num) ? null : num;
  };

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = numericFields.has(field)
        ? sanitizeUpdateNumber(req.body[field])
        : req.body[field];
    }
  }

  // If a new banner image was uploaded, override the bannerImage field
  if (bannerImageUrl) {
    updateData.bannerImage = bannerImageUrl;
  }

  // Only update if there are fields to update
  let updatedStructure;
  if (Object.keys(updateData).length > 0) {
    updatedStructure = await Structure.findByIdAndUpdate(id, updateData);
  } else {
    // No updates provided, return existing structure
    updatedStructure = structure;
  }

  // Enrich with smart contract data
  const enrichedStructure = await enrichStructureWithSmartContract(updatedStructure);

  res.status(200).json({
    success: true,
    message: 'Structure updated successfully',
    data: enrichedStructure
  });
}));

/**
 * @route   PATCH /api/structures/:id/financials
 * @desc    Update structure financial totals
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/financials', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { totalCalled, totalDistributed, totalInvested } = req.body;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can edit any structure, Admin can only edit assigned structures
  if (userRole === ROLES.ADMIN) {
    const canEdit = await canEditStructure(structure, userRole, userId, StructureAdmin);
    validate(canEdit, 'Unauthorized access to structure');
  }

  const financials = {};
  if (totalCalled !== undefined) financials.totalCalled = totalCalled;
  if (totalDistributed !== undefined) financials.totalDistributed = totalDistributed;
  if (totalInvested !== undefined) financials.totalInvested = totalInvested;

  validate(Object.keys(financials).length > 0, 'No financial data provided');

  const updatedStructure = await Structure.updateFinancials(id, financials);

  // Enrich with smart contract data
  const enrichedStructure = await enrichStructureWithSmartContract(updatedStructure);

  res.status(200).json({
    success: true,
    message: 'Structure financials updated successfully',
    data: enrichedStructure
  });
}));

/**
 * @route   POST /api/structures/:id/admins
 * @desc    Add admin or support user to structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/:id/admins', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { userId: targetUserId, role: targetRole, canEdit, canDelete, canManageInvestors, canManageDocuments } = req.body;

  // Validate required fields
  validate(targetUserId, 'User ID is required');
  validate(targetRole !== undefined, 'Role is required');
  validate([ROLES.ADMIN, ROLES.SUPPORT].includes(targetRole), 'Role must be 1 (admin) or 2 (support)');

  // Check if structure exists
  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can add to any structure, Admin can only add to assigned structures
  if (userRole === ROLES.ADMIN) {
    const canEdit = await canEditStructure(structure, userRole, userId, StructureAdmin);
    validate(canEdit, 'Unauthorized access to structure');
  }

  // Check if target user exists and has valid role
  const targetUser = await User.findById(targetUserId);
  validate(targetUser, 'Target user not found');
  validate(
    targetUser.role === ROLES.ADMIN || targetUser.role === ROLES.SUPPORT,
    'Target user must be an admin or support user'
  );

  // Check if user is already added to structure
  const existing = await StructureAdmin.hasAccess(id, targetUserId);
  validate(!existing, 'User is already assigned to this structure');

  // Create the relationship
  const structureAdmin = await StructureAdmin.create({
    structureId: id,
    userId: targetUserId,
    role: targetRole,
    canEdit: canEdit !== undefined ? canEdit : true,
    canDelete: canDelete !== undefined ? canDelete : false,
    canManageInvestors: canManageInvestors !== undefined ? canManageInvestors : true,
    canManageDocuments: canManageDocuments !== undefined ? canManageDocuments : true,
    addedBy: userId
  });

  res.status(201).json({
    success: true,
    message: 'User added to structure successfully',
    data: structureAdmin
  });
}));

/**
 * @route   GET /api/structures/:id/admins
 * @desc    Get all admins and support users for a structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/admins', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  // Check if structure exists
  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Read access: requireInvestmentManagerAccess gate is sufficient

  // Get all admins/support for this structure
  const admins = await StructureAdmin.findByStructureId(id);

  res.status(200).json({
    success: true,
    count: admins.length,
    data: admins
  });
}));

/**
 * @route   DELETE /api/structures/:id/admins/:targetUserId
 * @desc    Remove admin or support user from structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.delete('/:id/admins/:targetUserId', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id, targetUserId } = req.params;

  // Check if structure exists
  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can remove from any structure, Admin can only remove from assigned structures
  if (userRole === ROLES.ADMIN) {
    const canEdit = await canEditStructure(structure, userRole, userId, StructureAdmin);
    validate(canEdit, 'Unauthorized access to structure');
  }

  // Check if relationship exists
  const hasAccess = await StructureAdmin.hasAccess(id, targetUserId);
  validate(hasAccess, 'User is not assigned to this structure');

  // Remove the relationship
  await StructureAdmin.delete(id, targetUserId);

  res.status(200).json({
    success: true,
    message: 'User removed from structure successfully'
  });
}));

/**
 * @route   DELETE /api/structures/:id
 * @desc    Delete a structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.delete('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can delete any structure, Admin can only delete assigned structures
  if (userRole === ROLES.ADMIN) {
    const canEdit = await canEditStructure(structure, userRole, userId, StructureAdmin);
    validate(canEdit, 'Unauthorized access to structure');
  }

  await Structure.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Structure deleted successfully'
  });
}));

/**
 * @route   GET /api/structures/health
 * @desc    Health check for Structure API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Structure API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
