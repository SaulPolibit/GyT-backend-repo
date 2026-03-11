/**
 * Capital Call Reminders Cron Job
 *
 * This job runs daily and handles:
 * 1. Sending capital call notices on the notice date
 * 2. Sending payment reminders 3 days before deadline
 * 3. Sending payment reminders 1 day before deadline
 * 4. Sending final reminders on the deadline date
 *
 * Only sends reminders to investors who haven't fully paid.
 */

const cron = require('node-cron');
const CapitalCall = require('../models/supabase/capitalCall');
const { sendEmail } = require('../utils/emailSender');

// Email template configurations
const EMAIL_TEMPLATES = {
  capitalCallNotice: {
    subject: (fundName, callNumber) => `Capital Call #${callNumber} - ${fundName}`,
    getHtml: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a2e;">Capital Call Notice</h2>
        <p>Dear ${data.investorName},</p>
        <p>A capital call has been issued for <strong>${data.fundName}</strong>.</p>

        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #1a1a2e;">Capital Call Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Call Number:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">#${data.callNumber}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Your Amount Due:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd; color: #2563eb; font-weight: bold;">${data.currency} ${data.amountDue.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Payment Deadline:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd; color: #dc2626; font-weight: bold;">${data.deadlineDate}</td>
            </tr>
          </table>
        </div>

        ${data.purpose ? `<p><strong>Purpose:</strong> ${data.purpose}</p>` : ''}

        <p>Please ensure your payment is received by the deadline to avoid any late fees or penalties.</p>

        <p>You can view your capital call details and make payment through your <a href="${data.portalUrl}" style="color: #2563eb;">LP Portal</a>.</p>

        <p>If you have any questions, please contact your fund administrator.</p>

        <p>Best regards,<br>${data.fundName} Administration</p>
      </div>
    `,
    getText: (data) => `
Capital Call Notice

Dear ${data.investorName},

A capital call has been issued for ${data.fundName}.

Capital Call Details:
- Call Number: #${data.callNumber}
- Your Amount Due: ${data.currency} ${data.amountDue.toLocaleString()}
- Payment Deadline: ${data.deadlineDate}

${data.purpose ? `Purpose: ${data.purpose}` : ''}

Please ensure your payment is received by the deadline to avoid any late fees or penalties.

You can view your capital call details and make payment through your LP Portal: ${data.portalUrl}

If you have any questions, please contact your fund administrator.

Best regards,
${data.fundName} Administration
    `
  },

  reminder3Days: {
    subject: (fundName) => `Payment Reminder: Capital Call Due in 3 Days - ${fundName}`,
    getHtml: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f59e0b;">Payment Reminder</h2>
        <p>Dear ${data.investorName},</p>
        <p>This is a friendly reminder that your capital call payment for <strong>${data.fundName}</strong> is due in <strong>3 days</strong>.</p>

        <div style="background-color: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
          <h3 style="margin-top: 0; color: #92400e;">Payment Details</h3>
          <p><strong>Amount Outstanding:</strong> ${data.currency} ${data.remainingAmount.toLocaleString()}</p>
          <p><strong>Payment Deadline:</strong> ${data.deadlineDate}</p>
        </div>

        <p>Please ensure your payment is submitted before the deadline.</p>

        <p><a href="${data.portalUrl}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Make Payment</a></p>

        <p>Best regards,<br>${data.fundName} Administration</p>
      </div>
    `,
    getText: (data) => `
Payment Reminder

Dear ${data.investorName},

This is a friendly reminder that your capital call payment for ${data.fundName} is due in 3 days.

Payment Details:
- Amount Outstanding: ${data.currency} ${data.remainingAmount.toLocaleString()}
- Payment Deadline: ${data.deadlineDate}

Please ensure your payment is submitted before the deadline.

Make payment at: ${data.portalUrl}

Best regards,
${data.fundName} Administration
    `
  },

  reminder1Day: {
    subject: (fundName) => `Urgent: Capital Call Payment Due Tomorrow - ${fundName}`,
    getHtml: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Urgent Payment Reminder</h2>
        <p>Dear ${data.investorName},</p>
        <p>Your capital call payment for <strong>${data.fundName}</strong> is due <strong>tomorrow</strong>.</p>

        <div style="background-color: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
          <h3 style="margin-top: 0; color: #991b1b;">Immediate Action Required</h3>
          <p><strong>Amount Outstanding:</strong> ${data.currency} ${data.remainingAmount.toLocaleString()}</p>
          <p><strong>Payment Deadline:</strong> ${data.deadlineDate}</p>
        </div>

        <p>Please submit your payment immediately to avoid any late fees or penalties.</p>

        <p><a href="${data.portalUrl}" style="display: inline-block; background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Make Payment Now</a></p>

        <p>Best regards,<br>${data.fundName} Administration</p>
      </div>
    `,
    getText: (data) => `
Urgent Payment Reminder

Dear ${data.investorName},

Your capital call payment for ${data.fundName} is due TOMORROW.

Immediate Action Required:
- Amount Outstanding: ${data.currency} ${data.remainingAmount.toLocaleString()}
- Payment Deadline: ${data.deadlineDate}

Please submit your payment immediately to avoid any late fees or penalties.

Make payment at: ${data.portalUrl}

Best regards,
${data.fundName} Administration
    `
  },

  reminderDueToday: {
    subject: (fundName) => `Final Notice: Capital Call Payment Due Today - ${fundName}`,
    getHtml: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Final Payment Notice</h2>
        <p>Dear ${data.investorName},</p>
        <p>Your capital call payment for <strong>${data.fundName}</strong> is due <strong>TODAY</strong>.</p>

        <div style="background-color: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
          <h3 style="margin-top: 0; color: #991b1b;">Payment Due Today</h3>
          <p><strong>Amount Outstanding:</strong> ${data.currency} ${data.remainingAmount.toLocaleString()}</p>
          <p><strong>Payment Deadline:</strong> TODAY (${data.deadlineDate})</p>
        </div>

        <p>Failure to submit payment today may result in late fees or other penalties as outlined in your subscription agreement.</p>

        <p><a href="${data.portalUrl}" style="display: inline-block; background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Make Payment Now</a></p>

        <p>If you have already submitted your payment, please disregard this notice.</p>

        <p>Best regards,<br>${data.fundName} Administration</p>
      </div>
    `,
    getText: (data) => `
Final Payment Notice

Dear ${data.investorName},

Your capital call payment for ${data.fundName} is due TODAY.

Payment Due Today:
- Amount Outstanding: ${data.currency} ${data.remainingAmount.toLocaleString()}
- Payment Deadline: TODAY (${data.deadlineDate})

Failure to submit payment today may result in late fees or other penalties as outlined in your subscription agreement.

Make payment at: ${data.portalUrl}

If you have already submitted your payment, please disregard this notice.

Best regards,
${data.fundName} Administration
    `
  }
};

/**
 * Format date for display
 */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Send capital call notice emails
 */
async function sendCapitalCallNotices() {
  console.log('[CapitalCallReminders] Checking for capital calls to notify...');

  try {
    const callsToNotify = await CapitalCall.findCallsToNotifyToday();
    console.log(`[CapitalCallReminders] Found ${callsToNotify.length} capital calls to notify`);

    for (const call of callsToNotify) {
      try {
        // Get all allocations for this call
        const allocations = await CapitalCall.getAllocationsWithUsers(call.id);
        console.log(`[CapitalCallReminders] Sending notices for call #${call.callNumber} to ${allocations.length} investors`);

        const portalUrl = process.env.FRONTEND_URL || 'https://app.polibit.com';
        const currency = call.structure?.baseCurrency || 'USD';

        for (const allocation of allocations) {
          if (!allocation.user?.email) {
            console.warn(`[CapitalCallReminders] No email for user ${allocation.userId}, skipping`);
            continue;
          }

          const template = EMAIL_TEMPLATES.capitalCallNotice;
          const emailData = {
            investorName: `${allocation.user.firstName || ''} ${allocation.user.lastName || ''}`.trim() || 'Investor',
            fundName: call.structure?.name || 'Fund',
            callNumber: call.callNumber,
            amountDue: allocation.totalDue || allocation.allocatedAmount,
            currency,
            deadlineDate: formatDate(call.deadlineDate),
            purpose: call.purpose,
            portalUrl: `${portalUrl}/lp-portal/capital-calls`
          };

          await sendEmail(null, {
            to: [allocation.user.email],
            subject: template.subject(emailData.fundName, emailData.callNumber),
            bodyHtml: template.getHtml(emailData),
            bodyText: template.getText(emailData)
          });

          console.log(`[CapitalCallReminders] Sent notice to user ${allocation.user.id}`);
        }

        // Update capital call status to 'Sent'
        await CapitalCall.markAsSent(call.id);
        console.log(`[CapitalCallReminders] Updated call #${call.callNumber} status to Sent`);

      } catch (err) {
        console.error(`[CapitalCallReminders] Error processing call ${call.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[CapitalCallReminders] Error in sendCapitalCallNotices:', err);
  }
}

/**
 * Send reminder emails for a specific days-before-deadline
 */
async function sendDeadlineReminders(daysBeforeDeadline, templateKey) {
  console.log(`[CapitalCallReminders] Checking for ${daysBeforeDeadline}-day reminders...`);

  try {
    const calls = await CapitalCall.findCallsForDeadlineReminder(daysBeforeDeadline);
    console.log(`[CapitalCallReminders] Found ${calls.length} capital calls for ${daysBeforeDeadline}-day reminder`);

    for (const call of calls) {
      try {
        // Get UNPAID allocations only
        const unpaidAllocations = await CapitalCall.getUnpaidAllocations(call.id);
        console.log(`[CapitalCallReminders] Sending ${daysBeforeDeadline}-day reminders for call #${call.callNumber} to ${unpaidAllocations.length} unpaid investors`);

        const portalUrl = process.env.FRONTEND_URL || 'https://app.polibit.com';
        const currency = call.structure?.baseCurrency || 'USD';

        for (const allocation of unpaidAllocations) {
          if (!allocation.user?.email) {
            console.warn(`[CapitalCallReminders] No email for user ${allocation.userId}, skipping`);
            continue;
          }

          const template = EMAIL_TEMPLATES[templateKey];
          const emailData = {
            investorName: `${allocation.user.firstName || ''} ${allocation.user.lastName || ''}`.trim() || 'Investor',
            fundName: call.structure?.name || 'Fund',
            remainingAmount: allocation.remainingAmount || allocation.allocatedAmount,
            currency,
            deadlineDate: formatDate(call.deadlineDate),
            portalUrl: `${portalUrl}/lp-portal/capital-calls`
          };

          await sendEmail(null, {
            to: [allocation.user.email],
            subject: template.subject(emailData.fundName),
            bodyHtml: template.getHtml(emailData),
            bodyText: template.getText(emailData)
          });

          console.log(`[CapitalCallReminders] Sent ${daysBeforeDeadline}-day reminder to user ${allocation.user.id}`);
        }

      } catch (err) {
        console.error(`[CapitalCallReminders] Error processing call ${call.id}:`, err);
      }
    }
  } catch (err) {
    console.error(`[CapitalCallReminders] Error in sendDeadlineReminders (${daysBeforeDeadline} days):`, err);
  }
}

/**
 * Main job function - runs all reminder checks
 */
async function runCapitalCallReminderJob() {
  console.log('\n========================================');
  console.log('[CapitalCallReminders] Starting daily job...');
  console.log(`[CapitalCallReminders] Current time: ${new Date().toISOString()}`);
  console.log('========================================\n');

  // 1. Send capital call notices (noticeDate = today)
  await sendCapitalCallNotices();

  // 2. Send 3-day reminders (deadlineDate = today + 3 days)
  await sendDeadlineReminders(3, 'reminder3Days');

  // 3. Send 1-day reminders (deadlineDate = today + 1 day)
  await sendDeadlineReminders(1, 'reminder1Day');

  // 4. Send due-today reminders (deadlineDate = today)
  await sendDeadlineReminders(0, 'reminderDueToday');

  console.log('\n========================================');
  console.log('[CapitalCallReminders] Daily job completed');
  console.log('========================================\n');
}

/**
 * Initialize the cron job
 * Runs daily at 8:00 AM server time
 */
function initCapitalCallRemindersCron() {
  // Schedule: At 8:00 AM every day
  // Cron format: minute hour day-of-month month day-of-week
  const schedule = '0 8 * * *';

  cron.schedule(schedule, async () => {
    await runCapitalCallReminderJob();
  });

  console.log('[CapitalCallReminders] Cron job initialized - runs daily at 8:00 AM');

  // Also export a manual trigger for testing
  return {
    runNow: runCapitalCallReminderJob
  };
}

module.exports = {
  initCapitalCallRemindersCron,
  runCapitalCallReminderJob
};
