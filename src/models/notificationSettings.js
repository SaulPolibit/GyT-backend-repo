// models/NotificationSettings.js
const mongoose = require('mongoose');

const notificationSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    unique: true,
    index: true
  },
  emailNotifications: {
    type: Boolean,
    default: false
  },
  portfolioNotifications: {
    type: Boolean,
    default: false
  },
  reportNotifications: {
    type: Boolean,
    default: false
  },
  investorActivityNotifications: {
    type: Boolean,
    default: false
  },
  systemUpdateNotifications: {
    type: Boolean,
    default: false
  },
  marketingEmailNotifications: {
    type: Boolean,
    default: false
  },
  pushNotifications: {
    type: Boolean,
    default: false
  },
  smsNotifications: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Index to ensure one notification settings per user
notificationSettingsSchema.index({ userId: 1 }, { unique: true });

// Static method to find or create notification settings for a user
notificationSettingsSchema.statics.findOrCreateByUserId = async function(userId) {
  let settings = await this.findOne({ userId });

  if (!settings) {
    settings = await this.create({ userId });
  }

  return settings;
};

// Static method to find by user ID
notificationSettingsSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId });
};

// Static method to update notification settings
notificationSettingsSchema.statics.updateByUserId = async function(userId, updates) {
  return this.findOneAndUpdate(
    { userId },
    { $set: updates },
    { new: true, runValidators: true }
  );
};

// Method to check if a specific notification type is enabled
notificationSettingsSchema.methods.isNotificationEnabled = function(notificationType) {
  return this[notificationType] === true;
};

// Method to enable all notifications
notificationSettingsSchema.methods.enableAll = function() {
  this.emailNotifications = true;
  this.portfolioNotifications = true;
  this.reportNotifications = true;
  this.investorActivityNotifications = true;
  this.systemUpdateNotifications = true;
  this.marketingEmailNotifications = true;
  this.pushNotifications = true;
  this.smsNotifications = true;
  return this.save();
};

// Method to disable all notifications
notificationSettingsSchema.methods.disableAll = function() {
  this.emailNotifications = false;
  this.portfolioNotifications = false;
  this.reportNotifications = false;
  this.investorActivityNotifications = false;
  this.systemUpdateNotifications = false;
  this.marketingEmailNotifications = false;
  this.pushNotifications = false;
  this.smsNotifications = false;
  return this.save();
};

const NotificationSettings = mongoose.model('NotificationSettings', notificationSettingsSchema);

module.exports = NotificationSettings;
