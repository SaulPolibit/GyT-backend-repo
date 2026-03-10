/**
 * Notification Helper Utility
 * Functions to send notifications to investors for various events
 */

const Notification = require('../models/supabase/notification');
const NotificationSettings = require('../models/supabase/notificationSettings');
const Subscription = require('../models/supabase/subscription');
const { Structure } = require('../models/supabase');

/**
 * Create a security alert notification for a user
 * @param {string} userId - User ID
 * @param {string} alertType - Type of security alert
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 */
async function createSecurityAlertNotification(userId, alertType, title, message) {
  try {
    const settings = await NotificationSettings.findByUserId(userId);
    const shouldSend = !settings || settings.securityAlerts !== false;

    if (!shouldSend) {
      console.log('[Security Alert] User has security alerts disabled, skipping notification');
      return;
    }

    await Notification.create({
      userId,
      notificationType: 'security_alert',
      channel: 'portal',
      title,
      message,
      priority: 'high',
      metadata: {
        alertType,
        timestamp: new Date().toISOString()
      }
    });

    console.log(`[Security Alert] Notification created - ${alertType}`);
  } catch (error) {
    console.error('[Security Alert] Error creating notification:', error.message);
  }
}

/**
 * Get all investor user IDs for a structure
 * @param {string} structureId - Structure ID
 * @returns {Promise<string[]>} Array of user IDs
 */
async function getStructureInvestorUserIds(structureId) {
  try {
    const subscriptions = await Subscription.findByStructureId(structureId);
    // Get unique user IDs
    const userIds = [...new Set(subscriptions.map(sub => sub.userId).filter(Boolean))];
    return userIds;
  } catch (error) {
    console.error('[NotificationHelper] Error getting structure investors:', error.message);
    return [];
  }
}

/**
 * Send notification to all investors in a structure
 * @param {string} structureId - Structure ID
 * @param {Object} notificationData - Notification data (without userId)
 * @param {string} senderId - Sender user ID
 * @returns {Promise<Object[]>} Created notifications
 */
async function notifyStructureInvestors(structureId, notificationData, senderId) {
  try {
    const userIds = await getStructureInvestorUserIds(structureId);

    if (userIds.length === 0) {
      console.log('[NotificationHelper] No investors found for structure:', structureId);
      return [];
    }

    const notifications = userIds.map(userId => ({
      userId,
      ...notificationData,
      senderId,
      channel: 'portal',
      status: 'pending'
    }));

    const createdNotifications = await Notification.createMany(notifications);
    console.log(`[NotificationHelper] Sent ${createdNotifications.length} notifications for structure:`, structureId);
    return createdNotifications;
  } catch (error) {
    console.error('[NotificationHelper] Error notifying structure investors:', error.message);
    return [];
  }
}

/**
 * Send Capital Call Notice to all investors in a structure
 * @param {Object} capitalCall - Capital call object
 * @param {Object} structure - Structure object
 * @param {string} senderId - Sender user ID
 * @param {boolean} isUrgent - Whether the capital call is urgent
 */
async function sendCapitalCallNotice(capitalCall, structure, senderId, isUrgent = false) {
  const notificationType = isUrgent ? 'urgent_capital_call' : 'capital_call_notice';
  const priority = isUrgent ? 'urgent' : 'high';

  const notificationData = {
    notificationType,
    title: `Capital Call Notice - ${structure.name}`,
    message: `A capital call of $${capitalCall.totalCallAmount?.toLocaleString() || '0'} has been issued for ${structure.name}. Due date: ${new Date(capitalCall.dueDate).toLocaleDateString()}.`,
    priority,
    relatedEntityType: 'CapitalCall',
    relatedEntityId: capitalCall.id,
    actionUrl: '/lp-portal/capital-calls',
    metadata: {
      structureId: structure.id,
      structureName: structure.name,
      callNumber: capitalCall.callNumber,
      totalAmount: capitalCall.totalCallAmount,
      dueDate: capitalCall.dueDate
    }
  };

  return notifyStructureInvestors(capitalCall.structureId, notificationData, senderId);
}

/**
 * Send Distribution Notice to all investors in a structure
 * @param {Object} distribution - Distribution object
 * @param {Object} structure - Structure object
 * @param {string} senderId - Sender user ID
 */
async function sendDistributionNotice(distribution, structure, senderId) {
  const notificationData = {
    notificationType: 'distribution_notice',
    title: `Distribution Notice - ${structure.name}`,
    message: `A distribution of $${distribution.totalAmount?.toLocaleString() || '0'} has been processed for ${structure.name}. The funds will be transferred to your account shortly.`,
    priority: 'normal',
    relatedEntityType: 'Distribution',
    relatedEntityId: distribution.id,
    actionUrl: '/lp-portal/distributions',
    metadata: {
      structureId: structure.id,
      structureName: structure.name,
      distributionNumber: distribution.distributionNumber,
      totalAmount: distribution.totalAmount,
      distributionDate: distribution.distributionDate
    }
  };

  return notifyStructureInvestors(distribution.structureId, notificationData, senderId);
}

/**
 * Send Quarterly Report notification to all investors in a structure
 * @param {Object} reportData - Report data { structureId, quarter, year, reportUrl }
 * @param {Object} structure - Structure object
 * @param {string} senderId - Sender user ID
 */
async function sendQuarterlyReportNotice(reportData, structure, senderId) {
  const notificationData = {
    notificationType: 'quarterly_report',
    title: `Q${reportData.quarter} ${reportData.year} Report Available - ${structure.name}`,
    message: `The quarterly report for Q${reportData.quarter} ${reportData.year} is now available for ${structure.name}. View the report in your investor portal.`,
    priority: 'normal',
    relatedEntityType: 'Structure',
    relatedEntityId: structure.id,
    actionUrl: reportData.reportUrl || '/lp-portal/documents',
    metadata: {
      structureId: structure.id,
      structureName: structure.name,
      quarter: reportData.quarter,
      year: reportData.year,
      reportUrl: reportData.reportUrl
    }
  };

  return notifyStructureInvestors(reportData.structureId, notificationData, senderId);
}

/**
 * Send K-1 Tax Form Available notification to all investors in a structure
 * @param {Object} k1Data - K-1 data { structureId, taxYear, formUrl }
 * @param {Object} structure - Structure object
 * @param {string} senderId - Sender user ID
 */
async function sendK1TaxFormNotice(k1Data, structure, senderId) {
  const notificationData = {
    notificationType: 'k1_tax_form',
    title: `K-1 Tax Form Available - ${structure.name}`,
    message: `Your K-1 tax form for tax year ${k1Data.taxYear} is now available for ${structure.name}. Please download it for your tax filing.`,
    priority: 'high',
    relatedEntityType: 'Structure',
    relatedEntityId: structure.id,
    actionUrl: k1Data.formUrl || '/lp-portal/documents',
    metadata: {
      structureId: structure.id,
      structureName: structure.name,
      taxYear: k1Data.taxYear,
      formUrl: k1Data.formUrl
    }
  };

  return notifyStructureInvestors(k1Data.structureId, notificationData, senderId);
}

/**
 * Send Document Upload notification to specific user or structure investors
 * @param {Object} document - Document object
 * @param {string} senderId - Sender user ID
 * @param {string} uploaderName - Name of the uploader
 * @param {string[]} targetUserIds - Optional specific user IDs to notify
 */
async function sendDocumentUploadNotice(document, senderId, uploaderName, targetUserIds = null) {
  const notificationData = {
    notificationType: 'document_upload',
    title: `New Document Uploaded`,
    message: `${uploaderName || 'A user'} has uploaded a new document: "${document.documentName}".`,
    priority: 'normal',
    relatedEntityType: document.entityType,
    relatedEntityId: document.entityId,
    actionUrl: '/lp-portal/documents',
    metadata: {
      documentId: document.id,
      documentName: document.documentName,
      documentType: document.documentType,
      entityType: document.entityType,
      entityId: document.entityId
    }
  };

  if (targetUserIds && targetUserIds.length > 0) {
    // Send to specific users
    const notifications = targetUserIds.map(userId => ({
      userId,
      ...notificationData,
      senderId,
      channel: 'portal',
      status: 'pending'
    }));
    return Notification.createMany(notifications);
  } else if (document.entityType === 'Structure') {
    // For structure documents, notify all investors in that structure
    return notifyStructureInvestors(document.entityId, notificationData, senderId);
  }

  return [];
}

/**
 * Send General Announcement to all investors in a structure or all users
 * @param {Object} announcementData - Announcement data { title, message, structureId?, priority?, actionUrl? }
 * @param {string} senderId - Sender user ID
 * @param {string[]} targetUserIds - Optional specific user IDs to notify (if no structureId)
 */
async function sendGeneralAnnouncement(announcementData, senderId, targetUserIds = null) {
  const notificationData = {
    notificationType: 'general_announcement',
    title: announcementData.title,
    message: announcementData.message,
    priority: announcementData.priority || 'normal',
    actionUrl: announcementData.actionUrl || null,
    metadata: {
      structureId: announcementData.structureId || null,
      announcementType: announcementData.announcementType || 'general'
    }
  };

  if (announcementData.structureId) {
    // Send to all investors in the structure
    return notifyStructureInvestors(announcementData.structureId, notificationData, senderId);
  } else if (targetUserIds && targetUserIds.length > 0) {
    // Send to specific users
    const notifications = targetUserIds.map(userId => ({
      userId,
      ...notificationData,
      senderId,
      channel: 'portal',
      status: 'pending'
    }));
    return Notification.createMany(notifications);
  }

  return [];
}

/**
 * Send Payment Confirmation notification
 * @param {string} userId - User ID to notify
 * @param {Object} paymentData - Payment data { amount, type, structureName }
 * @param {string} senderId - Sender user ID
 */
async function sendPaymentConfirmation(userId, paymentData, senderId) {
  const notification = {
    userId,
    notificationType: 'payment_confirmation',
    title: 'Payment Confirmed',
    message: `Your payment of $${paymentData.amount?.toLocaleString() || '0'} for ${paymentData.structureName} has been confirmed.`,
    priority: 'normal',
    channel: 'portal',
    senderId,
    metadata: paymentData
  };

  return Notification.create(notification);
}

module.exports = {
  createSecurityAlertNotification,
  getStructureInvestorUserIds,
  notifyStructureInvestors,
  sendCapitalCallNotice,
  sendDistributionNotice,
  sendQuarterlyReportNotice,
  sendK1TaxFormNotice,
  sendDocumentUploadNotice,
  sendGeneralAnnouncement,
  sendPaymentConfirmation
};
