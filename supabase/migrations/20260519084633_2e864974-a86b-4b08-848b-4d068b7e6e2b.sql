CREATE OR REPLACE FUNCTION public.grant_admin_for_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) IN ('wilkinson.marshall@gmail.com', 'marshall@marshallwilkinson.com') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM public.profiles
WHERE lower(email) IN ('wilkinson.marshall@gmail.com', 'marshall@marshallwilkinson.com')
ON CONFLICT DO NOTHING;