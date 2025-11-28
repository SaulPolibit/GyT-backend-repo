/**
 * Main Application File
 * Express.js server configuration and middleware setup
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const routes = require('./routes');
const { initializeSocket } = require('./config/socket');
const {
  errorHandler,
  notFoundHandler,
  setupGlobalHandlers
} = require('./middleware/errorHandler');
const { isDevelopment } = require('./utils/helpers');


const { connectDB } = require('./config/database');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Initialize Socket.IO
initializeSocket(server);

// ===== GLOBAL ERROR HANDLERS =====
// Setup handlers for unhandled rejections and uncaught exceptions
setupGlobalHandlers();

// ===== SECURITY MIDDLEWARE =====
// Helmet helps secure Express apps by setting various HTTP headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:', 'http://localhost:3000'],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ===== CORS CONFIGURATION =====
// Configure CORS based on environment
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (isDevelopment()) {
      return callback(null, true);
    }
    
    // In production, check against whitelist
    const whitelist = process.env.CORS_WHITELIST 
      ? process.env.CORS_WHITELIST.split(',') 
      : [];
    
    if (whitelist.indexOf(origin) !== -1 || whitelist.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-API-Key',
    'Accept',
  ],
};

app.use(cors(corsOptions));

// ===== ADDITIONAL CORS HEADERS =====
// Manual CORS headers for additional control
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// ===== STATIC FILES MIDDLEWARE =====
// Serve uploaded files with CORS headers
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
}, express.static(path.join(__dirname, '../uploads')));

// ===== BODY PARSING MIDDLEWARE =====
// Parse JSON bodies
app.use(express.json({
  limit: '10mb',
  strict: true,
}));

// Parse URL-encoded bodies
app.use(express.urlencoded({
  extended: true,
  limit: '10mb',
}));

// ===== LOGGING MIDDLEWARE =====
// Different logging formats for different environments
if (isDevelopment()) {
  // Development: detailed logging
  app.use(morgan('dev'));
} else {
  // Production: combined format
  app.use(morgan('combined'));
}

// ===== REQUEST ID MIDDLEWARE =====
// Add unique ID to each request for tracking
app.use((req, res, next) => {
  req.id = require('crypto').randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// ===== CUSTOM MIDDLEWARE =====
// Add request timestamp
app.use((req, res, next) => {
  req.timestamp = new Date().toISOString();
  next();
});

// ===== RATE LIMITING (Optional) =====
// Uncomment to enable basic rate limiting
/*
const { rateLimit } = require('./middleware/auth');
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
}));
*/

// ===== HEALTH CHECK ENDPOINT =====
app.get('/health', (req, res) => {
  const healthCheck = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    memoryUsage: {
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
    },
  };
  
  res.status(200).json(healthCheck);
});

// ===== ROOT ENDPOINT =====
app.get('/', (req, res) => {
  res.json({
    name: 'API Project',
    version: '1.0.0',
    description: 'Node.js API implementing FlutterFlow API calls',
    documentation: '/api',
    health: '/health',
    endpoints: {
      portal: '/api/portal',
      vudy: '/api/vudy',
      docuseal: '/api/docuseal',
      bridge: '/api/bridge',
      custom: '/api/custom',
    },
  });
});

// ===== API ROUTES =====
app.use('/api', routes);

// ===== API DOCUMENTATION ENDPOINT =====
app.get('/api', (req, res) => {
  res.json({
    message: 'API is running',
    version: '1.0.0',
    services: {
      portalHQ: {
        description: 'Client management, wallet creation, and blockchain transactions',
        endpoints: '/api/portal',
      },
      vudy: {
        description: 'Payment request management',
        endpoints: '/api/vudy',
      },
      docuseal: {
        description: 'Document submission management',
        endpoints: '/api/docuseal',
      },
      bridge: {
        description: 'Customer, wallet, virtual account, and transfer management',
        endpoints: '/api/bridge',
      },
      custom: {
        description: 'PoliBit, DiDit KYC, and smart contract deployment',
        endpoints: '/api/custom',
      },
      company: {
        description: 'Company data management',
        endpoints: '/api/company',
      },
      notifications: {
        description: 'User notification settings management',
        endpoints: '/api/notifications',
      },
      blockchain: {
        description: 'Smart contract interactions and blockchain queries',
        endpoints: '/api/blockchain',
      },
    },
    documentation: {
      health: 'GET /health',
      apiInfo: 'GET /api',
    },
  });
});

// ===== 404 HANDLER =====
// This should be after all other routes
app.use(notFoundHandler);

// ===== ERROR HANDLING MIDDLEWARE =====
// This must be the last middleware
app.use(errorHandler);

// ===== GRACEFUL SHUTDOWN =====
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  server.close(() => {
    console.log('HTTP server closed.');
    
    // Close database connections, clean up resources, etc.
    // Example: await db.close();
    
    console.log('Graceful shutdown completed.');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// ===== START SERVER =====
server.listen(PORT, async () => {
  
  console.log('\n=================================');
  console.log('🚀 Server Started Successfully!');
  console.log('=================================');
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Server URL: http://localhost:${PORT}`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  console.log(`📚 API Docs: http://localhost:${PORT}/api`);
  console.log('=================================');
  console.log('\n📋 Available Services:');
  console.log(`   • Portal HQ: http://localhost:${PORT}/api/portal`);
  console.log(`   • Vudy: http://localhost:${PORT}/api/vudy`);
  console.log(`   • DocuSeal: http://localhost:${PORT}/api/docuseal`);
  console.log(`   • Bridge: http://localhost:${PORT}/api/bridge`);
  console.log(`   • Custom: http://localhost:${PORT}/api/custom`);
  console.log(`   • Company: http://localhost:${PORT}/api/company`);
  console.log(`   • Notifications: http://localhost:${PORT}/api/notifications`);
  console.log(`   • Blockchain: http://localhost:${PORT}/api/blockchain`);
  console.log(`   • WebSocket: ws://localhost:${PORT} (Socket.IO)`);
  console.log('=================================\n');
  
  await connectDB();
  console.log('✅ Database connected');
  // Log environment variables status (without exposing values)
  if (isDevelopment()) {
    console.log('🔑 Environment Variables:');
    console.log(`   • PORT: ${PORT}`);
    console.log(`   • PORTAL_API_KEY: ${process.env.PORTAL_API_KEY ? '✓ Set' : '✗ Not set'}`);
    console.log(`   • VUDY_API_KEY: ${process.env.VUDY_API_KEY ? '✓ Set' : '✗ Not set'}`);
    console.log(`   • DOCUSEAL_API_TOKEN: ${process.env.DOCUSEAL_API_TOKEN ? '✓ Set' : '✗ Not set'}`);
    console.log(`   • BRIDGE_API_KEY: ${process.env.BRIDGE_API_KEY ? '✓ Set' : '✗ Not set'}`);
    console.log(`   • JWT_SECRET: ${process.env.JWT_SECRET ? '✓ Set' : '✗ Not set'}`);
    console.log(`   • API_KEY: ${process.env.API_KEY ? '✓ Set' : '✗ Not set'}`);
    console.log('=================================\n');
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ===== EXPORT APP FOR TESTING =====
module.exports = app;