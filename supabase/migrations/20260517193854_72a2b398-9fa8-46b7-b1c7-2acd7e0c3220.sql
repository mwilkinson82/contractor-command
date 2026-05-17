drop policy if exists "authenticated can list company logos" on storage.objects;

create policy "owner can list own company logo"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'company-logos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );