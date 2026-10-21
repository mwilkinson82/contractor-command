-- Job 2701 (Harbor Point MOB – Electrical) re-seed clean-up. NOT APPLIED. Run only after Marshall's yes.
-- Not a migration: one-off data fix, run once in the Lovable database query tool. Everything is backed up first and
-- the whole script runs in one transaction. It only changes text on 5 rows and retires 1 empty lookahead; nothing is deleted.
--
-- What it fixes (checked read-only on 2026-10-21 against the live database):
--  1. RFI-001 item (Ref A19FA): says "Sent 2026-11-10", a future date, and points at a 2026-11-19 underground inspection.
--     The saved CPM (v1–v3) has A1130 Underground inspection (hold point) on 2026-11-05.
--  2. Underground inspection item (Ref EC16A): says the inspection is on 2026-11-19; A1130 is 2026-11-05.
--     Needed-by 2026-11-02 stays (request it before the inspection).
--  3. Fire alarm pathway inspection item (Ref 8D3F0): says 2026-11-18. A1120a/A1120b FA/LV underground pathways finish
--     2026-11-02 and the pathways are covered by the A1130 hold point on 2026-11-05, so it now points at 2026-11-05.
--     OPEN FOR MARSHALL: if the FA pathway inspection really is a separate city visit on 11-18, skip step 3.
--  4. CPM v2 change note says "Set the data date to November 2, 2026" but v2 was saved with data date 2026-10-19
--     (as were v3). The note gets a correction line; the saved data date is NOT changed.
--     OPEN FOR MARSHALL: if the data date should really be 2026-11-02, that is a new CPM version, not this script.
--  5. CPM v3 change note says "final acceptance Jul 27, 2027" and "contract completion remains Sep 30, 2027". Saved:
--     A1370 Final acceptance 2027-07-13, contract completion 2027-09-16 (contract cover page). Correction line added.
--  6. Two lookaheads cover Oct 26 – Nov 6: LA-37D09 (37d093e2…, no items, only an inspection list) and LA-31BE8
--     (31be8a04…, every input and 6 items). LA-37D09 is retired as merged into LA-31BE8 (inputs.kind = 'merged',
--     which every read already hides). Its row and its saved inspection list stay; nothing is deleted.
--     Also empty, left alone (OPEN FOR MARSHALL): a01414c3… (Oct 19–30, dates only) and 6e2bde49… (no dates, no inputs).
-- History stays readable: the original note text is kept and a "[Corrected 2026-10-21 …]" line is appended.

BEGIN;

-- ---------- backups (kept; drop them later by hand once Marshall is happy) ----------
CREATE TABLE IF NOT EXISTS public._bak_20261021_2701_open_items AS
  SELECT * FROM public.mcp_open_items WHERE false;
INSERT INTO public._bak_20261021_2701_open_items
  SELECT * FROM public.mcp_open_items WHERE id IN (
    'a19fa7ee-253b-4db3-8748-264701eec5fe', 'ec16a28d-03ba-41c7-8a6a-715eb1d4446b', '8d3f0c4f-27ee-4e45-876f-1ec21b24bdeb');
CREATE TABLE IF NOT EXISTS public._bak_20261021_2701_living_reports AS
  SELECT * FROM public.mcp_living_reports WHERE false;
INSERT INTO public._bak_20261021_2701_living_reports
  SELECT * FROM public.mcp_living_reports WHERE id IN ('1a09ecf3-ebea-4ac0-b717-3667fc5de87c', '28ac8f48-2439-4eab-b7f3-0eb3e8a55df1');
CREATE TABLE IF NOT EXISTS public._bak_20261021_2701_lookaheads AS
  SELECT * FROM public.mcp_lookaheads WHERE false;
INSERT INTO public._bak_20261021_2701_lookaheads
  SELECT * FROM public.mcp_lookaheads WHERE id = '37d093e2-b45d-4b36-8b77-b68e09992d9f';
ALTER TABLE public._bak_20261021_2701_lookaheads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bak_20261021_2701_lookaheads FROM anon, authenticated, public;
ALTER TABLE public._bak_20261021_2701_open_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20261021_2701_living_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bak_20261021_2701_open_items, public._bak_20261021_2701_living_reports FROM anon, authenticated, public;

-- ---------- guards: stop if the rows aren't what was checked ----------
DO $$ BEGIN
  IF (SELECT count(*) FROM public._bak_20261021_2701_open_items) <> 3 THEN RAISE EXCEPTION '2701 fix: expected 3 open items'; END IF;
  IF (SELECT count(*) FROM public._bak_20261021_2701_living_reports) <> 2 THEN RAISE EXCEPTION '2701 fix: expected 2 CPM versions'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_open_items WHERE lookahead_id = '37d093e2-b45d-4b36-8b77-b68e09992d9f') THEN RAISE EXCEPTION '2701 fix: LA-37D09 has items now'; END IF;
  IF (SELECT count(*) FROM public.mcp_open_items WHERE lookahead_id = '31be8a04-2867-4a20-9e19-3e6874111a2c') = 0 THEN RAISE EXCEPTION '2701 fix: LA-31BE8 lost its items'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_open_items WHERE id = 'a19fa7ee-253b-4db3-8748-264701eec5fe' AND action LIKE '%Sent 2026-11-10%') THEN RAISE EXCEPTION '2701 fix: RFI-001 text changed since check'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mcp_living_reports r, jsonb_array_elements(r.data->'activities') a
    WHERE r.id = '28ac8f48-2439-4eab-b7f3-0eb3e8a55df1' AND a->>'id' = 'A1130' AND a->>'finish' = '2026-11-05') THEN RAISE EXCEPTION '2701 fix: A1130 is no longer 2026-11-05'; END IF;
END $$;

-- 1. RFI-001
UPDATE public.mcp_open_items SET
  action = '2701 – RFIs: RFI-001: underground conduit routing at grid C/4 conflicts with the storm line. Not sent yet: send to Bayline Design Studio by 2026-10-26; answer needed by 2026-10-30 to hold the 2026-11-05 underground inspection (A1130).',
  updated_at = now()
WHERE id = 'a19fa7ee-253b-4db3-8748-264701eec5fe';

-- 2. Underground inspection
UPDATE public.mcp_open_items SET
  action = '2701 – Inspections: Underground electrical inspection (A1130 hold point) on 2026-11-05 is not yet requested with the City of Corpus Christi; Marcus Hale to request it.',
  updated_at = now()
WHERE id = 'ec16a28d-03ba-41c7-8a6a-715eb1d4446b';

-- 3. Fire alarm pathway inspection (skip if it is a separate 11-18 visit)
UPDATE public.mcp_open_items SET
  action = '2701 – Inspections: Fire alarm underground pathway inspection (A1120a/A1120b, covered at the A1130 hold point on 2026-11-05) is not yet requested with the City of Corpus Christi; Priya Nandakumar to request it.',
  updated_at = now()
WHERE id = '8d3f0c4f-27ee-4e45-876f-1ec21b24bdeb';

-- 4. CPM v2 note
UPDATE public.mcp_living_reports SET
  change_why = coalesce(change_why, '') || ' [Corrected 2026-10-21: this version was saved with data date 2026-10-19, not November 2, 2026.]'
WHERE id = '1a09ecf3-ebea-4ac0-b717-3667fc5de87c' AND coalesce(change_why, '') NOT LIKE '%[Corrected 2026-10-21%';

-- 5. CPM v3 note
UPDATE public.mcp_living_reports SET
  change_why = coalesce(change_why, '') || ' [Corrected 2026-10-21: saved final acceptance (A1370) is Jul 13, 2027 and contract completion is Sep 16, 2027 (contract cover page).]'
WHERE id = '28ac8f48-2439-4eab-b7f3-0eb3e8a55df1' AND coalesce(change_why, '') NOT LIKE '%[Corrected 2026-10-21%';

-- 6. Retire LA-37D09 (merged into LA-31BE8)
UPDATE public.mcp_lookaheads SET
  inputs = coalesce(inputs, '{}'::jsonb) || jsonb_build_object('kind', 'merged', 'merged_into', '31be8a04-2867-4a20-9e19-3e6874111a2c', 'merged_at', '2026-10-21', 'merged_why', 'Empty duplicate of LA-31BE8 (same Oct 26 – Nov 6 window).')
WHERE id = '37d093e2-b45d-4b36-8b77-b68e09992d9f' AND coalesce(inputs->>'kind', '') <> 'merged';

-- Check before COMMIT: 3 items and 2 notes changed.
SELECT 'items' AS what, count(*) FROM public.mcp_open_items i JOIN public._bak_20261021_2701_open_items b USING (id) WHERE i.action <> b.action
UNION ALL
SELECT 'notes', count(*) FROM public.mcp_living_reports r JOIN public._bak_20261021_2701_living_reports b USING (id) WHERE r.change_why IS DISTINCT FROM b.change_why
UNION ALL
SELECT 'retired lookaheads', count(*) FROM public.mcp_lookaheads WHERE id = '37d093e2-b45d-4b36-8b77-b68e09992d9f' AND inputs->>'kind' = 'merged';

COMMIT;

-- ---------- rollback (run only if needed) ----------
-- BEGIN;
-- UPDATE public.mcp_open_items i SET action = b.action, updated_at = b.updated_at FROM public._bak_20261021_2701_open_items b WHERE i.id = b.id;
-- UPDATE public.mcp_living_reports r SET change_why = b.change_why FROM public._bak_20261021_2701_living_reports b WHERE r.id = b.id;
-- UPDATE public.mcp_lookaheads l SET inputs = b.inputs FROM public._bak_20261021_2701_lookaheads b WHERE l.id = b.id;
-- COMMIT;
