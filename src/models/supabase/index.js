// models/supabase/index.js
// Centralized exports for all Supabase models

// Core models
const User = require('./user');
const Company = require('./company');
const NotificationSettings = require('./notificationSettings');
const Project = require('./project');
const SmartContract = require('./smartContract');

// Investment Manager models
const Structure = require('./structure');
const Investor = require('./investor');
const Investment = require('./investment');
const CapitalCall = require('./capitalCall');
const Distribution = require('./distribution');
const WaterfallTier = require('./waterfallTier');
const Document = require('./document');

module.exports = {
  // Core models
  User,
  Company,
  NotificationSettings,
  Project,
  SmartContract,

  // Investment Manager models
  Structure,
  Investor,
  Investment,
  CapitalCall,
  Distribution,
  WaterfallTier,
  Document,
};
