/**
 * Document Generator Service
 *
 * Generates ILPA-compliant Capital Call and Distribution Notices.
 * Server-side document generation for email attachments and storage.
 */

const PDFDocument = require('pdfkit');

// ============================================================================
// PDF STYLING CONSTANTS
// ============================================================================

const COLORS = {
  primary: '#2D1B69',      // Polibit purple
  secondary: '#6B21A8',    // Lighter purple
  accent: '#EDE9FE',       // Very light purple
  text: '#1F2937',         // Dark gray
  muted: '#6B7280',        // Medium gray
  border: '#E5E7EB',       // Light gray
  success: '#059669',      // Green
  warning: '#D97706',      // Orange
};

// ============================================================================
// CAPITAL CALL NOTICE GENERATOR
// ============================================================================

/**
 * Generate ILPA Capital Call Notice PDF
 * @param {Object} capitalCall - Capital call data
 * @param {Object} structure - Fund/structure data
 * @param {Object} options - Generation options
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateCapitalCallNoticePDF(capitalCall, structure, options = {}) {
  const { firmName = 'Investment Manager', bankDetails = {} } = options;
  const currency = capitalCall.currency || structure.currency || 'USD';

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
        autoFirstPage: true
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      addNoticeHeader(doc, {
        firmName,
        title: `CAPITAL CALL NOTICE #${capitalCall.callNumber}`,
        fundName: structure.name || capitalCall.fundName,
        date: capitalCall.callDate
      });

      // Section A: Transaction Summary
      addSectionA(doc, capitalCall, structure, currency);

      // Section B: Fee Breakdown
      if (capitalCall.managementFeeRate || capitalCall.managementFeeAmount) {
        addSectionB(doc, capitalCall, structure, currency);
      }

      // Section C: Payment Instructions
      addSectionC(doc, capitalCall, bankDetails || structure.bankDetails, currency);

      // Section D: Balance Summary
      if (capitalCall.allocations && capitalCall.allocations.length > 0) {
        addSectionD(doc, capitalCall, currency);
      }

      // Footer
      addNoticeFooter(doc, firmName);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate Individual LP Notice PDF
 * @param {Object} capitalCall - Capital call data
 * @param {Object} allocation - Investor allocation data
 * @param {Object} structure - Fund/structure data
 * @param {Object} investor - Investor data
 * @param {Object} options - Generation options
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateIndividualLPNoticePDF(capitalCall, allocation, structure, investor, options = {}) {
  const { firmName = 'Investment Manager', bankDetails = {} } = options;
  const currency = capitalCall.currency || structure?.currency || 'USD';

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
        autoFirstPage: true
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header with LP name
      addNoticeHeader(doc, {
        firmName,
        title: `CAPITAL CALL NOTICE #${capitalCall.callNumber}`,
        fundName: structure?.name || capitalCall.fundName,
        date: capitalCall.callDate,
        recipientName: investor?.name || allocation.investorName
      });

      // Section A: Transaction Summary (LP-specific)
      addLPSectionA(doc, capitalCall, allocation, structure, currency);

      // Section B: Fee Breakdown (LP-specific)
      addLPSectionB(doc, capitalCall, allocation, structure, investor, currency);

      // Section C: Payment Instructions
      addSectionC(doc, capitalCall, bankDetails || structure?.bankDetails, currency);

      // Section D: Balance Summary (LP-specific)
      addLPSectionD(doc, allocation, currency);

      // Footer
      addNoticeFooter(doc, firmName);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================================
// DISTRIBUTION NOTICE GENERATOR
// ============================================================================

/**
 * Generate ILPA Distribution Notice PDF
 * @param {Object} distribution - Distribution data
 * @param {Object} structure - Fund/structure data
 * @param {Object} options - Generation options
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateDistributionNoticePDF(distribution, structure, options = {}) {
  const { firmName = 'Investment Manager' } = options;
  const currency = distribution.currency || structure?.currency || 'USD';

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
        autoFirstPage: true
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      addNoticeHeader(doc, {
        firmName,
        title: `DISTRIBUTION NOTICE #${distribution.distributionNumber}`,
        fundName: structure?.name || distribution.fundName,
        date: distribution.distributionDate
      });

      // Distribution summary
      addDistributionSummary(doc, distribution, structure, currency);

      // Footer
      addNoticeFooter(doc, firmName);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================================
// SECTION GENERATORS
// ============================================================================

function addNoticeHeader(doc, options) {
  const { firmName, title, fundName, date, recipientName } = options;

  // Firm name
  doc.fontSize(20)
     .fillColor(COLORS.primary)
     .text(firmName, 50, 50);

  // Document title
  doc.fontSize(16)
     .fillColor(COLORS.text)
     .text(title, 50, 85);

  // Fund name
  doc.fontSize(12)
     .fillColor(COLORS.muted)
     .text(fundName, 50, 110);

  // Recipient (if individual notice)
  if (recipientName) {
    doc.moveDown(0.5);
    doc.fontSize(11)
       .fillColor(COLORS.text)
       .text(`Attention: ${recipientName}`);
  }

  // Date
  doc.fontSize(10)
     .fillColor(COLORS.muted)
     .text(
       `Notice Date: ${formatDate(date)}`,
       400,
       50,
       { align: 'right' }
     );

  // Divider
  const dividerY = recipientName ? 155 : 140;
  doc.moveTo(50, dividerY)
     .lineTo(562, dividerY)
     .stroke(COLORS.border);

  doc.y = dividerY + 10;
}

function addSectionA(doc, capitalCall, structure, currency) {
  const startY = doc.y + 10;

  // Section header
  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION A: TRANSACTION SUMMARY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const summaryData = [
    ['Capital Call Number', `#${capitalCall.callNumber}`],
    ['Call Date', formatDate(capitalCall.callDate)],
    ['Due Date', formatDate(capitalCall.dueDate)],
    ['Total Call Amount', formatCurrency(capitalCall.totalCallAmount, currency)],
    ['Purpose', capitalCall.purpose || 'Capital Deployment'],
    ['Transaction Type', capitalCall.transactionType || 'Capital Call'],
  ];

  let currentY = doc.y;
  summaryData.forEach(([label, value]) => {
    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text(label, 60, currentY);

    doc.fillColor(COLORS.text)
       .text(String(value), 250, currentY, { width: 300 });

    currentY += 18;
  });

  doc.y = currentY + 10;
}

function addLPSectionA(doc, capitalCall, allocation, structure, currency) {
  const startY = doc.y + 10;

  // Section header
  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION A: TRANSACTION SUMMARY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const commitment = allocation.commitment || allocation.allocatedAmount || 0;
  const ownershipPercent = allocation.ownershipPercent || allocation.ownership_percent || 0;
  const callAmount = allocation.allocatedAmount || allocation.callAmount || allocation.total_due || 0;

  const summaryData = [
    ['Capital Call Number', `#${capitalCall.callNumber}`],
    ['Call Date', formatDate(capitalCall.callDate)],
    ['Due Date', formatDate(capitalCall.dueDate)],
    ['Your Commitment', formatCurrency(commitment, currency)],
    ['Your Ownership %', `${ownershipPercent.toFixed(4)}%`],
    ['Your Call Amount', formatCurrency(callAmount, currency)],
    ['Purpose', capitalCall.purpose || 'Capital Deployment'],
  ];

  let currentY = doc.y;
  summaryData.forEach(([label, value]) => {
    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text(label, 60, currentY);

    doc.fillColor(COLORS.text)
       .font('Helvetica-Bold')
       .text(String(value), 250, currentY, { width: 300 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 10;
}

function addSectionB(doc, capitalCall, structure, currency) {
  if (doc.y > 600) doc.addPage();

  const startY = doc.y + 10;

  // Section header
  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION B: FEE BREAKDOWN (ILPA)', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const managementFeeRate = capitalCall.managementFeeRate || structure?.managementFee || 2.0;
  const feeBase = capitalCall.managementFeeBase || structure?.managementFeeBase || 'committed';
  const vatRate = capitalCall.vatRate || parseFloat(structure?.vatRate) || 0;

  const feeData = [
    ['Fee Calculation Base', formatFeeBase(feeBase)],
    ['Management Fee Rate', `${managementFeeRate}% per annum`],
    ['Fee Period', capitalCall.feePeriod || 'Quarterly'],
  ];

  if (capitalCall.managementFeeAmount) {
    feeData.push(['Management Fee Amount', formatCurrency(capitalCall.managementFeeAmount, currency)]);
  }

  if (vatRate > 0 && capitalCall.vatApplicable !== false) {
    feeData.push(['VAT Rate', `${vatRate}%`]);
  }

  let currentY = doc.y;
  feeData.forEach(([label, value]) => {
    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text(label, 60, currentY);

    doc.fillColor(COLORS.text)
       .text(String(value), 250, currentY);

    currentY += 18;
  });

  doc.y = currentY + 10;
}

function addLPSectionB(doc, capitalCall, allocation, structure, investor, currency) {
  if (doc.y > 600) doc.addPage();

  const startY = doc.y + 10;

  // Section header
  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION B: YOUR FEE BREAKDOWN (ILPA)', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  // Extract ILPA fee breakdown from allocation
  const principalAmount = allocation.principal_amount || allocation.allocatedAmount || 0;
  const managementFeeGross = allocation.management_fee_gross || 0;
  const managementFeeDiscount = allocation.management_fee_discount || 0;
  const managementFeeNet = allocation.management_fee_net || 0;
  const vatAmount = allocation.vat_amount || 0;
  const totalDue = allocation.total_due || allocation.allocatedAmount || 0;

  const feeData = [
    ['Principal (Capital Call)', formatCurrency(principalAmount, currency)],
  ];

  if (managementFeeGross > 0) {
    feeData.push(['Management Fee (Gross)', formatCurrency(managementFeeGross, currency)]);

    if (managementFeeDiscount > 0) {
      const discountPercent = investor?.feeDiscount || 0;
      feeData.push([`Fee Discount (${discountPercent}%)`, `-${formatCurrency(managementFeeDiscount, currency)}`]);
    }

    feeData.push(['Management Fee (Net)', formatCurrency(managementFeeNet, currency)]);
  }

  if (vatAmount > 0) {
    const vatRate = capitalCall.vatRate || 0;
    feeData.push([`VAT (${vatRate}%)`, formatCurrency(vatAmount, currency)]);
  }

  feeData.push(['', '']); // Separator
  feeData.push(['TOTAL AMOUNT DUE', formatCurrency(totalDue, currency)]);

  let currentY = doc.y;
  feeData.forEach(([label, value]) => {
    if (label === '') {
      // Divider line
      doc.moveTo(60, currentY + 5)
         .lineTo(400, currentY + 5)
         .stroke(COLORS.border);
      currentY += 15;
      return;
    }

    const isTotal = label.includes('TOTAL');

    doc.fontSize(10)
       .fillColor(isTotal ? COLORS.primary : COLORS.muted)
       .font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, 60, currentY);

    doc.fillColor(isTotal ? COLORS.primary : COLORS.text)
       .text(String(value), 300, currentY, { align: 'right', width: 150 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 10;
}

function addSectionC(doc, capitalCall, bankDetails, currency) {
  if (doc.y > 550) doc.addPage();

  const startY = doc.y + 10;

  // Section header
  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION C: PAYMENT INSTRUCTIONS', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  // Payment due notice
  doc.fontSize(11)
     .fillColor(COLORS.warning)
     .font('Helvetica-Bold')
     .text(`Payment Due: ${formatDate(capitalCall.dueDate)}`, 60, doc.y)
     .font('Helvetica');

  doc.y += 20;

  // Bank details
  const wireInstructions = bankDetails ? [
    ['Bank Name', bankDetails.bankName || '[To be configured]'],
    ['Account Name', bankDetails.accountName || '[To be configured]'],
    ['Account Number', bankDetails.accountNumber || '[To be configured]'],
    ['Routing Number', bankDetails.routingNumber || 'N/A'],
    ['SWIFT Code', bankDetails.swiftCode || 'N/A'],
    ['Reference', bankDetails.reference || `Capital Call #${capitalCall.callNumber}`],
  ] : [
    ['Bank Name', '[To be configured in Fund Settings]'],
    ['Account Number', '[To be configured in Fund Settings]'],
    ['Reference', `Capital Call #${capitalCall.callNumber}`],
  ];

  let currentY = doc.y;
  wireInstructions.forEach(([label, value]) => {
    if (value === 'N/A') return; // Skip N/A entries

    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text(label, 60, currentY);

    doc.fillColor(COLORS.text)
       .font('Helvetica-Bold')
       .text(String(value), 200, currentY, { width: 350 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 20;
}

function addSectionD(doc, capitalCall, currency) {
  if (doc.y > 500) doc.addPage();

  const startY = doc.y + 10;

  // Section header
  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION D: LP ALLOCATIONS', 60, startY + 7);

  doc.y = startY + 40;
  doc.font('Helvetica');

  // Table header
  const headers = ['LP Name', 'Commitment', 'This Call', 'Status'];
  const colWidths = [180, 120, 120, 90];
  let colX = 50;

  doc.fontSize(9)
     .font('Helvetica-Bold')
     .fillColor(COLORS.primary);

  headers.forEach((header, i) => {
    doc.text(header, colX, doc.y, { width: colWidths[i] });
    colX += colWidths[i];
  });

  // Header underline
  doc.moveTo(50, doc.y + 15)
     .lineTo(562, doc.y + 15)
     .stroke(COLORS.border);

  let currentY = doc.y + 22;
  doc.font('Helvetica')
     .fillColor(COLORS.text);

  const allocations = capitalCall.allocations || [];
  allocations.forEach((allocation, index) => {
    if (currentY > 700) {
      doc.addPage();
      currentY = 50;
    }

    colX = 50;
    const investorName = allocation.investorName || allocation.investor_name || 'Unknown';
    const commitment = allocation.commitment || allocation.allocatedAmount || 0;
    const callAmount = allocation.total_due || allocation.allocatedAmount || 0;
    const status = allocation.status || 'Pending';

    const rowData = [
      investorName.substring(0, 30),
      formatCurrency(commitment, currency),
      formatCurrency(callAmount, currency),
      status
    ];

    doc.fontSize(9);
    rowData.forEach((value, i) => {
      doc.text(value, colX, currentY, { width: colWidths[i] });
      colX += colWidths[i];
    });

    currentY += 16;
  });

  doc.y = currentY + 10;
}

function addLPSectionD(doc, allocation, currency) {
  if (doc.y > 550) doc.addPage();

  const startY = doc.y + 10;

  // Section header
  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION D: YOUR BALANCE SUMMARY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const commitment = allocation.commitment || allocation.allocatedAmount || 0;
  const callAmount = allocation.total_due || allocation.allocatedAmount || 0;
  const calledToDate = allocation.calledCapitalToDate || callAmount;
  const uncalled = allocation.uncalledCapital || (commitment - calledToDate);
  const previouslyCalled = calledToDate - callAmount;

  const balanceData = [
    ['Total Commitment', formatCurrency(commitment, currency)],
    ['Previously Called', formatCurrency(previouslyCalled, currency)],
    ['This Capital Call', formatCurrency(callAmount, currency)],
    ['', ''],
    ['Total Called to Date', formatCurrency(calledToDate, currency)],
    ['Remaining Unfunded', formatCurrency(uncalled, currency)],
  ];

  let currentY = doc.y;
  balanceData.forEach(([label, value]) => {
    if (label === '') {
      doc.moveTo(60, currentY + 5)
         .lineTo(350, currentY + 5)
         .stroke(COLORS.border);
      currentY += 15;
      return;
    }

    const isHighlight = label.includes('Remaining') || label.includes('Total Called');

    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .font(isHighlight ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, 60, currentY);

    doc.fillColor(isHighlight ? COLORS.primary : COLORS.text)
       .text(String(value), 250, currentY, { width: 100, align: 'right' })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 20;
}

function addDistributionSummary(doc, distribution, structure, currency) {
  const startY = doc.y + 10;

  // Section header - Transaction Summary
  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION A: DISTRIBUTION SUMMARY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const totalAmount = distribution.totalAmount || distribution.totalDistributionAmount || 0;

  const summaryData = [
    ['Distribution Number', `#${distribution.distributionNumber}`],
    ['Distribution Date', formatDate(distribution.distributionDate)],
    ['Total Distribution', formatCurrency(totalAmount, currency)],
    ['Source', distribution.source || 'Operating Income'],
    ['Status', distribution.status || 'Pending'],
  ];

  let currentY = doc.y;
  summaryData.forEach(([label, value]) => {
    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text(label, 60, currentY);

    doc.fillColor(COLORS.text)
       .text(String(value), 250, currentY, { width: 300 });

    currentY += 18;
  });

  doc.y = currentY + 20;

  // Section B: Source Breakdown (if available)
  if (distribution.sourceEquityGain || distribution.sourceDebtInterest || distribution.sourceDebtPrincipal || distribution.sourceOther) {
    addDistributionSourceBreakdown(doc, distribution, currency);
  }

  // Section C: Waterfall Breakdown (if waterfall applied)
  if (distribution.waterfallApplied) {
    addDistributionWaterfallBreakdown(doc, distribution, currency);
  }

  // Section D: LP Allocations (if available)
  if (distribution.allocations && distribution.allocations.length > 0) {
    addDistributionAllocations(doc, distribution, currency);
  }
}

function addDistributionSourceBreakdown(doc, distribution, currency) {
  if (doc.y > 550) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION B: SOURCE BREAKDOWN (ILPA)', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const sourceData = [];

  if (distribution.sourceEquityGain) {
    sourceData.push(['Equity Gain / Capital Appreciation', formatCurrency(distribution.sourceEquityGain, currency)]);
  }
  if (distribution.sourceDebtInterest) {
    sourceData.push(['Debt Interest / Income', formatCurrency(distribution.sourceDebtInterest, currency)]);
  }
  if (distribution.sourceDebtPrincipal) {
    sourceData.push(['Debt Principal Return', formatCurrency(distribution.sourceDebtPrincipal, currency)]);
  }
  if (distribution.sourceOther) {
    sourceData.push(['Other Income', formatCurrency(distribution.sourceOther, currency)]);
  }

  const totalAmount = distribution.totalAmount || distribution.totalDistributionAmount || 0;
  sourceData.push(['', '']);
  sourceData.push(['TOTAL', formatCurrency(totalAmount, currency)]);

  let currentY = doc.y;
  sourceData.forEach(([label, value]) => {
    if (label === '') {
      doc.moveTo(60, currentY + 5)
         .lineTo(350, currentY + 5)
         .stroke(COLORS.border);
      currentY += 15;
      return;
    }

    const isTotal = label === 'TOTAL';

    doc.fontSize(10)
       .fillColor(isTotal ? COLORS.primary : COLORS.muted)
       .font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, 60, currentY);

    doc.fillColor(isTotal ? COLORS.primary : COLORS.text)
       .text(String(value), 300, currentY, { align: 'right', width: 100 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 20;
}

function addDistributionWaterfallBreakdown(doc, distribution, currency) {
  if (doc.y > 500) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION C: WATERFALL BREAKDOWN', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const waterfallData = [
    ['Tier 1: Return of Capital', formatCurrency(distribution.tier1Amount || 0, currency)],
    ['Tier 2: Preferred Return', formatCurrency(distribution.tier2Amount || 0, currency)],
    ['Tier 3: GP Catch-Up', formatCurrency(distribution.tier3Amount || 0, currency)],
    ['Tier 4: Carried Interest Split', formatCurrency(distribution.tier4Amount || 0, currency)],
    ['', ''],
    ['LP Total Proceeds', formatCurrency(distribution.lpTotalAmount || 0, currency)],
    ['GP Total Proceeds', formatCurrency(distribution.gpTotalAmount || 0, currency)],
  ];

  if (distribution.managementFeeAmount) {
    waterfallData.push(['Management Fee', formatCurrency(distribution.managementFeeAmount, currency)]);
  }

  let currentY = doc.y;
  waterfallData.forEach(([label, value]) => {
    if (label === '') {
      doc.moveTo(60, currentY + 5)
         .lineTo(350, currentY + 5)
         .stroke(COLORS.border);
      currentY += 15;
      return;
    }

    const isHighlight = label.includes('LP Total') || label.includes('GP Total');

    doc.fontSize(10)
       .fillColor(isHighlight ? COLORS.primary : COLORS.muted)
       .font(isHighlight ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, 60, currentY);

    doc.fillColor(isHighlight ? COLORS.primary : COLORS.text)
       .text(String(value), 300, currentY, { align: 'right', width: 100 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 20;
}

function addDistributionAllocations(doc, distribution, currency) {
  if (doc.y > 450) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION D: LP ALLOCATIONS', 60, startY + 7);

  doc.y = startY + 40;
  doc.font('Helvetica');

  // Table header
  const headers = ['LP Name', 'Ownership %', 'Distribution Amount', 'Status'];
  const colWidths = [180, 100, 140, 90];
  let colX = 50;

  doc.fontSize(9)
     .font('Helvetica-Bold')
     .fillColor(COLORS.primary);

  headers.forEach((header, i) => {
    doc.text(header, colX, doc.y, { width: colWidths[i] });
    colX += colWidths[i];
  });

  // Header underline
  doc.moveTo(50, doc.y + 15)
     .lineTo(562, doc.y + 15)
     .stroke(COLORS.border);

  let currentY = doc.y + 22;
  doc.font('Helvetica')
     .fillColor(COLORS.text);

  const allocations = distribution.allocations || [];
  allocations.forEach((allocation) => {
    if (currentY > 700) {
      doc.addPage();
      currentY = 50;
    }

    colX = 50;
    const investorName = allocation.investorName || allocation.investor_name || allocation.user?.name || 'Unknown';
    const ownershipPercent = allocation.ownership_percent || allocation.ownershipPercent || 0;
    const distributionAmount = allocation.allocated_amount || allocation.distributionAmount || 0;
    const status = allocation.status || 'Pending';

    const rowData = [
      investorName.substring(0, 30),
      `${ownershipPercent.toFixed(2)}%`,
      formatCurrency(distributionAmount, currency),
      status
    ];

    doc.fontSize(9);
    rowData.forEach((value, i) => {
      doc.text(value, colX, currentY, { width: colWidths[i] });
      colX += colWidths[i];
    });

    currentY += 16;
  });

  doc.y = currentY + 10;
}

function addNoticeFooter(doc, firmName) {
  const pages = doc.bufferedPageRange();

  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);

    // Footer line
    doc.moveTo(50, 730)
       .lineTo(562, 730)
       .stroke(COLORS.border);

    // ILPA compliance note
    doc.fontSize(8)
       .fillColor(COLORS.muted)
       .text(
         'This notice is compliant with ILPA Capital Call & Distribution Template v2.0 standards.',
         50,
         740
       );

    // Generated by
    doc.text(`Generated by ${firmName}`, 50, 752);

    // Page number
    doc.text(
      `Page ${i + 1} of ${pages.count}`,
      0,
      752,
      { align: 'center', width: 612 }
    );

    // Date
    doc.text(
      new Date().toLocaleDateString('en-US'),
      0,
      752,
      { align: 'right', width: 562 }
    );
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatCurrency(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatFeeBase(base) {
  switch (base) {
    case 'committed':
      return 'Committed Capital';
    case 'invested':
      return 'Invested Capital';
    case 'nic_plus_unfunded':
      return 'NIC + Unfunded (ILPA)';
    default:
      return String(base);
  }
}

// ============================================================================
// INDIVIDUAL DISTRIBUTION NOTICE GENERATOR (PER-LP)
// ============================================================================

/**
 * Generate Individual LP Distribution Notice PDF
 * Personalized distribution notice with investor-specific waterfall breakdown,
 * source classification, and balance impact.
 *
 * @param {Object} distribution - Distribution data
 * @param {Object} allocation - Investor-specific allocation data
 * @param {Object} structure - Fund/structure data
 * @param {Object} investor - Investor profile data
 * @param {Object} options - Generation options
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateIndividualDistributionNoticePDF(distribution, allocation, structure, investor, options = {}) {
  const { firmName = 'Investment Manager' } = options;
  const currency = distribution.currency || structure?.currency || 'USD';

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
        autoFirstPage: true
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header with LP name
      addNoticeHeader(doc, {
        firmName,
        title: `DISTRIBUTION NOTICE #${distribution.distributionNumber}`,
        fundName: structure?.name || distribution.fundName,
        date: distribution.distributionDate,
        recipientName: investor?.name || allocation.investorName || allocation.user?.name
      });

      // Section A: Your Distribution Summary
      addDistLPSectionA(doc, distribution, allocation, structure, currency);

      // Section B: Source Breakdown
      addDistLPSectionB(doc, distribution, allocation, currency);

      // Section C: Waterfall Details (if applied)
      if (distribution.waterfallApplied) {
        addDistLPSectionC(doc, distribution, allocation, currency);
      }

      // Section D: Balance Impact
      addDistLPSectionD(doc, distribution, allocation, currency);

      // Footer
      addNoticeFooter(doc, firmName);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function addDistLPSectionA(doc, distribution, allocation, structure, currency) {
  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION A: YOUR DISTRIBUTION SUMMARY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const ownershipPercent = allocation.ownership_percent || allocation.ownershipPercent || 0;
  const distributionAmount = allocation.allocated_amount || allocation.distributionAmount || allocation.finalAllocation || 0;
  const commitment = allocation.commitment || 0;

  const summaryData = [
    ['Distribution Number', `#${distribution.distributionNumber}`],
    ['Distribution Date', formatDate(distribution.distributionDate)],
    ['Fund Name', structure?.name || distribution.fundName || 'N/A'],
    ['Your Commitment', formatCurrency(commitment, currency)],
    ['Your Ownership %', `${ownershipPercent.toFixed(4)}%`],
    ['Your Distribution Amount', formatCurrency(distributionAmount, currency)],
    ['Source', distribution.source || 'Operating Income'],
    ['Status', allocation.status || distribution.status || 'Pending'],
  ];

  let currentY = doc.y;
  summaryData.forEach(([label, value]) => {
    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text(label, 60, currentY);

    const isHighlight = label.includes('Distribution Amount');
    doc.fillColor(isHighlight ? COLORS.success : COLORS.text)
       .font(isHighlight ? 'Helvetica-Bold' : 'Helvetica')
       .text(String(value), 250, currentY, { width: 300 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 10;
}

function addDistLPSectionB(doc, distribution, allocation, currency) {
  if (doc.y > 550) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION B: SOURCE BREAKDOWN (ILPA)', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const ownershipPercent = allocation.ownership_percent || allocation.ownershipPercent || 0;
  const ownershipFraction = ownershipPercent / 100;

  // Pro-rata source breakdown for the investor
  const totalEquityGain = distribution.sourceEquityGain || 0;
  const totalDebtInterest = distribution.sourceDebtInterest || 0;
  const totalDebtPrincipal = distribution.sourceDebtPrincipal || 0;
  const totalOther = distribution.sourceOther || 0;

  const lpEquityGain = totalEquityGain * ownershipFraction;
  const lpDebtInterest = totalDebtInterest * ownershipFraction;
  const lpDebtPrincipal = totalDebtPrincipal * ownershipFraction;
  const lpOther = totalOther * ownershipFraction;
  const distributionAmount = allocation.allocated_amount || allocation.distributionAmount || allocation.finalAllocation || 0;

  const sourceData = [];

  // Return of Capital classification
  const returnOfCapital = allocation.return_of_capital || (lpDebtPrincipal > 0 ? lpDebtPrincipal : 0);
  if (returnOfCapital > 0) {
    sourceData.push(['Return of Capital', formatCurrency(returnOfCapital, currency)]);
  }

  // Income classification
  const incomeAmount = allocation.income_amount || lpDebtInterest;
  if (incomeAmount > 0) {
    sourceData.push(['Income (Interest / Dividends)', formatCurrency(incomeAmount, currency)]);
  }

  // Capital Gain classification
  const capitalGain = allocation.capital_gain || lpEquityGain;
  if (capitalGain > 0) {
    sourceData.push(['Capital Gain', formatCurrency(capitalGain, currency)]);
  }

  // Other income
  if (lpOther > 0) {
    sourceData.push(['Other Income', formatCurrency(lpOther, currency)]);
  }

  // If no breakdown available, show total
  if (sourceData.length === 0) {
    sourceData.push(['Distribution Proceeds', formatCurrency(distributionAmount, currency)]);
  }

  sourceData.push(['', '']);
  sourceData.push(['YOUR TOTAL DISTRIBUTION', formatCurrency(distributionAmount, currency)]);

  let currentY = doc.y;
  sourceData.forEach(([label, value]) => {
    if (label === '') {
      doc.moveTo(60, currentY + 5)
         .lineTo(400, currentY + 5)
         .stroke(COLORS.border);
      currentY += 15;
      return;
    }

    const isTotal = label.includes('TOTAL');

    doc.fontSize(10)
       .fillColor(isTotal ? COLORS.primary : COLORS.muted)
       .font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, 60, currentY);

    doc.fillColor(isTotal ? COLORS.primary : COLORS.text)
       .text(String(value), 300, currentY, { align: 'right', width: 150 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 20;
}

function addDistLPSectionC(doc, distribution, allocation, currency) {
  if (doc.y > 500) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION C: WATERFALL DETAILS', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const ownershipPercent = allocation.ownership_percent || allocation.ownershipPercent || 0;
  const ownershipFraction = ownershipPercent / 100;
  const distributionAmount = allocation.allocated_amount || allocation.distributionAmount || allocation.finalAllocation || 0;

  // Pro-rata waterfall tiers for this LP
  const waterfallData = [
    ['Tier 1: Return of Capital', formatCurrency((distribution.tier1Amount || 0) * ownershipFraction, currency)],
    ['Tier 2: Preferred Return', formatCurrency((distribution.tier2Amount || 0) * ownershipFraction, currency)],
    ['Tier 3: GP Catch-Up', formatCurrency((distribution.tier3Amount || 0) * ownershipFraction, currency)],
    ['Tier 4: Carried Interest Split', formatCurrency((distribution.tier4Amount || 0) * ownershipFraction, currency)],
    ['', ''],
    ['Your LP Proceeds', formatCurrency(distributionAmount, currency)],
  ];

  // Show carried interest deducted
  const gpTotal = distribution.gpTotalAmount || 0;
  const carriedInterestLP = gpTotal * ownershipFraction;
  if (carriedInterestLP > 0) {
    waterfallData.push(['Carried Interest Deducted', `-${formatCurrency(carriedInterestLP, currency)}`]);
  }

  let currentY = doc.y;
  waterfallData.forEach(([label, value]) => {
    if (label === '') {
      doc.moveTo(60, currentY + 5)
         .lineTo(400, currentY + 5)
         .stroke(COLORS.border);
      currentY += 15;
      return;
    }

    const isHighlight = label.includes('LP Proceeds') || label.includes('Carried Interest');

    doc.fontSize(10)
       .fillColor(isHighlight ? COLORS.primary : COLORS.muted)
       .font(isHighlight ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, 60, currentY);

    doc.fillColor(isHighlight ? COLORS.primary : COLORS.text)
       .text(String(value), 300, currentY, { align: 'right', width: 150 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 20;
}

function addDistLPSectionD(doc, distribution, allocation, currency) {
  if (doc.y > 500) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION D: BALANCE IMPACT', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const commitment = allocation.commitment || 0;
  const distributionAmount = allocation.allocated_amount || allocation.distributionAmount || allocation.finalAllocation || 0;
  const priorDistributions = allocation.prior_distributions || allocation.distributionsToDate || 0;
  const totalDistributions = priorDistributions + distributionAmount;
  const calledCapital = allocation.calledCapitalToDate || allocation.called_capital || 0;
  const netAccountValue = calledCapital - totalDistributions;

  const balanceData = [
    ['Total Commitment', formatCurrency(commitment, currency)],
    ['Called Capital to Date', formatCurrency(calledCapital, currency)],
    ['', ''],
    ['Prior Distributions', formatCurrency(priorDistributions, currency)],
    ['This Distribution', formatCurrency(distributionAmount, currency)],
    ['', ''],
    ['Total Distributions to Date', formatCurrency(totalDistributions, currency)],
    ['Net Capital Account', formatCurrency(netAccountValue, currency)],
  ];

  let currentY = doc.y;
  balanceData.forEach(([label, value]) => {
    if (label === '') {
      doc.moveTo(60, currentY + 5)
         .lineTo(400, currentY + 5)
         .stroke(COLORS.border);
      currentY += 15;
      return;
    }

    const isHighlight = label.includes('Total Distributions') || label.includes('Net Capital');

    doc.fontSize(10)
       .fillColor(isHighlight ? COLORS.primary : COLORS.muted)
       .font(isHighlight ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, 60, currentY);

    doc.fillColor(isHighlight ? COLORS.primary : COLORS.text)
       .text(String(value), 250, currentY, { width: 150, align: 'right' })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 20;
}

module.exports = {
  generateCapitalCallNoticePDF,
  generateIndividualLPNoticePDF,
  generateDistributionNoticePDF,
  generateIndividualDistributionNoticePDF
};
