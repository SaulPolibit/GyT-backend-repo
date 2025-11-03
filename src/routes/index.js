const express = require('express');
const portalHQRoutes = require('./portalHQ.routes');
const vudyRoutes = require('./vudy.routes');
const docusealRoutes = require('./docuseal.routes');
const bridgeRoutes = require('./bridge.routes');
const customRoutes = require('./custom.routes');
const companyRoutes = require('./company.routes');
const notificationsRoutes = require('./notifications.routes');

const router = express.Router();

// Mount route modules
router.use('/portal', portalHQRoutes);
router.use('/vudy', vudyRoutes);
router.use('/docuseal', docusealRoutes);
router.use('/bridge', bridgeRoutes);
router.use('/custom', customRoutes);
router.use('/company', companyRoutes);
router.use('/notifications', notificationsRoutes);

// Root API endpoint
router.get('/', (req, res) => {
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
    },
  });
});

module.exports = router;