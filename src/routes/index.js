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

// Investment Manager routes
const structureRoutes = require('./structure.routes');
const investorRoutes = require('./investor.routes');
const investmentRoutes = require('./investment.routes');
const capitalCallRoutes = require('./capitalCall.routes');
const distributionRoutes = require('./distribution.routes');
const waterfallTierRoutes = require('./waterfallTier.routes');
const documentRoutes = require('./document.routes');

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

// Mount Investment Manager routes
router.use('/structures', structureRoutes);
router.use('/investors', investorRoutes);
router.use('/investments', investmentRoutes);
router.use('/capital-calls', capitalCallRoutes);
router.use('/distributions', distributionRoutes);
router.use('/waterfall-tiers', waterfallTierRoutes);
router.use('/documents', documentRoutes);

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
      // Investment Manager endpoints
      structures: '/api/structures',
      investors: '/api/investors',
      investments: '/api/investments',
      capitalCalls: '/api/capital-calls',
      distributions: '/api/distributions',
      waterfallTiers: '/api/waterfall-tiers',
      documents: '/api/documents',
    },
  });
});

module.exports = router;