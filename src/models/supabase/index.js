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

// MFA System models
const MFAFactor = require('./mfaFactor');

// DocuSeal System models
const DocusealSubmission = require('./docusealSubmission');

module.exports = {
  // Core models
  User,
  Company,
  NotificationSettings,
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

  // MFA System models
  MFAFactor,

  // DocuSeal System models
  DocusealSubmission,
};
