-- 0020: open items follow the job PM.
-- When a PM is set (member or contact), open items still reading "Unassigned (no PM set)", or naming
-- the PM with another label such as "Sam Ortiz (non-member PM)", are re-pointed to "<name> (PM)".
-- New items naming the PM with any other label are normalised the same way (accountable, owner, reported_by).

-- A PM name typed with notes ("Sam Ortiz (sam.ortiz@example.com) — non-member PM") keeps only the name;
-- an email inside it becomes the PM email when none was given.
CREATE OR REPLACE FUNCTION public.mcp_pm_email_in(_s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT lower(substring(_s from '([^\s<>()@,;]+@[^\s<>()@,;]+\.[^\s<>()@,;]+)')) $$;
CREATE OR REPLACE FUNCTION public.mcp_clean_pm_name(_s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(_s, ''),
    '[<(]?[^\s<>()@,;]+@[^\s<>()@,;]+\.[^\s<>()@,;]+[>)]?', '', 'g'),   -- email
    '\s*[-–—,;:]\s*(?:non[- ]?member|not an? (?:athena )?(?:member|user)|contact|external)\M.*$', '', 'i'),  -- "— non-member PM"
    '\s*\((?:[^()]*\m(?:pm|project manager|non[- ]?member|member|contact)\M[^()]*|\s*)\)', '', 'gi'),  -- "(non-member PM)", "(PM)", "()"
    '\s{2,}', ' ', 'g')), '')
$$;

CREATE OR REPLACE FUNCTION public.mcp_pm_label(_job uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    (SELECT m.display_name FROM public.mcp_company_members m WHERE m.company_id = j.company_id AND m.user_id = j.pm_user_id),
    nullif(btrim(j.pm_name), '')) || ' (PM)'
  FROM public.mcp_jobs j WHERE j.id = _job
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_pm_label(uuid) FROM anon, public, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_is_pm_ref(_label text, _pm text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT _pm IS NOT NULL AND _label IS NOT NULL AND (
    _label = 'Unassigned (no PM set)'
    OR lower(public.mcp_clean_pm_name(_label)) = lower(public.mcp_clean_pm_name(_pm)))
$$;

CREATE OR REPLACE FUNCTION public.mcp_repoint_pm_items(_job uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE lbl text := public.mcp_pm_label(_job); n integer := 0;
BEGIN
  IF lbl IS NULL THEN RETURN 0; END IF;
  UPDATE public.mcp_open_items SET
      accountable = CASE WHEN public.mcp_is_pm_ref(accountable, lbl) THEN lbl ELSE accountable END,
      owner = CASE WHEN public.mcp_is_pm_ref(owner, lbl) THEN lbl ELSE owner END,
      reported_by = CASE WHEN public.mcp_is_pm_ref(reported_by, lbl) THEN lbl ELSE reported_by END,
      updated_at = now()
    WHERE job_id = _job AND status = 'open'
      AND ((public.mcp_is_pm_ref(accountable, lbl) AND accountable IS DISTINCT FROM lbl)
        OR (public.mcp_is_pm_ref(owner, lbl) AND owner IS DISTINCT FROM lbl)
        OR (public.mcp_is_pm_ref(reported_by, lbl) AND reported_by IS DISTINCT FROM lbl));
  GET DIAGNOSTICS n = ROW_COUNT;
  -- Audited when a member sets the PM; the one-off backfill runs without a user.
  IF n > 0 AND auth.uid() IS NOT NULL THEN PERFORM public.mcp_audit_job(_job, 'intake', 'items_repointed_to_pm', n::text); END IF;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_repoint_pm_items(uuid) FROM anon, public, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_open_items_pm_label() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE lbl text := public.mcp_pm_label(NEW.job_id);
BEGIN
  IF lbl IS NOT NULL THEN
    IF public.mcp_is_pm_ref(NEW.accountable, lbl) THEN NEW.accountable := lbl; END IF;
    IF public.mcp_is_pm_ref(NEW.owner, lbl) THEN NEW.owner := lbl; END IF;
    IF public.mcp_is_pm_ref(NEW.reported_by, lbl) THEN NEW.reported_by := lbl; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mcp_open_items_pm_label ON public.mcp_open_items;
CREATE TRIGGER mcp_open_items_pm_label BEFORE INSERT ON public.mcp_open_items
  FOR EACH ROW EXECUTE FUNCTION public.mcp_open_items_pm_label();

CREATE OR REPLACE FUNCTION public.mcp_job_settings(_job uuid, _time_zone text, _pm_name text, _pm_email text DEFAULT NULL, _pm_title text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; r text; uid uuid; nm text := public.mcp_clean_pm_name(_pm_name); em text := coalesce(nullif(lower(btrim(_pm_email)), ''), public.mcp_pm_email_in(_pm_name)); ti text := nullif(btrim(_pm_title), ''); mname text;
BEGIN
  IF public.mcp_assert_job_scope(_job) <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:Your role can''t change job settings.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF nullif(btrim(_time_zone), '') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = btrim(_time_zone)) THEN
      RAISE EXCEPTION 'MCP_BAD:Unknown time zone. Use an IANA name such as America/Chicago.';
    END IF;
    UPDATE public.mcp_jobs SET time_zone = btrim(_time_zone), updated_at = now() WHERE id = _job;
    UPDATE public.mcp_open_items SET status = 'resolved', resolution = 'verified', verify_state = 'verified', verified_at = now(),
      verified_evidence = 'Time zone set to ' || btrim(_time_zone), resolved_at = now()
      WHERE job_id = _job AND check_key = 'tz:job' AND status = 'open';
    PERFORM public.mcp_audit_job(_job, 'intake', 'job_time_zone_set', NULL);
  END IF;
  IF em IS NOT NULL AND em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'MCP_BAD:That PM email doesn''t look valid.'; END IF;
  IF nm IS NOT NULL OR em IS NOT NULL OR ti IS NOT NULL THEN
    SELECT role INTO r FROM public.mcp_company_members WHERE company_id = j.company_id AND user_id = auth.uid();
    IF coalesce(r, '') NOT IN ('owner','all_access','finance') AND j.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'MCP_BAD:Only an Owner, Finance, All-access member or the job creator can assign the PM.';
    END IF;
  END IF;
  IF nm IS NOT NULL THEN
    SELECT m.user_id, m.display_name INTO uid, mname FROM public.mcp_company_members m
      WHERE m.company_id = j.company_id AND lower(m.display_name) = lower(nm) LIMIT 1;
    IF uid IS NULL AND em IS NOT NULL THEN
      SELECT m.user_id, m.display_name INTO uid, mname FROM public.mcp_company_members m JOIN auth.users u ON u.id = m.user_id
        WHERE m.company_id = j.company_id AND lower(u.email) = em LIMIT 1;
    END IF;
    IF uid IS NOT NULL THEN
      -- Member PM: the contact name follows the member; email defaults to their sign-in email.
      UPDATE public.mcp_jobs SET pm_user_id = uid, pm_name = mname,
        pm_email = coalesce(em, (SELECT lower(email) FROM auth.users WHERE id = uid)), pm_title = coalesce(ti, pm_title, 'Project Manager'), updated_at = now() WHERE id = _job;
      PERFORM public.mcp_audit_job(_job, 'intake', 'job_pm_set', uid::text);
    ELSE
      -- Contact PM: name + email only. Grants nothing (no member row, no job access).
      UPDATE public.mcp_jobs SET pm_user_id = NULL, pm_name = nm, pm_email = em, pm_title = coalesce(ti, 'Project Manager'), updated_at = now() WHERE id = _job;
      PERFORM public.mcp_audit_job(_job, 'intake', 'job_pm_contact_set', NULL);
    END IF;
  ELSIF em IS NOT NULL OR ti IS NOT NULL THEN
    UPDATE public.mcp_jobs SET pm_email = coalesce(em, pm_email), pm_title = coalesce(ti, pm_title), updated_at = now() WHERE id = _job;
    PERFORM public.mcp_audit_job(_job, 'intake', 'job_pm_contact_set', NULL);
  END IF;
  PERFORM public.mcp_repoint_pm_items(_job);
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  RETURN jsonb_build_object('time_zone', j.time_zone,
    'pm', coalesce((SELECT display_name FROM public.mcp_company_members WHERE company_id = j.company_id AND user_id = j.pm_user_id), j.pm_name),
    'pm_email', j.pm_email, 'pm_title', j.pm_title, 'pm_is_member', j.pm_user_id IS NOT NULL);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_job_settings(uuid, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_job_settings(uuid, text, text, text, text) TO authenticated;

-- Clean PM names saved with notes, then re-point items on every job that has a PM.
UPDATE public.mcp_jobs SET pm_email = coalesce(pm_email, public.mcp_pm_email_in(pm_name)), pm_name = coalesce(public.mcp_clean_pm_name(pm_name), pm_name), updated_at = now()
  WHERE pm_user_id IS NULL AND pm_name IS NOT NULL AND public.mcp_clean_pm_name(pm_name) IS DISTINCT FROM btrim(pm_name);
SELECT public.mcp_repoint_pm_items(j.id) FROM public.mcp_jobs j
  WHERE j.pm_user_id IS NOT NULL OR nullif(btrim(j.pm_name), '') IS NOT NULL;
