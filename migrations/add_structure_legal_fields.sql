-- Migration: Add Legal and Partnership Fields to Structures Table
-- This migration adds comprehensive legal, partnership, and reporting fields for structures

-- ============================================================================
-- Add Management and Control Fields
-- ============================================================================

-- Add management_control column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS management_control TEXT;

-- ============================================================================
-- Add Capital and Allocation Fields
-- ============================================================================

-- Add capital_contributions column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS capital_contributions TEXT;

-- Add allocations_distributions column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS allocations_distributions TEXT;

-- ============================================================================
-- Add Limited Partner Fields
-- ============================================================================

-- Add limited_partner_obligations column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS limited_partner_obligations TEXT;

-- Add limited_partner_rights column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS limited_partner_rights TEXT;

-- ============================================================================
-- Add Withdrawal and Lock-up Fields
-- ============================================================================

-- Add lock_up_period column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS lock_up_period TEXT;

-- Add withdrawal_conditions column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS withdrawal_conditions TEXT;

-- Add withdrawal_process column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS withdrawal_process TEXT;

-- ============================================================================
-- Add Transfer Restrictions Fields
-- ============================================================================

-- Add general_prohibition column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS general_prohibition TEXT;

-- Add permitted_transfers column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS permitted_transfers TEXT;

-- Add transfer_requirements column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS transfer_requirements TEXT;

-- ============================================================================
-- Add Reporting and Communication Fields
-- ============================================================================

-- Add quarterly_reports column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS quarterly_reports TEXT;

-- Add annual_reports column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS annual_reports TEXT;

-- Add tax_forms column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS tax_forms TEXT;

-- Add capital_call_distributions_notices column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS capital_call_distributions_notices TEXT;

-- Add additional_communications column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS additional_communications TEXT;

-- ============================================================================
-- Add Liability and Indemnification Fields
-- ============================================================================

-- Add limited_liability column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS limited_liability TEXT;

-- Add exceptions_liability column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS exceptions_liability TEXT;

-- Add maximum_exposure column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS maximum_exposure TEXT;

-- Add indemnifies_partnership column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS indemnifies_partnership TEXT;

-- Add lp_indemnifies_partnership column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS lp_indemnifies_partnership TEXT;

-- Add indemnifies_procedures column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS indemnifies_procedures TEXT;

-- ============================================================================
-- Add Governance and Legal Fields
-- ============================================================================

-- Add amendments column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS amendments TEXT;

-- Add dissolution column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS dissolution TEXT;

-- Add disputes_resolution column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS disputes_resolution TEXT;

-- Add governing_law column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS governing_law TEXT;

-- Add additional_provisions column if missing
ALTER TABLE structures
ADD COLUMN IF NOT EXISTS additional_provisions TEXT;

-- ============================================================================
-- Verification
-- ============================================================================

-- Verify all columns were added
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'structures'
AND column_name IN (
    'management_control',
    'capital_contributions',
    'allocations_distributions',
    'limited_partner_obligations',
    'limited_partner_rights',
    'lock_up_period',
    'withdrawal_conditions',
    'withdrawal_process',
    'general_prohibition',
    'permitted_transfers',
    'transfer_requirements',
    'quarterly_reports',
    'annual_reports',
    'tax_forms',
    'capital_call_distributions_notices',
    'additional_communications',
    'limited_liability',
    'exceptions_liability',
    'maximum_exposure',
    'indemnifies_partnership',
    'lp_indemnifies_partnership',
    'indemnifies_procedures',
    'amendments',
    'dissolution',
    'disputes_resolution',
    'governing_law',
    'additional_provisions'
)
ORDER BY column_name;
