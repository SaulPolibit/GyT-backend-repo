/**
 * Investor API Routes
 * Endpoints for managing investors (Individual, Institution, Fund of Funds, Family Office)
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { Investor } = require('../models/supabase');

const router = express.Router();

/**
 * @route   POST /api/investors
 * @desc    Create a new investor
 * @access  Private (requires authentication)
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  const {
    investorType,
    email,
    phoneNumber,
    country,
    taxId,
    kycStatus,
    accreditedInvestor,
    riskTolerance,
    investmentPreferences,
    // Individual fields
    firstName,
    lastName,
    dateOfBirth,
    nationality,
    passportNumber,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    // Institution fields
    institutionName,
    institutionType,
    registrationNumber,
    legalRepresentative,
    // Fund of Funds fields
    fundName,
    fundManager,
    aum,
    // Family Office fields
    officeName,
    familyName,
    principalContact,
    assetsUnderManagement
  } = req.body;

  // Validate required fields
  validate(investorType, 'Investor type is required');
  validate(['Individual', 'Institution', 'Fund of Funds', 'Family Office'].includes(investorType), 'Invalid investor type');
  validate(email, 'Email is required');

  // Validate email format
  const emailRegex = /^\S+@\S+\.\S+$/;
  validate(emailRegex.test(email), 'Invalid email format');

  // Check if email already exists
  const existingInvestor = await Investor.findByEmail(email);
  validate(!existingInvestor, 'Investor with this email already exists');

  // Validate type-specific required fields
  if (investorType === 'Individual') {
    validate(firstName, 'First name is required for individual investors');
    validate(lastName, 'Last name is required for individual investors');
  } else if (investorType === 'Institution') {
    validate(institutionName, 'Institution name is required');
  } else if (investorType === 'Fund of Funds') {
    validate(fundName, 'Fund name is required');
  } else if (investorType === 'Family Office') {
    validate(officeName, 'Office name is required');
  }

  // Create investor
  const investorData = {
    investorType,
    email: email.toLowerCase(),
    phoneNumber: phoneNumber?.trim() || '',
    country: country?.trim() || '',
    taxId: taxId?.trim() || '',
    kycStatus: kycStatus || 'Pending',
    accreditedInvestor: accreditedInvestor || false,
    riskTolerance: riskTolerance?.trim() || '',
    investmentPreferences: investmentPreferences || {},
    userId
  };

  // Add type-specific fields
  if (investorType === 'Individual') {
    investorData.firstName = firstName.trim();
    investorData.lastName = lastName.trim();
    investorData.dateOfBirth = dateOfBirth || null;
    investorData.nationality = nationality?.trim() || '';
    investorData.passportNumber = passportNumber?.trim() || '';
    investorData.addressLine1 = addressLine1?.trim() || '';
    investorData.addressLine2 = addressLine2?.trim() || '';
    investorData.city = city?.trim() || '';
    investorData.state = state?.trim() || '';
    investorData.postalCode = postalCode?.trim() || '';
  } else if (investorType === 'Institution') {
    investorData.institutionName = institutionName.trim();
    investorData.institutionType = institutionType?.trim() || '';
    investorData.registrationNumber = registrationNumber?.trim() || '';
    investorData.legalRepresentative = legalRepresentative?.trim() || '';
  } else if (investorType === 'Fund of Funds') {
    investorData.fundName = fundName.trim();
    investorData.fundManager = fundManager?.trim() || '';
    investorData.aum = aum || null;
  } else if (investorType === 'Family Office') {
    investorData.officeName = officeName.trim();
    investorData.familyName = familyName?.trim() || '';
    investorData.principalContact = principalContact?.trim() || '';
    investorData.assetsUnderManagement = assetsUnderManagement || null;
  }

  const investor = await Investor.create(investorData);

  res.status(201).json({
    success: true,
    message: 'Investor created successfully',
    data: investor
  });
}));

/**
 * @route   GET /api/investors
 * @desc    Get all investors for authenticated user
 * @access  Private (requires authentication)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { investorType, kycStatus, accreditedInvestor } = req.query;

  let filter = { userId };

  if (investorType) filter.investorType = investorType;
  if (kycStatus) filter.kycStatus = kycStatus;
  if (accreditedInvestor !== undefined) filter.accreditedInvestor = accreditedInvestor === 'true';

  const investors = await Investor.find(filter);

  res.status(200).json({
    success: true,
    count: investors.length,
    data: investors
  });
}));

/**
 * @route   GET /api/investors/search
 * @desc    Search investors by name or email
 * @access  Private (requires authentication)
 */
router.get('/search', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { q } = req.query;

  validate(q, 'Search query is required');
  validate(q.length >= 2, 'Search query must be at least 2 characters');

  const investors = await Investor.search(q, userId);

  res.status(200).json({
    success: true,
    count: investors.length,
    data: investors
  });
}));

/**
 * @route   GET /api/investors/:id
 * @desc    Get a single investor by ID
 * @access  Private (requires authentication)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const investor = await Investor.findById(id);

  validate(investor, 'Investor not found');
  validate(investor.userId === userId, 'Unauthorized access to investor');

  res.status(200).json({
    success: true,
    data: investor
  });
}));

/**
 * @route   GET /api/investors/:id/with-structures
 * @desc    Get investor with all structures
 * @access  Private (requires authentication)
 */
router.get('/:id/with-structures', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const investor = await Investor.findById(id);
  validate(investor, 'Investor not found');
  validate(investor.userId === userId, 'Unauthorized access to investor');

  const investorWithStructures = await Investor.findWithStructures(id);

  res.status(200).json({
    success: true,
    data: investorWithStructures
  });
}));

/**
 * @route   GET /api/investors/:id/portfolio
 * @desc    Get investor portfolio summary
 * @access  Private (requires authentication)
 */
router.get('/:id/portfolio', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const investor = await Investor.findById(id);
  validate(investor, 'Investor not found');
  validate(investor.userId === userId, 'Unauthorized access to investor');

  const portfolio = await Investor.getPortfolioSummary(id);

  res.status(200).json({
    success: true,
    data: portfolio
  });
}));

/**
 * @route   PUT /api/investors/:id
 * @desc    Update an investor
 * @access  Private (requires authentication)
 */
router.put('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const investor = await Investor.findById(id);
  validate(investor, 'Investor not found');
  validate(investor.userId === userId, 'Unauthorized access to investor');

  const updateData = {};
  const allowedFields = [
    'phoneNumber', 'country', 'taxId', 'kycStatus', 'accreditedInvestor',
    'riskTolerance', 'investmentPreferences',
    // Individual fields
    'firstName', 'lastName', 'dateOfBirth', 'nationality', 'passportNumber',
    'addressLine1', 'addressLine2', 'city', 'state', 'postalCode',
    // Institution fields
    'institutionName', 'institutionType', 'registrationNumber', 'legalRepresentative',
    // Fund of Funds fields
    'fundName', 'fundManager', 'aum',
    // Family Office fields
    'officeName', 'familyName', 'principalContact', 'assetsUnderManagement'
  ];

  // Define field types for proper handling
  const booleanFields = ['accreditedInvestor'];
  const numberFields = ['aum', 'assetsUnderManagement'];
  const jsonFields = ['investmentPreferences'];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      const value = req.body[field];

      // Skip empty strings for boolean fields
      if (booleanFields.includes(field) && value === '') {
        continue;
      }

      // Convert empty strings to null for number fields
      if (numberFields.includes(field) && value === '') {
        updateData[field] = null;
        continue;
      }

      // Convert empty strings to null for JSON fields
      if (jsonFields.includes(field) && value === '') {
        updateData[field] = null;
        continue;
      }

      // For string fields, keep as-is (including empty strings)
      updateData[field] = value;
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const updatedInvestor = await Investor.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Investor updated successfully',
    data: updatedInvestor
  });
}));

/**
 * @route   DELETE /api/investors/:id
 * @desc    Delete an investor
 * @access  Private (requires authentication)
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const investor = await Investor.findById(id);
  validate(investor, 'Investor not found');
  validate(investor.userId === userId, 'Unauthorized access to investor');

  await Investor.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Investor deleted successfully'
  });
}));

/**
 * @route   GET /api/investors/health
 * @desc    Health check for Investor API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Investor API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
