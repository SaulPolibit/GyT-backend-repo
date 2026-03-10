/**
 * ILPA Report Excel Generator
 *
 * Generates Excel reports for ILPA Performance, Quarterly, and CC&D reports.
 * Falls back to CSV if ExcelJS is not available.
 */

/**
 * Generate ILPA Performance Report Excel
 */
async function generatePerformanceReportExcel(reportData, structure, options = {}) {
  const { firmName = 'Investment Manager' } = options;

  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = firmName;
    workbook.created = new Date();

    // Fund Info Sheet
    const infoSheet = workbook.addWorksheet('Fund Info');
    infoSheet.columns = [
      { header: 'Field', key: 'field', width: 25 },
      { header: 'Value', key: 'value', width: 30 },
    ];
    infoSheet.getRow(1).font = { bold: true };

    const fi = reportData.fundInfo;
    infoSheet.addRow({ field: 'Fund Name', value: fi.name });
    infoSheet.addRow({ field: 'Currency', value: fi.currency });
    infoSheet.addRow({ field: 'Total Commitment', value: fi.totalCommitment });
    infoSheet.addRow({ field: 'Investors', value: fi.investorCount });
    infoSheet.addRow({ field: 'As of Date', value: reportData.asOfDate });

    // Performance Sheet
    const perfSheet = workbook.addWorksheet('Performance');
    perfSheet.columns = [
      { header: 'Metric', key: 'metric', width: 20 },
      { header: 'Value', key: 'value', width: 15 },
    ];
    perfSheet.getRow(1).font = { bold: true };
    perfSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };

    const p = reportData.performance;
    perfSheet.addRow({ metric: 'Gross IRR', value: `${p.grossIRR}%` });
    perfSheet.addRow({ metric: 'Net IRR', value: `${p.netIRR}%` });
    perfSheet.addRow({ metric: 'Gross TVPI', value: `${p.grossTVPI}x` });
    perfSheet.addRow({ metric: 'Net TVPI', value: `${p.netTVPI}x` });
    perfSheet.addRow({ metric: 'DPI', value: `${p.dpi}x` });
    perfSheet.addRow({ metric: 'RVPI', value: `${p.rvpi}x` });
    perfSheet.addRow({ metric: 'MOIC', value: `${p.moic}x` });

    // Capital Summary Sheet
    const capSheet = workbook.addWorksheet('Capital Summary');
    capSheet.columns = [
      { header: 'Metric', key: 'metric', width: 25 },
      { header: 'Amount', key: 'amount', width: 20 },
    ];
    capSheet.getRow(1).font = { bold: true };

    const cs = reportData.capitalSummary;
    capSheet.addRow({ metric: 'Total Commitment', amount: cs.totalCommitment });
    capSheet.addRow({ metric: 'Capital Called', amount: cs.totalCapitalCalled });
    capSheet.addRow({ metric: 'Total Distributed', amount: cs.totalDistributed });
    capSheet.addRow({ metric: 'Total Fees', amount: cs.totalFees });
    capSheet.addRow({ metric: 'Uncalled Capital', amount: cs.uncalled });
    capSheet.addRow({ metric: 'Current NAV', amount: cs.currentNAV });
    capSheet.addRow({ metric: 'Total Value', amount: cs.totalValue });
    capSheet.addRow({ metric: 'Paid-In Ratio', amount: `${cs.paidInRatio}%` });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    console.warn('ExcelJS not available, falling back to CSV:', error.message);
    return generatePerformanceCSV(reportData);
  }
}

/**
 * Generate ILPA Quarterly Report Excel
 */
async function generateQuarterlyReportExcel(reportData, structure, options = {}) {
  const { firmName = 'Investment Manager' } = options;

  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = firmName;
    workbook.created = new Date();

    // Performance sheet (same as performance report)
    if (reportData.performance) {
      const perfSheet = workbook.addWorksheet('Performance');
      perfSheet.columns = [
        { header: 'Metric', key: 'metric', width: 20 },
        { header: 'Value', key: 'value', width: 15 },
      ];
      perfSheet.getRow(1).font = { bold: true };

      const p = reportData.performance.performance;
      perfSheet.addRow({ metric: 'Gross IRR', value: `${p.grossIRR}%` });
      perfSheet.addRow({ metric: 'Net IRR', value: `${p.netIRR}%` });
      perfSheet.addRow({ metric: 'TVPI', value: `${p.grossTVPI}x` });
      perfSheet.addRow({ metric: 'DPI', value: `${p.dpi}x` });
      perfSheet.addRow({ metric: 'RVPI', value: `${p.rvpi}x` });
    }

    // Quarterly Activity sheet
    if (reportData.quarterlyActivity) {
      const actSheet = workbook.addWorksheet('Quarterly Activity');
      actSheet.columns = [
        { header: 'Type', key: 'type', width: 15 },
        { header: 'Number', key: 'number', width: 12 },
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Amount', key: 'amount', width: 18 },
        { header: 'Description', key: 'description', width: 30 },
      ];
      actSheet.getRow(1).font = { bold: true };

      const qa = reportData.quarterlyActivity;
      qa.capitalCalls.calls.forEach(c => {
        actSheet.addRow({
          type: 'Capital Call',
          number: `#${c.callNumber}`,
          date: c.callDate,
          amount: c.amount,
          description: c.purpose,
        });
      });

      qa.distributions.distributions.forEach(d => {
        actSheet.addRow({
          type: 'Distribution',
          number: `#${d.distributionNumber}`,
          date: d.distributionDate,
          amount: d.amount,
          description: d.source,
        });
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    console.warn('ExcelJS not available, falling back to CSV:', error.message);
    return generateQuarterlyCSV(reportData);
  }
}

/**
 * Generate ILPA CC&D Report Excel
 */
async function generateCCDReportExcel(reportData, structure, options = {}) {
  const { firmName = 'Investment Manager' } = options;

  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = firmName;
    workbook.created = new Date();

    // Capital Calls sheet
    const callSheet = workbook.addWorksheet('Capital Calls');
    callSheet.columns = [
      { header: 'Call #', key: 'callNumber', width: 10 },
      { header: 'Date', key: 'callDate', width: 15 },
      { header: 'Amount', key: 'amount', width: 18 },
      { header: 'Purpose', key: 'purpose', width: 25 },
      { header: 'Cumulative', key: 'cumulative', width: 18 },
    ];
    callSheet.getRow(1).font = { bold: true };
    callSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };

    (reportData.capitalCalls.items || []).forEach(c => {
      callSheet.addRow({
        callNumber: `#${c.callNumber}`,
        callDate: c.callDate,
        amount: c.amount,
        purpose: c.purpose,
        cumulative: c.cumulativeCalled,
      });
    });

    // Distributions sheet
    const distSheet = workbook.addWorksheet('Distributions');
    distSheet.columns = [
      { header: 'Dist #', key: 'distNumber', width: 10 },
      { header: 'Date', key: 'distDate', width: 15 },
      { header: 'Amount', key: 'amount', width: 18 },
      { header: 'Source', key: 'source', width: 25 },
      { header: 'Cumulative', key: 'cumulative', width: 18 },
    ];
    distSheet.getRow(1).font = { bold: true };
    distSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };

    (reportData.distributions.items || []).forEach(d => {
      distSheet.addRow({
        distNumber: `#${d.distributionNumber}`,
        distDate: d.distributionDate,
        amount: d.amount,
        source: d.source,
        cumulative: d.cumulativeDistributed,
      });
    });

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 25 },
      { header: 'Value', key: 'value', width: 20 },
    ];
    summarySheet.getRow(1).font = { bold: true };

    summarySheet.addRow({ metric: 'Total Capital Calls', value: reportData.capitalCalls.count });
    summarySheet.addRow({ metric: 'Total Called Amount', value: reportData.capitalCalls.totalAmount });
    summarySheet.addRow({ metric: 'Total Distributions', value: reportData.distributions.count });
    summarySheet.addRow({ metric: 'Total Distributed Amount', value: reportData.distributions.totalAmount });
    summarySheet.addRow({ metric: 'Net Position', value: reportData.netPosition });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    console.warn('ExcelJS not available, falling back to CSV:', error.message);
    return generateCCDCSV(reportData);
  }
}

// CSV fallbacks
function generatePerformanceCSV(reportData) {
  const rows = [];
  rows.push('ILPA Performance Report');
  rows.push(`Fund,${reportData.fundInfo.name}`);
  rows.push(`As of,${reportData.asOfDate}`);
  rows.push('');
  rows.push('Metric,Value');
  rows.push(`Gross IRR,${reportData.performance.grossIRR}%`);
  rows.push(`Net IRR,${reportData.performance.netIRR}%`);
  rows.push(`TVPI,${reportData.performance.grossTVPI}x`);
  rows.push(`DPI,${reportData.performance.dpi}x`);
  rows.push(`RVPI,${reportData.performance.rvpi}x`);
  rows.push(`MOIC,${reportData.performance.moic}x`);
  rows.push('');
  rows.push(`Total Commitment,${reportData.capitalSummary.totalCommitment}`);
  rows.push(`Capital Called,${reportData.capitalSummary.totalCapitalCalled}`);
  rows.push(`Total Distributed,${reportData.capitalSummary.totalDistributed}`);
  rows.push(`Current NAV,${reportData.capitalSummary.currentNAV}`);
  return Buffer.from(rows.join('\n'), 'utf-8');
}

function generateQuarterlyCSV(reportData) {
  const rows = ['ILPA Quarterly Report'];
  if (reportData.quarterlyActivity) {
    rows.push(`Period,${reportData.quarterlyActivity.period.startDate} to ${reportData.quarterlyActivity.period.endDate}`);
    rows.push(`Net Cash Flow,${reportData.quarterlyActivity.netCashFlow}`);
  }
  return Buffer.from(rows.join('\n'), 'utf-8');
}

function generateCCDCSV(reportData) {
  const rows = ['Capital Call & Distribution Summary'];
  rows.push('');
  rows.push('Capital Calls');
  rows.push('Call #,Date,Amount,Purpose,Cumulative');
  (reportData.capitalCalls.items || []).forEach(c => {
    rows.push(`#${c.callNumber},${c.callDate},${c.amount},"${c.purpose}",${c.cumulativeCalled}`);
  });
  rows.push('');
  rows.push('Distributions');
  rows.push('Dist #,Date,Amount,Source,Cumulative');
  (reportData.distributions.items || []).forEach(d => {
    rows.push(`#${d.distributionNumber},${d.distributionDate},${d.amount},"${d.source}",${d.cumulativeDistributed}`);
  });
  return Buffer.from(rows.join('\n'), 'utf-8');
}

module.exports = {
  generatePerformanceReportExcel,
  generateQuarterlyReportExcel,
  generateCCDReportExcel
};
