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
 *            includeAdditionalService: true, // Optional - include Additional Service Base Cost
 *            trialDays: 7 // Optional trial period in days
 *          }
 */
router.post('/create-subscription', authenticate, catchAsync(async (req, res) => {
  const { includeAdditionalService = false, trialDays } = req.body;
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Ensure user has a Stripe customer ID
  if (!user.stripeCustomerId) {
    return res.status(400).json({
      success: false,
      message: 'Please create a customer first. Call POST /api/stripe/create-customer'
    });
  }

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

  // Build service price IDs array
  const servicePriceIds = [];
  if (includeAdditionalService) {
    servicePriceIds.push(PRICE_IDS.ADDITIONAL_SERVICE_COST);
  }

  // Create subscription options
  const options = {};
  if (trialDays && trialDays > 0) {
    options.trial_period_days = trialDays;
  }

  // Create subscription with Service Base Cost + optional Additional Service
  const subscription = await stripeService.createSubscription(
    user.stripeCustomerId,
    PRICE_IDS.SERVICE_BASE_COST,
    servicePriceIds,
    options
  );

  // Save subscription info to user
  await User.findByIdAndUpdate(user.id, {
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status
  });

  res.json({
    success: true,
    subscriptionId: subscription.id,
    clientSecret: subscription.latest_invoice?.payment_intent?.client_secret,
    status: subscription.status,
    message: 'Subscription created successfully. Use clientSecret to complete payment.'
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

module.exports = router;
