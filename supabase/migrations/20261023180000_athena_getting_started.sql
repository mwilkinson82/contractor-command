-- First-chat getting started. Additive only. NOT APPLIED.
-- One row per user, written the first time Athena shows the start card.
-- Members can read their own row. Writes go through mcp_getting_started_claim.

CREATE TABLE IF NOT EXISTS public.mcp_getting_started (
  user_id uuid PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_getting_started ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "getting started read own" ON public.mcp_getting_started;
CREATE POLICY "getting started read own" ON public.mcp_getting_started
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.mcp_getting_started FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_getting_started TO authenticated;
GRANT ALL ON public.mcp_getting_started TO service_role;

-- Insert the caller's row once. show is true only on that first insert.
CREATE OR REPLACE FUNCTION public.mcp_getting_started_claim() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('show', false);
  END IF;
  INSERT INTO public.mcp_getting_started (user_id)
  VALUES (auth.uid())
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('show', n > 0);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_getting_started_claim() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_getting_started_claim() TO authenticated;
