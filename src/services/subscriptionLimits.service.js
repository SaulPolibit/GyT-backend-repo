/**
 * Subscription Limits Service
 * Handles validation of subscription limits for structure creation and investor creation
 *
 * Subscription data is stored in the platform_subscription table (single record per platform)
 * All limits apply to the entire platform, not individual users
 *
 * Supports two subscription models:
 * - tier_based: Limits based on total AUM commitment and investor count
 * - payg: Limits based on investor count only, with credit-based billing
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
 * PAYG Credit Costs (in cents)
 * Operations consume credits based on subscription tier
 */
const PAYG_CREDIT_COSTS = {
  kyc_session: {
    starter: 400,    // $4.00
    growth: 300,     // $3.00
    enterprise: 300  // $3.00
  },
  document_signing: {
    starter: 300,    // $3.00
    growth: 200,     // $2.00
    enterprise: 200  // $2.00
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
// PLATFORM SUBSCRIPTION FUNCTIONS
// ============================================================================

/**
 * Get any existing platform subscription (for upsert purposes)
 * Finds the most recent subscription regardless of status
 * @returns {Promise<Object|null>} Platform subscription or null
 */
const getAnyPlatformSubscription = async () => {
  const supabase = getSupabase();

  const { data: subscription, error } = await supabase
    .from('platform_subscription')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    console.error('[SubscriptionLimits] Error fetching any platform subscription:', error);
  }

  return subscription || null;
};

/**
 * Get the active platform subscription
 * @returns {Promise<Object|null>} Platform subscription or null
 */
const getPlatformSubscription = async () => {
  const supabase = getSupabase();

  // Include 'canceling' - user can still use credits until subscription actually ends
  const { data: subscription, error } = await supabase
    .from('platform_subscription')
    .select('*')
    .in('subscription_status', ['active', 'trialing', 'canceling'])
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    console.error('[SubscriptionLimits] Error fetching platform subscription:', error);
  }

  return subscription || null;
};

/**
 * Get subscription info with defaults applied
 * This is the main function for getting subscription data
 * @returns {Promise<Object>} Subscription info with limits
 */
const getSubscription = async () => {
  const subscription = await getPlatformSubscription();

  console.log('[SubscriptionLimits] Raw platform subscription:', subscription ? {
    id: subscription.id,
    subscription_model: subscription.subscription_model,
    subscription_tier: subscription.subscription_tier,
    subscription_status: subscription.subscription_status,
    credit_balance: subscription.credit_balance
  } : null);

  if (!subscription) {
    console.log('[SubscriptionLimits] No active platform subscription found');
    return {
      model: null,
      tier: null,
      status: null,
      stripeSubscriptionId: null,
      maxTotalCommitment: 0,
      maxInvestors: 0,
      extraCommitmentPurchased: 0,
      extraInvestorsPurchased: 0,
      creditBalance: 0,
      emissionsAvailable: 0,
      emissionsUsed: 0,
      tierName: 'No Subscription',
      hasSubscription: false
    };
  }

  const model = subscription.subscription_model || 'tier_based';
  const tier = subscription.subscription_tier || 'starter';
  const defaults = getDefaultLimits(model, tier);

  const result = {
    id: subscription.id,
    model,
    tier,
    status: subscription.subscription_status,
    stripeSubscriptionId: subscription.stripe_subscription_id,
    stripeCustomerId: subscription.stripe_customer_id,
    subscriptionStartDate: subscription.subscription_start_date,
    // Limits (with fallback to defaults)
    maxTotalCommitment: subscription.max_total_commitment !== null
      ? parseFloat(subscription.max_total_commitment)
      : defaults.maxTotalCommitment,
    maxInvestors: subscription.max_investors !== null
      ? subscription.max_investors
      : defaults.maxInvestors,
    // Extra purchases
    extraCommitmentPurchased: parseFloat(subscription.extra_commitment_purchased) || 0,
    extraInvestorsPurchased: subscription.extra_investors_purchased || 0,
    // Credits (PAYG)
    creditBalance: subscription.credit_balance || 0,
    // Emissions
    emissionsAvailable: subscription.emissions_available || 0,
    emissionsUsed: subscription.emissions_used || 0,
    // Display
    tierName: getTierName(model, tier),
    hasSubscription: true,
    // Management
    managedByUserId: subscription.managed_by_user_id
  };

  console.log('[SubscriptionLimits] Platform subscription:', result);

  return result;
};

/**
 * Get subscription for a specific user (returns platform subscription)
 * This maintains backward compatibility with existing code
 * @param {string} userId - User ID (not used, platform subscription applies to all)
 * @returns {Promise<Object>} Subscription info
 */
const getUserSubscription = async (userId) => {
  console.log('[SubscriptionLimits] getUserSubscription called for userId:', userId);
  // All users share the same platform subscription
  return getSubscription();
};

/**
 * Create or update platform subscription
 * Only updates fields that are explicitly provided (not undefined)
 * @param {Object} data - Subscription data
 * @returns {Promise<Object>} Created/updated subscription
 */
const upsertPlatformSubscription = async (data) => {
  const supabase = getSupabase();

  // Check if ANY subscription exists (not just active ones) to avoid duplicates
  const existing = await getAnyPlatformSubscription();

  // Build subscription data - only include fields that are provided
  const subscriptionData = {};

  // Map provided fields (only include if value is not undefined)
  const fieldMapping = {
    stripeSubscriptionId: 'stripe_subscription_id',
    stripeCustomerId: 'stripe_customer_id',
    subscriptionModel: 'subscription_model',
    subscriptionTier: 'subscription_tier',
    subscriptionStatus: 'subscription_status',
    subscriptionStartDate: 'subscription_start_date',
    maxTotalCommitment: 'max_total_commitment',
    maxInvestors: 'max_investors',
    extraCommitmentPurchased: 'extra_commitment_purchased',
    extraInvestorsPurchased: 'extra_investors_purchased',
    creditBalance: 'credit_balance',
    emissionsAvailable: 'emissions_available',
    emissionsUsed: 'emissions_used',
    managedByUserId: 'managed_by_user_id'
  };

  for (const [camelKey, snakeKey] of Object.entries(fieldMapping)) {
    if (data[camelKey] !== undefined) {
      subscriptionData[snakeKey] = data[camelKey];
    }
  }

  console.log('[SubscriptionLimits] upsertPlatformSubscription data:', subscriptionData);

  let result;

  if (existing) {
    // Update existing subscription - only update provided fields
    const { data: updated, error } = await supabase
      .from('platform_subscription')
      .update(subscriptionData)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.error('[SubscriptionLimits] Error updating platform subscription:', error);
      throw error;
    }
    result = updated;
    console.log('[SubscriptionLimits] Updated platform subscription:', result.id, 'Fields updated:', Object.keys(subscriptionData));
  } else {
    // Create new subscription - set defaults for missing fields
    const insertData = {
      ...subscriptionData,
      extra_commitment_purchased: subscriptionData.extra_commitment_purchased ?? 0,
      extra_investors_purchased: subscriptionData.extra_investors_purchased ?? 0,
      credit_balance: subscriptionData.credit_balance ?? 0,
      emissions_available: subscriptionData.emissions_available ?? 0,
      emissions_used: subscriptionData.emissions_used ?? 0
    };

    const { data: created, error } = await supabase
      .from('platform_subscription')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('[SubscriptionLimits] Error creating platform subscription:', error);
      throw error;
    }
    result = created;
    console.log('[SubscriptionLimits] Created platform subscription:', result.id);
  }

  return result;
};

/**
 * Update platform subscription fields
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated subscription
 */
const updatePlatformSubscription = async (updates) => {
  const supabase = getSupabase();

  // Use getAnyPlatformSubscription to find the existing row regardless of status
  const existing = await getAnyPlatformSubscription();
  if (!existing) {
    throw new Error('No platform subscription found');
  }

  // Map camelCase to snake_case
  const dbUpdates = {};
  const fieldMapping = {
    stripeSubscriptionId: 'stripe_subscription_id',
    stripeCustomerId: 'stripe_customer_id',
    subscriptionModel: 'subscription_model',
    subscriptionTier: 'subscription_tier',
    subscriptionStatus: 'subscription_status',
    subscriptionStartDate: 'subscription_start_date',
    maxTotalCommitment: 'max_total_commitment',
    maxInvestors: 'max_investors',
    extraCommitmentPurchased: 'extra_commitment_purchased',
    extraInvestorsPurchased: 'extra_investors_purchased',
    creditBalance: 'credit_balance',
    emissionsAvailable: 'emissions_available',
    emissionsUsed: 'emissions_used',
    managedByUserId: 'managed_by_user_id'
  };

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = fieldMapping[key] || key;
    dbUpdates[dbKey] = value;
  }

  const { data, error } = await supabase
    .from('platform_subscription')
    .update(dbUpdates)
    .eq('id', existing.id)
    .select()
    .single();

  if (error) {
    console.error('[SubscriptionLimits] Error updating platform subscription:', error);
    throw error;
  }

  console.log('[SubscriptionLimits] Updated platform subscription:', data.id);
  return data;
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
 * Calculate total commitment across all structures
 * @returns {Promise<number>} Total commitment in dollars
 */
const calculateTotalCommitment = async () => {
  const supabase = getSupabase();

  const { data: structures, error } = await supabase
    .from('structures')
    .select('total_commitment');

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

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate if a new structure can be created based on subscription limits
 * Only applies to tier_based model (checks total commitment)
 *
 * @param {string} userId - User ID (not used, platform-wide validation)
 * @param {number} newCommitment - The total commitment of the new structure
 * @returns {Promise<Object>} Validation result
 */
const validateStructureCreation = async (userId, newCommitment = 0) => {
  try {
    console.log('[SubscriptionLimits] validateStructureCreation called:', { userId, newCommitment });

    const subscription = await getSubscription();
    console.log('[SubscriptionLimits] Platform subscription:', subscription);

    if (!subscription.hasSubscription) {
      return {
        allowed: false,
        reason: 'No active subscription. Please subscribe to create structures.'
      };
    }

    // Only tier_based model has commitment limits
    if (subscription.model !== 'tier_based') {
      console.log('[SubscriptionLimits] Model is not tier_based, skipping commitment validation');
      return { allowed: true };
    }

    const currentTotal = await calculateTotalCommitment();
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
    return {
      allowed: false,
      reason: `Validation error: ${error.message}. Please contact support.`,
      error: error.message
    };
  }
};

/**
 * Validate if a new investor can be created based on subscription limits
 *
 * @param {string} userId - User ID (not used, platform-wide validation)
 * @returns {Promise<Object>} Validation result
 */
const validateInvestorCreation = async (userId) => {
  try {
    console.log('[SubscriptionLimits] validateInvestorCreation called');

    const subscription = await getSubscription();
    console.log('[SubscriptionLimits] Platform subscription:', subscription);

    if (!subscription.hasSubscription) {
      return {
        allowed: false,
        reason: 'No active subscription. Please subscribe to create investors.'
      };
    }

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
    return {
      allowed: false,
      reason: `Validation error: ${error.message}. Please contact support.`,
      error: error.message
    };
  }
};

/**
 * Get current usage statistics for the platform subscription
 * @param {string} userId - User ID (not used, platform-wide)
 * @returns {Promise<Object>} Usage stats
 */
const getSubscriptionUsage = async (userId) => {
  try {
    const subscription = await getSubscription();
    const currentInvestors = await countInvestors();
    const currentCommitment = await calculateTotalCommitment();

    return {
      model: subscription.model,
      tier: subscription.tier,
      status: subscription.status,
      hasSubscription: subscription.hasSubscription,
      investors: {
        current: currentInvestors,
        limit: subscription.maxInvestors,
        remaining: Math.max(0, subscription.maxInvestors - currentInvestors),
        percentUsed: subscription.maxInvestors > 0
          ? Math.round((currentInvestors / subscription.maxInvestors) * 100)
          : 0
      },
      commitment: subscription.model === 'tier_based' ? {
        current: currentCommitment,
        limit: subscription.maxTotalCommitment,
        remaining: Math.max(0, subscription.maxTotalCommitment - currentCommitment),
        percentUsed: subscription.maxTotalCommitment > 0
          ? Math.round((currentCommitment / subscription.maxTotalCommitment) * 100)
          : 0
      } : null,
      creditBalance: subscription.creditBalance,
      emissionsAvailable: subscription.emissionsAvailable,
      emissionsUsed: subscription.emissionsUsed,
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

// ============================================================================
// SUBSCRIPTION UPDATE FUNCTIONS
// ============================================================================

/**
 * Add extra investors to platform subscription
 * @param {string} userId - User ID (not used)
 * @param {number} extraInvestors - Number of extra investors to add
 * @returns {Promise<Object>} Updated subscription
 */
const addExtraInvestors = async (userId, extraInvestors) => {
  const subscription = await getPlatformSubscription();
  if (!subscription) {
    throw new Error('No active platform subscription found');
  }

  const currentMax = subscription.max_investors || 0;
  const currentExtra = subscription.extra_investors_purchased || 0;

  const updated = await updatePlatformSubscription({
    maxInvestors: currentMax + extraInvestors,
    extraInvestorsPurchased: currentExtra + extraInvestors
  });

  console.log('[SubscriptionLimits] Added extra investors:', {
    extraInvestors,
    newMax: updated.max_investors
  });

  return updated;
};

/**
 * Add extra AUM commitment to platform subscription
 * @param {string} userId - User ID (not used)
 * @param {number} extraCommitment - Extra commitment amount to add
 * @returns {Promise<Object>} Updated subscription
 */
const addExtraCommitment = async (userId, extraCommitment) => {
  const subscription = await getPlatformSubscription();
  if (!subscription) {
    throw new Error('No active platform subscription found');
  }

  const currentMax = parseFloat(subscription.max_total_commitment) || 0;
  const currentExtra = parseFloat(subscription.extra_commitment_purchased) || 0;

  const updated = await updatePlatformSubscription({
    maxTotalCommitment: currentMax + extraCommitment,
    extraCommitmentPurchased: currentExtra + extraCommitment
  });

  console.log('[SubscriptionLimits] Added extra commitment:', {
    extraCommitment,
    newMax: updated.max_total_commitment
  });

  return updated;
};

/**
 * Add credits to platform subscription (for PAYG model)
 * @param {string} userId - User ID (not used)
 * @param {number} amountInCents - Amount to add in cents
 * @returns {Promise<Object>} Updated subscription
 */
const addCredits = async (userId, amountInCents) => {
  const subscription = await getPlatformSubscription();
  if (!subscription) {
    throw new Error('No active platform subscription found');
  }

  const currentBalance = subscription.credit_balance || 0;
  const newBalance = currentBalance + amountInCents;

  const updated = await updatePlatformSubscription({
    creditBalance: newBalance
  });

  console.log('[SubscriptionLimits] Added credits:', {
    amountInCents,
    newBalance: updated.credit_balance
  });

  return updated;
};

/**
 * Deduct credits from platform subscription (for PAYG model)
 * @param {string} userId - User ID (not used)
 * @param {number} amountInCents - Amount to deduct in cents
 * @returns {Promise<Object>} Updated subscription
 */
const deductCredits = async (userId, amountInCents) => {
  const subscription = await getPlatformSubscription();
  if (!subscription) {
    throw new Error('No active platform subscription found');
  }

  const currentBalance = subscription.credit_balance || 0;

  if (currentBalance < amountInCents) {
    throw new Error(`Insufficient credits. Current: ${currentBalance}, Required: ${amountInCents}`);
  }

  const newBalance = currentBalance - amountInCents;

  const updated = await updatePlatformSubscription({
    creditBalance: newBalance
  });

  console.log('[SubscriptionLimits] Deducted credits:', {
    amountInCents,
    newBalance: updated.credit_balance
  });

  return updated;
};

// ============================================================================
// CREDIT OPERATION FUNCTIONS
// ============================================================================

/**
 * Get credit cost for an operation based on subscription tier
 * @param {string} operation - Operation type ('kyc_session' or 'document_signing')
 * @param {string} tier - Subscription tier
 * @returns {number} Cost in cents
 */
const getCreditCost = (operation, tier) => {
  const costs = PAYG_CREDIT_COSTS[operation];
  if (!costs) {
    console.warn(`[SubscriptionLimits] Unknown operation: ${operation}`);
    return 0;
  }
  return costs[tier] || costs.starter;
};

/**
 * Check if platform has sufficient credits for an operation (PAYG model only)
 * @param {string} userId - User ID (not used)
 * @param {string} operation - Operation type ('kyc_session' or 'document_signing')
 * @returns {Promise<Object>} { allowed: boolean, cost: number, balance: number, reason?: string }
 */
const checkCreditsForOperation = async (userId, operation) => {
  try {
    const subscription = await getSubscription();

    // Only PAYG model uses credits
    if (subscription.model !== 'payg') {
      return { allowed: true, cost: 0, balance: 0, model: subscription.model };
    }

    const cost = getCreditCost(operation, subscription.tier);
    const balance = subscription.creditBalance || 0;

    if (balance < cost) {
      return {
        allowed: false,
        cost,
        balance,
        model: subscription.model,
        tier: subscription.tier,
        reason: `Insufficient credits. This operation costs $${(cost / 100).toFixed(2)} but your balance is $${(balance / 100).toFixed(2)}. Please add more credits to continue.`
      };
    }

    return {
      allowed: true,
      cost,
      balance,
      model: subscription.model,
      tier: subscription.tier
    };
  } catch (error) {
    console.error('[SubscriptionLimits] checkCreditsForOperation error:', error);
    throw error;
  }
};

/**
 * Deduct credits for an operation (PAYG model only)
 * @param {string} userId - User ID (not used)
 * @param {string} operation - Operation type ('kyc_session' or 'document_signing')
 * @returns {Promise<Object>} { success: boolean, cost: number, newBalance: number, reason?: string }
 */
const deductCreditsForOperation = async (userId, operation) => {
  try {
    const check = await checkCreditsForOperation(userId, operation);

    if (!check.allowed) {
      return {
        success: false,
        cost: check.cost,
        balance: check.balance,
        reason: check.reason
      };
    }

    // Skip deduction for non-PAYG models
    if (check.model !== 'payg') {
      return {
        success: true,
        cost: 0,
        newBalance: 0,
        model: check.model
      };
    }

    // Deduct the credits
    const updated = await deductCredits(userId, check.cost);

    console.log(`[SubscriptionLimits] Deducted ${check.cost} cents for ${operation}. New balance: ${updated.credit_balance}`);

    return {
      success: true,
      cost: check.cost,
      newBalance: updated.credit_balance,
      model: check.model,
      tier: check.tier
    };
  } catch (error) {
    console.error('[SubscriptionLimits] deductCreditsForOperation error:', error);
    throw error;
  }
};

// ============================================================================
// BACKWARD COMPATIBILITY (deprecated, use getSubscription instead)
// ============================================================================

/**
 * @deprecated Use getSubscription() instead
 */
const findSubscriptionOwner = async () => {
  console.warn('[SubscriptionLimits] findSubscriptionOwner is deprecated, use getPlatformSubscription instead');
  return getPlatformSubscription();
};

/**
 * @deprecated Use upsertPlatformSubscription() instead
 */
const updateUserSubscription = async (userId, model, tier) => {
  console.warn('[SubscriptionLimits] updateUserSubscription is deprecated');
  const defaults = getDefaultLimits(model, tier);

  return upsertPlatformSubscription({
    subscriptionModel: model,
    subscriptionTier: tier,
    maxTotalCommitment: defaults.maxTotalCommitment,
    maxInvestors: defaults.maxInvestors,
    extraCommitmentPurchased: 0,
    extraInvestorsPurchased: 0,
    managedByUserId: userId
  });
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Default Constants (for reference/fallback)
  PAYG_LIMITS,
  TIER_BASED_LIMITS,
  PAYG_CREDIT_COSTS,

  // Helper functions
  getDefaultLimits,
  getUpgradeTier,
  formatCurrency,
  getCreditCost,

  // Platform subscription functions (NEW)
  getAnyPlatformSubscription,
  getPlatformSubscription,
  getSubscription,
  upsertPlatformSubscription,
  updatePlatformSubscription,

  // Database queries
  countInvestors,
  calculateTotalCommitment,

  // Backward compatibility (delegates to platform subscription)
  getUserSubscription,
  findSubscriptionOwner,
  updateUserSubscription,

  // Validation functions
  validateStructureCreation,
  validateInvestorCreation,
  checkCreditsForOperation,

  // Usage and updates
  getSubscriptionUsage,
  addExtraInvestors,
  addExtraCommitment,

  // Credit management (PAYG)
  addCredits,
  deductCredits,
  deductCreditsForOperation
};
