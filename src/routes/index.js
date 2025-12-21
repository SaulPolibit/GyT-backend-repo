const express = require('express');
const portalHQRoutes = require('./portalHQ.routes');
const vudyRoutes = require('./vudy.routes');
const docusealRoutes = require('./docuseal.routes');
const bridgeRoutes = require('./bridge.routes');
const customRoutes = require('./custom.routes');
const companyRoutes = require('./company.routes');
const notificationsRoutes = require('./notifications.routes');
const blockchainRoutes = require('./blockchain.routes');
const projectRoutes = require('./project.routes');
const userRoutes = require('./user.routes');

// Investment Manager routes
const structureRoutes = require('./structure.routes');
const investorRoutes = require('./investor.routes');
const investmentRoutes = require('./investment.routes');
const capitalCallRoutes = require('./capitalCall.routes');
const distributionRoutes = require('./distribution.routes');
const waterfallTierRoutes = require('./waterfallTier.routes');
const documentRoutes = require('./document.routes');

// Chat System routes
const conversationRoutes = require('./conversation.routes');
const messageRoutes = require('./message.routes');

// Email System routes
const emailRoutes = require('./email.routes');

// Payment routes
const paymentRoutes = require('./payment.routes');

// Subscription routes
const subscriptionRoutes = require('./subscription.routes');

// Investment Subscription routes
const investmentSubscriptionRoutes = require('./investmentSubscription.routes');

// KYC Session routes
const kycSessionRoutes = require('./kycSession.routes');

// Firm Settings routes
const firmSettingsRoutes = require('./firmSettings.routes');

const router = express.Router();

// Mount route modules
router.use('/portal', portalHQRoutes);
router.use('/vudy', vudyRoutes);
router.use('/docuseal', docusealRoutes);
router.use('/bridge', bridgeRoutes);
router.use('/custom', customRoutes);
router.use('/company', companyRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/blockchain', blockchainRoutes);
router.use('/projects', projectRoutes);
router.use('/users', userRoutes);

// Mount Investment Manager routes
router.use('/structures', structureRoutes);
router.use('/investors', investorRoutes);
router.use('/investments', investmentRoutes);
router.use('/capital-calls', capitalCallRoutes);
router.use('/distributions', distributionRoutes);
router.use('/waterfall-tiers', waterfallTierRoutes);
router.use('/documents', documentRoutes);

// Mount Chat System routes
router.use('/conversations', conversationRoutes);
router.use('/conversations', messageRoutes);
router.use('/', messageRoutes); // For /api/messages/* routes

// Mount Email System routes
router.use('/users', emailRoutes); // For /api/users/:userId/email-* routes

// Mount Payment routes
router.use('/payments', paymentRoutes);

// Mount Subscription routes
router.use('/subscriptions', subscriptionRoutes);

// Mount Investment Subscription routes
router.use('/investment-subscriptions', investmentSubscriptionRoutes);

// Mount KYC Session routes
router.use('/kyc-sessions', kycSessionRoutes);

// Mount Firm Settings routes
router.use('/firm-settings', firmSettingsRoutes);

// Root API endpoint
router.get('/', (_req, res) => {
  res.json({
    message: 'API is running',
    version: '1.0.0',
    endpoints: {
      portal: '/api/portal',
      vudy: '/api/vudy',
      docuseal: '/api/docuseal',
      bridge: '/api/bridge',
      custom: '/api/custom',
      company: '/api/company',
      notifications: '/api/notifications',
      blockchain: '/api/blockchain',
      projects: '/api/projects',
      users: '/api/users',
      // Investment Manager endpoints
      structures: '/api/structures',
      investors: '/api/investors',
      investments: '/api/investments',
      capitalCalls: '/api/capital-calls',
      distributions: '/api/distributions',
      waterfallTiers: '/api/waterfall-tiers',
      documents: '/api/documents',
      // Chat System endpoints
      conversations: '/api/conversations',
      messages: '/api/messages',
      // Email System endpoints
      emailSettings: '/api/users/:userId/email-settings',
      sendEmail: '/api/users/:userId/send-email',
      emailLogs: '/api/users/:userId/email-logs',
      // Payment endpoints
      payments: '/api/payments',
      // Subscription endpoints
      subscriptions: '/api/subscriptions',
      // Investment Subscription endpoints
      investmentSubscriptions: '/api/investment-subscriptions',
      // KYC Session endpoints
      kycSessions: '/api/kyc-sessions',
      // Firm Settings endpoints
      firmSettings: '/api/firm-settings',
    },
  });
});

module.exports = router;