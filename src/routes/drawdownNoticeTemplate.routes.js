/**
 * Drawdown Notice Template API Routes
 * Endpoints for managing per-structure drawdown notice templates.
 * Templates are stored once per structure and reused across capital calls.
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { canCreate, getUserContext } = require('../middleware/rbac');
const DrawdownNoticeTemplate = require('../models/supabase/drawdownNoticeTemplate');

const router = express.Router();

/**
 * @route   GET /api/structures/:structureId/drawdown-template
 * @desc    Get drawdown notice template for a structure
 * @access  Private (Root, Admin)
 */
router.get('/:structureId/drawdown-template', authenticate, catchAsync(async (req, res) => {
  const { structureId } = req.params;

  const template = await DrawdownNoticeTemplate.findByStructureId(structureId);

  res.status(200).json({
    success: true,
    data: template, // null if no template exists yet
  });
}));

/**
 * @route   PUT /api/structures/:structureId/drawdown-template
 * @desc    Create or update drawdown notice template for a structure
 * @access  Private (Root, Admin only)
 */
router.put('/:structureId/drawdown-template', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Only Root and Admin can manage templates
  if (!canCreate(userRole)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only Root and Admin users can manage drawdown notice templates.',
    });
  }

  const { structureId } = req.params;
  const userId = req.auth.userId || req.user.id;

  const {
    headerTitle,
    headerSubtitle,
    includeFirmLogo,
    legalDescription,
    paymentInstructionsNote,
    footerSignatoryName,
    footerSignatoryTitle,
    footerCompanyName,
    footerAdditionalNotes,
  } = req.body;

  const templateData = {};
  const allowedFields = {
    headerTitle,
    headerSubtitle,
    includeFirmLogo,
    legalDescription,
    paymentInstructionsNote,
    footerSignatoryName,
    footerSignatoryTitle,
    footerCompanyName,
    footerAdditionalNotes,
  };

  // Only include fields that were provided
  for (const [key, value] of Object.entries(allowedFields)) {
    if (value !== undefined) {
      if (typeof value === 'string') {
        templateData[key] = value.trim();
      } else {
        templateData[key] = value;
      }
    }
  }

  validate(Object.keys(templateData).length > 0, 'No valid fields provided');

  // Track who created/updated the template
  templateData.createdBy = userId;

  const template = await DrawdownNoticeTemplate.upsertByStructureId(structureId, templateData);

  res.status(200).json({
    success: true,
    message: 'Drawdown notice template saved successfully',
    data: template,
  });
}));

/**
 * @route   DELETE /api/structures/:structureId/drawdown-template
 * @desc    Delete drawdown notice template for a structure
 * @access  Private (Root, Admin only)
 */
router.delete('/:structureId/drawdown-template', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  if (!canCreate(userRole)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only Root and Admin users can delete drawdown notice templates.',
    });
  }

  const { structureId } = req.params;

  const deleted = await DrawdownNoticeTemplate.deleteByStructureId(structureId);

  if (!deleted) {
    return res.status(404).json({
      success: false,
      message: 'No drawdown notice template found for this structure.',
    });
  }

  res.status(200).json({
    success: true,
    message: 'Drawdown notice template deleted successfully',
  });
}));

module.exports = router;
