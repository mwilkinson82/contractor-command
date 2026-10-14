CREATE OR REPLACE FUNCTION public.mcp_log_surfaced(_refs jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; existed boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(_refs, '[]'::jsonb)) LOOP
    IF NOT coalesce(public.mcp_can_access_contract((r->>'job_id')::uuid), false) THEN CONTINUE; END IF;
    existed := EXISTS (SELECT 1 FROM public.mcp_surfaced WHERE user_id = auth.uid() AND ref = left(r->>'ref', 120));
    IF existed THEN
      UPDATE public.mcp_surfaced SET last_surfaced_at = now(), times = times + 1 WHERE user_id = auth.uid() AND ref = left(r->>'ref', 120);
    ELSE
      INSERT INTO public.mcp_surfaced (user_id, job_id, ref, item_id)
        VALUES (auth.uid(), (r->>'job_id')::uuid, left(r->>'ref', 120), nullif(r->>'item_id', '')::uuid);
      IF nullif(r->>'item_id', '') IS NOT NULL THEN
        INSERT INTO public.mcp_item_events (user_id, item_id, event) VALUES (auth.uid(), (r->>'item_id')::uuid, 'surfaced');
      END IF;
    END IF;
  END LOOP;
END $$;