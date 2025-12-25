-- Create w9-forms storage bucket in Supabase
-- This bucket stores W9 tax form documents for users/investors

-- Step 1: Insert the bucket into storage.buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'w9-forms',
  'w9-forms',
  false,  -- Private bucket for sensitive tax documents
  10485760,  -- 10MB file size limit
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Step 2: Create RLS policies for the bucket
-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Allow authenticated users to upload w9 forms" ON storage.objects;
DROP POLICY IF EXISTS "Allow users to read their own w9 forms" ON storage.objects;
DROP POLICY IF EXISTS "Allow users to update their own w9 forms" ON storage.objects;
DROP POLICY IF EXISTS "Allow users to delete their own w9 forms" ON storage.objects;

-- Allow authenticated users to upload w9 forms
CREATE POLICY "Allow authenticated users to upload w9 forms"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'w9-forms');

-- Allow users to read their own w9 forms
-- Users can only access files in their own folder (organized by user ID)
CREATE POLICY "Allow users to read their own w9 forms"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'w9-forms' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to update their own w9 forms
CREATE POLICY "Allow users to update their own w9 forms"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'w9-forms' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to delete their own w9 forms
CREATE POLICY "Allow users to delete their own w9 forms"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'w9-forms' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Created w9-forms storage bucket';
    RAISE NOTICE '🔒 Bucket is private with 10MB file size limit';
    RAISE NOTICE '🔐 RLS policies created - users can only access their own W9 forms';
    RAISE NOTICE '📄 Allowed MIME types: PDF, DOC, DOCX, JPEG, PNG, WebP';
END $$;
