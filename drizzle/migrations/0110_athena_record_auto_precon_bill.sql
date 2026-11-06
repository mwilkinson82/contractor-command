
-- Apply through Lovable Cloud only. Plain SQL for Lovable to apply; nothing in this repo applies it.

-- The project record credits Athena, not the contractor, for the pre-con invoice Athena issues by itself when the

-- owner signs on the client page (payment 1 due at signing). That bill runs inside the owner's signing, as the

-- member who invited them, so its record entry was stored with that member's id and showed as theirs

-- ("Marshall, Owner").

--   * From now on the signing marks its own bill, and that bill's record entry is stored as Athena's.

--   * Entries already stored: the feed reads a pre-con invoice entry as Athena's when it was written in the same

--     transaction as a client-page signature on the same job (same occurred_at). A bill the contractor sends

--     later is its own transaction, so it stays theirs. The record itself is append-only and is not changed.

-- Additive: one private helper and three in-place changes. No data changes. Needs 20261106170000 applied first.

SET LOCAL lock_timeout = '5s';

SET LOCAL statement_timeout = '60s';



-- True when a record entry is the pre-con bill Athena issued as part of the owner's signature.

CREATE OR REPLACE FUNCTION mcp_private.record_auto_bill(_job uuid, _kind text, _at timestamptz) RETURNS boolean

LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$

  SELECT coalesce(_kind, '') = 'precon_invoice_share' AND EXISTS (

    SELECT 1 FROM public.mcp_project_record_events s

     WHERE s.job_id = _job AND s.kind = 'precon_signed' AND s.occurred_at = _at)

$$;

REVOKE ALL ON FUNCTION mcp_private.record_auto_bill(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;



-- 1. The bill's record entry is Athena's while the signing is billing it.

DO $patch$

DECLARE routine regprocedure := 'mcp_private.precon_bill_next(public.mcp_precon_agreements,public.mcp_jobs,date)'::regprocedure; definition text; revised text;

BEGIN

  definition := pg_get_functiondef(routine);

  IF position('mcp.precon_auto_bill' IN definition) > 0 THEN RETURN; END IF;

  revised := replace(definition,

    $old$'payment', idx), 'user', NULL, NULL);$old$,

    $new$'payment', idx), CASE WHEN current_setting('mcp.precon_auto_bill', true) = 'on' THEN 'athena' ELSE 'user' END, NULL, NULL);$new$);

  IF revised = definition THEN RAISE EXCEPTION 'Pre-con billing format changed; review this migration before applying.'; END IF;

  EXECUTE revised;

END $patch$;



-- 2. The owner's signature marks the bill it issues, for that call only.

DO $patch$

DECLARE routine regprocedure := 'public.mcp_portal_precon_sign(uuid,text,uuid,text,text,text,text,text,text,text,text,text)'::regprocedure; definition text; revised text;

BEGIN

  definition := pg_get_functiondef(routine);

  IF position('mcp.precon_auto_bill' IN definition) > 0 THEN RETURN; END IF;

  revised := replace(definition,

    $old$bill := mcp_private.precon_bill_next(ag, j, NULL);$old$,

    $new$PERFORM set_config('mcp.precon_auto_bill', 'on', true); bill := mcp_private.precon_bill_next(ag, j, NULL); PERFORM set_config('mcp.precon_auto_bill', 'off', true);$new$);

  IF revised = definition THEN RAISE EXCEPTION 'Pre-con signing format changed; review this migration before applying.'; END IF;

  EXECUTE revised;

END $patch$;



-- 3. The feed reads bills already stored that way as Athena's.

DO $patch$

DECLARE routine regprocedure := 'public.mcp_project_record_feed(uuid,date,date)'::regprocedure; definition text; revised text;

BEGIN

  definition := pg_get_functiondef(routine);

  IF position('mcp_private.record_auto_bill' IN definition) > 0 THEN RETURN; END IF;

  IF position('mcp_private.record_by_client' IN definition) = 0 THEN

    RAISE EXCEPTION 'Apply 20261106170000_athena_record_client_actor first.';

  END IF;

  revised := replace(definition,

    $old$SELECT x.id, x.job_id, x.occurred_at, x.actor, x.kind,$old$,

    $new$SELECT x.id, x.job_id, x.occurred_at, CASE WHEN mcp_private.record_auto_bill(x.job_id, x.kind, x.occurred_at) THEN 'athena' ELSE x.actor END AS actor, x.kind,$new$);

  IF revised = definition THEN RAISE EXCEPTION 'Project record feed format changed; review this migration before applying.'; END IF;

  EXECUTE revised;

END $patch$;
