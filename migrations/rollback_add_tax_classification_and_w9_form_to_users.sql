/**
 * Rollback Migration: Remove tax classification and W9 form fields from users table
 * Description: Removes tax_classification and w9_form fields added in add_tax_classification_and_w9_form_to_users.sql
 * Date: 2025-12-25
 */

-- Drop indexes
DROP INDEX IF EXISTS idx_users_tax_classification;
DROP INDEX IF EXISTS idx_users_w9_form;

-- Remove w9_form field
ALTER TABLE users
DROP COLUMN IF EXISTS w9_form;

-- Remove tax_classification field
ALTER TABLE users
DROP COLUMN IF EXISTS tax_classification;
