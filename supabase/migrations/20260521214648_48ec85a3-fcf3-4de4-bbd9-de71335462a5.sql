
CREATE OR REPLACE FUNCTION public.tier_rank(_tier app_tier)
 RETURNS integer LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE _tier
    WHEN 'aos_only' THEN 0
    WHEN 'book_buyer' THEN 1
    WHEN 'power_hour' THEN 2
    WHEN 'sm_school' THEN 2
    WHEN 'contractor_school' THEN 2
    WHEN 'intensive' THEN 3
    WHEN 'circle' THEN 4
    WHEN 'hardcore' THEN 5
  END;
$function$;

CREATE OR REPLACE FUNCTION public.can_read_replay_category(_user_id uuid, _category replay_category)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE _category
    WHEN 'circle_call' THEN public.has_tier_at_least(_user_id, 'book_buyer')
    WHEN 'power_hour' THEN
      public.get_user_tier(_user_id) IN ('power_hour','intensive','circle','hardcore')
    WHEN 'sm_school' THEN
      public.get_user_tier(_user_id) IN ('sm_school','intensive','circle','hardcore')
    WHEN 'contractor_school' THEN
      public.get_user_tier(_user_id) IN ('contractor_school','hardcore')
    ELSE false
  END;
$function$;
