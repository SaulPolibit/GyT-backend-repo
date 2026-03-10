/**
 * Stripe Routes
 * Handles all Stripe subscription endpoints
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { catchAsync } = require('../middleware/errorHandler');
const stripeService = require('../services/stripe.service');
const { User } = require('../models/supabase');
const { upsertPlatformSubscription, getPlatformSubscription } = require('../services/subscriptionLimits.service');

// Minimum subscription period in months
const MINIMUM_SUBSCRIPTION_MONTHS = 12;

// Subscription model from environment (defaults to 'payg')
const SUBSCRIPTION_MODEL = process.env.SUBSCRIPTION_MODEL || 'payg';
const SUBSCRIPTION_TIER = process.env.SUBSCRIPTION_TIER || 'starter';

// Price IDs from environment
const PRICE_IDS = {
  SERVICE_BASE_COST: process.env.STRIPE_SERVICE_BASE_COST_PRICE_ID,
  ADDITIONAL_SERVICE_COST: process.env.STRIPE_ADDITIONAL_SERVICE_COST_PRICE_ID
};

/**
 * GET /api/stripe/config
 * Get Stripe configuration for frontend
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    priceIds: PRICE_IDS,
    currency: 'usd'
  });
});

/**
 * POST /api/stripe/create-customer
 * Create a Stripe customer for the authenticated user
 */
router.post('/create-customer', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id || req.user.userId;
  const user = await User.findById(userId);

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  // Check if customer already exists
  if (user.stripeCustomerId) {
    return res.json({ success: true, customerId: user.stripeCustomerId });
  }

  // Create new customer
  const customer = await stripeService.createCustomer(user);

  // Update user with Stripe customer ID
  await User.findByIdAndUpdate(userId, { stripeCustomerId: customer.id });

  res.json({ success: true, customerId: customer.id });
}));

/**
 * POST /api/stripe/create-subscription
 * Create a subscription for the authenticated user
 */
router.post('/create-subscription', authenticate, catchAsync(async (req, res) => {
  const { cardToken, additionalServiceQuantity = 0, trialDays } = req.body;
  const userId = req.user.id || req.user.userId;
  const user = await User.findById(userId);

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (!cardToken) {
    return res.status(400).json({ success: false, message: 'Card token is required' });
  }

  if (!user.stripeCustomerId) {
    return res.status(400).json({ success: false, message: 'Please create a customer first' });
  }

  // Create payment method from token and attach to customer
  const paymentMethod = await stripeService.createPaymentMethodFromToken(cardToken);
  await stripeService.attachPaymentMethodToCustomer(paymentMethod.id, user.stripeCustomerId);

  // Prepare addons
  const addons = [];
  if (additionalServiceQuantity > 0 && PRICE_IDS.ADDITIONAL_SERVICE_COST) {
    addons.push({
      priceId: PRICE_IDS.ADDITIONAL_SERVICE_COST,
      quantity: additionalServiceQuantity
    });
  }

  // Subscription options
  const options = { default_payment_method: paymentMethod.id };
  if (trialDays && trialDays > 0) {
    options.trial_period_days = trialDays;
  }

  // Create subscription
  const subscription = await stripeService.createSubscription(
    user.stripeCustomerId,
    PRICE_IDS.SERVICE_BASE_COST,
    addons,
    options
  );

  // Update user with subscription info
  await User.findByIdAndUpdate(userId, {
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status
  });

  // Update platform subscription with model and tier from env vars
  await upsertPlatformSubscription({
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: user.stripeCustomerId,
    subscriptionModel: SUBSCRIPTION_MODEL,
    subscriptionTier: SUBSCRIPTION_TIER,
    subscriptionStatus: subscription.status,
    subscriptionStartDate: new Date().toISOString(),
    managedByUserId: userId
  });

  console.log(`[Stripe] Created subscription with model: ${SUBSCRIPTION_MODEL}, tier: ${SUBSCRIPTION_TIER}`);

  res.json({
    success: true,
    subscriptionId: subscription.id,
    status: subscription.status,
    subscriptionModel: SUBSCRIPTION_MODEL,
    subscriptionTier: SUBSCRIPTION_TIER,
    message: subscription.status === 'active'
      ? 'Subscription created and payment successful!'
      : 'Subscription created'
  });
}));

/**
 * GET /api/stripe/subscription
 * Get the current user's subscription
 */
router.get('/subscription', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id || req.user.userId;
  const user = await User.findById(userId);

  if (!user || !user.stripeSubscriptionId) {
    return res.json({ success: true, subscription: null });
  }

  const subscription = await stripeService.getSubscription(user.stripeSubscriptionId);
  res.json({ success: true, subscription });
}));

/**
 * POST /api/stripe/add-additional-service
 * Add an additional service to the current subscription
 */
router.post('/add-additional-service', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id || req.user.userId;
  const user = await User.findById(userId);

  if (!user || !user.stripeSubscriptionId) {
    return res.status(400).json({ success: false, message: 'No active subscription found' });
  }

  if (!PRICE_IDS.ADDITIONAL_SERVICE_COST) {
    return res.status(500).json({ success: false, message: 'Additional service price not configured' });
  }

  const item = await stripeService.addAddonToSubscription(
    user.stripeSubscriptionId,
    PRICE_IDS.ADDITIONAL_SERVICE_COST
  );

  res.json({ success: true, subscriptionItem: item });
}));

/**
 * POST /api/stripe/update-service-quantity
 * Update the quantity of a service item
 */
router.post('/update-service-quantity', authenticate, catchAsync(async (req, res) => {
  const { subscriptionItemId, quantity } = req.body;

  if (!subscriptionItemId || quantity === undefined) {
    return res.status(400).json({ success: false, message: 'subscriptionItemId and quantity are required' });
  }

  const updated = await stripeService.updateSubscriptionItemQuantity(subscriptionItemId, quantity);
  res.json({ success: true, subscriptionItem: updated });
}));

/**
 * POST /api/stripe/remove-service
 * Remove a service item from the subscription
 */
router.post('/remove-service', authenticate, catchAsync(async (req, res) => {
  const { subscriptionItemId } = req.body;

  if (!subscriptionItemId) {
    return res.status(400).json({ success: false, message: 'subscriptionItemId is required' });
  }

  const deleted = await stripeService.removeAddonFromSubscription(subscriptionItemId);
  res.json({ success: true, deleted });
}));

/**
 * POST /api/stripe/cancel-subscription
 * Cancel the current subscription (requires minimum 12-month period)
 */
router.post('/cancel-subscription', authenticate, catchAsync(async (req, res) => {
  const { immediately = false } = req.body;
  const userId = req.user.id || req.user.userId;
  const user = await User.findById(userId);

  if (!user || !user.stripeSubscriptionId) {
    return res.status(400).json({ success: false, message: 'No active subscription found' });
  }

  // Check minimum subscription period using platform subscription
  const platformSubscription = await getPlatformSubscription();

  if (platformSubscription && platformSubscription.subscription_start_date) {
    const startDate = new Date(platformSubscription.subscription_start_date);
    const now = new Date();
    const monthsDiff = (now.getFullYear() - startDate.getFullYear()) * 12 +
                       (now.getMonth() - startDate.getMonth());

    if (monthsDiff < MINIMUM_SUBSCRIPTION_MONTHS) {
      const remainingMonths = MINIMUM_SUBSCRIPTION_MONTHS - monthsDiff;
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + MINIMUM_SUBSCRIPTION_MONTHS);

      return res.status(400).json({
        success: false,
        message: `Cannot cancel subscription before minimum ${MINIMUM_SUBSCRIPTION_MONTHS}-month period. You have ${remainingMonths} month(s) remaining until ${endDate.toLocaleDateString()}.`,
        minimumPeriod: MINIMUM_SUBSCRIPTION_MONTHS,
        subscriptionStartDate: startDate.toISOString(),
        earliestCancellationDate: endDate.toISOString(),
        remainingMonths
      });
    }
  }

  const subscription = await stripeService.cancelSubscription(user.stripeSubscriptionId, immediately);

  await User.findByIdAndUpdate(userId, {
    subscriptionStatus: immediately ? 'canceled' : 'canceling'
  });

  res.json({ success: true, subscription });
}));

/**
 * POST /api/stripe/reactivate-subscription
 * Reactivate a subscription scheduled for cancellation
 */
router.post('/reactivate-subscription', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id || req.user.userId;
  const user = await User.findById(userId);

  if (!user || !user.stripeSubscriptionId) {
    return res.status(400).json({ success: false, message: 'No subscription found' });
  }

  const subscription = await stripeService.reactivateSubscription(user.stripeSubscriptionId);

  await User.findByIdAndUpdate(userId, { subscriptionStatus: subscription.status });

  res.json({ success: true, subscription });
}));

/**
 * GET /api/stripe/invoices
 * Get invoices for the current user
 */
router.get('/invoices', authenticate, catchAsync(async (req, res) => {
  const { limit = 10 } = req.query;
  const userId = req.user.id || req.user.userId;
  const user = await User.findById(userId);

  if (!user || !user.stripeCustomerId) {
    return res.json({ success: true, invoices: [] });
  }

  const invoices = await stripeService.getCustomerInvoices(user.stripeCustomerId, parseInt(limit));
  res.json({ success: true, invoices: invoices.data });
}));

/**
 * GET /api/stripe/upcoming-invoice
 * Get the upcoming invoice for the current user
 */
router.get('/upcoming-invoice', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id || req.user.userId;
  const user = await User.findById(userId);

  if (!user || !user.stripeCustomerId) {
    return res.json({ success: true, upcomingInvoice: null });
  }

  const upcomingInvoice = await stripeService.getUpcomingInvoice(user.stripeCustomerId);
  res.json({ success: true, upcomingInvoice });
}));

/**
 * POST /api/stripe/webhook
 * Handle Stripe webhook events
 * Note: This needs raw body, so should be mounted before JSON parser
 */
router.post('/webhook', express.raw({ type: 'application/json' }), catchAsync(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Stripe Webhook] Webhook secret not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    event = stripeService.verifyWebhookSignature(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  // Handle the event
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const user = await User.findOne({ stripeCustomerId: subscription.customer });
      if (user) {
        await User.findByIdAndUpdate(user.id, {
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status
        });

        // Also update platform_subscription with model from env
        await upsertPlatformSubscription({
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: subscription.customer,
          subscriptionModel: SUBSCRIPTION_MODEL,
          subscriptionTier: SUBSCRIPTION_TIER,
          subscriptionStatus: subscription.status,
          managedByUserId: user.id
        });

        console.log(`[Stripe Webhook] Updated subscription for user ${user.id} - model: ${SUBSCRIPTION_MODEL}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const deletedSub = event.data.object;
      const user = await User.findOne({ stripeCustomerId: deletedSub.customer });
      if (user) {
        await User.findByIdAndUpdate(user.id, { subscriptionStatus: 'canceled' });

        // Also update platform_subscription status
        await upsertPlatformSubscription({
          stripeSubscriptionId: deletedSub.id,
          subscriptionStatus: 'canceled'
        });

        console.log(`[Stripe Webhook] Marked subscription as canceled for user ${user.id}`);
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      console.log(`[Stripe Webhook] Payment succeeded for invoice ${invoice.id}`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`[Stripe Webhook] Payment failed for invoice ${invoice.id}`);
      // Optionally update user subscription status
      const user = await User.findOne({ stripeCustomerId: invoice.customer });
      if (user) {
        await User.findByIdAndUpdate(user.id, { subscriptionStatus: 'past_due' });
      }
      break;
    }

    default:
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
}));

// ==========================================
// STRIPE CONNECT ROUTES (for Investors - role 3)
// ==========================================

/**
 * @route   POST /api/stripe/connect/create-account
 * @desc    Create a Stripe Connect account for an investor
 * @access  Private (Investors only - role 3)
 */
router.post('/connect/create-account', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Only investors (role 3) can create Connect accounts
  if (user.role !== 3) {
    return res.status(403).json({
      success: false,
      message: 'Only investors can create Stripe Connect accounts'
    });
  }

  // Check if user already has a Connect account
  if (user.stripeAccountId) {
    return res.json({
      success: true,
      accountId: user.stripeAccountId,
      message: 'Connect account already exists'
    });
  }

  // Create Stripe Connect account
  const account = await stripeService.createConnectAccount(user);

  // Save account ID to user record
  await User.findByIdAndUpdate(user.id, {
    stripeAccountId: account.id,
    stripeAccountStatus: 'pending',
    stripeOnboardingComplete: false
  });

  res.json({
    success: true,
    accountId: account.id,
    message: 'Stripe Connect account created successfully'
  });
}));

/**
 * @route   POST /api/stripe/connect/onboarding-link
 * @desc    Create an onboarding link for Stripe Connect
 * @access  Private (Investors only - role 3)
 * @body    { returnUrl: 'https://...', refreshUrl: 'https://...' }
 */
router.post('/connect/onboarding-link', authenticate, catchAsync(async (req, res) => {
  const { returnUrl, refreshUrl } = req.body;
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Only investors (role 3) can access Connect
  if (user.role !== 3) {
    return res.status(403).json({
      success: false,
      message: 'Only investors can access Stripe Connect'
    });
  }

  // Check if user has a Connect account
  if (!user.stripeAccountId) {
    return res.status(400).json({
      success: false,
      message: 'No Connect account found. Please create an account first.'
    });
  }

  // Default URLs if not provided
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const finalReturnUrl = returnUrl || `${baseUrl}/lp-portal/settings?tab=payment&onboarding=complete`;
  const finalRefreshUrl = refreshUrl || `${baseUrl}/lp-portal/settings?tab=payment&onboarding=refresh`;

  // Create onboarding link
  const accountLink = await stripeService.createAccountLink(
    user.stripeAccountId,
    finalRefreshUrl,
    finalReturnUrl
  );

  res.json({
    success: true,
    url: accountLink.url,
    expiresAt: accountLink.expires_at,
    message: 'Onboarding link created successfully'
  });
}));

/**
 * @route   GET /api/stripe/connect/account-status
 * @desc    Get Stripe Connect account status
 * @access  Private (Investors only - role 3)
 */
router.get('/connect/account-status', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Only investors (role 3) can access Connect
  if (user.role !== 3) {
    return res.status(403).json({
      success: false,
      message: 'Only investors can access Stripe Connect'
    });
  }

  // Check if user has a Connect account
  if (!user.stripeAccountId) {
    return res.json({
      success: true,
      hasAccount: false,
      status: 'not_created',
      message: 'No Connect account found'
    });
  }

  // Get account status from Stripe
  const status = await stripeService.checkConnectAccountStatus(user.stripeAccountId);

  // Update user record if status changed
  if (status.isComplete !== user.stripeOnboardingComplete || status.accountStatus !== user.stripeAccountStatus) {
    await User.findByIdAndUpdate(user.id, {
      stripeOnboardingComplete: status.isComplete,
      stripeAccountStatus: status.accountStatus
    });
  }

  res.json({
    success: true,
    hasAccount: true,
    accountId: user.stripeAccountId,
    ...status
  });
}));

/**
 * @route   GET /api/stripe/connect/dashboard-link
 * @desc    Get a link to the Stripe Connect Express dashboard
 * @access  Private (Investors only - role 3)
 */
router.get('/connect/dashboard-link', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Only investors (role 3) can access Connect
  if (user.role !== 3) {
    return res.status(403).json({
      success: false,
      message: 'Only investors can access Stripe Connect'
    });
  }

  // Check if user has a Connect account
  if (!user.stripeAccountId) {
    return res.status(400).json({
      success: false,
      message: 'No Connect account found'
    });
  }

  // Check if onboarding is complete
  if (!user.stripeOnboardingComplete) {
    return res.status(400).json({
      success: false,
      message: 'Please complete onboarding first'
    });
  }

  // Create dashboard login link
  const loginLink = await stripeService.createConnectDashboardLink(user.stripeAccountId);

  res.json({
    success: true,
    url: loginLink.url,
    message: 'Dashboard link created successfully'
  });
}));

/**
 * @route   GET /api/stripe/connect/balance
 * @desc    Get Stripe Connect account balance
 * @access  Private (Investors only - role 3)
 */
router.get('/connect/balance', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Only investors (role 3) can access Connect
  if (user.role !== 3) {
    return res.status(403).json({
      success: false,
      message: 'Only investors can access Stripe Connect'
    });
  }

  // Check if user has a Connect account
  if (!user.stripeAccountId) {
    return res.status(400).json({
      success: false,
      message: 'No Connect account found'
    });
  }

  // Get account balance
  const balance = await stripeService.getConnectAccountBalance(user.stripeAccountId);

  res.json({
    success: true,
    balance: balance
  });
}));

// ==========================================
// ADMIN ROUTES (for Fund Managers - roles 1, 2)
// ==========================================

/**
 * @route   GET /api/stripe/connect/admin/status/:investorId
 * @desc    Get Stripe Connect status for a specific investor (admin)
 * @access  Private (Fund Managers - role 1 or 2)
 */
router.get('/connect/admin/status/:investorId', authenticate, catchAsync(async (req, res) => {
  const adminUser = await User.findById(req.user.id);

  // Only fund managers (role 1 or 2) can access admin routes
  if (!adminUser || (adminUser.role !== 1 && adminUser.role !== 2)) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }

  const { investorId } = req.params;
  const investor = await User.findById(investorId);

  if (!investor) {
    return res.status(404).json({
      success: false,
      message: 'Investor not found'
    });
  }

  // Check if investor has a Connect account
  if (!investor.stripeAccountId) {
    return res.json({
      success: true,
      hasAccount: false,
      accountStatus: 'not_created',
      message: 'No Connect account found'
    });
  }

  // Get account status from Stripe
  const status = await stripeService.checkConnectAccountStatus(investor.stripeAccountId);

  res.json({
    success: true,
    hasAccount: true,
    investorId: investor.id,
    accountId: investor.stripeAccountId,
    ...status
  });
}));

/**
 * @route   POST /api/stripe/connect/admin/send-invite/:investorId
 * @desc    Send Stripe Connect onboarding invite to investor
 * @access  Private (Fund Managers - role 1 or 2)
 */
router.post('/connect/admin/send-invite/:investorId', authenticate, catchAsync(async (req, res) => {
  const adminUser = await User.findById(req.user.id);

  // Only fund managers (role 1 or 2) can access admin routes
  if (!adminUser || (adminUser.role !== 1 && adminUser.role !== 2)) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }

  const { investorId } = req.params;
  const investor = await User.findById(investorId);

  if (!investor) {
    return res.status(404).json({
      success: false,
      message: 'Investor not found'
    });
  }

  // Create Connect account if not exists
  let accountId = investor.stripeAccountId;
  if (!accountId) {
    const account = await stripeService.createConnectAccount(investor);
    accountId = account.id;

    // Save account ID to investor record
    await User.findByIdAndUpdate(investor.id, {
      stripeAccountId: account.id,
      stripeAccountStatus: 'pending',
      stripeOnboardingComplete: false
    });
  }

  // Create onboarding link
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const accountLink = await stripeService.createAccountLink(
    accountId,
    `${baseUrl}/lp-portal/settings?tab=payment&onboarding=refresh`,
    `${baseUrl}/lp-portal/settings?tab=payment&onboarding=complete`
  );

  // TODO: Send email with onboarding link using your email service

  res.json({
    success: true,
    message: 'Onboarding invite prepared',
    onboardingUrl: accountLink.url,
    expiresAt: accountLink.expires_at,
    investorEmail: investor.email
  });
}));

/**
 * @route   GET /api/stripe/connect/admin/investors
 * @desc    Get all investors with their Stripe Connect status
 * @access  Private (Fund Managers - role 1 or 2)
 */
router.get('/connect/admin/investors', authenticate, catchAsync(async (req, res) => {
  const adminUser = await User.findById(req.user.id);

  // Only fund managers (role 1 or 2) can access admin routes
  if (!adminUser || (adminUser.role !== 1 && adminUser.role !== 2)) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }

  // Get all investors (role 3)
  const investors = await User.find({ role: 3 });

  const investorsWithStatus = investors.map(investor => ({
    id: investor.id,
    name: investor.name || `${investor.firstName} ${investor.lastName}`,
    email: investor.email,
    stripeAccountId: investor.stripeAccountId,
    stripeOnboardingComplete: investor.stripeOnboardingComplete,
    stripeAccountStatus: investor.stripeAccountStatus || 'not_created'
  }));

  res.json({
    success: true,
    data: investorsWithStatus,
    total: investorsWithStatus.length,
    withAccount: investorsWithStatus.filter(i => i.stripeAccountId).length,
    onboardingComplete: investorsWithStatus.filter(i => i.stripeOnboardingComplete).length
  });
}));

// ==========================================
// STRIPE CONNECT WEBHOOK
// Separate endpoint for Connect events
// ==========================================

/**
 * @route   POST /api/stripe/webhook-connect
 * @desc    Handle Stripe Connect webhook events
 * @access  Public (Stripe only - verified by signature)
 */
router.post('/webhook-connect', catchAsync(async (req, res) => {
  const signature = req.headers['stripe-signature'];

  if (!signature) {
    console.error('[Stripe Connect Webhook] Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing signature' });
  }

  let event;

  try {
    // Verify webhook signature using Connect-specific method
    event = stripeService.verifyConnectWebhookSignature(req.body, signature);
  } catch (error) {
    console.error('[Stripe Connect Webhook] Signature verification failed:', error.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${error.message}` });
  }

  console.log(`[Stripe Connect Webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      // ==========================================
      // ACCOUNT EVENTS
      // ==========================================

      case 'account.updated': {
        const account = event.data.object;
        console.log(`[Stripe Connect Webhook] Account updated: ${account.id}`);

        // Determine account status
        let accountStatus = 'pending';
        let onboardingComplete = false;

        if (account.details_submitted && account.charges_enabled && account.payouts_enabled) {
          accountStatus = 'enabled';
          onboardingComplete = true;
        } else if (account.requirements?.disabled_reason) {
          accountStatus = 'disabled';
        } else if (account.requirements?.currently_due?.length > 0) {
          accountStatus = 'pending';
        }

        // Find user with this Connect account
        const user = await User.findOne({ stripeAccountId: account.id });

        if (user) {
          await User.findByIdAndUpdate(user.id, {
            stripeOnboardingComplete: onboardingComplete,
            stripeAccountStatus: accountStatus
          });
          console.log(`[Stripe Connect Webhook] Updated user ${user.id} - status: ${accountStatus}, onboarding: ${onboardingComplete}`);
        } else {
          console.warn(`[Stripe Connect Webhook] No user found with Connect account ID: ${account.id}`);
        }
        break;
      }

      case 'account.application.deauthorized': {
        const account = event.data.object;
        console.log(`[Stripe Connect Webhook] Account deauthorized: ${account.id}`);

        const user = await User.findOne({ stripeAccountId: account.id });
        if (user) {
          await User.findByIdAndUpdate(user.id, {
            stripeAccountId: null,
            stripeOnboardingComplete: false,
            stripeAccountStatus: 'not_created'
          });
          console.log(`[Stripe Connect Webhook] Cleared Connect account for user ${user.id}`);
        }
        break;
      }

      // ==========================================
      // EXTERNAL ACCOUNT EVENTS (Bank accounts)
      // ==========================================

      case 'account.external_account.created':
      case 'account.external_account.deleted':
      case 'account.external_account.updated': {
        const externalAccount = event.data.object;
        const accountId = event.account;
        console.log(`[Stripe Connect Webhook] External account ${event.type.split('.').pop()} for ${accountId}: ${externalAccount.id}`);
        break;
      }

      // ==========================================
      // TRANSFER EVENTS (Platform to Connected Account)
      // ==========================================

      case 'transfer.created': {
        const transfer = event.data.object;
        console.log(`[Stripe Connect Webhook] Transfer created: ${transfer.id} to ${transfer.destination} for ${transfer.amount} ${transfer.currency}`);
        break;
      }

      case 'transfer.failed': {
        const transfer = event.data.object;
        console.error(`[Stripe Connect Webhook] Transfer failed: ${transfer.id}`);
        // TODO: Handle failed transfer - notify admin, retry, etc.
        break;
      }

      case 'transfer.reversed': {
        const transfer = event.data.object;
        console.warn(`[Stripe Connect Webhook] Transfer reversed: ${transfer.id}`);
        break;
      }

      // ==========================================
      // PAYOUT EVENTS (Connected Account to Bank)
      // ==========================================

      case 'payout.created': {
        const payout = event.data.object;
        const accountId = event.account;
        console.log(`[Stripe Connect Webhook] Payout created for ${accountId}: ${payout.id} - ${payout.amount} ${payout.currency}`);
        break;
      }

      case 'payout.paid': {
        const payout = event.data.object;
        const accountId = event.account;
        console.log(`[Stripe Connect Webhook] Payout paid for ${accountId}: ${payout.id}`);

        const user = await User.findOne({ stripeAccountId: accountId });
        if (user) {
          console.log(`[Stripe Connect Webhook] Payout completed for user ${user.id}: ${payout.amount / 100} ${payout.currency.toUpperCase()}`);
          // TODO: Send notification to investor about payout
        }
        break;
      }

      case 'payout.failed': {
        const payout = event.data.object;
        const accountId = event.account;
        console.error(`[Stripe Connect Webhook] Payout failed for ${accountId}: ${payout.id} - ${payout.failure_message}`);

        const user = await User.findOne({ stripeAccountId: accountId });
        if (user) {
          console.error(`[Stripe Connect Webhook] Payout failed for user ${user.id}: ${payout.failure_message}`);
          // TODO: Notify investor about failed payout
        }
        break;
      }

      // ==========================================
      // CAPABILITY EVENTS
      // ==========================================

      case 'capability.updated': {
        const capability = event.data.object;
        const accountId = event.account;
        console.log(`[Stripe Connect Webhook] Capability ${capability.id} updated for ${accountId}: ${capability.status}`);
        break;
      }

      default:
        console.log(`[Stripe Connect Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`[Stripe Connect Webhook] Error processing event ${event.type}:`, error);
    // Don't return error - acknowledge receipt to Stripe
  }

  // Always return 200 to acknowledge receipt
  res.status(200).json({ received: true });
}));

module.exports = router;
