/**
 * ILPA Report PDF Generator
 *
 * Generates PDF reports for ILPA Performance, Quarterly, and CC&D reports.
 */

const PDFDocument = require('pdfkit');

const COLORS = {
  primary: '#2D1B69',
  secondary: '#6B21A8',
  accent: '#EDE9FE',
  text: '#1F2937',
  muted: '#6B7280',
  border: '#E5E7EB',
  success: '#059669',
  warning: '#D97706',
};

/**
 * Generate ILPA Performance Report PDF
 */
async function generatePerformanceReportPDF(reportData, structure, options = {}) {
  const { firmName = 'Investment Manager' } = options;
  const currency = structure?.currency || 'USD';

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
      addReportHeader(doc, {
        firmName,
        title: 'ILPA PERFORMANCE REPORT',
        fundName: structure?.name || 'Fund',
        date: reportData.asOfDate
      });

      // Fund Info
      addFundInfo(doc, reportData.fundInfo, currency);

      // Performance Metrics
      addPerformanceMetrics(doc, reportData.performance);

      // Capital Summary
      addCapitalSummary(doc, reportData.capitalSummary, currency);

      // Cash Flow Summary
      addCashFlowSummary(doc, reportData.cashFlowSummary, currency);

      // Footer
      addReportFooter(doc, firmName, 'ILPA Performance Report');

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate ILPA Quarterly Report PDF
 */
async function generateQuarterlyReportPDF(reportData, structure, options = {}) {
  const { firmName = 'Investment Manager' } = options;
  const currency = structure?.currency || 'USD';

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
      addReportHeader(doc, {
        firmName,
        title: 'ILPA QUARTERLY REPORT',
        fundName: structure?.name || 'Fund',
        date: reportData.performance?.asOfDate || reportData.quarterlyActivity?.period?.endDate
      });

      // Performance metrics
      if (reportData.performance) {
        addPerformanceMetrics(doc, reportData.performance.performance);
        addCapitalSummary(doc, reportData.performance.capitalSummary, currency);
      }

      // Quarterly Activity
      if (reportData.quarterlyActivity) {
        addQuarterlyActivity(doc, reportData.quarterlyActivity, currency);
      }

      // Footer
      addReportFooter(doc, firmName, 'ILPA Quarterly Report');

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate ILPA CC&D Report PDF
 */
async function generateCCDReportPDF(reportData, structure, options = {}) {
  const { firmName = 'Investment Manager' } = options;
  const currency = structure?.currency || 'USD';

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
      addReportHeader(doc, {
        firmName,
        title: 'CAPITAL CALL & DISTRIBUTION SUMMARY',
        fundName: structure?.name || 'Fund',
        date: new Date().toISOString().split('T')[0]
      });

      // Capital Calls Table
      addCCDCallsTable(doc, reportData.capitalCalls, currency);

      // Distributions Table
      addCCDDistributionsTable(doc, reportData.distributions, currency);

      // Net Position
      addNetPosition(doc, reportData, currency);

      // Footer
      addReportFooter(doc, firmName, 'ILPA CC&D Report');

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================================
// SECTION GENERATORS
// ============================================================================

function addReportHeader(doc, options) {
  const { firmName, title, fundName, date } = options;

  doc.fontSize(20)
     .fillColor(COLORS.primary)
     .text(firmName, 50, 50);

  doc.fontSize(16)
     .fillColor(COLORS.text)
     .text(title, 50, 85);

  doc.fontSize(12)
     .fillColor(COLORS.muted)
     .text(fundName, 50, 110);

  doc.fontSize(10)
     .fillColor(COLORS.muted)
     .text(
       `As of: ${formatDate(date)}`,
       400, 50, { align: 'right' }
     );

  doc.moveTo(50, 140)
     .lineTo(562, 140)
     .stroke(COLORS.border);

  doc.y = 150;
}

function addFundInfo(doc, fundInfo, currency) {
  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('FUND INFORMATION', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const infoData = [
    ['Fund Name', fundInfo.name || 'N/A'],
    ['Currency', fundInfo.currency || 'USD'],
    ['Vintage Year', fundInfo.vintage ? String(fundInfo.vintage) : 'N/A'],
    ['Total Commitment', formatCurrency(fundInfo.totalCommitment, currency)],
    ['Number of Investors', String(fundInfo.investorCount || 0)],
  ];

  let currentY = doc.y;
  infoData.forEach(([label, value]) => {
    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text(label, 60, currentY);

    doc.fillColor(COLORS.text)
       .text(String(value), 250, currentY, { width: 300 });

    currentY += 18;
  });

  doc.y = currentY + 10;
}

function addPerformanceMetrics(doc, performance) {
  if (doc.y > 550) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('PERFORMANCE METRICS', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  // Metrics in a grid layout
  const metrics = [
    ['Gross IRR', `${performance.grossIRR}%`],
    ['Net IRR', `${performance.netIRR}%`],
    ['Gross TVPI', `${performance.grossTVPI}x`],
    ['Net TVPI', `${performance.netTVPI}x`],
    ['DPI', `${performance.dpi}x`],
    ['RVPI', `${performance.rvpi}x`],
    ['MOIC', `${performance.moic}x`],
  ];

  let currentY = doc.y;
  metrics.forEach(([label, value]) => {
    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text(label, 60, currentY);

    const isPositive = parseFloat(value) >= 0;
    doc.fillColor(isPositive ? COLORS.success : COLORS.warning)
       .font('Helvetica-Bold')
       .text(String(value), 250, currentY, { width: 100 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 10;
}

function addCapitalSummary(doc, capitalSummary, currency) {
  if (doc.y > 500) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('CAPITAL SUMMARY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const summaryData = [
    ['Total Commitment', formatCurrency(capitalSummary.totalCommitment, currency)],
    ['Capital Called', formatCurrency(capitalSummary.totalCapitalCalled, currency)],
    ['Paid-In Ratio', `${capitalSummary.paidInRatio}%`],
    ['Total Distributed', formatCurrency(capitalSummary.totalDistributed, currency)],
    ['Total Fees', formatCurrency(capitalSummary.totalFees, currency)],
    ['Uncalled Capital', formatCurrency(capitalSummary.uncalled, currency)],
    ['', ''],
    ['Current NAV', formatCurrency(capitalSummary.currentNAV, currency)],
    ['Total Value', formatCurrency(capitalSummary.totalValue, currency)],
  ];

  let currentY = doc.y;
  summaryData.forEach(([label, value]) => {
    if (label === '') {
      doc.moveTo(60, currentY + 5)
         .lineTo(400, currentY + 5)
         .stroke(COLORS.border);
      currentY += 15;
      return;
    }

    const isHighlight = label.includes('NAV') || label.includes('Total Value');

    doc.fontSize(10)
       .fillColor(isHighlight ? COLORS.primary : COLORS.muted)
       .font(isHighlight ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, 60, currentY);

    doc.fillColor(isHighlight ? COLORS.primary : COLORS.text)
       .text(String(value), 300, currentY, { align: 'right', width: 150 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 10;
}

function addCashFlowSummary(doc, cashFlowSummary, currency) {
  if (doc.y > 600) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('CASH FLOW SUMMARY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const flowData = [
    ['Total Capital Calls', String(cashFlowSummary.totalCalls)],
    ['Total Distributions', String(cashFlowSummary.totalDistributions)],
    ['Unrealized Gain', formatCurrency(cashFlowSummary.unrealizedGain, currency)],
    ['Realized Gain', formatCurrency(cashFlowSummary.realizedGain, currency)],
  ];

  let currentY = doc.y;
  flowData.forEach(([label, value]) => {
    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text(label, 60, currentY);

    doc.fillColor(COLORS.text)
       .text(String(value), 300, currentY, { align: 'right', width: 150 });

    currentY += 18;
  });

  doc.y = currentY + 10;
}

function addQuarterlyActivity(doc, activity, currency) {
  if (doc.y > 400) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('QUARTERLY ACTIVITY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  doc.fontSize(10)
     .fillColor(COLORS.muted)
     .text(`Period: ${formatDate(activity.period.startDate)} - ${formatDate(activity.period.endDate)}`, 60, doc.y);

  doc.y += 20;

  // Capital calls this quarter
  if (activity.capitalCalls.count > 0) {
    doc.fontSize(11)
       .fillColor(COLORS.primary)
       .font('Helvetica-Bold')
       .text(`Capital Calls: ${activity.capitalCalls.count} (${formatCurrency(activity.capitalCalls.totalAmount, currency)})`, 60, doc.y);
    doc.y += 18;
    doc.font('Helvetica');

    activity.capitalCalls.calls.forEach(c => {
      doc.fontSize(9)
         .fillColor(COLORS.text)
         .text(`#${c.callNumber} - ${formatDateShort(c.callDate)} - ${formatCurrency(c.amount, currency)} - ${c.purpose}`, 80, doc.y);
      doc.y += 14;
    });

    doc.y += 5;
  }

  // Distributions this quarter
  if (activity.distributions.count > 0) {
    doc.fontSize(11)
       .fillColor(COLORS.primary)
       .font('Helvetica-Bold')
       .text(`Distributions: ${activity.distributions.count} (${formatCurrency(activity.distributions.totalAmount, currency)})`, 60, doc.y);
    doc.y += 18;
    doc.font('Helvetica');

    activity.distributions.distributions.forEach(d => {
      doc.fontSize(9)
         .fillColor(COLORS.text)
         .text(`#${d.distributionNumber} - ${formatDateShort(d.distributionDate)} - ${formatCurrency(d.amount, currency)} - ${d.source}`, 80, doc.y);
      doc.y += 14;
    });

    doc.y += 5;
  }

  // Net cash flow
  doc.fontSize(10)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text(`Net Cash Flow: ${formatCurrency(activity.netCashFlow, currency)}`, 60, doc.y);
  doc.font('Helvetica');
  doc.y += 20;
}

function addCCDCallsTable(doc, capitalCalls, currency) {
  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('CAPITAL CALLS', 60, startY + 7);

  doc.y = startY + 40;
  doc.font('Helvetica');

  if (!capitalCalls || capitalCalls.count === 0) {
    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text('No capital calls recorded.', 60, doc.y);
    doc.y += 20;
    return;
  }

  const headers = ['Call #', 'Date', 'Amount', 'Purpose', 'Cumulative'];
  const colWidths = [60, 90, 100, 150, 100];
  let colX = 55;

  doc.fontSize(8)
     .font('Helvetica-Bold')
     .fillColor(COLORS.primary);

  headers.forEach((header, i) => {
    doc.text(header, colX, doc.y, { width: colWidths[i] });
    colX += colWidths[i];
  });

  doc.moveTo(50, doc.y + 12)
     .lineTo(562, doc.y + 12)
     .stroke(COLORS.border);

  let currentY = doc.y + 18;
  doc.font('Helvetica').fillColor(COLORS.text);

  capitalCalls.items.forEach(c => {
    if (currentY > 700) {
      doc.addPage();
      currentY = 50;
    }

    colX = 55;
    const rowData = [
      `#${c.callNumber}`,
      formatDateShort(c.callDate),
      formatCurrency(c.amount, currency),
      (c.purpose || '').substring(0, 25),
      formatCurrency(c.cumulativeCalled, currency)
    ];

    doc.fontSize(8);
    rowData.forEach((value, i) => {
      doc.text(value, colX, currentY, { width: colWidths[i] });
      colX += colWidths[i];
    });

    currentY += 14;
  });

  // Total
  doc.moveTo(55, currentY + 2)
     .lineTo(562, currentY + 2)
     .stroke(COLORS.border);
  currentY += 8;

  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary);
  doc.text(`Total: ${capitalCalls.count} calls`, 55, currentY);
  doc.text(formatCurrency(capitalCalls.totalAmount, currency), 205, currentY, { width: 100 });
  doc.font('Helvetica');

  doc.y = currentY + 20;
}

function addCCDDistributionsTable(doc, distributions, currency) {
  if (doc.y > 450) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('DISTRIBUTIONS', 60, startY + 7);

  doc.y = startY + 40;
  doc.font('Helvetica');

  if (!distributions || distributions.count === 0) {
    doc.fontSize(10)
       .fillColor(COLORS.muted)
       .text('No distributions recorded.', 60, doc.y);
    doc.y += 20;
    return;
  }

  const headers = ['Dist #', 'Date', 'Amount', 'Source', 'Cumulative'];
  const colWidths = [60, 90, 100, 150, 100];
  let colX = 55;

  doc.fontSize(8)
     .font('Helvetica-Bold')
     .fillColor(COLORS.primary);

  headers.forEach((header, i) => {
    doc.text(header, colX, doc.y, { width: colWidths[i] });
    colX += colWidths[i];
  });

  doc.moveTo(50, doc.y + 12)
     .lineTo(562, doc.y + 12)
     .stroke(COLORS.border);

  let currentY = doc.y + 18;
  doc.font('Helvetica').fillColor(COLORS.text);

  distributions.items.forEach(d => {
    if (currentY > 700) {
      doc.addPage();
      currentY = 50;
    }

    colX = 55;
    const rowData = [
      `#${d.distributionNumber}`,
      formatDateShort(d.distributionDate),
      formatCurrency(d.amount, currency),
      (d.source || '').substring(0, 25),
      formatCurrency(d.cumulativeDistributed, currency)
    ];

    doc.fontSize(8);
    rowData.forEach((value, i) => {
      doc.text(value, colX, currentY, { width: colWidths[i] });
      colX += colWidths[i];
    });

    currentY += 14;
  });

  // Total
  doc.moveTo(55, currentY + 2)
     .lineTo(562, currentY + 2)
     .stroke(COLORS.border);
  currentY += 8;

  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary);
  doc.text(`Total: ${distributions.count} distributions`, 55, currentY);
  doc.text(formatCurrency(distributions.totalAmount, currency), 205, currentY, { width: 100 });
  doc.font('Helvetica');

  doc.y = currentY + 20;
}

function addNetPosition(doc, reportData, currency) {
  if (doc.y > 650) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('NET POSITION', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const netData = [
    ['Total Capital Called', formatCurrency(reportData.capitalCalls.totalAmount, currency)],
    ['Total Distributed', formatCurrency(reportData.distributions.totalAmount, currency)],
    ['', ''],
    ['Net Position', formatCurrency(reportData.netPosition, currency)],
  ];

  let currentY = doc.y;
  netData.forEach(([label, value]) => {
    if (label === '') {
      doc.moveTo(60, currentY + 5)
         .lineTo(350, currentY + 5)
         .stroke(COLORS.border);
      currentY += 15;
      return;
    }

    const isHighlight = label.includes('Net Position');

    doc.fontSize(10)
       .fillColor(isHighlight ? COLORS.primary : COLORS.muted)
       .font(isHighlight ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, 60, currentY);

    doc.fillColor(isHighlight ? COLORS.primary : COLORS.text)
       .text(String(value), 300, currentY, { align: 'right', width: 100 })
       .font('Helvetica');

    currentY += 18;
  });

  doc.y = currentY + 10;
}

function addReportFooter(doc, firmName, reportType) {
  const pages = doc.bufferedPageRange();

  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);

    doc.moveTo(50, 730)
       .lineTo(562, 730)
       .stroke(COLORS.border);

    doc.fontSize(8)
       .fillColor(COLORS.muted)
       .text(
         `${reportType} generated in accordance with ILPA reporting standards.`,
         50, 740
       );

    doc.text(`Generated by ${firmName}`, 50, 752);

    doc.text(
      `Page ${i + 1} of ${pages.count}`,
      0, 752, { align: 'center', width: 612 }
    );

    doc.text(
      new Date().toLocaleDateString('en-US'),
      0, 752, { align: 'right', width: 562 }
    );
  }
}

// Utilities
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

function formatDateShort(dateString) {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

module.exports = {
  generatePerformanceReportPDF,
  generateQuarterlyReportPDF,
  generateCCDReportPDF
};
