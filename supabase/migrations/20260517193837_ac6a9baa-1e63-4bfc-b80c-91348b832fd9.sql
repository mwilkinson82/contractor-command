-- Drop the broad SELECT policy that allowed anonymous listing of every file
-- in the bucket. Because the bucket is public, individual file URLs are still
-- served publicly via Supabase Storage's CDN — only the LIST operation is
-- restricted.
drop policy if exists "company logos are publicly readable" on storage.objects;

-- Authenticated users can list (e.g. to fetch their own current logo path).
create policy "authenticated can list company logos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'company-logos');