/**
 * Stripe Service
 * Handles all Stripe API operations for subscriptions
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
   * Create a subscription with base plan and optional add-ons
   * @param {string} customerId - Stripe customer ID
   * @param {string} basePriceId - Price ID for base plan (e.g., price_xxxxx)
   * @param {Array<string>} addonPriceIds - Array of addon price IDs
   * @param {Object} options - Additional options (trial_period_days, etc.)
   * @returns {Promise<Object>} Stripe subscription object with clientSecret
   */
  async createSubscription(customerId, basePriceId, addonPriceIds = [], options = {}) {
    try {
      // Build subscription items: base plan + addons
      const items = [
        { price: basePriceId, quantity: 1 } // Base plan (required)
      ];

      // Add optional addons
      addonPriceIds.forEach(priceId => {
        items.push({ price: priceId, quantity: 1 });
      });

      const subscriptionData = {
        customer: customerId,
        items: items,
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription'
        },
        expand: ['latest_invoice.payment_intent'],
        ...options // trial_period_days, etc.
      };

      const subscription = await stripe.subscriptions.create(subscriptionData);

      console.log(`[Stripe] Created subscription ${subscription.id} for customer ${customerId}`);
      console.log(`[Stripe] Subscription items:`, items.length);

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
        unit_amount: 2000, // $20.00 in cents (adjust as needed)
        currency: 'usd',
        recurring: { interval: 'month' }
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
        currency: 'usd',
        recurring: { interval: 'month' }
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
}

module.exports = new StripeService();
