/**
 * ILPA Report API Routes
 * Endpoints for ILPA Performance, Quarterly, and CC&D reports
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { Structure, FirmSettings } = require('../models/supabase');
const { requireInvestmentManagerAccess, getUserContext, ROLES } = require('../middleware/rbac');
const { calculatePerformanceMetrics, calculateQuarterlyActivity, calculateCCDSummary } = require('../services/ilpaReportService');
const { generatePerformanceReportPDF, generateQuarterlyReportPDF, generateCCDReportPDF } = require('../services/ilpaReportPdfGenerator');
const { generatePerformanceReportExcel, generateQuarterlyReportExcel, generateCCDReportExcel } = require('../services/ilpaReportExcelGenerator');

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
 * @route   GET /api/ilpa-reports/:structureId/performance
 * @desc    Get or generate ILPA Performance Report
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:structureId/performance', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.params;
  const { asOfDate, format = 'json' } = req.query;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const reportData = await calculatePerformanceMetrics(structureId, asOfDate);
  const firmName = await getFirmNameForUser(userId);

  if (format === 'pdf') {
    const pdfBuffer = await generatePerformanceReportPDF(reportData, structure, { firmName });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ILPA_Performance_${structure.name?.replace(/\s+/g, '_')}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  }

  if (format === 'excel') {
    const excelBuffer = await generatePerformanceReportExcel(reportData, structure, { firmName });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ILPA_Performance_${structure.name?.replace(/\s+/g, '_')}.xlsx"`);
    res.setHeader('Content-Length', excelBuffer.length);
    return res.send(excelBuffer);
  }

  // Default: JSON
  res.status(200).json({
    success: true,
    data: reportData
  });
}));

/**
 * @route   GET /api/ilpa-reports/:structureId/quarterly
 * @desc    Get or generate ILPA Quarterly Report
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:structureId/quarterly', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.params;
  const { startDate, endDate, format = 'json' } = req.query;

  validate(startDate, 'Start date is required');
  validate(endDate, 'End date is required');

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  // Get performance metrics as of end date + quarterly activity
  const [performanceData, quarterlyActivity] = await Promise.all([
    calculatePerformanceMetrics(structureId, endDate),
    calculateQuarterlyActivity(structureId, startDate, endDate)
  ]);

  const reportData = { performance: performanceData, quarterlyActivity };
  const firmName = await getFirmNameForUser(userId);

  if (format === 'pdf') {
    const pdfBuffer = await generateQuarterlyReportPDF(reportData, structure, { firmName });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ILPA_Quarterly_${structure.name?.replace(/\s+/g, '_')}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  }

  if (format === 'excel') {
    const excelBuffer = await generateQuarterlyReportExcel(reportData, structure, { firmName });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ILPA_Quarterly_${structure.name?.replace(/\s+/g, '_')}.xlsx"`);
    res.setHeader('Content-Length', excelBuffer.length);
    return res.send(excelBuffer);
  }

  res.status(200).json({
    success: true,
    data: reportData
  });
}));

/**
 * @route   GET /api/ilpa-reports/:structureId/ccd
 * @desc    Get or generate ILPA CC&D Report
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:structureId/ccd', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.params;
  const { format = 'json' } = req.query;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const reportData = await calculateCCDSummary(structureId);
  const firmName = await getFirmNameForUser(userId);

  if (format === 'pdf') {
    const pdfBuffer = await generateCCDReportPDF(reportData, structure, { firmName });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ILPA_CCD_${structure.name?.replace(/\s+/g, '_')}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  }

  if (format === 'excel') {
    const excelBuffer = await generateCCDReportExcel(reportData, structure, { firmName });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ILPA_CCD_${structure.name?.replace(/\s+/g, '_')}.xlsx"`);
    res.setHeader('Content-Length', excelBuffer.length);
    return res.send(excelBuffer);
  }

  res.status(200).json({
    success: true,
    data: reportData
  });
}));

/**
 * @route   GET /api/ilpa-reports/:structureId/all
 * @desc    Bundle all 3 ILPA reports (JSON only)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:structureId/all', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.params;
  const { asOfDate, startDate, endDate } = req.query;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const [performanceReport, ccdReport] = await Promise.all([
    calculatePerformanceMetrics(structureId, asOfDate),
    calculateCCDSummary(structureId)
  ]);

  let quarterlyReport = null;
  if (startDate && endDate) {
    const quarterlyActivity = await calculateQuarterlyActivity(structureId, startDate, endDate);
    quarterlyReport = { performance: performanceReport, quarterlyActivity };
  }

  res.status(200).json({
    success: true,
    data: {
      performanceReport,
      quarterlyReport,
      ccdReport
    }
  });
}));

/**
 * @route   GET /api/ilpa-reports/health
 * @desc    Health check
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'ILPA Report API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
