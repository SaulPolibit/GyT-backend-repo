/**
 * Fee & Expense Report Generator
 *
 * Generates ILPA-compliant Fee & Expense Reports (PDF and Excel).
 * Supports fund-level summary, per-investor detail, and dual-rate breakdowns.
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
 * Generate Fee & Expense Report PDF
 * @param {Object} structure - Fund/structure data
 * @param {Object} feeData - Aggregated fee data
 * @param {Object} period - { startDate, endDate }
 * @param {Object} options - { firmName, currency }
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateFeeReportPDF(structure, feeData, period, options = {}) {
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
      addFeeReportHeader(doc, {
        firmName,
        fundName: structure?.name || 'Fund',
        startDate: period.startDate,
        endDate: period.endDate
      });

      // Section A: Fund-Level Fee Summary
      addFundFeeSummary(doc, feeData.summary, currency);

      // Section B: Per-Investor Fee Detail
      if (feeData.investors && feeData.investors.length > 0) {
        addInvestorFeeDetail(doc, feeData.investors, currency);
      }

      // Section C: Dual-Rate Details (if applicable)
      if (feeData.isDualRate && feeData.investors.some(i => i.nicFeeAmount || i.unfundedFeeAmount)) {
        addDualRateDetails(doc, feeData.investors, currency);
      }

      // Footer
      addFeeReportFooter(doc, firmName);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate Fee & Expense Report Excel
 * @param {Object} structure - Fund/structure data
 * @param {Object} feeData - Aggregated fee data
 * @param {Object} period - { startDate, endDate }
 * @param {Object} options - { firmName, currency }
 * @returns {Promise<Buffer>} Excel buffer
 */
async function generateFeeReportExcel(structure, feeData, period, options = {}) {
  const { firmName = 'Investment Manager' } = options;
  const currency = structure?.currency || options.currency || 'USD';

  // Use a simple CSV-like approach since ExcelJS may not be available
  // The route handler will check for ExcelJS availability
  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = firmName;
    workbook.created = new Date();

    // Summary worksheet
    const summarySheet = workbook.addWorksheet('Fee Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Amount', key: 'amount', width: 20 },
    ];

    const summary = feeData.summary;
    summarySheet.addRow({ metric: 'Fund', amount: structure?.name || 'N/A' });
    summarySheet.addRow({ metric: 'Period', amount: `${period.startDate} to ${period.endDate}` });
    summarySheet.addRow({ metric: '', amount: '' });
    summarySheet.addRow({ metric: 'Total Management Fees (Gross)', amount: summary.totalFeesGross });
    summarySheet.addRow({ metric: 'Total Discounts', amount: summary.totalDiscounts });
    summarySheet.addRow({ metric: 'Total Management Fees (Net)', amount: summary.totalFeesNet });
    summarySheet.addRow({ metric: 'Total VAT', amount: summary.totalVAT });
    summarySheet.addRow({ metric: 'Total Fees Collected', amount: summary.totalFeesCollected });

    // Per-Investor Detail worksheet
    const detailSheet = workbook.addWorksheet('Per-Investor Detail');
    const detailColumns = [
      { header: 'Investor', key: 'investorName', width: 25 },
      { header: 'Commitment', key: 'commitment', width: 18 },
      { header: 'Gross Fee', key: 'grossFee', width: 15 },
      { header: 'Discount', key: 'discount', width: 15 },
      { header: 'Net Fee', key: 'netFee', width: 15 },
      { header: 'VAT', key: 'vat', width: 12 },
      { header: 'Total', key: 'total', width: 15 },
    ];

    if (feeData.isDualRate) {
      detailColumns.splice(2, 0,
        { header: 'NIC Fee', key: 'nicFee', width: 15 },
        { header: 'Unfunded Fee', key: 'unfundedFee', width: 15 }
      );
    }

    detailSheet.columns = detailColumns;

    // Style header row
    detailSheet.getRow(1).font = { bold: true };
    detailSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEDE9FE' }
    };

    feeData.investors.forEach(inv => {
      const row = {
        investorName: inv.investorName,
        commitment: inv.commitment,
        grossFee: inv.grossFee,
        discount: inv.discount,
        netFee: inv.netFee,
        vat: inv.vat,
        total: inv.total,
      };
      if (feeData.isDualRate) {
        row.nicFee = inv.nicFeeAmount || 0;
        row.unfundedFee = inv.unfundedFeeAmount || 0;
      }
      detailSheet.addRow(row);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    // Fallback: return a CSV buffer if ExcelJS is not available
    console.warn('ExcelJS not available, falling back to CSV:', error.message);
    return generateFeeReportCSV(structure, feeData, period, options);
  }
}

function generateFeeReportCSV(structure, feeData, period, options = {}) {
  const rows = [];
  rows.push('Fee & Expense Report');
  rows.push(`Fund,${structure?.name || 'N/A'}`);
  rows.push(`Period,${period.startDate} to ${period.endDate}`);
  rows.push('');
  rows.push('Investor,Commitment,Gross Fee,Discount,Net Fee,VAT,Total');

  feeData.investors.forEach(inv => {
    rows.push(`"${inv.investorName}",${inv.commitment},${inv.grossFee},${inv.discount},${inv.netFee},${inv.vat},${inv.total}`);
  });

  return Buffer.from(rows.join('\n'), 'utf-8');
}

// PDF Section Generators

function addFeeReportHeader(doc, options) {
  const { firmName, fundName, startDate, endDate } = options;

  doc.fontSize(20)
     .fillColor(COLORS.primary)
     .text(firmName, 50, 50);

  doc.fontSize(16)
     .fillColor(COLORS.text)
     .text('FEE & EXPENSE REPORT', 50, 85);

  doc.fontSize(12)
     .fillColor(COLORS.muted)
     .text(fundName, 50, 110);

  doc.fontSize(10)
     .fillColor(COLORS.muted)
     .text(
       `Report Period: ${formatDate(startDate)} - ${formatDate(endDate)}`,
       400, 50, { align: 'right' }
     );

  doc.moveTo(50, 140)
     .lineTo(562, 140)
     .stroke(COLORS.border);

  doc.y = 150;
}

function addFundFeeSummary(doc, summary, currency) {
  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION A: FUND-LEVEL FEE SUMMARY', 60, startY + 7);

  doc.y = startY + 35;
  doc.font('Helvetica');

  const summaryData = [
    ['Total Management Fees (Gross)', formatCurrency(summary.totalFeesGross, currency)],
    ['Total Discounts Applied', summary.totalDiscounts > 0 ? `-${formatCurrency(summary.totalDiscounts, currency)}` : formatCurrency(0, currency)],
    ['Total Management Fees (Net)', formatCurrency(summary.totalFeesNet, currency)],
    ['Total VAT', formatCurrency(summary.totalVAT, currency)],
    ['', ''],
    ['Total Fees Collected', formatCurrency(summary.totalFeesCollected, currency)],
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

    const isTotal = label.includes('Total Fees Collected');

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

function addInvestorFeeDetail(doc, investors, currency) {
  if (doc.y > 450) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION B: PER-INVESTOR FEE DETAIL', 60, startY + 7);

  doc.y = startY + 40;
  doc.font('Helvetica');

  // Table header
  const headers = ['Investor', 'Commitment', 'Gross Fee', 'Discount', 'Net Fee', 'VAT', 'Total'];
  const colWidths = [110, 75, 65, 65, 65, 55, 75];
  let colX = 50;

  doc.fontSize(7)
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

  investors.forEach((inv) => {
    if (currentY > 700) {
      doc.addPage();
      currentY = 50;
    }

    colX = 50;
    const rowData = [
      (inv.investorName || 'Unknown').substring(0, 20),
      formatCurrency(inv.commitment, currency),
      formatCurrency(inv.grossFee, currency),
      inv.discount > 0 ? `-${formatCurrency(inv.discount, currency)}` : '$0',
      formatCurrency(inv.netFee, currency),
      formatCurrency(inv.vat, currency),
      formatCurrency(inv.total, currency)
    ];

    doc.fontSize(7);
    rowData.forEach((value, i) => {
      doc.text(value, colX, currentY, { width: colWidths[i] });
      colX += colWidths[i];
    });

    currentY += 14;
  });

  doc.y = currentY + 10;
}

function addDualRateDetails(doc, investors, currency) {
  if (doc.y > 450) doc.addPage();

  const startY = doc.y + 10;

  doc.rect(50, startY, 512, 25)
     .fill(COLORS.accent);

  doc.fontSize(12)
     .fillColor(COLORS.primary)
     .font('Helvetica-Bold')
     .text('SECTION C: DUAL-RATE FEE DETAILS', 60, startY + 7);

  doc.y = startY + 40;
  doc.font('Helvetica');

  const headers = ['Investor', 'NIC Fee', 'Unfunded Fee', 'GP Offset', 'Gross Fee', 'Net Fee'];
  const colWidths = [130, 80, 80, 80, 75, 75];
  let colX = 50;

  doc.fontSize(7)
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

  investors.forEach((inv) => {
    if (currentY > 700) {
      doc.addPage();
      currentY = 50;
    }

    colX = 50;
    const rowData = [
      (inv.investorName || 'Unknown').substring(0, 22),
      formatCurrency(inv.nicFeeAmount || 0, currency),
      formatCurrency(inv.unfundedFeeAmount || 0, currency),
      formatCurrency(inv.feeOffsetAmount || 0, currency),
      formatCurrency(inv.grossFee, currency),
      formatCurrency(inv.netFee, currency)
    ];

    doc.fontSize(7);
    rowData.forEach((value, i) => {
      doc.text(value, colX, currentY, { width: colWidths[i] });
      colX += colWidths[i];
    });

    currentY += 14;
  });

  doc.y = currentY + 10;
}

function addFeeReportFooter(doc, firmName) {
  const pages = doc.bufferedPageRange();

  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);

    doc.moveTo(50, 730)
       .lineTo(562, 730)
       .stroke(COLORS.border);

    doc.fontSize(8)
       .fillColor(COLORS.muted)
       .text(
         'Fee & Expense Report generated in accordance with ILPA Fee Transparency Initiative.',
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

module.exports = {
  generateFeeReportPDF,
  generateFeeReportExcel
};
