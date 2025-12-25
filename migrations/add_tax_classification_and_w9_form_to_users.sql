/**
 * Migration: Add tax classification and W9 form fields to users table
 * Description: Adds tax_classification and w9_form fields for tax documentation and compliance
 * Date: 2025-12-25
 */

-- Add tax_classification field
ALTER TABLE users
ADD COLUMN IF NOT EXISTS tax_classification TEXT;

COMMENT ON COLUMN users.tax_classification IS 'Tax classification for the user/investor (e.g., Individual, Corporation, Partnership, Trust, etc.)';

-- Add w9_form field
ALTER TABLE users
ADD COLUMN IF NOT EXISTS w9_form TEXT;

COMMENT ON COLUMN users.w9_form IS 'Supabase Storage public URL for the uploaded W9 tax form document';

-- Create index for users with W9 forms (useful for compliance reporting)
CREATE INDEX IF NOT EXISTS idx_users_w9_form
ON users(w9_form) WHERE w9_form IS NOT NULL;

-- Create index for users by tax classification
CREATE INDEX IF NOT EXISTS idx_users_tax_classification
ON users(tax_classification) WHERE tax_classification IS NOT NULL;
