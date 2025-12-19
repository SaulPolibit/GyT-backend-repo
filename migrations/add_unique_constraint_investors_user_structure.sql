-- Add unique constraint to investors table to prevent duplicate user-structure combinations
-- This ensures one investor record per user-structure combination

-- Step 1: Remove any duplicate rows before adding constraint (keep the most recent)
DELETE FROM investors a USING investors b
WHERE a.id < b.id
AND a.user_id = b.user_id
AND a.structure_id = b.structure_id
AND a.user_id IS NOT NULL
AND a.structure_id IS NOT NULL;

-- Step 2: Add unique constraint
ALTER TABLE investors
ADD CONSTRAINT unique_investor_user_structure
UNIQUE (user_id, structure_id);

-- Step 3: Create comment
COMMENT ON CONSTRAINT unique_investor_user_structure ON investors IS
'Ensures each user can have only one investor profile per structure';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Added unique constraint to investors table';
    RAISE NOTICE '🔒 Constraint: unique_investor_user_structure (user_id, structure_id)';
    RAISE NOTICE '📊 Each user can have only one investor profile per structure';
    RAISE NOTICE '🗑️  Removed any duplicate rows (kept most recent)';
END $$;
