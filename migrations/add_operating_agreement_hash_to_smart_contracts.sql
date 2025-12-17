-- Add operating agreement hash field to smart_contracts table
-- This migration adds a field to store the hash of the operating agreement document

-- Add operating agreement hash field
ALTER TABLE smart_contracts
ADD COLUMN IF NOT EXISTS operating_agreement_hash VARCHAR(255);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_smart_contracts_operating_agreement_hash ON smart_contracts(operating_agreement_hash);

-- Add comment to document the schema
COMMENT ON COLUMN smart_contracts.operating_agreement_hash IS 'Hash of the operating agreement document associated with the smart contract';
