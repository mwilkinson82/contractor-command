
-- Grant admin to existing user with that email (if any)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = 'wilkinson.marshall@gmail.com'
ON CONFLICT DO NOTHING;

-- Auto-grant admin on profile creation for that email (covers future signup)
CREATE OR REPLACE FUNCTION public.grant_admin_for_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) = 'wilkinson.marshall@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_admin_for_owner_trg ON public.profiles;
CREATE TRIGGER grant_admin_for_owner_trg
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.grant_admin_for_owner();
