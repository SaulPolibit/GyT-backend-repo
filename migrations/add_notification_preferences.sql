-- Migration: Add notification preferences fields
-- This migration adds notification frequency, contact method, and report delivery format fields

-- ============================================================================
-- Add new columns to notification_settings table
-- ============================================================================

-- Add notification_frequency column
-- Options: 'immediate', 'daily', 'weekly', 'monthly'
ALTER TABLE notification_settings
ADD COLUMN IF NOT EXISTS notification_frequency VARCHAR(20) DEFAULT 'immediate';

-- Add preferred_contact_method column
-- Options: 'email', 'sms', 'push', 'phone'
ALTER TABLE notification_settings
ADD COLUMN IF NOT EXISTS preferred_contact_method VARCHAR(20) DEFAULT 'email';

-- Add report_delivery_format column
-- Options: 'pdf', 'excel', 'both'
ALTER TABLE notification_settings
ADD COLUMN IF NOT EXISTS report_delivery_format VARCHAR(20) DEFAULT 'both';

-- ============================================================================
-- Add comments to document the new columns
-- ============================================================================

COMMENT ON COLUMN notification_settings.notification_frequency IS
'How often the user wants to receive notifications: immediate, daily, weekly, monthly';

COMMENT ON COLUMN notification_settings.preferred_contact_method IS
'User preferred method of contact: email, sms, push, phone';

COMMENT ON COLUMN notification_settings.report_delivery_format IS
'Preferred format for report delivery: pdf, excel, both';

-- ============================================================================
-- Verification Query (optional - uncomment to verify changes)
-- ============================================================================

-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'notification_settings'
--   AND column_name IN ('notification_frequency', 'preferred_contact_method', 'report_delivery_format');
