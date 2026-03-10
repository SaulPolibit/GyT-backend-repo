/**
 * ILPA Report Service
 *
 * Backend calculation service for ILPA Performance, Quarterly,
 * and Capital Call & Distribution reports.
 * Ports IRR/TVPI/DPI/RVPI calculations from frontend to server-side.
 */

const { getSupabase } = require('../config/database');

/**
 * Calculate IRR using Newton-Raphson method
 * @param {Array} cashFlows - Array of { date, amount }
 * @returns {number} IRR as percentage
 */
function calculateIRR(cashFlows) {
  if (cashFlows.length < 2) return 0;

  const sorted = [...cashFlows].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const startDate = new Date(sorted[0].date);
  const flows = sorted.map(cf => ({
    days: Math.floor((new Date(cf.date).getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
    amount: cf.amount
  }));

  let rate = 0.1;
  const maxIterations = 100;
  const tolerance = 0.0001;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let derivative = 0;

    for (const flow of flows) {
      const years = flow.days / 365.25;
      const factor = Math.pow(1 + rate, years);
      npv += flow.amount / factor;
      derivative -= flow.amount * years / (factor * (1 + rate));
    }

    if (Math.abs(npv) < tolerance) {
      return rate * 100;
    }

    if (Math.abs(derivative) < 1e-10) break;

    rate = rate - npv / derivative;
    if (rate < -0.99) rate = -0.99;
    if (rate > 10) rate = 10;
  }

  return rate * 100;
}

/**
 * Calculate fund-level performance metrics
 * @param {string} structureId
 * @param {string} asOfDate - ISO date string
 * @returns {Object} Performance report data
 */
async function calculatePerformanceMetrics(structureId, asOfDate) {
  const dateFilter = asOfDate || new Date().toISOString().split('T')[0];

  // Get structure
  const { data: structure } = await getSupabase()
    .from('structures')
    .select('*')
    .eq('id', structureId)
    .single();

  // Get capital calls
  const { data: capitalCalls } = await getSupabase()
    .from('capital_calls')
    .select('*, capital_call_allocations(*)')
    .eq('structure_id', structureId)
    .lte('callDate', dateFilter)
    .order('callDate', { ascending: true });

  // Get distributions
  const { data: distributions } = await getSupabase()
    .from('distributions')
    .select('*, distribution_allocations(*)')
    .eq('structure_id', structureId)
    .lte('distributionDate', dateFilter)
    .order('distributionDate', { ascending: true });

  // Get investors
  const { data: investors } = await getSupabase()
    .from('investors')
    .select('*, user:users(id, name, email)')
    .eq('structure_id', structureId);

  const allCalls = capitalCalls || [];
  const allDists = distributions || [];
  const allInvestors = investors || [];

  // Calculate totals
  const totalCapitalCalled = allCalls.reduce((sum, cc) =>
    sum + (cc.totalCallAmount || 0), 0);
  const totalDistributed = allDists.reduce((sum, d) =>
    sum + (d.totalAmount || 0), 0);
  const totalCommitment = allInvestors.reduce((sum, inv) =>
    sum + (inv.commitment || inv.total_commitment || 0), 0);

  // Total fees
  const totalFees = allCalls.reduce((sum, cc) => {
    const callFees = (cc.capital_call_allocations || [])
      .reduce((s, a) => s + (a.management_fee_net || 0), 0);
    return sum + callFees;
  }, 0);

  // Estimate NAV (called - distributed as simplified)
  const currentNAV = totalCapitalCalled - totalDistributed;
  const totalValue = currentNAV + totalDistributed;

  // IRR calculation - build cash flows
  const cashFlows = [];

  // Capital calls are negative (outflows from LP perspective)
  allCalls.forEach(cc => {
    cashFlows.push({
      date: cc.callDate,
      amount: -(cc.totalCallAmount || 0)
    });
  });

  // Distributions are positive (inflows to LP)
  allDists.forEach(d => {
    cashFlows.push({
      date: d.distributionDate,
      amount: d.totalAmount || 0
    });
  });

  // Add current NAV as terminal value
  if (currentNAV > 0) {
    cashFlows.push({
      date: dateFilter,
      amount: currentNAV
    });
  }

  const grossIRR = calculateIRR(cashFlows);

  // Net IRR (approximate by reducing returns by fee ratio)
  const feeRatio = totalCapitalCalled > 0 ? totalFees / totalCapitalCalled : 0;
  const netIRR = grossIRR * (1 - feeRatio);

  // Multiple calculations
  const totalInvested = totalCapitalCalled;
  const tvpi = totalInvested > 0 ? totalValue / totalInvested : 0;
  const dpi = totalInvested > 0 ? totalDistributed / totalInvested : 0;
  const rvpi = totalInvested > 0 ? currentNAV / totalInvested : 0;
  const moic = tvpi;

  const grossTVPI = tvpi;
  const netTVPI = totalInvested > 0 ? (totalValue - totalFees) / totalInvested : 0;

  return {
    fundInfo: {
      id: structureId,
      name: structure?.name || 'Fund',
      currency: structure?.currency || 'USD',
      vintage: structure?.created_at ? new Date(structure.created_at).getFullYear() : null,
      totalCommitment,
      investorCount: allInvestors.length,
    },
    performance: {
      grossIRR: parseFloat(grossIRR.toFixed(2)),
      netIRR: parseFloat(netIRR.toFixed(2)),
      grossTVPI: parseFloat(grossTVPI.toFixed(2)),
      netTVPI: parseFloat(netTVPI.toFixed(2)),
      dpi: parseFloat(dpi.toFixed(2)),
      rvpi: parseFloat(rvpi.toFixed(2)),
      moic: parseFloat(moic.toFixed(2)),
    },
    capitalSummary: {
      totalCommitment,
      totalCapitalCalled,
      totalDistributed,
      totalFees,
      currentNAV,
      totalValue,
      uncalled: totalCommitment - totalCapitalCalled,
      paidInRatio: totalCommitment > 0 ? parseFloat((totalCapitalCalled / totalCommitment * 100).toFixed(1)) : 0,
    },
    cashFlowSummary: {
      totalCalls: allCalls.length,
      totalDistributions: allDists.length,
      unrealizedGain: Math.max(0, currentNAV - (totalCapitalCalled - totalDistributed)),
      realizedGain: Math.max(0, totalDistributed - totalCapitalCalled * dpi),
    },
    asOfDate: dateFilter,
  };
}

/**
 * Calculate quarterly activity
 * @param {string} structureId
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Object} Quarterly activity data
 */
async function calculateQuarterlyActivity(structureId, startDate, endDate) {
  // Get capital calls this quarter
  const { data: quarterCalls } = await getSupabase()
    .from('capital_calls')
    .select('*')
    .eq('structure_id', structureId)
    .gte('callDate', startDate)
    .lte('callDate', endDate);

  // Get distributions this quarter
  const { data: quarterDists } = await getSupabase()
    .from('distributions')
    .select('*')
    .eq('structure_id', structureId)
    .gte('distributionDate', startDate)
    .lte('distributionDate', endDate);

  const calls = quarterCalls || [];
  const dists = quarterDists || [];

  return {
    period: { startDate, endDate },
    capitalCalls: {
      count: calls.length,
      totalAmount: calls.reduce((sum, c) => sum + (c.totalCallAmount || 0), 0),
      calls: calls.map(c => ({
        callNumber: c.callNumber,
        callDate: c.callDate,
        amount: c.totalCallAmount || 0,
        purpose: c.purpose || 'Capital Deployment',
      }))
    },
    distributions: {
      count: dists.length,
      totalAmount: dists.reduce((sum, d) => sum + (d.totalAmount || 0), 0),
      distributions: dists.map(d => ({
        distributionNumber: d.distributionNumber,
        distributionDate: d.distributionDate,
        amount: d.totalAmount || 0,
        source: d.source || 'Operating Income',
      }))
    },
    netCashFlow: calls.reduce((sum, c) => sum + (c.totalCallAmount || 0), 0) -
                  dists.reduce((sum, d) => sum + (d.totalAmount || 0), 0),
  };
}

/**
 * Calculate Capital Call & Distribution summary
 * @param {string} structureId
 * @returns {Object} CC&D summary
 */
async function calculateCCDSummary(structureId) {
  // Get all capital calls
  const { data: allCalls } = await getSupabase()
    .from('capital_calls')
    .select('*')
    .eq('structure_id', structureId)
    .order('callDate', { ascending: true });

  // Get all distributions
  const { data: allDists } = await getSupabase()
    .from('distributions')
    .select('*')
    .eq('structure_id', structureId)
    .order('distributionDate', { ascending: true });

  const calls = allCalls || [];
  const dists = allDists || [];

  // Running balance
  let runningCalled = 0;
  let runningDistributed = 0;

  const callSummary = calls.map(c => {
    runningCalled += (c.totalCallAmount || 0);
    return {
      callNumber: c.callNumber,
      callDate: c.callDate,
      amount: c.totalCallAmount || 0,
      purpose: c.purpose || 'Capital Deployment',
      cumulativeCalled: runningCalled,
    };
  });

  const distSummary = dists.map(d => {
    runningDistributed += (d.totalAmount || 0);
    return {
      distributionNumber: d.distributionNumber,
      distributionDate: d.distributionDate,
      amount: d.totalAmount || 0,
      source: d.source || 'Operating Income',
      cumulativeDistributed: runningDistributed,
    };
  });

  return {
    capitalCalls: {
      count: calls.length,
      totalAmount: runningCalled,
      items: callSummary,
    },
    distributions: {
      count: dists.length,
      totalAmount: runningDistributed,
      items: distSummary,
    },
    netPosition: runningCalled - runningDistributed,
  };
}

module.exports = {
  calculatePerformanceMetrics,
  calculateQuarterlyActivity,
  calculateCCDSummary,
  calculateIRR
};
