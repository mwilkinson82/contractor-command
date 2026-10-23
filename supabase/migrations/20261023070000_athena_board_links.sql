-- Board links for a browser that has no Athena session. Same pattern as report shares:
-- only the SHA-256 of the token is stored, it expires, it can be turned off, and each open is logged.
-- One row is one job. It cannot open another job. Not an owner share.

CREATE TABLE IF NOT EXISTS public.mcp_board_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('full', 'super')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_board_links_job_idx ON public.mcp_board_links (company_id, job_id);
ALTER TABLE public.mcp_board_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_board_links FROM anon, authenticated, public;
GRANT ALL ON public.mcp_board_links TO service_role;

CREATE TABLE IF NOT EXISTS public.mcp_board_link_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.mcp_board_links(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  page text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_board_link_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_board_link_opens FROM anon, authenticated, public;
GRANT ALL ON public.mcp_board_link_opens TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_board_link_create(_job uuid, _token_hash text, _expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; co uuid; nid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:Bad link.'; END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:Your role can''t open this job''s board.'; END IF;
  IF _expires_at <= now() + interval '1 hour' OR _expires_at > now() + interval '48 hours' THEN RAISE EXCEPTION 'MCP_BAD:A board link lasts about 24 hours.'; END IF;
  SELECT company_id INTO co FROM public.mcp_jobs WHERE id = _job;
  INSERT INTO public.mcp_board_links (company_id, job_id, scope, token_hash, expires_at)
  VALUES (co, _job, sc, _token_hash, _expires_at) RETURNING id INTO nid;
  RETURN jsonb_build_object('id', nid, 'scope', sc, 'expires_at', _expires_at);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_board_link_create(uuid, text, timestamptz) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_board_link_create(uuid, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_board_link_revoke(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_board_links;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.mcp_board_links WHERE token_hash = _token_hash;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  IF r.created_by <> auth.uid() AND NOT public.mcp_is_company_leader(r.company_id) THEN RETURN NULL; END IF;
  UPDATE public.mcp_board_links SET revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid()) WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id, 'job_id', r.job_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_board_link_revoke(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_board_link_revoke(text) TO authenticated;

-- Hash in, one job's page out. Expired, revoked, unknown, or the wrong job returns a status and no payload.
CREATE OR REPLACE FUNCTION public.mcp_board_link_open(_token_hash text, _job uuid, _page text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_board_links; payload jsonb;
BEGIN
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF _page NOT IN ('field', 'items', 'daily', 'photos', 'ior', 'payapp') THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  SELECT * INTO r FROM public.mcp_board_links WHERE token_hash = _token_hash;
  IF r.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF r.job_id <> _job THEN RETURN jsonb_build_object('status', 'wrong_job'); END IF;
  IF r.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  IF (_page IN ('ior', 'payapp') AND r.scope <> 'full') OR r.scope NOT IN ('full', 'super') THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  -- auth.uid() reads request.jwt.claims on this project, and some hosts also read claim.sub. Set both for this transaction only.
  PERFORM set_config('request.jwt.claim.sub', r.created_by::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', r.created_by::text, 'role', 'authenticated')::text, true);
  BEGIN
    payload := public.mcp_report_page_get(_page, _job, NULL);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'denied');
  END;
  INSERT INTO public.mcp_board_link_opens (link_id, job_id, page) VALUES (r.id, r.job_id, _page);
  UPDATE public.mcp_board_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('status', 'ok', 'payload', payload);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_board_link_open(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.mcp_board_link_open(text, uuid, text) TO anon, authenticated;
