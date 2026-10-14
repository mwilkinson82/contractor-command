ALTER TABLE public.mcp_item_events DROP CONSTRAINT mcp_item_events_event_check;
ALTER TABLE public.mcp_item_events ADD CONSTRAINT mcp_item_events_event_check
  CHECK (event = ANY (ARRAY['opened','carried_forward','resolved','updated','waived','surfaced']));