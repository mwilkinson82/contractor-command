-- Apply through Lovable Cloud only. Plain SQL for Lovable to apply; nothing in this repo applies it.

-- The project record names the client, not the contractor, for what the client did on their client page.

-- Client-page actions run as the member who invited the client, so their record entries were stored with that

-- member's id and the project record showed them as the contractor's own ("Marshall, Owner"), under "Your team".

-- The record itself is append-only and is not changed. The feed now reads an entry as the client's when it is a

-- client-page decision (it carries portal_decision, or it is a customer approve or decline, a pre-construction

-- signature or decline, or an owner paying by check), and names the client who acted.

-- Additive: two private helpers and one in-place change to the feed's record query. No data changes.

SET LOCAL lock_timeout = '5s';

SET LOCAL statement_timeout = '60s';



-- True when a project record entry is something the client did on their client page.

CREATE OR REPLACE FUNCTION mcp_private.record_by_client(_actor text, _kind text, _payload jsonb) RETURNS boolean

LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$

  SELECT coalesce(_actor, '') <> 'athena' AND (

    coalesce(_payload, '{}'::jsonb) ? 'portal_decision'

    OR _kind IN ('precon_signed', 'precon_declined', 'precon_check_request')

    OR coalesce(_kind, '') ~ '_customer_(approve|approved|decline|declined|reject|rejected)$')

$$;

REVOKE ALL ON FUNCTION mcp_private.record_by_client(text, text, jsonb) FROM PUBLIC, anon, authenticated;



-- The client's name on the client page for a decision, when the entry itself names no one.

CREATE OR REPLACE FUNCTION mcp_private.record_client_name(_payload jsonb) RETURNS text

LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$

  SELECT nullif(btrim(pa.name), '')

    FROM public.mcp_portal_decisions pd JOIN public.mcp_portal_access pa ON pa.id = pd.access_id

   WHERE coalesce(_payload ->> 'portal_decision', '') ~ '^[0-9a-fA-F-]{36}$'

     AND pd.id = (_payload ->> 'portal_decision')::uuid

   LIMIT 1

$$;

REVOKE ALL ON FUNCTION mcp_private.record_client_name(jsonb) FROM PUBLIC, anon, authenticated;



-- The feed reads the record through a view of it where a client-page entry has no member id and names the client.

-- Patched in place so every other source and rule in the feed stays as it is.

DO $patch$

DECLARE routine regprocedure := 'public.mcp_project_record_feed(uuid,date,date)'::regprocedure; definition text; revised text;

BEGIN

  definition := pg_get_functiondef(routine);

  IF position('mcp_private.record_by_client' IN definition) > 0 THEN RETURN; END IF;

  revised := replace(definition,

    $old$FROM public.mcp_project_record_events e$old$,

    $new$FROM (SELECT x.id, x.job_id, x.occurred_at, x.actor, x.kind, x.title, x.summary, x.ref_table, x.ref_id, CASE WHEN mcp_private.record_by_client(x.actor, x.kind, x.payload) THEN NULL ELSE x.actor_id END AS actor_id, CASE WHEN mcp_private.record_by_client(x.actor, x.kind, x.payload) THEN coalesce(nullif(btrim(x.counterparty_name), ''), mcp_private.record_client_name(x.payload), 'Client') ELSE x.counterparty_name END AS counterparty_name FROM public.mcp_project_record_events x) e$new$);

  IF revised = definition THEN RAISE EXCEPTION 'Project record feed format changed; review this migration before applying.'; END IF;

  EXECUTE revised;

END $patch$;