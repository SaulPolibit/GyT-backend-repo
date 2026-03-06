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

// Initialize Stripe SDK for direct API calls
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
 *
 * Note: 12-month minimum commitment is enforced. Users cannot cancel
 * before 12 months from subscription start date.
 */
router.post('/cancel-subscription', authenticate, catchAsync(async (req, res) => {
  const { immediately = false } = req.body;
  const supabase = require('../config/database').getSupabase();
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

  // Check 12-month minimum commitment
  const { data: userData, error: userDataError } = await supabase
    .from('users')
    .select('subscription_start_date')
    .eq('id', req.user.id)
    .single();

  console.log('[Stripe Cancel] Checking commitment:', {
    userId: req.user.id,
    userData,
    userDataError,
    subscription_start_date: userData?.subscription_start_date
  });

  if (userData?.subscription_start_date) {
    const startDate = new Date(userData.subscription_start_date);
    const now = new Date();
    const monthsElapsed = (now.getFullYear() - startDate.getFullYear()) * 12 +
                          (now.getMonth() - startDate.getMonth());

    const MINIMUM_MONTHS = 12;

    console.log('[Stripe Cancel] Commitment check:', {
      startDate: startDate.toISOString(),
      now: now.toISOString(),
      monthsElapsed,
      MINIMUM_MONTHS,
      shouldBlock: monthsElapsed < MINIMUM_MONTHS
    });

    if (monthsElapsed < MINIMUM_MONTHS) {
      const remainingMonths = MINIMUM_MONTHS - monthsElapsed;
      const canCancelDate = new Date(startDate);
      canCancelDate.setMonth(canCancelDate.getMonth() + MINIMUM_MONTHS);

      console.log('[Stripe Cancel] BLOCKING cancellation - minimum commitment not met');

      return res.status(403).json({
        success: false,
        error: 'MINIMUM_COMMITMENT',
        message: `Your subscription has a 12-month minimum commitment. You can cancel after ${canCancelDate.toLocaleDateString()}.`,
        monthsElapsed,
        remainingMonths,
        canCancelDate: canCancelDate.toISOString()
      });
    }
  } else {
    console.log('[Stripe Cancel] No subscription_start_date found, skipping commitment check');
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
 * @route   GET /api/stripe/commitment-status
 * @desc    Get subscription commitment status (12-month minimum)
 * @access  Private
 */
router.get('/commitment-status', authenticate, catchAsync(async (req, res) => {
  const supabase = require('../config/database').getSupabase();

  const { data: userData } = await supabase
    .from('users')
    .select('subscription_start_date, subscription_status')
    .eq('id', req.user.id)
    .single();

  if (!userData?.subscription_start_date) {
    return res.json({
      success: true,
      canCancel: true,
      hasCommitment: false,
      message: 'No commitment period found'
    });
  }

  const startDate = new Date(userData.subscription_start_date);
  const now = new Date();
  const monthsElapsed = (now.getFullYear() - startDate.getFullYear()) * 12 +
                        (now.getMonth() - startDate.getMonth());

  const MINIMUM_MONTHS = 12;
  const canCancel = monthsElapsed >= MINIMUM_MONTHS;
  const remainingMonths = Math.max(0, MINIMUM_MONTHS - monthsElapsed);

  const canCancelDate = new Date(startDate);
  canCancelDate.setMonth(canCancelDate.getMonth() + MINIMUM_MONTHS);

  res.json({
    success: true,
    canCancel,
    hasCommitment: true,
    startDate: startDate.toISOString(),
    monthsElapsed,
    remainingMonths,
    canCancelDate: canCancelDate.toISOString(),
    message: canCancel
      ? 'Commitment period completed. You can cancel anytime.'
      : `${remainingMonths} month(s) remaining in your 12-month commitment.`
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

          // Build update object
          const updateData = {
            stripeSubscriptionId: subscription.id,
            subscriptionStatus: subscription.status
          };

          // Set subscription_start_date only on creation (12-month minimum commitment)
          if (event.type === 'customer.subscription.created') {
            // Use Stripe's subscription start_date or current period start
            const startTimestamp = subscription.start_date || subscription.current_period_start;
            updateData.subscriptionStartDate = new Date(startTimestamp * 1000).toISOString();
            console.log(`[Stripe Webhook] Setting subscription start date: ${updateData.subscriptionStartDate}`);
          }

          // Update user subscription status
          const updatedUser = await User.findOneAndUpdate(
            { stripeCustomerId: subscription.customer },
            updateData
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

        case 'checkout.session.completed':
          const session = event.data.object;
          console.log(`[Stripe Webhook] Checkout session completed: ${session.id}`);

          // Check for extra purchases via metadata
          const { purchaseType, userId: purchaseUserId, extraInvestors, extraCommitment, millionsToAdd } = session.metadata || {};

          // Check if this session was already processed (prevent duplicates with verify-extra-purchase endpoint)
          const supabaseForWebhook = require('../config/database').getSupabase();
          const { data: existingWebhookSession } = await supabaseForWebhook
            .from('processed_stripe_sessions')
            .select('id')
            .eq('session_id', session.id)
            .maybeSingle();

          if (existingWebhookSession) {
            console.log(`[Stripe Webhook] Session ${session.id} already processed, skipping`);
            break;
          }

          // Mark session as processed FIRST (prevents race conditions with verify endpoint)
          if (purchaseUserId && (purchaseType === 'extra_investors' || purchaseType === 'extra_aum' || purchaseType === 'credit_topup' || purchaseType === 'subscription')) {
            const { error: webhookInsertError } = await supabaseForWebhook
              .from('processed_stripe_sessions')
              .insert({ session_id: session.id, user_id: purchaseUserId });

            if (webhookInsertError) {
              if (webhookInsertError.code === '23505') {
                console.log(`[Stripe Webhook] Session ${session.id} already processed (concurrent), skipping`);
                break;
              }
              console.error(`[Stripe Webhook] Error marking session as processed:`, webhookInsertError);
              // Continue anyway - better to potentially double-process than miss a payment
            }
          }

          if (purchaseType === 'extra_investors' && purchaseUserId && extraInvestors) {
            console.log(`[Stripe Webhook] Processing extra investors purchase: ${extraInvestors} for user ${purchaseUserId}`);
            try {
              const updatedUser = await addExtraInvestors(purchaseUserId, parseInt(extraInvestors));
              console.log(`[Stripe Webhook] Extra investors added. New limit: ${updatedUser.max_investors}`);
            } catch (err) {
              console.error(`[Stripe Webhook] Error adding extra investors:`, err);
            }
          }

          if (purchaseType === 'extra_aum' && purchaseUserId && extraCommitment) {
            console.log(`[Stripe Webhook] Processing extra AUM purchase: ${extraCommitment} for user ${purchaseUserId}`);
            try {
              const updatedUser = await addExtraCommitment(purchaseUserId, parseFloat(extraCommitment));
              console.log(`[Stripe Webhook] Extra AUM added. New limit: ${updatedUser.max_total_commitment}`);
            } catch (err) {
              console.error(`[Stripe Webhook] Error adding extra AUM:`, err);
            }
          }

          // Handle credit top-up (PAYG model)
          const creditsToAdd = session.metadata?.creditsToAdd;
          if (purchaseType === 'credit_topup' && purchaseUserId && creditsToAdd) {
            console.log(`[Stripe Webhook] Processing credit top-up: ${creditsToAdd} cents for user ${purchaseUserId}`);
            try {
              const updatedUser = await addCredits(purchaseUserId, parseInt(creditsToAdd));
              console.log(`[Stripe Webhook] Credits added. New balance: ${updatedUser.credit_balance}`);
            } catch (err) {
              console.error(`[Stripe Webhook] Error adding credits:`, err);
            }
          }

          // Handle initial subscription with credits (PAYG)
          const initialCredits = session.metadata?.initialCredits;
          if (purchaseType === 'subscription' && purchaseUserId && initialCredits) {
            console.log(`[Stripe Webhook] Adding initial credits: ${initialCredits} cents for user ${purchaseUserId}`);
            try {
              const updatedUser = await addCredits(purchaseUserId, parseInt(initialCredits));
              console.log(`[Stripe Webhook] Initial credits added. Balance: ${updatedUser.credit_balance}`);
            } catch (err) {
              console.error(`[Stripe Webhook] Error adding initial credits:`, err);
            }
          }
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

// ==========================================
// SUBSCRIPTION LIMITS ENDPOINTS
// ==========================================

const { getSubscriptionUsage, updateUserSubscription, validateStructureCreation, validateInvestorCreation, addExtraInvestors, addExtraCommitment, addCredits } = require('../services/subscriptionLimits.service');

/**
 * @route   GET /api/stripe/subscription-usage
 * @desc    Get current subscription usage stats (investor count, commitment)
 * @access  Private
 */
router.get('/subscription-usage', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id;

  try {
    const usage = await getSubscriptionUsage(userId);
    res.json({
      success: true,
      usage
    });
  } catch (error) {
    console.error('[Stripe] Error getting subscription usage:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subscription usage',
      error: error.message
    });
  }
}));

/**
 * @route   POST /api/stripe/update-subscription-plan
 * @desc    Update user's subscription model and tier
 * @access  Private
 */
router.post('/update-subscription-plan', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { model, tier } = req.body;

  // Validate model
  if (!model || !['tier_based', 'payg'].includes(model)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid subscription model. Must be "tier_based" or "payg"'
    });
  }

  // Validate tier based on model
  const validTiers = model === 'payg'
    ? ['starter', 'growth', 'enterprise']
    : ['starter', 'professional', 'enterprise'];

  if (!tier || !validTiers.includes(tier)) {
    return res.status(400).json({
      success: false,
      message: `Invalid tier for ${model} model. Must be one of: ${validTiers.join(', ')}`
    });
  }

  try {
    await updateUserSubscription(userId, model, tier);

    // Get updated usage stats
    const usage = await getSubscriptionUsage(userId);

    res.json({
      success: true,
      message: 'Subscription plan updated successfully',
      usage
    });
  } catch (error) {
    console.error('[Stripe] Error updating subscription plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update subscription plan',
      error: error.message
    });
  }
}));

/**
 * @route   POST /api/stripe/purchase-extra-investors
 * @desc    Create Stripe checkout session for purchasing extra investor slots
 * @access  Private
 */
router.post('/purchase-extra-investors', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id;
  const userEmail = req.user.email;
  const { extraInvestors } = req.body;

  // Validate input
  if (!extraInvestors || typeof extraInvestors !== 'number' || extraInvestors <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid extraInvestors value. Must be a positive number.'
    });
  }

  try {
    const priceId = process.env.STRIPE_PRICE_EXTRA_INVESTORS;
    if (!priceId) {
      return res.status(500).json({
        success: false,
        message: 'Extra investors price not configured'
      });
    }

    // Calculate quantity (price is per 10 investors, so +10 = 1 unit, +25 = 2.5 rounded up to 3, etc.)
    const quantity = Math.ceil(extraInvestors / 10);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: userEmail,
      line_items: [
        {
          price: priceId,
          quantity: quantity,
        },
      ],
      metadata: {
        userId,
        purchaseType: 'extra_investors',
        extraInvestors: extraInvestors.toString(),
      },
      success_url: `${frontendUrl}/investment-manager/settings?tab=subscription&success=true&purchase=extra_investors&quantity=${extraInvestors}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/investment-manager/settings?tab=subscription&canceled=true`,
    });

    console.log('[Stripe] Extra investors checkout session created:', { userId, extraInvestors, quantity, sessionId: session.id });

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error('[Stripe] Error creating extra investors checkout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create checkout session',
      error: error.message
    });
  }
}));

/**
 * @route   POST /api/stripe/purchase-extra-aum
 * @desc    Create Stripe checkout session for purchasing extra AUM capacity
 * @access  Private
 */
router.post('/purchase-extra-aum', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id;
  const userEmail = req.user.email;
  const { extraCommitment } = req.body;

  // Validate input - should be in dollars (e.g., 1000000 for $1M)
  if (!extraCommitment || typeof extraCommitment !== 'number' || extraCommitment <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid extraCommitment value. Must be a positive number in dollars.'
    });
  }

  try {
    const priceId = process.env.STRIPE_PRICE_EXTRA_AUM;
    if (!priceId) {
      return res.status(500).json({
        success: false,
        message: 'Extra AUM price not configured'
      });
    }

    // Calculate quantity (price is per $1M, so $1M = 1 unit, $5M = 5 units)
    const millionsToAdd = extraCommitment / 1000000;
    const quantity = Math.ceil(millionsToAdd);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: userEmail,
      line_items: [
        {
          price: priceId,
          quantity: quantity,
        },
      ],
      metadata: {
        userId,
        purchaseType: 'extra_aum',
        extraCommitment: extraCommitment.toString(),
        millionsToAdd: millionsToAdd.toString(),
      },
      success_url: `${frontendUrl}/investment-manager/settings?tab=subscription&success=true&purchase=extra_aum&quantity=${millionsToAdd}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/investment-manager/settings?tab=subscription&canceled=true`,
    });

    console.log('[Stripe] Extra AUM checkout session created:', { userId, extraCommitment, millionsToAdd, quantity, sessionId: session.id });

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error('[Stripe] Error creating extra AUM checkout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create checkout session',
      error: error.message
    });
  }
}));

/**
 * @route   POST /api/stripe/verify-extra-purchase
 * @desc    Verify a completed checkout session and apply extra purchase to user limits
 * @access  Private
 */
router.post('/verify-extra-purchase', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { sessionId } = req.body;
  const supabase = require('../config/database').getSupabase();

  if (!sessionId) {
    return res.status(400).json({
      success: false,
      message: 'Session ID is required'
    });
  }

  try {
    // Check if session was already processed in database (prevent duplicates)
    const { data: existingSession } = await supabase
      .from('processed_stripe_sessions')
      .select('id')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (existingSession) {
      console.log('[Stripe] Session already processed, skipping:', sessionId);
      return res.json({
        success: true,
        message: 'Purchase already applied',
        alreadyProcessed: true
      });
    }

    // Mark session as processed FIRST (prevents race conditions)
    const { error: insertError } = await supabase
      .from('processed_stripe_sessions')
      .insert({ session_id: sessionId, user_id: userId });

    if (insertError) {
      // If insert fails due to unique constraint, session was already processed
      if (insertError.code === '23505') {
        console.log('[Stripe] Session already processed (concurrent), skipping:', sessionId);
        return res.json({
          success: true,
          message: 'Purchase already applied',
          alreadyProcessed: true
        });
      }
      console.error('[Stripe] Error marking session as processed:', insertError);
    }

    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    console.log('[Stripe] Verifying extra purchase session:', { sessionId, status: session.payment_status, metadata: session.metadata });

    // Check if payment was successful
    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed',
        status: session.payment_status
      });
    }

    // Verify the session belongs to this user
    if (session.metadata?.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Session does not belong to this user'
      });
    }

    const { purchaseType, extraInvestors, extraCommitment } = session.metadata || {};

    if (purchaseType === 'extra_investors' && extraInvestors) {
      const investorsToAdd = parseInt(extraInvestors);
      console.log(`[Stripe] Applying extra investors: ${investorsToAdd} for user ${userId}`);

      const updatedUser = await addExtraInvestors(userId, investorsToAdd);

      return res.json({
        success: true,
        message: `Added ${investorsToAdd} extra investor slots`,
        newLimit: updatedUser.max_investors,
        extraPurchased: updatedUser.extra_investors_purchased
      });
    }

    if (purchaseType === 'extra_aum' && extraCommitment) {
      const commitmentToAdd = parseFloat(extraCommitment);
      console.log(`[Stripe] Applying extra AUM: ${commitmentToAdd} for user ${userId}`);

      const updatedUser = await addExtraCommitment(userId, commitmentToAdd);

      return res.json({
        success: true,
        message: `Added $${(commitmentToAdd / 1000000).toFixed(0)}M extra AUM capacity`,
        newLimit: parseFloat(updatedUser.max_total_commitment),
        extraPurchased: parseFloat(updatedUser.extra_commitment_purchased)
      });
    }

    // Handle credit top-up
    const creditsToAdd = session.metadata?.creditsToAdd;
    if (purchaseType === 'credit_topup' && creditsToAdd) {
      const credits = parseInt(creditsToAdd);
      console.log(`[Stripe] Applying credit top-up: ${credits} cents for user ${userId}`);

      const updatedUser = await addCredits(userId, credits);

      return res.json({
        success: true,
        message: `Added $${(credits / 100).toFixed(2)} to your credit balance`,
        newBalance: updatedUser.credit_balance
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Unknown purchase type or missing metadata'
    });

  } catch (error) {
    console.error('[Stripe] Error verifying extra purchase:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify purchase',
      error: error.message
    });
  }
}));

/**
 * @route   POST /api/stripe/purchase-credits
 * @desc    Create Stripe checkout session for purchasing credits (PAYG model)
 * @access  Private
 */
router.post('/purchase-credits', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id;
  const userEmail = req.user.email;
  const { amountInCents } = req.body;

  // Validate input (minimum $10 = 1000 cents)
  if (!amountInCents || typeof amountInCents !== 'number' || amountInCents < 1000) {
    return res.status(400).json({
      success: false,
      message: 'Invalid amount. Minimum top-up is $10.00'
    });
  }

  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Create Stripe checkout session with dynamic pricing
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Credit Top-Up',
              description: `Add $${(amountInCents / 100).toFixed(2)} to your credit balance`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        purchaseType: 'credit_topup',
        creditsToAdd: amountInCents.toString(),
      },
      success_url: `${frontendUrl}/investment-manager/settings?tab=subscription&success=true&purchase=credits&amount=${amountInCents}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/investment-manager/settings?tab=subscription&canceled=true`,
    });

    console.log('[Stripe] Credit top-up checkout session created:', { userId, amountInCents, sessionId: session.id });

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error('[Stripe] Error creating credit top-up checkout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create checkout session',
      error: error.message
    });
  }
}));

/**
 * @route   POST /api/stripe/validate-structure-creation
 * @desc    Validate if a new structure can be created (checks commitment limits)
 * @access  Private
 */
router.post('/validate-structure-creation', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { totalCommitment } = req.body;

  try {
    const validation = await validateStructureCreation(userId, totalCommitment || 0);
    res.json({
      success: true,
      validation
    });
  } catch (error) {
    console.error('[Stripe] Error validating structure creation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate structure creation',
      error: error.message
    });
  }
}));

/**
 * @route   GET /api/stripe/validate-investor-creation
 * @desc    Validate if a new investor can be created (checks investor limits)
 * @access  Private
 */
router.get('/validate-investor-creation', authenticate, catchAsync(async (req, res) => {
  const userId = req.user.id;

  try {
    const validation = await validateInvestorCreation(userId);
    res.json({
      success: true,
      validation
    });
  } catch (error) {
    console.error('[Stripe] Error validating investor creation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate investor creation',
      error: error.message
    });
  }
}));

module.exports = router;
