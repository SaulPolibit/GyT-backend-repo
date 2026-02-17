/**
 * Stripe Service
 * Handles all Stripe API operations for subscriptions and Connect
 */

// Stripe instance for Subscriptions (Fund Manager billing)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Stripe instance for Connect (Investor payouts)
// Uses separate key if provided, otherwise falls back to main key
const stripeConnect = require('stripe')(
  process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY
);

class StripeService {
  /**
   * Create a Stripe customer from a user
   * @param {Object} user - User object with email, firstName, lastName, id
   * @returns {Promise<Object>} Stripe customer object
   */
  async createCustomer(user) {
    try {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim(),
        metadata: {
          userId: user.id,
          role: user.role
        }
      });

      console.log(`[Stripe] Created customer ${customer.id} for user ${user.id}`);
      return customer;
    } catch (error) {
      console.error('[Stripe] Error creating customer:', error);
      throw error;
    }
  }

  /**
   * Get customer by ID
   * @param {string} customerId - Stripe customer ID
   * @returns {Promise<Object>} Stripe customer object
   */
  async getCustomer(customerId) {
    try {
      return await stripe.customers.retrieve(customerId);
    } catch (error) {
      console.error('[Stripe] Error retrieving customer:', error);
      throw error;
    }
  }

  /**
   * Create payment method from card token
   * @param {string} cardToken - Stripe card token (tok_xxxxx)
   * @returns {Promise<Object>} Payment method object
   */
  async createPaymentMethodFromToken(cardToken) {
    try {
      const paymentMethod = await stripe.paymentMethods.create({
        type: 'card',
        card: {
          token: cardToken,
        },
      });

      console.log(`[Stripe] Created payment method ${paymentMethod.id} from token`);
      return paymentMethod;
    } catch (error) {
      console.error('[Stripe] Error creating payment method from token:', error);
      throw error;
    }
  }

  /**
   * Attach payment method to customer and set as default
   * @param {string} paymentMethodId - Stripe payment method ID
   * @param {string} customerId - Stripe customer ID
   * @returns {Promise<Object>} Payment method object
   */
  async attachPaymentMethodToCustomer(paymentMethodId, customerId) {
    try {
      // Attach payment method to customer
      const paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });

      // Set as default payment method for invoices
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      console.log(`[Stripe] Attached payment method ${paymentMethodId} to customer ${customerId}`);
      return paymentMethod;
    } catch (error) {
      console.error('[Stripe] Error attaching payment method:', error);
      throw error;
    }
  }

  /**
   * Create a subscription with base plan and optional add-ons
   * @param {string} customerId - Stripe customer ID
   * @param {string} basePriceId - Price ID for base plan (e.g., price_xxxxx)
   * @param {Array<{priceId: string, quantity: number}>|Array<string>} addons - Array of addon objects with priceId and quantity, or array of price IDs
   * @param {Object} options - Additional options (trial_period_days, default_payment_method, etc.)
   * @returns {Promise<Object>} Stripe subscription object
   */
  async createSubscription(customerId, basePriceId, addons = [], options = {}) {
    try {
      // Build subscription items: base plan + addons
      const items = [
        { price: basePriceId, quantity: 1 } // Base plan (required)
      ];

      // Add optional addons (support both old format and new format with quantities)
      addons.forEach(addon => {
        if (typeof addon === 'string') {
          // Old format: just price ID
          items.push({ price: addon, quantity: 1 });
        } else if (addon.priceId && addon.quantity > 0) {
          // New format: object with priceId and quantity
          items.push({ price: addon.priceId, quantity: addon.quantity });
        }
      });

      // Build subscription data
      const subscriptionData = {
        customer: customerId,
        items: items,
        expand: ['latest_invoice.payment_intent'],
        ...options // trial_period_days, default_payment_method, etc.
      };

      // If no default_payment_method provided, use default_incomplete behavior
      if (!options.default_payment_method) {
        subscriptionData.payment_behavior = 'default_incomplete';
        subscriptionData.payment_settings = {
          save_default_payment_method: 'on_subscription'
        };
      }

      const subscription = await stripe.subscriptions.create(subscriptionData);

      console.log(`[Stripe] Created subscription ${subscription.id} for customer ${customerId}`);
      console.log(`[Stripe] Subscription status:`, subscription.status);
      console.log(`[Stripe] Subscription items:`, items.length);
      console.log(`[Stripe] Has default payment method:`, !!options.default_payment_method);

      // If we have a default_payment_method, subscription should charge automatically
      // No need to manually handle invoices or payment intents
      if (options.default_payment_method) {
        console.log(`[Stripe] Subscription created with payment method. Status should be 'active' or 'incomplete' if payment failed.`);
      } else {
        // Legacy flow: no payment method, need to handle payment intent manually
        const latestInvoiceId = typeof subscription.latest_invoice === 'string'
          ? subscription.latest_invoice
          : subscription.latest_invoice?.id;

        console.log(`[Stripe] Latest invoice ID:`, latestInvoiceId || 'None');

        if (latestInvoiceId) {
          // Fetch invoice with payment intent
          const invoice = await stripe.invoices.retrieve(latestInvoiceId, {
            expand: ['payment_intent']
          });

          subscription.latest_invoice = invoice;
          console.log(`[Stripe] Invoice status:`, invoice.status);
          console.log(`[Stripe] Payment intent ID:`, invoice.payment_intent?.id || 'None');
          console.log(`[Stripe] Client secret present:`, !!invoice.payment_intent?.client_secret);
        }
      }

      return subscription;
    } catch (error) {
      console.error('[Stripe] Error creating subscription:', error);
      throw error;
    }
  }

  /**
   * Add an addon to existing subscription or increment quantity if it exists
   * @param {string} subscriptionId - Stripe subscription ID
   * @param {string} addonPriceId - Price ID of the addon to add
   * @param {number} quantity - Quantity to add (default: 1)
   * @returns {Promise<Object>} Stripe subscription item object
   */
  async addAddonToSubscription(subscriptionId, addonPriceId, quantity = 1) {
    try {
      // Retrieve the price to check if it's metered
      const price = await stripe.prices.retrieve(addonPriceId);

      if (price.recurring?.usage_type === 'metered') {
        throw new Error(
          'Cannot add metered price with fixed quantity. ' +
          'Please recreate the price as a standard recurring price (usage_type: licensed). ' +
          'Use POST /api/stripe/create-products to recreate products correctly.'
        );
      }

      // Check if addon already exists in subscription
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['items.data.price']
      });

      const existingItem = subscription.items.data.find(
        item => item.price.id === addonPriceId
      );

      if (existingItem) {
        // Increment quantity if addon already exists
        const newQuantity = existingItem.quantity + quantity;
        const updatedItem = await stripe.subscriptionItems.update(existingItem.id, {
          quantity: newQuantity,
          proration_behavior: 'create_prorations'
        });
        console.log(`[Stripe] Updated addon ${addonPriceId} quantity to ${newQuantity} in subscription ${subscriptionId}`);
        return updatedItem;
      }

      // Add new addon
      const subscriptionItem = await stripe.subscriptionItems.create({
        subscription: subscriptionId,
        price: addonPriceId,
        quantity: quantity,
        proration_behavior: 'create_prorations' // Charge prorated amount immediately
      });

      console.log(`[Stripe] Added addon ${addonPriceId} (quantity: ${quantity}) to subscription ${subscriptionId}`);
      return subscriptionItem;
    } catch (error) {
      console.error('[Stripe] Error adding addon:', error);
      throw error;
    }
  }

  /**
   * Update quantity of a subscription item
   * @param {string} subscriptionItemId - Stripe subscription item ID
   * @param {number} quantity - New quantity (must be >= 1)
   * @returns {Promise<Object>} Updated subscription item
   */
  async updateSubscriptionItemQuantity(subscriptionItemId, quantity) {
    try {
      if (quantity < 1) {
        throw new Error('Quantity must be at least 1. Use removeAddonFromSubscription to remove the item.');
      }

      // Retrieve the subscription item to check the price type
      const item = await stripe.subscriptionItems.retrieve(subscriptionItemId, {
        expand: ['price']
      });

      if (item.price.recurring?.usage_type === 'metered') {
        throw new Error(
          'Cannot set quantity for metered prices. ' +
          'Please recreate the price as a standard recurring price (usage_type: licensed). ' +
          'Use POST /api/stripe/create-products to recreate products correctly.'
        );
      }

      const updatedItem = await stripe.subscriptionItems.update(subscriptionItemId, {
        quantity: quantity,
        proration_behavior: 'create_prorations'
      });

      console.log(`[Stripe] Updated subscription item ${subscriptionItemId} quantity to ${quantity}`);
      return updatedItem;
    } catch (error) {
      console.error('[Stripe] Error updating subscription item quantity:', error);
      throw error;
    }
  }

  /**
   * Remove an addon from subscription
   * @param {string} subscriptionItemId - Stripe subscription item ID (not subscription ID!)
   * @returns {Promise<Object>} Deleted subscription item
   */
  async removeAddonFromSubscription(subscriptionItemId) {
    try {
      const deleted = await stripe.subscriptionItems.del(subscriptionItemId, {
        proration_behavior: 'create_prorations' // Credit prorated amount
      });

      console.log(`[Stripe] Removed subscription item ${subscriptionItemId}`);
      return deleted;
    } catch (error) {
      console.error('[Stripe] Error removing addon:', error);
      throw error;
    }
  }

  /**
   * Cancel subscription
   * @param {string} subscriptionId - Stripe subscription ID
   * @param {boolean} immediately - If true, cancel immediately. If false, cancel at period end.
   * @returns {Promise<Object>} Updated subscription object
   */
  async cancelSubscription(subscriptionId, immediately = false) {
    try {
      if (immediately) {
        const canceled = await stripe.subscriptions.cancel(subscriptionId);
        console.log(`[Stripe] Immediately canceled subscription ${subscriptionId}`);
        return canceled;
      } else {
        const updated = await stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true
        });
        console.log(`[Stripe] Scheduled subscription ${subscriptionId} to cancel at period end`);
        return updated;
      }
    } catch (error) {
      console.error('[Stripe] Error canceling subscription:', error);
      throw error;
    }
  }

  /**
   * Reactivate a subscription scheduled for cancellation
   * @param {string} subscriptionId - Stripe subscription ID
   * @returns {Promise<Object>} Updated subscription object
   */
  async reactivateSubscription(subscriptionId) {
    try {
      const updated = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false
      });
      console.log(`[Stripe] Reactivated subscription ${subscriptionId}`);
      return updated;
    } catch (error) {
      console.error('[Stripe] Error reactivating subscription:', error);
      throw error;
    }
  }

  /**
   * Get subscription details
   * @param {string} subscriptionId - Stripe subscription ID
   * @returns {Promise<Object>} Subscription object with expanded data
   */
  async getSubscription(subscriptionId) {
    try {
      return await stripe.subscriptions.retrieve(subscriptionId, {
        expand: [
          'items.data.price.product',
          'latest_invoice',
          'customer',
          'default_payment_method'
        ]
      });
    } catch (error) {
      console.error('[Stripe] Error retrieving subscription:', error);
      throw error;
    }
  }

  /**
   * Update subscription (e.g., change payment method, update quantity)
   * @param {string} subscriptionId - Stripe subscription ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated subscription object
   */
  async updateSubscription(subscriptionId, updates) {
    try {
      const updated = await stripe.subscriptions.update(subscriptionId, updates);
      console.log(`[Stripe] Updated subscription ${subscriptionId}`);
      return updated;
    } catch (error) {
      console.error('[Stripe] Error updating subscription:', error);
      throw error;
    }
  }

  /**
   * Create a setup intent for saving payment method without immediate charge
   * @param {string} customerId - Stripe customer ID
   * @returns {Promise<Object>} SetupIntent object with clientSecret
   */
  async createSetupIntent(customerId) {
    try {
      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card']
      });

      console.log(`[Stripe] Created setup intent for customer ${customerId}`);
      return setupIntent;
    } catch (error) {
      console.error('[Stripe] Error creating setup intent:', error);
      throw error;
    }
  }

  /**
   * List customer payment methods
   * @param {string} customerId - Stripe customer ID
   * @returns {Promise<Array>} Array of payment methods
   */
  async getPaymentMethods(customerId) {
    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card'
      });

      return paymentMethods.data;
    } catch (error) {
      console.error('[Stripe] Error listing payment methods:', error);
      throw error;
    }
  }

  /**
   * List customer invoices
   * @param {string} customerId - Stripe customer ID
   * @param {number} limit - Number of invoices to retrieve
   * @returns {Promise<Object>} Invoices list object
   */
  async getCustomerInvoices(customerId, limit = 10) {
    try {
      return await stripe.invoices.list({
        customer: customerId,
        limit: limit
      });
    } catch (error) {
      console.error('[Stripe] Error listing invoices:', error);
      throw error;
    }
  }

  /**
   * Get upcoming invoice (preview of next charge)
   * @param {string} customerId - Stripe customer ID
   * @returns {Promise<Object>} Upcoming invoice object
   */
  async getUpcomingInvoice(customerId) {
    try {
      return await stripe.invoices.retrieveUpcoming({
        customer: customerId
      });
    } catch (error) {
      // No upcoming invoice is normal (e.g., for canceled subscriptions)
      if (error.code === 'invoice_upcoming_none') {
        return null;
      }
      console.error('[Stripe] Error retrieving upcoming invoice:', error);
      throw error;
    }
  }

  /**
   * Create products and prices programmatically
   * Useful for initial setup or testing
   * @returns {Promise<Object>} Created products and prices
   */
  async createProducts() {
    try {
      // Service Base Cost
      const serviceBaseCost = await stripe.products.create({
        name: 'Service Base Cost',
        description: 'Base service subscription with core platform features',
        metadata: {
          type: 'base_service'
        }
      });

      const serviceBasePrice = await stripe.prices.create({
        product: serviceBaseCost.id,
        unit_amount: 2000, // 20.00 MXN in centavos (adjust as needed)
        currency: 'mxn', // Mexican Pesos
        recurring: {
          interval: 'month',
          usage_type: 'licensed' // NOT metered - standard recurring
        }
      });

      // Additional Service Base Cost
      const additionalServiceCost = await stripe.products.create({
        name: 'Additional Service Base Cost',
        description: 'Additional service features and capabilities',
        metadata: {
          type: 'additional_service'
        }
      });

      const additionalServicePrice = await stripe.prices.create({
        product: additionalServiceCost.id,
        unit_amount: 1000, // $10.00 in cents (adjust as needed)
        currency: 'mxn', // Mexican Pesos
        recurring: {
          interval: 'month',
          usage_type: 'licensed' // NOT metered - supports fixed quantities
        }
      });

      console.log('[Stripe] Created products successfully!');
      console.log('Service Base Cost Price ID:', serviceBasePrice.id);
      console.log('Additional Service Base Cost Price ID:', additionalServicePrice.id);

      return {
        serviceBaseCost: { product: serviceBaseCost, price: serviceBasePrice },
        additionalServiceCost: { product: additionalServiceCost, price: additionalServicePrice }
      };
    } catch (error) {
      console.error('[Stripe] Error creating products:', error);
      throw error;
    }
  }

  /**
   * List all products
   * @returns {Promise<Array>} Array of products
   */
  async listProducts() {
    try {
      const products = await stripe.products.list({
        active: true,
        expand: ['data.default_price']
      });
      return products.data;
    } catch (error) {
      console.error('[Stripe] Error listing products:', error);
      throw error;
    }
  }

  /**
   * Validate webhook signature and parse event
   * @param {string} payload - Raw request body
   * @param {string} signature - Stripe signature header
   * @param {string} webhookSecret - Webhook signing secret
   * @returns {Object} Parsed Stripe event
   */
  verifyWebhookSignature(payload, signature, webhookSecret) {
    try {
      const event = stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret
      );
      return event;
    } catch (error) {
      console.error('[Stripe] Webhook signature verification failed:', error.message);
      throw error;
    }
  }

  // ==========================================
  // STRIPE CONNECT METHODS (for Investors)
  // Uses separate stripeConnect instance
  // ==========================================

  /**
   * Create a Stripe Connect Express account for an investor
   * @param {Object} user - User object with email, firstName, lastName, id, country
   * @returns {Promise<Object>} Stripe Connect account object
   */
  async createConnectAccount(user) {
    try {
      const account = await stripeConnect.accounts.create({
        type: 'express',
        country: user.country || 'MX', // Default to Mexico
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        individual: {
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
        },
        metadata: {
          userId: user.id,
          role: 'investor'
        }
      });

      console.log(`[Stripe Connect] Created account ${account.id} for user ${user.id}`);
      return account;
    } catch (error) {
      console.error('[Stripe Connect] Error creating account:', error);
      throw error;
    }
  }

  /**
   * Create an account onboarding link for Stripe Connect
   * @param {string} accountId - Stripe Connect account ID
   * @param {string} refreshUrl - URL to redirect if link expires
   * @param {string} returnUrl - URL to redirect after completion
   * @returns {Promise<Object>} Account link object with URL
   */
  async createAccountLink(accountId, refreshUrl, returnUrl) {
    try {
      const accountLink = await stripeConnect.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });

      console.log(`[Stripe Connect] Created onboarding link for account ${accountId}`);
      return accountLink;
    } catch (error) {
      console.error('[Stripe Connect] Error creating account link:', error);
      throw error;
    }
  }

  /**
   * Get Stripe Connect account details
   * @param {string} accountId - Stripe Connect account ID
   * @returns {Promise<Object>} Account object
   */
  async getConnectAccount(accountId) {
    try {
      const account = await stripeConnect.accounts.retrieve(accountId);
      return account;
    } catch (error) {
      console.error('[Stripe Connect] Error retrieving account:', error);
      throw error;
    }
  }

  /**
   * Check if Connect account has completed onboarding
   * @param {string} accountId - Stripe Connect account ID
   * @returns {Promise<Object>} Onboarding status
   */
  async checkConnectAccountStatus(accountId) {
    try {
      const account = await stripeConnect.accounts.retrieve(accountId);

      const status = {
        accountId: account.id,
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        requirements: account.requirements,
        isComplete: account.details_submitted && account.charges_enabled && account.payouts_enabled,
        accountStatus: this._determineAccountStatus(account)
      };

      console.log(`[Stripe Connect] Account ${accountId} status:`, status.accountStatus);
      return status;
    } catch (error) {
      console.error('[Stripe Connect] Error checking account status:', error);
      throw error;
    }
  }

  /**
   * Determine account status from Stripe account object
   * @param {Object} account - Stripe account object
   * @returns {string} Account status
   * @private
   */
  _determineAccountStatus(account) {
    if (!account.details_submitted) {
      return 'pending';
    }
    if (account.requirements?.disabled_reason) {
      return 'disabled';
    }
    if (account.requirements?.currently_due?.length > 0) {
      return 'pending';
    }
    if (account.charges_enabled && account.payouts_enabled) {
      return 'enabled';
    }
    return 'pending';
  }

  /**
   * Create a login link for the Connect Express dashboard
   * @param {string} accountId - Stripe Connect account ID
   * @returns {Promise<Object>} Login link object
   */
  async createConnectDashboardLink(accountId) {
    try {
      const loginLink = await stripeConnect.accounts.createLoginLink(accountId);
      console.log(`[Stripe Connect] Created dashboard link for account ${accountId}`);
      return loginLink;
    } catch (error) {
      console.error('[Stripe Connect] Error creating dashboard link:', error);
      throw error;
    }
  }

  /**
   * Create a transfer to a Connect account (for distributions/payouts)
   * @param {string} accountId - Destination Stripe Connect account ID
   * @param {number} amount - Amount in cents
   * @param {string} currency - Currency code (default: mxn)
   * @param {string} description - Transfer description
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Transfer object
   */
  async createTransferToConnectAccount(accountId, amount, currency = 'mxn', description = '', metadata = {}) {
    try {
      const transfer = await stripeConnect.transfers.create({
        amount: amount,
        currency: currency,
        destination: accountId,
        description: description,
        metadata: metadata
      });

      console.log(`[Stripe Connect] Created transfer ${transfer.id} to account ${accountId} for ${amount} ${currency}`);
      return transfer;
    } catch (error) {
      console.error('[Stripe Connect] Error creating transfer:', error);
      throw error;
    }
  }

  /**
   * Delete/deauthorize a Connect account
   * @param {string} accountId - Stripe Connect account ID
   * @returns {Promise<Object>} Deleted account object
   */
  async deleteConnectAccount(accountId) {
    try {
      const deleted = await stripeConnect.accounts.del(accountId);
      console.log(`[Stripe Connect] Deleted account ${accountId}`);
      return deleted;
    } catch (error) {
      console.error('[Stripe Connect] Error deleting account:', error);
      throw error;
    }
  }

  /**
   * Get Connect account balance
   * @param {string} accountId - Stripe Connect account ID
   * @returns {Promise<Object>} Balance object
   */
  async getConnectAccountBalance(accountId) {
    try {
      const balance = await stripeConnect.balance.retrieve({
        stripeAccount: accountId
      });
      return balance;
    } catch (error) {
      console.error('[Stripe Connect] Error retrieving balance:', error);
      throw error;
    }
  }

  /**
   * Verify Connect webhook signature (uses separate secret)
   * @param {string} payload - Raw request body
   * @param {string} signature - Stripe signature header
   * @returns {Object} Parsed Stripe event
   */
  verifyConnectWebhookSignature(payload, signature) {
    try {
      const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
      const event = stripeConnect.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret
      );
      return event;
    } catch (error) {
      console.error('[Stripe Connect] Webhook signature verification failed:', error.message);
      throw error;
    }
  }
}

module.exports = new StripeService();
