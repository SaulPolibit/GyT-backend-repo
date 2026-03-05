/**
 * Subscription Limits Service
 * Handles validation of subscription limits for structure creation and investor creation
 *
 * Limits are stored in the database (users table) and can be increased
 * when users purchase Extra AUM or Extra Investors
 *
 * Supports two subscription models:
 * - tier_based: Limits based on total AUM commitment and investor count
 * - payg: Limits based on investor count only
 */

const { getSupabase } = require('../config/database');

// ============================================================================
// DEFAULT LIMITS (Fallback when database values not set)
// ============================================================================

/**
 * PAYG Model Default Limits (Pay-As-You-Grow)
 */
const PAYG_LIMITS = {
  starter: {
    maxInvestors: 1000,
    maxTotalCommitment: 999999999999, // No commitment limit for PAYG
    name: 'Base Fee - Starter'
  },
  growth: {
    maxInvestors: 2000,
    maxTotalCommitment: 999999999999,
    name: 'Base Fee - Growth'
  },
  enterprise: {
    maxInvestors: 4000,
    maxTotalCommitment: 999999999999,
    name: 'Base Fee - Enterprise'
  }
};

/**
 * Tier-Based Model Default Limits
 */
const TIER_BASED_LIMITS = {
  starter: {
    maxTotalCommitment: 25000000, // $25 Million
    maxInvestors: 50,
    name: 'Monthly Fee - Starter'
  },
  professional: {
    maxTotalCommitment: 50000000, // $50 Million
    maxInvestors: 100,
    name: 'Monthly Fee - Professional'
  },
  enterprise: {
    maxTotalCommitment: 100000000, // $100 Million
    maxInvestors: 200,
    name: 'Monthly Fee - Enterprise'
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get default limits for a specific model and tier (fallback)
 * @param {string} model - 'tier_based' or 'payg'
 * @param {string} tier - The subscription tier
 * @returns {Object} The limits configuration
 */
const getDefaultLimits = (model, tier) => {
  if (model === 'payg') {
    return PAYG_LIMITS[tier] || PAYG_LIMITS.starter;
  }
  return TIER_BASED_LIMITS[tier] || TIER_BASED_LIMITS.starter;
};

/**
 * Get tier name for display
 * @param {string} model - 'tier_based' or 'payg'
 * @param {string} tier - The subscription tier
 * @returns {string} Tier display name
 */
const getTierName = (model, tier) => {
  const defaults = getDefaultLimits(model, tier);
  return defaults.name || `${model} - ${tier}`;
};

/**
 * Get the next tier upgrade recommendation
 * @param {string} model - 'tier_based' or 'payg'
 * @param {string} currentTier - Current subscription tier
 * @returns {Object|null} Next tier info or null if already at max
 */
const getUpgradeTier = (model, currentTier) => {
  if (model === 'payg') {
    const tiers = ['starter', 'growth', 'enterprise'];
    const currentIndex = tiers.indexOf(currentTier);
    if (currentIndex < tiers.length - 1) {
      const nextTier = tiers[currentIndex + 1];
      return { tier: nextTier, ...PAYG_LIMITS[nextTier] };
    }
  } else {
    const tiers = ['starter', 'professional', 'enterprise'];
    const currentIndex = tiers.indexOf(currentTier);
    if (currentIndex < tiers.length - 1) {
      const nextTier = tiers[currentIndex + 1];
      return { tier: nextTier, ...TIER_BASED_LIMITS[nextTier] };
    }
  }
  return null;
};

/**
 * Format currency for error messages
 * @param {number} amount - Amount in dollars
 * @returns {string} Formatted currency string
 */
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

// ============================================================================
// DATABASE QUERY FUNCTIONS
// ============================================================================

/**
 * Count total investors by counting users with role 3
 * @returns {Promise<number>} Total investor count
 */
const countInvestors = async () => {
  const supabase = getSupabase();

  // Count all users with role 3 (investors)
  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 3);

  if (error) {
    console.error('[SubscriptionLimits] Error counting investors:', error);
    throw error;
  }

  console.log('[SubscriptionLimits] countInvestors result:', { count });

  return count || 0;
};

/**
 * Calculate total commitment across all structures for a user
 * @param {string} userId - The admin/fund manager user ID
 * @returns {Promise<number>} Total commitment in dollars
 */
const calculateTotalCommitment = async (userId) => {
  const supabase = getSupabase();

  const { data: structures, error } = await supabase
    .from('structures')
    .select('total_commitment')
    .eq('created_by', userId);

  if (error) {
    console.error('[SubscriptionLimits] Error calculating total commitment:', error);
    throw error;
  }

  if (!structures || structures.length === 0) {
    return 0;
  }

  const total = structures.reduce((sum, s) => {
    return sum + (parseFloat(s.total_commitment) || 0);
  }, 0);

  return total;
};

/**
 * Get user's subscription info and limits from database
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Subscription info with limits
 */
const getUserSubscription = async (userId) => {
  const supabase = getSupabase();

  console.log('[SubscriptionLimits] Fetching subscription for user:', userId);

  const { data: user, error } = await supabase
    .from('users')
    .select(`
      subscription_model,
      subscription_tier,
      subscription_status,
      stripe_subscription_id,
      max_total_commitment,
      max_investors,
      extra_commitment_purchased,
      extra_investors_purchased
    `)
    .eq('id', userId)
    .single();

  if (error) {
    console.error('[SubscriptionLimits] Error fetching user subscription:', error);
    throw error;
  }

  console.log('[SubscriptionLimits] Raw user data:', user);

  const model = user.subscription_model || 'tier_based';
  const tier = user.subscription_tier || 'starter';
  const defaults = getDefaultLimits(model, tier);

  // Use database values if set, otherwise fall back to defaults
  const result = {
    model,
    tier,
    status: user.subscription_status,
    stripeSubscriptionId: user.stripe_subscription_id,
    // Limits from database (with fallback to defaults)
    maxTotalCommitment: user.max_total_commitment !== null ? parseFloat(user.max_total_commitment) : defaults.maxTotalCommitment,
    maxInvestors: user.max_investors !== null ? user.max_investors : defaults.maxInvestors,
    // Track extras purchased
    extraCommitmentPurchased: parseFloat(user.extra_commitment_purchased) || 0,
    extraInvestorsPurchased: user.extra_investors_purchased || 0,
    // Tier name for display
    tierName: getTierName(model, tier)
  };

  console.log('[SubscriptionLimits] Parsed subscription with limits:', result);

  return result;
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate if a new structure can be created based on subscription limits
 * Only applies to tier_based model (checks total commitment)
 *
 * @param {string} userId - The admin/fund manager user ID
 * @param {number} newCommitment - The total commitment of the new structure
 * @returns {Promise<Object>} Validation result
 */
const validateStructureCreation = async (userId, newCommitment = 0) => {
  try {
    console.log('[SubscriptionLimits] validateStructureCreation called:', { userId, newCommitment });

    const subscription = await getUserSubscription(userId);
    console.log('[SubscriptionLimits] User subscription:', subscription);

    // Only tier_based model has commitment limits
    if (subscription.model !== 'tier_based') {
      console.log('[SubscriptionLimits] Model is not tier_based, skipping commitment validation');
      return { allowed: true };
    }

    const currentTotal = await calculateTotalCommitment(userId);
    const projectedTotal = currentTotal + (parseFloat(newCommitment) || 0);
    const maxAllowed = subscription.maxTotalCommitment;

    console.log('[SubscriptionLimits] Commitment check:', {
      currentTotal,
      newCommitment,
      projectedTotal,
      maxAllowed
    });

    if (projectedTotal > maxAllowed) {
      const upgradeOption = getUpgradeTier(subscription.model, subscription.tier);

      console.log('[SubscriptionLimits] LIMIT EXCEEDED - blocking structure creation');

      return {
        allowed: false,
        reason: `Total commitment limit exceeded. Your ${subscription.tierName} plan allows up to ${formatCurrency(maxAllowed)} total commitment. Current: ${formatCurrency(currentTotal)}, New structure: ${formatCurrency(newCommitment)}, Total: ${formatCurrency(projectedTotal)}.`,
        currentTotal,
        newCommitment,
        projectedTotal,
        limit: maxAllowed,
        tier: subscription.tier,
        upgradeOption: upgradeOption ? {
          tier: upgradeOption.tier,
          name: upgradeOption.name,
          maxTotalCommitment: upgradeOption.maxTotalCommitment
        } : null
      };
    }

    console.log('[SubscriptionLimits] Within limits - allowing structure creation');
    return {
      allowed: true,
      currentTotal,
      newCommitment,
      projectedTotal,
      limit: maxAllowed,
      remaining: maxAllowed - projectedTotal
    };
  } catch (error) {
    console.error('[SubscriptionLimits] validateStructureCreation error:', error);
    console.error('[SubscriptionLimits] Error stack:', error.stack);
    return {
      allowed: false,
      reason: `Validation error: ${error.message}. Please contact support.`,
      error: error.message
    };
  }
};

/**
 * Validate if a new investor can be created based on subscription limits
 * Reads limits from database (supports Extra Investors purchases)
 *
 * @param {string} userId - The admin/fund manager user ID
 * @returns {Promise<Object>} Validation result
 */
const validateInvestorCreation = async (userId) => {
  try {
    console.log('[SubscriptionLimits] validateInvestorCreation called for userId:', userId);

    const subscription = await getUserSubscription(userId);
    console.log('[SubscriptionLimits] User subscription:', subscription);

    const currentCount = await countInvestors();
    const projectedCount = currentCount + 1;
    const maxAllowed = subscription.maxInvestors;

    console.log('[SubscriptionLimits] Investor count check:', {
      currentCount,
      projectedCount,
      maxInvestors: maxAllowed,
      willExceed: projectedCount > maxAllowed
    });

    if (projectedCount > maxAllowed) {
      const upgradeOption = getUpgradeTier(subscription.model, subscription.tier);

      console.log('[SubscriptionLimits] LIMIT EXCEEDED - blocking investor creation');

      return {
        allowed: false,
        reason: `Investor limit exceeded. Your ${subscription.tierName} plan allows up to ${maxAllowed} investors. Current: ${currentCount}. Please upgrade your subscription or purchase Extra Investors to add more.`,
        currentCount,
        limit: maxAllowed,
        tier: subscription.tier,
        model: subscription.model,
        upgradeOption: upgradeOption ? {
          tier: upgradeOption.tier,
          name: upgradeOption.name,
          maxInvestors: upgradeOption.maxInvestors
        } : null
      };
    }

    console.log('[SubscriptionLimits] Within limits - allowing investor creation');
    return {
      allowed: true,
      currentCount,
      limit: maxAllowed,
      remaining: maxAllowed - projectedCount
    };
  } catch (error) {
    console.error('[SubscriptionLimits] validateInvestorCreation error:', error);
    console.error('[SubscriptionLimits] Error stack:', error.stack);
    return {
      allowed: false,
      reason: `Validation error: ${error.message}. Please contact support.`,
      error: error.message
    };
  }
};

/**
 * Get current usage statistics for a user's subscription
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Usage stats
 */
const getSubscriptionUsage = async (userId) => {
  try {
    const subscription = await getUserSubscription(userId);
    const currentInvestors = await countInvestors();
    const currentCommitment = await calculateTotalCommitment(userId);

    return {
      model: subscription.model,
      tier: subscription.tier,
      status: subscription.status,
      investors: {
        current: currentInvestors,
        limit: subscription.maxInvestors,
        remaining: Math.max(0, subscription.maxInvestors - currentInvestors),
        percentUsed: Math.round((currentInvestors / subscription.maxInvestors) * 100)
      },
      commitment: subscription.model === 'tier_based' ? {
        current: currentCommitment,
        limit: subscription.maxTotalCommitment,
        remaining: Math.max(0, subscription.maxTotalCommitment - currentCommitment),
        percentUsed: Math.round((currentCommitment / subscription.maxTotalCommitment) * 100)
      } : null,
      extras: {
        commitmentPurchased: subscription.extraCommitmentPurchased,
        investorsPurchased: subscription.extraInvestorsPurchased
      },
      limits: {
        maxInvestors: subscription.maxInvestors,
        maxTotalCommitment: subscription.maxTotalCommitment,
        name: subscription.tierName
      },
      upgradeOption: getUpgradeTier(subscription.model, subscription.tier)
    };
  } catch (error) {
    console.error('[SubscriptionLimits] getSubscriptionUsage error:', error);
    throw error;
  }
};

/**
 * Update user's subscription model and tier
 * @param {string} userId - User ID
 * @param {string} model - 'tier_based' or 'payg'
 * @param {string} tier - Subscription tier
 * @returns {Promise<Object>} Updated user
 */
const updateUserSubscription = async (userId, model, tier) => {
  const supabase = getSupabase();

  // Get default limits for the new tier
  const defaults = getDefaultLimits(model, tier);

  const { data, error } = await supabase
    .from('users')
    .update({
      subscription_model: model,
      subscription_tier: tier,
      max_total_commitment: defaults.maxTotalCommitment,
      max_investors: defaults.maxInvestors,
      // Reset extras when changing tier (or keep them - business decision)
      extra_commitment_purchased: 0,
      extra_investors_purchased: 0
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('[SubscriptionLimits] Error updating subscription:', error);
    throw error;
  }

  return data;
};

/**
 * Add extra investors to user's subscription
 * @param {string} userId - User ID
 * @param {number} extraInvestors - Number of extra investors to add
 * @returns {Promise<Object>} Updated user
 */
const addExtraInvestors = async (userId, extraInvestors) => {
  const supabase = getSupabase();

  // First get current values
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('max_investors, extra_investors_purchased')
    .eq('id', userId)
    .single();

  if (fetchError) {
    throw fetchError;
  }

  const currentMax = user.max_investors || 0;
  const currentExtra = user.extra_investors_purchased || 0;

  const { data, error } = await supabase
    .from('users')
    .update({
      max_investors: currentMax + extraInvestors,
      extra_investors_purchased: currentExtra + extraInvestors
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('[SubscriptionLimits] Error adding extra investors:', error);
    throw error;
  }

  console.log('[SubscriptionLimits] Added extra investors:', { userId, extraInvestors, newMax: data.max_investors });

  return data;
};

/**
 * Add extra AUM commitment to user's subscription
 * @param {string} userId - User ID
 * @param {number} extraCommitment - Extra commitment amount to add
 * @returns {Promise<Object>} Updated user
 */
const addExtraCommitment = async (userId, extraCommitment) => {
  const supabase = getSupabase();

  // First get current values
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('max_total_commitment, extra_commitment_purchased')
    .eq('id', userId)
    .single();

  if (fetchError) {
    throw fetchError;
  }

  const currentMax = parseFloat(user.max_total_commitment) || 0;
  const currentExtra = parseFloat(user.extra_commitment_purchased) || 0;

  const { data, error } = await supabase
    .from('users')
    .update({
      max_total_commitment: currentMax + extraCommitment,
      extra_commitment_purchased: currentExtra + extraCommitment
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('[SubscriptionLimits] Error adding extra commitment:', error);
    throw error;
  }

  console.log('[SubscriptionLimits] Added extra commitment:', { userId, extraCommitment, newMax: data.max_total_commitment });

  return data;
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Default Constants (for reference/fallback)
  PAYG_LIMITS,
  TIER_BASED_LIMITS,

  // Helper functions
  getDefaultLimits,
  getUpgradeTier,
  formatCurrency,

  // Database queries
  countInvestors,
  calculateTotalCommitment,
  getUserSubscription,

  // Validation functions
  validateStructureCreation,
  validateInvestorCreation,

  // Usage and updates
  getSubscriptionUsage,
  updateUserSubscription,
  addExtraInvestors,
  addExtraCommitment
};
