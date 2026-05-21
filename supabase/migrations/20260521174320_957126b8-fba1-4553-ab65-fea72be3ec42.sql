
-- Re-rank tiers. Hardcore above Circle. PH and SM share rank 2.
CREATE OR REPLACE FUNCTION public.tier_rank(_tier app_tier)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _tier
    WHEN 'aos_only' THEN 0
    WHEN 'book_buyer' THEN 1
    WHEN 'power_hour' THEN 2
    WHEN 'sm_school' THEN 2
    WHEN 'intensive' THEN 3
    WHEN 'circle' THEN 4
    WHEN 'hardcore' THEN 5
  END;
$$;

-- Replay category enum
DO $$ BEGIN
  CREATE TYPE public.replay_category AS ENUM ('circle_call', 'power_hour', 'sm_school', 'contractor_school');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.replays
  ADD COLUMN IF NOT EXISTS category public.replay_category NOT NULL DEFAULT 'circle_call';

-- Helper: which tiers can read which categories
CREATE OR REPLACE FUNCTION public.can_read_replay_category(_user_id uuid, _category public.replay_category)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE _category
    -- Circle calls: Book Buyer and up (existing decision)
    WHEN 'circle_call' THEN public.has_tier_at_least(_user_id, 'book_buyer')
    -- Power Hour: Power Hour, Intensive, Circle, Hardcore
    WHEN 'power_hour' THEN
      public.get_user_tier(_user_id) IN ('power_hour','intensive','circle','hardcore')
    -- S&M School: S&M School, Intensive, Circle, Hardcore
    WHEN 'sm_school' THEN
      public.get_user_tier(_user_id) IN ('sm_school','intensive','circle','hardcore')
    -- Contractor School: Hardcore only
    WHEN 'contractor_school' THEN public.get_user_tier(_user_id) = 'hardcore'
    ELSE false
  END;
$$;

-- Replace replays RLS with per-category access
DROP POLICY IF EXISTS "book buyers and up read replays" ON public.replays;
DROP POLICY IF EXISTS "circle members read replays" ON public.replays;

CREATE POLICY "tiered read replays"
ON public.replays
FOR SELECT
USING (published AND public.can_read_replay_category(auth.uid(), category));
