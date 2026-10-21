-- STAGED — DO NOT RUN without Marshall's approval. Live rows (read-only scan 2026-10-20 ~11:05 PM AMT) that contain the
-- old delay spelling. All are job 2701 (Harbor Point demo). UPDATE only, no deletes. Wrap in a transaction and check counts.
-- 1) mcp_delay_events 5162d46e-b6c6-407b-8edb-7df1058913c3 description "...with a delay fragment and time-impact analysis."
-- 2) mcp_open_items 8252dd90-77ff-430f-adba-24e6712577f1 and 76a7c2ab-0edc-4024-b60c-ebc44f82a085 action text (same sentence, copied from the delay)
-- 3) mcp_living_reports 28ac8f48-2439-4eab-b7f3-0eb3e8a55df1 (2701 cpm) data.delay_analysis key "fragment": "D1060"
--    (the code now renames this key on read, so this update is optional hygiene)
-- 4) mcp_item_evidence bd7bad8b-0dc6-4b96-a453-6c7d82e43c97 evidence "...a prospective schedule fragment; ..."
BEGIN;
UPDATE public.mcp_delay_events SET description = replace(description, 'delay fragment', 'delay fragnet')
 WHERE id = '5162d46e-b6c6-407b-8edb-7df1058913c3' AND description ILIKE '%delay fragment%';           -- expect 1
UPDATE public.mcp_open_items SET action = replace(action, 'delay fragment', 'delay fragnet')
 WHERE id IN ('8252dd90-77ff-430f-adba-24e6712577f1','76a7c2ab-0edc-4024-b60c-ebc44f82a085') AND action ILIKE '%delay fragment%'; -- expect 2
UPDATE public.mcp_living_reports
   SET data = jsonb_set(data, '{delay_analysis}', (data->'delay_analysis') - 'fragment' || jsonb_build_object('fragnet', data->'delay_analysis'->'fragment'))
 WHERE id = '28ac8f48-2439-4eab-b7f3-0eb3e8a55df1' AND data->'delay_analysis' ? 'fragment' AND NOT data->'delay_analysis' ? 'fragnet'; -- expect 1
UPDATE public.mcp_item_evidence SET evidence = replace(evidence, 'schedule fragment', 'delay fragnet')
 WHERE id = 'bd7bad8b-0dc6-4b96-a453-6c7d82e43c97' AND evidence ILIKE '%schedule fragment%';          -- expect 1
-- verify: should return 0 for these ids
SELECT count(*) FROM public.mcp_delay_events WHERE id='5162d46e-b6c6-407b-8edb-7df1058913c3' AND description ILIKE '%fragment%';
COMMIT;  -- change to ROLLBACK for a dry run
