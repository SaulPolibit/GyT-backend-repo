-- Add user_id and structure_id columns to investors table
-- This migration adds foreign key relationships to users and structures tables

-- Step 1: Add user_id column (references users table)
ALTER TABLE investors
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Step 2: Add structure_id column (references structures table)
ALTER TABLE investors
ADD COLUMN IF NOT EXISTS structure_id UUID REFERENCES structures(id) ON DELETE SET NULL;

-- Step 3: Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_investors_user_id ON investors(user_id);
CREATE INDEX IF NOT EXISTS idx_investors_structure_id ON investors(structure_id);

-- Step 4: Add comments to document the columns
COMMENT ON COLUMN investors.user_id IS 'Foreign key to users table - associates investor with a user account';
COMMENT ON COLUMN investors.structure_id IS 'Foreign key to structures table - associates investor with a specific structure';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Added user_id and structure_id columns to investors table';
    RAISE NOTICE '📊 Created indexes: idx_investors_user_id, idx_investors_structure_id';
    RAISE NOTICE '🔗 Foreign keys: user_id → users(id), structure_id → structures(id)';
    RAISE NOTICE '⚠️  Both columns are optional (NULL allowed) and cascade on DELETE SET NULL';
END $$;
