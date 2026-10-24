-- Takeoff blind test (CCW-003, 2026-10-24): geometry and reader checkpoints carry across takeoff versions along a
-- one-to-one line map (line, item, sheet, measure type, unit; a renumber only when unambiguous), not byte-equal rows,
-- and the snapshot names lines the latest save dropped. Guards, permissions and existing rows are unchanged.

-- One-to-one map between the lines of two takeoff versions. Exact identities (line number, item, sheet,
-- measure type, unit) are reserved first. A renumber maps only when exactly one unmatched previous line and
-- exactly one unmatched new line share the rest of the identity. Anything ambiguous maps to nothing, so a
-- repeated description never inherits a neighbour's accepted quantity, whatever order the rows arrived in.
CREATE OR REPLACE FUNCTION public.mcp_takeoff_line_map(_previous uuid,_current uuid)
RETURNS TABLE(old_id uuid,new_id uuid,old_line_no integer,new_line_no integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
WITH o AS (SELECT id,line_no,lower(btrim(item)) AS item,lower(btrim(coalesce(sheet,''))) AS sheet,coalesce(measure_type,'') AS mt,lower(btrim(coalesce(unit,''))) AS unit FROM public.mcp_estimate_takeoff_lines WHERE takeoff_id=_previous),
 n AS (SELECT id,line_no,lower(btrim(item)) AS item,lower(btrim(coalesce(sheet,''))) AS sheet,coalesce(measure_type,'') AS mt,lower(btrim(coalesce(unit,''))) AS unit FROM public.mcp_estimate_takeoff_lines WHERE takeoff_id=_current),
 pairs AS (SELECT o.id AS old_id,n.id AS new_id,o.line_no AS old_line_no,n.line_no AS new_line_no FROM o JOIN n ON n.line_no=o.line_no AND n.item=o.item AND n.sheet=o.sheet AND n.mt=o.mt AND n.unit=o.unit),
 exact AS (SELECT * FROM pairs p WHERE (SELECT count(*) FROM pairs q WHERE q.old_id=p.old_id)=1 AND (SELECT count(*) FROM pairs q WHERE q.new_id=p.new_id)=1),
 ro AS (SELECT * FROM o WHERE id NOT IN (SELECT old_id FROM exact)),
 rn AS (SELECT * FROM n WHERE id NOT IN (SELECT new_id FROM exact)),
 renum AS (SELECT ro.id AS old_id,rn.id AS new_id,ro.line_no AS old_line_no,rn.line_no AS new_line_no FROM ro JOIN rn ON rn.item=ro.item AND rn.sheet=ro.sheet AND rn.mt=ro.mt AND rn.unit=ro.unit
  WHERE (SELECT count(*) FROM ro x WHERE x.item=ro.item AND x.sheet=ro.sheet AND x.mt=ro.mt AND x.unit=ro.unit)=1
    AND (SELECT count(*) FROM rn y WHERE y.item=rn.item AND y.sheet=rn.sheet AND y.mt=rn.mt AND y.unit=rn.unit)=1)
SELECT old_id,new_id,old_line_no,new_line_no FROM exact UNION ALL SELECT old_id,new_id,old_line_no,new_line_no FROM renum $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_line_map(uuid,uuid) FROM public,anon,authenticated;

-- The save inserts lines one at a time, so the carry is a deferred constraint trigger: it runs at commit,
-- when every line of the new version exists, and each line takes only its own partner from the map.
CREATE OR REPLACE FUNCTION public.mcp_takeoff_carry_lines() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m record; g record; checkpoint record; current_job uuid; current_version integer; previous_takeoff uuid; previous_version integer;
BEGIN
 SELECT job_id,version INTO current_job,current_version FROM public.mcp_estimate_takeoffs WHERE id=NEW.takeoff_id;
 SELECT id,version INTO previous_takeoff,previous_version FROM public.mcp_estimate_takeoffs WHERE job_id=current_job AND version<current_version ORDER BY version DESC LIMIT 1;
 IF previous_takeoff IS NULL THEN RETURN NULL; END IF;
 FOR m IN SELECT * FROM public.mcp_takeoff_line_map(previous_takeoff,NEW.takeoff_id) WHERE new_id=NEW.id LOOP
  FOR g IN SELECT * FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=current_job ORDER BY geometry_id,version DESC) heads WHERE line_id=m.old_id LOOP
   INSERT INTO public.mcp_takeoff_geometry(geometry_id,version,job_id,company_id,line_id,source_id,page,calibration_id,shape,measured,unit,status,source,reason,evidence)
   VALUES(g.geometry_id,g.version+1,g.job_id,g.company_id,m.new_id,g.source_id,g.page,g.calibration_id,g.shape,g.measured,g.unit,g.status,g.source,g.reason,g.evidence||jsonb_build_object('carried_from',g.id));
  END LOOP;
  FOR checkpoint IN SELECT * FROM (SELECT DISTINCT ON(pass_summary->>'pass_id') * FROM public.mcp_takeoff_markups WHERE job_id=current_job AND kind='pass' AND pass_summary->>'line_no'=m.old_line_no::text AND pass_summary->>'takeoff_version'=previous_version::text ORDER BY pass_summary->>'pass_id',created_at DESC) heads LOOP
   INSERT INTO public.mcp_takeoff_markups(job_id,company_id,source_id,page,kind,geometry_revs,pass_summary,created_by)
   VALUES(checkpoint.job_id,checkpoint.company_id,checkpoint.source_id,checkpoint.page,'pass','[]',checkpoint.pass_summary||jsonb_build_object('takeoff_version',current_version,'carried_from_takeoff_version',previous_version,'line_no',m.new_line_no,'carried_from_line_no',m.old_line_no),checkpoint.created_by);
  END LOOP;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_carry_lines() FROM public,anon,authenticated;
DROP TRIGGER IF EXISTS takeoff_carry_unchanged ON public.mcp_estimate_takeoff_lines;
DROP TRIGGER IF EXISTS takeoff_carry_identity ON public.mcp_estimate_takeoff_lines;
CREATE CONSTRAINT TRIGGER takeoff_carry_identity AFTER INSERT ON public.mcp_estimate_takeoff_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mcp_takeoff_carry_lines();
DROP FUNCTION IF EXISTS public.mcp_takeoff_carry_line();

CREATE OR REPLACE FUNCTION public.mcp_takeoff_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid uuid; tid uuid; ver integer; result jsonb; legacy jsonb; prev uuid; prev_ver integer;
BEGIN
 cid:=public.mcp_estimate_guard(_job);
 SELECT id,version INTO tid,ver FROM public.mcp_estimate_takeoffs WHERE job_id=_job ORDER BY version DESC LIMIT 1;
 legacy:=public.mcp_estimate_get(_job);
 SELECT id,version INTO prev,prev_ver FROM public.mcp_estimate_takeoffs WHERE job_id=_job AND version<coalesce(ver,0) ORDER BY version DESC LIMIT 1;
 RETURN jsonb_build_object('available',true,'takeoff_version',ver,'exports',public.mcp_takeoff_exports(_job,NULL,NULL,NULL),
  'gaps',coalesce(legacy->'gaps','[]'::jsonb),'verdicts',coalesce(legacy->'verdicts','[]'::jsonb),'role',legacy->'setup'->'role','trades',coalesce(legacy->'setup'->'trades','[]'::jsonb),
  'dropped_lines',coalesce((SELECT jsonb_agg(jsonb_build_object('line_no',o.line_no,'item',o.item,'version',prev_ver,'had_geometry',EXISTS(SELECT 1 FROM public.mcp_takeoff_geometry g WHERE g.line_id=o.id AND g.status IN('accepted','proposed'))) ORDER BY o.line_no) FROM public.mcp_estimate_takeoff_lines o WHERE o.takeoff_id=prev AND o.id NOT IN(SELECT old_id FROM public.mcp_takeoff_line_map(prev,tid))),'[]'::jsonb),
  'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY line_no) FROM public.mcp_estimate_takeoff_lines l WHERE takeoff_id=tid),'[]'::jsonb),
  'calibrations',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT DISTINCT ON(source_id,page,region) * FROM public.mcp_takeoff_calibrations WHERE job_id=_job ORDER BY source_id,page,region,version DESC) c),'[]'::jsonb),
  'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'stale',EXISTS(SELECT 1 FROM public.mcp_drawing_versions newer WHERE newer.job_id=_job AND newer.kind='source' AND newer.source_key=s.source_key AND newer.version>s.version AND newer.version=(SELECT max(v.version) FROM public.mcp_drawing_versions v WHERE v.job_id=_job AND v.kind='source' AND v.source_key=s.source_key) AND (newer.content_hash<>s.content_hash OR newer.sheets<>s.sheets)))) FROM public.mcp_drawing_versions s WHERE s.job_id=_job AND s.kind='source'),'[]'::jsonb),
  'accepted_history',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=_job AND status='accepted' AND line_id IN(SELECT id FROM public.mcp_estimate_takeoff_lines WHERE takeoff_id=tid) ORDER BY geometry_id,version DESC) a),'[]'::jsonb),
  'geometry',coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=_job AND line_id IN(SELECT id FROM public.mcp_estimate_takeoff_lines WHERE takeoff_id=tid) ORDER BY geometry_id,version DESC) g),'[]'::jsonb),
  'passes',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT * FROM (SELECT DISTINCT ON(pass_summary->>'pass_id') * FROM public.mcp_takeoff_markups WHERE job_id=_job AND kind='pass' AND pass_summary->>'pass_id' IS NOT NULL ORDER BY pass_summary->>'pass_id',created_at DESC) checkpoints ORDER BY created_at DESC LIMIT 400) p),'[]'::jsonb));
END $$;

ALTER FUNCTION public.mcp_takeoff_get(uuid) VOLATILE;
