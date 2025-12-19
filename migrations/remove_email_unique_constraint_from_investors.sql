-- Remove unique constraint on email from investors table
-- Business rule allows same user (email) to have multiple investor profiles (one per structure)
-- The unique constraint on (user_id, structure_id) enforces the business rule

-- Step 1: Check if the email unique constraint exists and drop it
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'investors_email_key'
    ) THEN
        ALTER TABLE investors DROP CONSTRAINT investors_email_key;
        RAISE NOTICE '✅ Removed unique constraint on email field';
    ELSE
        RAISE NOTICE 'ℹ️  Email unique constraint does not exist or already removed';
    END IF;
END $$;

-- Step 2: Verify that the user_id/structure_id constraint exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_investor_user_structure'
    ) THEN
        -- Add the constraint if it doesn't exist
        ALTER TABLE investors
        ADD CONSTRAINT unique_investor_user_structure
        UNIQUE (user_id, structure_id);

        RAISE NOTICE '✅ Added unique constraint on (user_id, structure_id)';
    ELSE
        RAISE NOTICE '✅ Unique constraint on (user_id, structure_id) already exists';
    END IF;
END $$;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '================================================';
    RAISE NOTICE '✅ Migration completed successfully';
    RAISE NOTICE '📧 Email field: No longer unique (allows same user across structures)';
    RAISE NOTICE '🔒 Constraint: unique_investor_user_structure (user_id, structure_id)';
    RAISE NOTICE '📋 Business Rule: One investor profile per user-structure combination';
    RAISE NOTICE '================================================';
END $$;
