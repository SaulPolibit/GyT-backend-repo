-- Migration: Rename transaction_hash to payment_transaction_hash and add token_transaction_hash
-- Date: 2025-12-23

-- Step 1: Rename transaction_hash column to payment_transaction_hash
ALTER TABLE payments
RENAME COLUMN transaction_hash TO payment_transaction_hash;

-- Step 2: Add token_transaction_hash column
ALTER TABLE payments
ADD COLUMN token_transaction_hash TEXT;

-- Step 3: Add comment to describe the columns
COMMENT ON COLUMN payments.payment_transaction_hash IS 'Transaction hash for payment transaction';
COMMENT ON COLUMN payments.token_transaction_hash IS 'Transaction hash for token transaction';
