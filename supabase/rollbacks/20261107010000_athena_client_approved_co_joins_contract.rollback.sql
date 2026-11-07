-- Rollback for 20261107010000_athena_client_approved_co_joins_contract: client approvals stop executing change
-- orders, a member's execution recomputes its total as before, and the helper is dropped. Change orders already
-- executed stay executed: the record is append-only and an executed change is reversed only by a compensating change.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $patch$
DECLARE routine regprocedure := 'public.mcp_portal_decide(uuid,text,uuid,text,text,text,text,text,text,text,text,text)'::regprocedure;
  definition text; revised text;
BEGIN
  definition := pg_get_functiondef(routine);
  revised := replace(definition, $old$
      IF _decision = 'approved' THEN PERFORM mcp_private.co_execute_client_approved(s.id); END IF;$old$, '');
  revised := replace(revised, $old$        PERFORM mcp_private.co_execute_client_approved(s.id);
$old$, '');
  IF position('mcp_private.co_execute_client_approved' IN revised) > 0 THEN RAISE EXCEPTION 'Client approval patch not found as applied.'; END IF;
  IF revised <> definition THEN EXECUTE revised; END IF;
END $patch$;

DO $patch$
DECLARE routine regprocedure := 'public.mcp_change_record(uuid,text,jsonb)'::regprocedure; definition text; revised text;
BEGIN
  definition := pg_get_functiondef(routine);
  revised := replace(definition,
    $new$VALUES(_job,'contract','executed_change_orders',to_jsonb((coalesce((SELECT round((f.value #>> '{}')::numeric*100) FROM public.mcp_job_facts f WHERE f.job_id=_job AND f.module='contract' AND f.key='executed_change_orders' AND jsonb_typeof(f.value)='number' AND f.status NOT IN('unknown','na')),delta_cents)+(d->>'total_cents')::numeric)/100),'known','member_answer',true) /* executed_total_kept */$new$,
    $old$VALUES(_job,'contract','executed_change_orders',to_jsonb((delta_cents+(d->>'total_cents')::numeric)/100),'known','member_answer',true)$old$);
  IF revised <> definition THEN EXECUTE revised; END IF;
END $patch$;

DROP FUNCTION IF EXISTS mcp_private.co_execute_client_approved(uuid);
