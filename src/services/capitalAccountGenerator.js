/**
 * Capital Account Statement Generator
 *
 * Generates ILPA-compliant Capital Account Statement PDFs.
 * Shows opening/closing balances, capital call activity,
 * distribution activity, fee summary, and balance continuity.
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
 * Generate Capital Account Statement PDF
 * @param {Object} investor - Investor profile data
 * @param {Object} structure - Fund/structure data
 * @param {Array} callAllocations - Capital call allocations for this investor
 * @param {Array} distAllocations - Distribution allocations for this investor
 * @param {Object} period - { startDate, endDate }
 * @param {Object} options - { firmName, currency }
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateCapitalAccountStatementPDF(investor, structure, callAllocations, distAllocations, period, options = {}) {
  const { firmName = 'Investment Manager' } = options;
  const currency = structure?.currency || options.currency || 'USD';

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
      addStatementHeader(doc, {
        firmName,
        investorName: investor?.name || 'Investor',
        fundName: structure?.name || 'Fund',
        startDate: period.startDate,
        endDate: period.endDate
      });

      // Calculate period data
      const periodCalls = callAllocations.filter(a => {
        const callDate = a.capital_call?.callDate || a.callDate;
        return callDate >= period.startDate && callDate <= period.endDate;
      });

      const periodDists = distAllocations.filter(a => {
        const distDate = a.distribution?.distributionDate || a.distributionDate;
        return distDate >= period.startDate && distDate <= period.endDate;
      });

      const priorCalls = callAllocations.filter(a => {
        const callDate = a.capital_call?.callDate || a.callDate;
        return callDate < period.startDate;
      });

      const priorDists = distAllocations.filter(a => {
        const distDate = a.distribution?.distributionDate || a.distributionDate;
        return distDate < period.startDate;
      });

      const commitment = investor?.commitment || investor?.totalCommitment || 0;
      const priorCalledTotal = priorCalls.reduce((sum, a) => sum + (a.total_due || a.allocatedAmount || 0), 0);
      const priorDistTotal = priorDists.reduce((sum, a) => sum + (a.allocated_amount || a.distributionAmount || 0), 0);
      const priorFees = priorCalls.reduce((sum, a) => sum + (a.management_fee_net || 0), 0);

      const periodCallTotal = periodCalls.reduce((sum, a) => sum + (a.total_due || a.allocatedAmount || 0), 0);
      const periodDistTotal = periodDists.reduce((sum, a) => sum + (a.allocated_amount || a.distributionAmount || 0), 0);
      const periodFees = periodCalls.reduce((sum, a) => sum + (a.management_fee_net || 0), 0);
      const periodVAT = periodCalls.reduce((sum, a) => sum + (a.vat_amount || 0), 0);

      const openingBalance = priorCalledTotal - priorDistTotal;
      const closingBalance = openingBalance + periodCallTotal - periodDistTotal;

      const totalCalledToDate = priorCalledTotal + periodCallTotal;
      const totalDistToDate = priorDistTotal + periodDistTotal;

      // Section A: Account Summary
      addAccountSummary(doc, {
        openingBalance,
        periodCalls: periodCallTotal,
        periodDistributions: periodDistTotal,
        periodFees,
        closingBalance,
        currency
      });

      // Section B: Capital Call Activity
      if (periodCalls.length > 0) {
        addCapitalCallActivity(doc, periodCalls, currency);
      }

      // Section C: Distribution Activity
      if (periodDists.length > 0) {
        addDistributionActivity(doc, periodDists, currency);
      }

      // Section D: Fee Summary
      addFeeSummary(doc, periodCalls, periodFees, periodVAT, currency);

      // Section E: Balance Continuity
      addBalanceContinuity(doc, {
        commitment,
        totalCalledToDate,
        uncalled: commitment - totalCalledToDate,
        totalDistToDate,
        netAccountValue: totalCalledToDate - totalDistToDate,
        currency
      });

      // Footer
      addStatementFooter(doc, firmName);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function addStatementHeader(doc, options) {
  const { firmName, investorName, fundName, startDate, endDate } = options;

  doc.fontSize(20)
     .fillColor(COLORS.primary)
     .text(firmName, 50, 50);

  doc.fontSize(16)
     .fillColor(COLORS.text)
     .text('CAPITAL ACCOUNT STATEMENT', 50, 85);

  doc.fontSize(12)
     .fillColor(COLORS.muted)
     .text(fundName, 50, 110);

  doc.moveDown(0.5);
  doc.fontSize(11)
     .fillColor(COLORS.text)
     .text(`Investor: ${investorName}`);

  doc.fontSize(10)
     .fillColor(COLORS.muted)
     .text(
       `Statement Period: ${formatDate(startDate)} - ${formatDate(endDate)}`,
       400, 50, { align: 'right' }
     );

  doc.moveTo(50, 155)
     .lineTo(562, 155)
     .stroke(COLORS.border);

  doc.y = 165;
}

function addAccountSummary(doc, data) {
  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION A: ACCOUNT SUMMARY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const summaryData = [
    ['Opening Balance', formatCurrency(data.openingBalance, data.currency)],
    ['Capital Calls (This Period)', `+ ${formatCurrency(data.periodCalls, data.currency)}`],
    ['Distributions (This Period)', `- ${formatCurrency(data.periodDistributions, data.currency)}`],
    ['Management Fees (This Period)', formatCurrency(data.periodFees, data.currency)],
    ['', ''],
    ['Closing Balance', formatCurrency(data.closingBalance, data.currency)],
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

    const isTotal = label.includes('Closing');

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

function addCapitalCallActivity(doc, callAllocations, currency) {
  if (doc.y > 500) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION B: CAPITAL CALL ACTIVITY', 60, startY + 7);

  doc.y = startY + 40;
  doc.font('Helvetica');

  // Table header
  const headers = ['Date', 'Call #', 'Principal', 'Mgmt Fee', 'VAT', 'Total'];
  const colWidths = [80, 60, 90, 80, 70, 90];
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
  doc.font('Helvetica')
     .fillColor(COLORS.text);

  let totalPrincipal = 0, totalFee = 0, totalVAT = 0, totalDue = 0;

  callAllocations.forEach((alloc) => {
    if (currentY > 700) {
      doc.addPage();
      currentY = 50;
    }

    const callDate = alloc.capital_call?.callDate || alloc.callDate || '';
    const callNumber = alloc.capital_call?.callNumber || alloc.callNumber || '';
    const principal = alloc.principal_amount || alloc.allocatedAmount || 0;
    const fee = alloc.management_fee_net || 0;
    const vat = alloc.vat_amount || 0;
    const total = alloc.total_due || alloc.allocatedAmount || 0;

    totalPrincipal += principal;
    totalFee += fee;
    totalVAT += vat;
    totalDue += total;

    colX = 55;
    const rowData = [
      formatDateShort(callDate),
      `#${callNumber}`,
      formatCurrency(principal, currency),
      formatCurrency(fee, currency),
      formatCurrency(vat, currency),
      formatCurrency(total, currency)
    ];

    doc.fontSize(8);
    rowData.forEach((value, i) => {
      doc.text(value, colX, currentY, { width: colWidths[i] });
      colX += colWidths[i];
    });

    currentY += 14;
  });

  // Totals row
  doc.moveTo(55, currentY + 2)
     .lineTo(562, currentY + 2)
     .stroke(COLORS.border);
  currentY += 8;

  colX = 55;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary);
  const totals = ['TOTAL', '', formatCurrency(totalPrincipal, currency), formatCurrency(totalFee, currency), formatCurrency(totalVAT, currency), formatCurrency(totalDue, currency)];
  totals.forEach((value, i) => {
    doc.text(value, colX, currentY, { width: colWidths[i] });
    colX += colWidths[i];
  });
  doc.font('Helvetica');

  doc.y = currentY + 20;
}

function addDistributionActivity(doc, distAllocations, currency) {
  if (doc.y > 500) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION C: DISTRIBUTION ACTIVITY', 60, startY + 7);

  doc.y = startY + 40;
  doc.font('Helvetica');

  const headers = ['Date', 'Dist #', 'ROC', 'Income', 'Cap. Gain', 'Total'];
  const colWidths = [80, 60, 85, 85, 85, 90];
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
  doc.font('Helvetica')
     .fillColor(COLORS.text);

  let totalROC = 0, totalIncome = 0, totalGain = 0, totalDist = 0;

  distAllocations.forEach((alloc) => {
    if (currentY > 700) {
      doc.addPage();
      currentY = 50;
    }

    const distDate = alloc.distribution?.distributionDate || alloc.distributionDate || '';
    const distNumber = alloc.distribution?.distributionNumber || alloc.distributionNumber || '';
    const roc = alloc.return_of_capital || 0;
    const income = alloc.income_amount || 0;
    const gain = alloc.capital_gain || 0;
    const total = alloc.allocated_amount || alloc.distributionAmount || 0;

    totalROC += roc;
    totalIncome += income;
    totalGain += gain;
    totalDist += total;

    colX = 55;
    const rowData = [
      formatDateShort(distDate),
      `#${distNumber}`,
      formatCurrency(roc, currency),
      formatCurrency(income, currency),
      formatCurrency(gain, currency),
      formatCurrency(total, currency)
    ];

    doc.fontSize(8);
    rowData.forEach((value, i) => {
      doc.text(value, colX, currentY, { width: colWidths[i] });
      colX += colWidths[i];
    });

    currentY += 14;
  });

  // Totals row
  doc.moveTo(55, currentY + 2)
     .lineTo(562, currentY + 2)
     .stroke(COLORS.border);
  currentY += 8;

  colX = 55;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary);
  const totals = ['TOTAL', '', formatCurrency(totalROC, currency), formatCurrency(totalIncome, currency), formatCurrency(totalGain, currency), formatCurrency(totalDist, currency)];
  totals.forEach((value, i) => {
    doc.text(value, colX, currentY, { width: colWidths[i] });
    colX += colWidths[i];
  });
  doc.font('Helvetica');

  doc.y = currentY + 20;
}

function addFeeSummary(doc, callAllocations, totalFees, totalVAT, currency) {
  if (doc.y > 600) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION D: FEE SUMMARY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const totalGross = callAllocations.reduce((sum, a) => sum + (a.management_fee_gross || 0), 0);
  const totalDiscount = callAllocations.reduce((sum, a) => sum + (a.management_fee_discount || 0), 0);

  const feeData = [
    ['Management Fees (Gross)', formatCurrency(totalGross, currency)],
    ['Fee Discounts Applied', totalDiscount > 0 ? `-${formatCurrency(totalDiscount, currency)}` : formatCurrency(0, currency)],
    ['Management Fees (Net)', formatCurrency(totalFees, currency)],
    ['VAT', formatCurrency(totalVAT, currency)],
    ['', ''],
    ['Total Fees & VAT', formatCurrency(totalFees + totalVAT, currency)],
  ];

  let currentY = doc.y;
  feeData.forEach(([label, value]) => {
    if (label === '') {
      doc.moveTo(60, currentY + 5)
         .lineTo(350, currentY + 5)
         .stroke(COLORS.border);
      currentY += 15;
      return;
    }

    const isTotal = label.includes('Total Fees');

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

function addBalanceContinuity(doc, data) {
  if (doc.y > 550) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION E: BALANCE CONTINUITY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const balanceData = [
    ['Total Commitment', formatCurrency(data.commitment, data.currency)],
    ['Called Capital to Date', formatCurrency(data.totalCalledToDate, data.currency)],
    ['Uncalled Capital', formatCurrency(data.uncalled, data.currency)],
    ['', ''],
    ['Total Distributions to Date', formatCurrency(data.totalDistToDate, data.currency)],
    ['Net Capital Account Value', formatCurrency(data.netAccountValue, data.currency)],
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

    const isHighlight = label.includes('Net Capital') || label.includes('Uncalled');

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

function addStatementFooter(doc, firmName) {
  const pages = doc.bufferedPageRange();

  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);

    doc.moveTo(50, 730)
       .lineTo(562, 730)
       .stroke(COLORS.border);

    doc.fontSize(8)
       .fillColor(COLORS.muted)
       .text(
         'Capital Account Statement generated in accordance with ILPA reporting standards.',
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

// Utility functions
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
  generateCapitalAccountStatementPDF
};
