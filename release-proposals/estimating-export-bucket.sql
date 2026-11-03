-- Lovable-managed proposal: create or validate this one private bucket only.
DO $bucket$
DECLARE
  b storage.buckets%ROWTYPE;
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'athena-estimate-exports', 'athena-estimate-exports', false, 10485760,
    ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
  ) ON CONFLICT (id) DO NOTHING;

  SELECT * INTO STRICT b FROM storage.buckets
  WHERE id = 'athena-estimate-exports' FOR UPDATE;
  IF b.name IS DISTINCT FROM 'athena-estimate-exports'
     OR b.public IS DISTINCT FROM false
     OR b.file_size_limit IS DISTINCT FROM 10485760
     OR b.allowed_mime_types IS DISTINCT FROM ARRAY[
       'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
     ]::text[] THEN
    RAISE EXCEPTION 'Existing athena-estimate-exports bucket differs from the approved configuration';
  END IF;
END
$bucket$;
