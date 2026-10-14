CREATE TABLE public.mcp_call_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  called_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.mcp_call_log TO authenticated;
GRANT USAGE ON SEQUENCE public.mcp_call_log_id_seq TO authenticated;
GRANT ALL ON public.mcp_call_log TO service_role;
ALTER TABLE public.mcp_call_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own mcp calls read" ON public.mcp_call_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own mcp calls insert" ON public.mcp_call_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX mcp_call_log_user_time ON public.mcp_call_log (user_id, called_at DESC);

CREATE OR REPLACE FUNCTION public.mcp_rate_hit(_limit int DEFAULT 60)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT count(*) INTO n FROM public.mcp_call_log WHERE user_id = auth.uid() AND called_at > now() - interval '1 hour';
  IF n >= _limit THEN RETURN false; END IF;
  INSERT INTO public.mcp_call_log(user_id) VALUES (auth.uid());
  DELETE FROM public.mcp_call_log WHERE user_id = auth.uid() AND called_at < now() - interval '2 hours';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.mcp_rate_hit(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_rate_hit(int) TO authenticated;