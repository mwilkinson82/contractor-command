-- Reopen one closed open-item. Same job scope as close (mcp_can_access_job). One row per call.
ALTER TABLE public.mcp_item_events DROP CONSTRAINT mcp_item_events_event_check;
ALTER TABLE public.mcp_item_events ADD CONSTRAINT mcp_item_events_event_check
  CHECK (event = ANY (ARRAY['opened','carried_forward','resolved','updated','waived','surfaced','reopened']));

CREATE OR REPLACE FUNCTION public.mcp_resolve_item(_item uuid, _kind text, _evidence text, _stated_by text, _stated_on date,
  _reason text, _approval text, _billing text, _collection text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it public.mcp_open_items; ev text := nullif(btrim(_evidence), ''); rgt text; res text; note text;
BEGIN
  PERFORM public.mcp_assert_active();
  SELECT * INTO it FROM public.mcp_open_items WHERE id = _item;
  IF NOT FOUND OR NOT public.mcp_can_access_job(it.job_id) THEN RAISE EXCEPTION 'MCP_NO_ITEM'; END IF;

  IF _kind = 'reopen' THEN
    IF it.status <> 'resolved' THEN RAISE EXCEPTION 'MCP_BAD:That item is already open.'; END IF;
    UPDATE public.mcp_open_items SET
      status = 'open',
      resolution = NULL,
      resolved_at = NULL,
      verified_at = NULL,
      verified_evidence = NULL,
      verify_state = 'last_reported',
      updated_at = now()
    WHERE id = it.id;
    INSERT INTO public.mcp_item_events (user_id, item_id, event, lookahead_id, note)
      VALUES (auth.uid(), it.id, 'reopened', it.lookahead_id, 'reopened');
    PERFORM public.mcp_audit_job(it.job_id, 'resolve_item', 'reopen', it.id::text);
    RETURN jsonb_build_object('closed', false, 'reopened', true);
  END IF;

  IF it.status <> 'open' THEN RAISE EXCEPTION 'MCP_BAD:That item is already closed.'; END IF;
  IF _kind = 'na' THEN RAISE EXCEPTION 'MCP_BAD:N/A is not a resolution. Marking a question or section N/A only stops future questions; this item stays open until it is resolved with evidence or waived by someone with that decision right.'; END IF;

  IF _kind = 'update' THEN
    IF coalesce(btrim(_stated_by), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:A status update needs stated_by (who reported it).'; END IF;
    UPDATE public.mcp_open_items SET verify_state = 'last_reported', reported_by = btrim(_stated_by),
      reported_at = coalesce(_stated_on::timestamptz, now()), updated_at = now() WHERE id = it.id;
    IF ev IS NOT NULL THEN INSERT INTO public.mcp_item_evidence (user_id, item_id, evidence) VALUES (auth.uid(), it.id, left(ev, 10000)); END IF;
    INSERT INTO public.mcp_item_events (user_id, item_id, event, lookahead_id, note) VALUES (auth.uid(), it.id, 'updated', it.lookahead_id, 'last-reported by ' || btrim(_stated_by));
    PERFORM public.mcp_audit_job(it.job_id, 'resolve_item', 'update', it.id::text);
    RETURN jsonb_build_object('closed', false, 'updated', true);
  END IF;

  IF _kind = 'verified' THEN
    IF ev IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Closing needs evidence.'; END IF;
    IF it.kind = 'commercial' THEN RAISE EXCEPTION 'MCP_BAD:Commercial items close only on approval, billing and collection (kind commercial_close), or an authorized drop (kind waive).'; END IF;
    res := 'verified';
  ELSIF _kind = 'member_statement' THEN
    IF it.kind <> 'confirm_unknown' THEN RAISE EXCEPTION 'MCP_BAD:A member statement only closes a confirm item. This item needs evidence (kind verified).'; END IF;
    IF ev IS NULL OR coalesce(btrim(_stated_by), '') = '' OR _stated_on IS NULL THEN
      RAISE EXCEPTION 'MCP_BAD:A member statement needs the statement (evidence), who said it (stated_by) and the date (stated_on).';
    END IF;
    ev := ev || ' — stated by ' || btrim(_stated_by) || ' on ' || _stated_on;
    res := 'member_statement';
  ELSIF _kind = 'waive' THEN
    rgt := CASE WHEN it.kind = 'commercial' THEN
      CASE it.commercial_type WHEN 'co' THEN 'change_orders' WHEN 'retainage' THEN 'write_offs' ELSE 'claims' END
      ELSE 'waive_items' END;
    IF NOT public.mcp_has_right(it.company_id, rgt) THEN
      RAISE EXCEPTION 'MCP_BAD:Only someone with the % decision right can waive or drop this item.', replace(rgt, '_', ' ');
    END IF;
    IF coalesce(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:A waiver needs a reason.'; END IF;
    note := 'waived: ' || btrim(_reason);
    ev := coalesce(ev, note);
    res := CASE WHEN it.kind = 'commercial' THEN 'dropped' ELSE 'waived' END;
  ELSIF _kind = 'commercial_close' THEN
    IF it.kind <> 'commercial' THEN RAISE EXCEPTION 'MCP_BAD:commercial_close is only for change order, REA, claim or retainage items.'; END IF;
    IF coalesce(btrim(_approval), '') = '' OR coalesce(btrim(_billing), '') = '' OR coalesce(btrim(_collection), '') = '' THEN
      RAISE EXCEPTION 'MCP_BAD:A commercial item closes only with approval, billing and collection evidence all provided.';
    END IF;
    ev := 'approval: ' || btrim(_approval) || ' | billing: ' || btrim(_billing) || ' | collection: ' || btrim(_collection) || coalesce(' | ' || ev, '');
    res := 'collected';
  ELSE
    RAISE EXCEPTION 'MCP_BAD:kind must be verified, member_statement, waive, commercial_close, update or reopen.';
  END IF;

  INSERT INTO public.mcp_item_evidence (user_id, item_id, evidence) VALUES (auth.uid(), it.id, left(ev, 10000));
  UPDATE public.mcp_open_items SET status = 'resolved', resolution = res, resolved_at = now(), updated_at = now(),
    verify_state = CASE WHEN res IN ('verified','collected') THEN 'verified' ELSE verify_state END,
    verified_evidence = CASE WHEN res IN ('verified','collected') THEN left(ev, 10000) ELSE verified_evidence END,
    verified_at = CASE WHEN res IN ('verified','collected') THEN now() ELSE verified_at END
  WHERE id = it.id;
  INSERT INTO public.mcp_item_events (user_id, item_id, event, lookahead_id, note)
    VALUES (auth.uid(), it.id, CASE WHEN res IN ('waived','dropped') THEN 'waived' ELSE 'resolved' END, it.lookahead_id, coalesce(note, res));
  PERFORM public.mcp_audit_job(it.job_id, 'resolve_item', 'close_' || res, it.id::text);
  RETURN jsonb_build_object('closed', true, 'resolution', res);
END $$;
