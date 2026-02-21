// models/supabase/index.js
// Centralized exports for all Supabase models

// Core models
const User = require('./user');
const Company = require('./company');
const NotificationSettings = require('./notificationSettings');
const Notification = require('./notification');
const Project = require('./project');
const SmartContract = require('./smartContract');

// Investment Manager models
const Structure = require('./structure');
const StructureAdmin = require('./structureAdmin');
const Investor = require('./investor');
const Investment = require('./investment');
const CapitalCall = require('./capitalCall');
const Distribution = require('./distribution');
const WaterfallTier = require('./waterfallTier');
const Document = require('./document');

// Chat System models
const Conversation = require('./conversation');
const ConversationParticipant = require('./conversationParticipant');
const Message = require('./message');
const MessageRead = require('./messageRead');
const MessageAttachment = require('./messageAttachment');

// Email System models
const EmailSettings = require('./emailSettings');
const EmailLog = require('./emailLog');
const EmailDomain = require('./emailDomain');

// MFA System models
const MFAFactor = require('./mfaFactor');

// DocuSeal System models
const DocusealSubmission = require('./docusealSubmission');

// Payment System models
const Payment = require('./payment');
const Subscription = require('./subscription');

// Investment Subscription models
const InvestmentSubscription = require('./investmentSubscription');

// KYC System models
const KycSession = require('./kycSession');

// Firm Settings models
const FirmSettings = require('./firmSettings');

// Presence System models
const Presence = require('./presence');

module.exports = {
  // Core models
  User,
  Company,
  NotificationSettings,
  Notification,
  Project,
  SmartContract,

  // Investment Manager models
  Structure,
  StructureAdmin,
  Investor,
  Investment,
  CapitalCall,
  Distribution,
  WaterfallTier,
  Document,

  // Chat System models
  Conversation,
  ConversationParticipant,
  Message,
  MessageRead,
  MessageAttachment,

  // Email System models
  EmailSettings,
  EmailLog,
  EmailDomain,

  // MFA System models
  MFAFactor,

  // DocuSeal System models
  DocusealSubmission,

  // Payment System models
  Payment,
  Subscription,

  // Investment Subscription models
  InvestmentSubscription,

  // KYC System models
  KycSession,

  // Firm Settings models
  FirmSettings,

  // Presence System models
  Presence,
};
