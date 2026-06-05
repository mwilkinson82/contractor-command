UPDATE public.subscriptions
SET metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{account_aliases}',
  to_jsonb(ARRAY['brandofsacrificeshogun@gmail.com']),
  true
) || jsonb_build_object(
  'alias_added', jsonb_build_object(
    'at', now(),
    'email', 'brandofsacrificeshogun@gmail.com',
    'reason', 'Justin secondary Gmail — mobile login was locked out of Circle features'
  )
)
WHERE id = '73c25220-5e23-4cdb-91ff-89c5659ed8fb';