-- Add status column to docuseal_submissions table
-- Migration: add_status_to_docuseal_submissions
-- Date: 2025-11-29

-- Add status column (nullable initially to avoid issues with existing data)
ALTER TABLE docuseal_submissions
ADD COLUMN IF NOT EXISTS status VARCHAR(50);

-- Set default value for existing rows
UPDATE docuseal_submissions
SET status = 'completed'
WHERE status IS NULL;

-- Optional: Add a check constraint for valid status values
-- ALTER TABLE docuseal_submissions
-- ADD CONSTRAINT docuseal_submissions_status_check
-- CHECK (status IN ('created', 'pending', 'completed', 'declined', 'expired'));

-- Optional: Create an index on status for better query performance
CREATE INDEX IF NOT EXISTS idx_docuseal_submissions_status ON docuseal_submissions(status);

-- Add comment to the column
COMMENT ON COLUMN docuseal_submissions.status IS 'Current status of the DocuSeal submission (created, pending, completed, declined, expired)';
