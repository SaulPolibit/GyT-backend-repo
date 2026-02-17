/**
 * Stripe API Routes
 * Handles subscription management, payments, and webhooks
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { catchAsync } = require('../middleware/errorHandler');
const stripeService = require('../services/stripe.service');
const { User } = require('../models/supabase');

// Price IDs - Get these from Stripe Dashboard after creating products
// You can also use environment variables for flexibility
const PRICE_IDS = {
  SERVICE_BASE_COST: process.env.STRIPE_SERVICE_BASE_COST_PRICE_ID || 'price_1xxxxxxxxxxxxx',
  ADDITIONAL_SERVICE_COST: process.env.STRIPE_ADDITIONAL_SERVICE_COST_PRICE_ID || 'price_2xxxxxxxxxxxxx'
};

// Service mapping: frontend ID -> Stripe price ID
const SERVICE_MAPPING = {
  'additional_service': PRICE_IDS.ADDITIONAL_SERVICE_COST
};

/**
 * @route   GET /api/stripe/config
 * @desc    Get public Stripe configuration (publishable key, price IDs)
 * @access  Public
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    priceIds: PRICE_IDS,
    currency: 'mxn'
  });
});

/**
 * @route   POST /api/stripe/create-customer
 * @desc    Create a Stripe customer for the authenticated user
 * @access  Private
 */
router.post('/create-customer', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Check if user already has a Stripe customer ID
  if (user.stripeCustomerId) {
    console.log(`[Stripe Routes] User ${user.id} already has customer ID: ${user.stripeCustomerId}`);
    return res.json({
      success: true,
      customerId: user.stripeCustomerId,
      message: 'Customer already exists'
    });
  }

  // Create Stripe customer
  const customer = await stripeService.createCustomer(user);

  // Save customer ID to user record
  await User.findByIdAndUpdate(user.id, {
    stripeCustomerId: customer.id
  });

  res.json({
    success: true,
    customerId: customer.id,
    message: 'Stripe customer created successfully'
  });
}));

/**
 * @route   POST /api/stripe/create-subscription
 * @desc    Create a new subscription with Service Base Cost and optional Additional Service
 * @access  Private
 * @body    {
 *            cardToken: 'tok_xxxxx', // Required - Stripe card token (backend creates payment method)
 *            additionalServiceQuantity: 2, // Optional - quantity of Additional Service Base Cost (default: 0)
 *            includeAdditionalService: true, // Optional - legacy boolean support
 *            trialDays: 7 // Optional trial period in days
 *          }
 */
router.post('/create-subscription', authenticate, catchAsync(async (req, res) => {
  const { cardToken, additionalServiceQuantity, includeAdditionalService = false, trialDays } = req.body;
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Validate card token
  if (!cardToken) {
    return res.status(400).json({
      success: false,
      message: 'Card token is required. Please provide a valid card token.'
    });
  }

  // Ensure user has a Stripe customer ID
  if (!user.stripeCustomerId) {
    return res.status(400).json({
      success: false,
      message: 'Please create a customer first. Call POST /api/stripe/create-customer'
    });
  }

  // Create payment method from card token
  console.log(`[Stripe Routes] Creating payment method from card token`);
  const paymentMethod = await stripeService.createPaymentMethodFromToken(cardToken);

  // Attach payment method to customer and set as default
  console.log(`[Stripe Routes] Attaching payment method ${paymentMethod.id} to customer ${user.stripeCustomerId}`);
  await stripeService.attachPaymentMethodToCustomer(paymentMethod.id, user.stripeCustomerId);

  // Check if user already has an active subscription
  if (user.stripeSubscriptionId) {
    const existingSub = await stripeService.getSubscription(user.stripeSubscriptionId);
    if (existingSub.status === 'active' || existingSub.status === 'trialing') {
      return res.status(400).json({
        success: false,
        message: 'User already has an active subscription',
        subscriptionId: existingSub.id,
        status: existingSub.status
      });
    }
  }

  // Build addons array with quantities
  const addons = [];

  // Support both new quantity-based approach and legacy boolean approach
  let quantity = 0;
  if (additionalServiceQuantity !== undefined) {
    quantity = parseInt(additionalServiceQuantity) || 0;
  } else if (includeAdditionalService) {
    quantity = 1;
  }

  if (quantity > 0) {
    addons.push({
      priceId: PRICE_IDS.ADDITIONAL_SERVICE_COST,
      quantity: quantity
    });
  }

  // Create subscription options
  const options = {
    default_payment_method: paymentMethod.id // Set payment method for immediate charge
  };

  if (trialDays && trialDays > 0) {
    options.trial_period_days = trialDays;
  }

  // Create subscription with Service Base Cost + optional Additional Service
  console.log(`[Stripe Routes] Creating subscription with payment method ${paymentMethod.id}`);
  const subscription = await stripeService.createSubscription(
    user.stripeCustomerId,
    PRICE_IDS.SERVICE_BASE_COST,
    addons,
    options
  );

  // Save subscription info to user
  await User.findByIdAndUpdate(user.id, {
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status
  });

  console.log('[Stripe Routes] Subscription created:', {
    subscriptionId: subscription.id,
    status: subscription.status,
    latestInvoice: subscription.latest_invoice?.id,
    paymentIntent: subscription.latest_invoice?.payment_intent?.id
  });

  // With payment method attached, subscription should charge immediately
  // Status will be 'active' if successful, 'incomplete' if payment failed
  let message = 'Subscription created successfully!';
  if (subscription.status === 'active') {
    message = 'Subscription created and payment successful!';
  } else if (subscription.status === 'incomplete') {
    message = 'Subscription created but payment failed. Please check your payment method.';
  }

  res.json({
    success: true,
    subscriptionId: subscription.id,
    status: subscription.status,
    message: message
  });
}));

/**
 * @route   POST /api/stripe/add-additional-service
 * @desc    Add Additional Service Base Cost to existing subscription
 * @access  Private
 */
router.post('/add-additional-service', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!user.stripeSubscriptionId) {
    return res.status(400).json({
      success: false,
      message: 'No active subscription found. Create a subscription first.'
    });
  }

  const priceId = PRICE_IDS.ADDITIONAL_SERVICE_COST;

  // Add Additional Service to subscription
  const subscriptionItem = await stripeService.addAddonToSubscription(
    user.stripeSubscriptionId,
    priceId
  );

  res.json({
    success: true,
    subscriptionItem: subscriptionItem,
    message: 'Additional Service Base Cost added successfully. Prorated charges will apply.'
  });
}));

/**
 * @route   POST /api/stripe/update-service-quantity
 * @desc    Update quantity of Additional Service in subscription
 * @access  Private
 * @body    { subscriptionItemId: 'si_xxxxx', quantity: 2 }
 */
router.post('/update-service-quantity', authenticate, catchAsync(async (req, res) => {
  const { subscriptionItemId, quantity } = req.body;
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!subscriptionItemId || !quantity) {
    return res.status(400).json({
      success: false,
      message: 'subscriptionItemId and quantity are required'
    });
  }

  if (quantity < 1) {
    return res.status(400).json({
      success: false,
      message: 'Quantity must be at least 1. Use remove-service to remove the item.'
    });
  }

  // Update Additional Service quantity
  const updated = await stripeService.updateSubscriptionItemQuantity(subscriptionItemId, quantity);

  res.json({
    success: true,
    subscriptionItem: updated,
    message: `Additional Service quantity updated to ${quantity}. Prorated charges will apply.`
  });
}));

/**
 * @route   POST /api/stripe/remove-service
 * @desc    Remove Additional Service from subscription
 * @access  Private
 * @body    { subscriptionItemId: 'si_xxxxx' }
 */
router.post('/remove-service', authenticate, catchAsync(async (req, res) => {
  const { subscriptionItemId } = req.body;
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!subscriptionItemId) {
    return res.status(400).json({
      success: false,
      message: 'subscriptionItemId is required'
    });
  }

  // Remove Additional Service
  const deleted = await stripeService.removeAddonFromSubscription(subscriptionItemId);

  res.json({
    success: true,
    deleted: deleted,
    message: 'Additional Service removed successfully. Prorated credits will apply.'
  });
}));

/**
 * @route   GET /api/stripe/subscription
 * @desc    Get current subscription details
 * @access  Private
 */
router.get('/subscription', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!user.stripeSubscriptionId) {
    return res.json({
      success: true,
      subscription: null,
      message: 'No subscription found'
    });
  }

  const subscription = await stripeService.getSubscription(user.stripeSubscriptionId);

  res.json({
    success: true,
    subscription: subscription
  });
}));

/**
 * @route   POST /api/stripe/cancel-subscription
 * @desc    Cancel subscription (at period end or immediately)
 * @access  Private
 * @body    { immediately: false }
 */
router.post('/cancel-subscription', authenticate, catchAsync(async (req, res) => {
  const { immediately = false } = req.body;
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!user.stripeSubscriptionId) {
    return res.status(400).json({
      success: false,
      message: 'No active subscription found'
    });
  }

  const subscription = await stripeService.cancelSubscription(
    user.stripeSubscriptionId,
    immediately
  );

  // Update user subscription status
  const newStatus = immediately ? 'canceled' : 'canceling';
  await User.findByIdAndUpdate(user.id, {
    subscriptionStatus: newStatus
  });

  res.json({
    success: true,
    subscription: subscription,
    message: immediately
      ? 'Subscription canceled immediately'
      : 'Subscription will cancel at the end of the current period'
  });
}));

/**
 * @route   POST /api/stripe/reactivate-subscription
 * @desc    Reactivate a subscription scheduled for cancellation
 * @access  Private
 */
router.post('/reactivate-subscription', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!user.stripeSubscriptionId) {
    return res.status(400).json({
      success: false,
      message: 'No subscription found'
    });
  }

  const subscription = await stripeService.reactivateSubscription(user.stripeSubscriptionId);

  await User.findByIdAndUpdate(user.id, {
    subscriptionStatus: subscription.status
  });

  res.json({
    success: true,
    subscription: subscription,
    message: 'Subscription reactivated successfully'
  });
}));

/**
 * @route   GET /api/stripe/invoices
 * @desc    Get customer invoices
 * @access  Private
 */
router.get('/invoices', authenticate, catchAsync(async (req, res) => {
  const { limit = 10 } = req.query;
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!user.stripeCustomerId) {
    return res.json({
      success: true,
      invoices: [],
      message: 'No customer found'
    });
  }

  const invoices = await stripeService.getCustomerInvoices(
    user.stripeCustomerId,
    parseInt(limit)
  );

  res.json({
    success: true,
    invoices: invoices.data,
    hasMore: invoices.has_more
  });
}));

/**
 * @route   GET /api/stripe/upcoming-invoice
 * @desc    Get preview of next invoice
 * @access  Private
 */
router.get('/upcoming-invoice', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!user.stripeCustomerId) {
    return res.json({
      success: true,
      upcomingInvoice: null
    });
  }

  const upcomingInvoice = await stripeService.getUpcomingInvoice(user.stripeCustomerId);

  res.json({
    success: true,
    upcomingInvoice: upcomingInvoice
  });
}));

/**
 * @route   POST /api/stripe/create-setup-intent
 * @desc    Create setup intent for saving payment method
 * @access  Private
 */
router.post('/create-setup-intent', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!user.stripeCustomerId) {
    return res.status(400).json({
      success: false,
      message: 'Please create a customer first'
    });
  }

  const setupIntent = await stripeService.createSetupIntent(user.stripeCustomerId);

  res.json({
    success: true,
    clientSecret: setupIntent.client_secret
  });
}));

/**
 * @route   GET /api/stripe/payment-methods
 * @desc    Get saved payment methods
 * @access  Private
 */
router.get('/payment-methods', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!user.stripeCustomerId) {
    return res.json({
      success: true,
      paymentMethods: []
    });
  }

  const paymentMethods = await stripeService.getPaymentMethods(user.stripeCustomerId);

  res.json({
    success: true,
    paymentMethods: paymentMethods
  });
}));

/**
 * @route   POST /api/stripe/webhook
 * @desc    Stripe webhook handler
 * @access  Public (verified with webhook secret)
 */
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  catchAsync(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
      return res.status(500).send('Webhook secret not configured');
    }

    let event;

    try {
      event = stripeService.verifyWebhookSignature(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`[Stripe Webhook] Received event: ${event.type}`);

    // Handle the event
    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          const subscription = event.data.object;
          console.log(`[Stripe Webhook] Subscription ${event.type}: ${subscription.id}`);

          // Update user subscription status
          const updatedUser = await User.findOneAndUpdate(
            { stripeCustomerId: subscription.customer },
            {
              stripeSubscriptionId: subscription.id,
              subscriptionStatus: subscription.status
            }
          );

          if (updatedUser) {
            console.log(`[Stripe Webhook] Updated user ${updatedUser.id} subscription status to ${subscription.status}`);
          } else {
            console.warn(`[Stripe Webhook] No user found with customer ID: ${subscription.customer}`);
          }
          break;

        case 'customer.subscription.deleted':
          const deletedSub = event.data.object;
          console.log(`[Stripe Webhook] Subscription deleted: ${deletedSub.id}`);

          const deletedUser = await User.findOneAndUpdate(
            { stripeCustomerId: deletedSub.customer },
            {
              subscriptionStatus: 'canceled'
            }
          );

          if (deletedUser) {
            console.log(`[Stripe Webhook] Updated user ${deletedUser.id} subscription status to canceled`);
          }
          break;

        case 'invoice.payment_succeeded':
          const successInvoice = event.data.object;
          console.log(`[Stripe Webhook] Payment succeeded for invoice: ${successInvoice.id}`);
          // You can send email notifications here
          break;

        case 'invoice.payment_failed':
          const failedInvoice = event.data.object;
          console.log(`[Stripe Webhook] Payment failed for invoice: ${failedInvoice.id}`);
          // Send payment failure notification
          break;

        case 'customer.subscription.trial_will_end':
          const trialEndingSub = event.data.object;
          console.log(`[Stripe Webhook] Trial ending soon for subscription: ${trialEndingSub.id}`);
          // Send trial ending reminder
          break;

        default:
          console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error(`[Stripe Webhook] Error processing event ${event.type}:`, error);
      // Still return 200 to acknowledge receipt
    }

    // Return 200 to acknowledge receipt
    res.json({ received: true });
  })
);

/**
 * @route   POST /api/stripe/create-products
 * @desc    Create initial products and prices (development/setup only)
 * @access  Private (admin only)
 */
router.post('/create-products', authenticate, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id);

  // Only allow admins or root users
  if (!user || (user.role !== 0 && user.role !== 1)) {
    return res.status(403).json({
      success: false,
      message: 'Only administrators can create products'
    });
  }

  const products = await stripeService.createProducts();

  res.json({
    success: true,
    products: products,
    message: 'Products created successfully. Save these price IDs to your environment variables.'
  });
}));

/**
 * @route   GET /api/stripe/products
 * @desc    List all available products and prices
 * @access  Public
 */
router.get('/products', catchAsync(async (req, res) => {
  const products = await stripeService.listProducts();

  res.json({
    success: true,
    products: products
  });
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
    console.log(`[Stripe Connect Routes] User ${user.id} already has account: ${user.stripeAccountId}`);
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
  const finalReturnUrl = returnUrl || `${baseUrl}/investor/settings?tab=payments&onboarding=complete`;
  const finalRefreshUrl = refreshUrl || `${baseUrl}/investor/settings?tab=payments&onboarding=refresh`;

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
// ADMIN ROUTES (for Fund Managers)
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
  console.log(`[Stripe Connect Admin] Onboarding link for ${investor.email}: ${accountLink.url}`);

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
  const investors = await User.findAll({ role: 3 });

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
 *
 * Configure in Stripe Dashboard:
 * - Endpoint URL: https://your-domain.com/api/stripe/webhook-connect
 * - Events: account.*, transfer.*, payout.*, capability.updated
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
        }
        break;
      }

      // ==========================================
      // CAPABILITY EVENTS
      // ==========================================

      case 'capability.updated': {
        const capability = event.data.object;
        const accountId = event.account;
        console.log(`[Stripe Connect Webhook] Capability updated for ${accountId}: ${capability.id} - ${capability.status}`);
        break;
      }

      default:
        console.log(`[Stripe Connect Webhook] Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true, type: event.type });

  } catch (error) {
    console.error(`[Stripe Connect Webhook] Error processing event ${event.type}:`, error);
    res.status(200).json({ received: true, error: error.message });
  }
}));

/**
 * @route   GET /api/stripe/webhook-connect/health
 * @desc    Health check for Connect webhook endpoint
 * @access  Public
 */
router.get('/webhook-connect/health', (req, res) => {
  res.json({
    status: 'ok',
    endpoint: 'stripe-connect-webhook',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
