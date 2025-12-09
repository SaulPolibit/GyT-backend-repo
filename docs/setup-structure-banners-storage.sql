-- Setup Storage for Structure Banner Images
-- Description: Creates storage bucket and policies for structure banners
-- Run this in Supabase SQL Editor (Storage section)

-- Step 1: Create storage bucket for structure banners
-- This bucket will store banner images for structures
INSERT INTO storage.buckets (id, name, public)
VALUES ('structure-banners', 'structure-banners', true)
ON CONFLICT (id) DO NOTHING;

-- Step 2: Set storage policies

-- Policy 1: Allow authenticated users to upload banner images
CREATE POLICY "Allow authenticated uploads for structure banners"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'structure-banners');

-- Policy 2: Allow public read access to banner images
CREATE POLICY "Allow public read access to structure banners"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'structure-banners');

-- Policy 3: Allow authenticated users to update their own banner images
CREATE POLICY "Allow authenticated updates for structure banners"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'structure-banners')
WITH CHECK (bucket_id = 'structure-banners');

-- Policy 4: Allow authenticated users to delete their own banner images
CREATE POLICY "Allow authenticated deletes for structure banners"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'structure-banners');

-- Verify the bucket was created
SELECT
  id,
  name,
  public,
  created_at
FROM storage.buckets
WHERE id = 'structure-banners';

-- Verify the policies were created
SELECT
  policyname as policy_name,
  permissive,
  roles,
  cmd as command,
  qual as using_expression,
  with_check as check_expression
FROM pg_policies
WHERE tablename = 'objects'
  AND schemaname = 'storage'
  AND policyname LIKE '%structure banner%';
