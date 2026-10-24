-- Takeoff blind test (CCW-003, 2026-10-24): geometry carries across takeoff versions by line identity, not byte-equal rows,
-- and the snapshot names lines the latest save dropped. Guards, permissions and existing rows are unchanged.

CREATE OR REPLACE FUNCTION public.mcp_takeoff_carry_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_line uuid; current_job uuid; previous_takeoff uuid; g record; checkpoint record; current_version integer; previous_version integer;
BEGIN
 SELECT job_id INTO current_job FROM public.mcp_estimate_takeoffs WHERE id=NEW.takeoff_id;
 SELECT version INTO current_version FROM public.mcp_estimate_takeoffs WHERE id=NEW.takeoff_id;
 SELECT id,version INTO previous_takeoff,previous_version FROM public.mcp_estimate_takeoffs WHERE job_id=current_job AND version<(SELECT version FROM public.mcp_estimate_takeoffs WHERE id=NEW.takeoff_id) ORDER BY version DESC LIMIT 1;
 -- The line's identity is its number and item on the same sheet. A changed note, confidence, math or
 -- detail is still the same line, so its measured geometry carries forward. A renumbered line carries
 -- when its item and sheet match exactly one previous line. Geometry is never carried onto a different item.
 SELECT l.id INTO old_line FROM public.mcp_estimate_takeoff_lines l WHERE l.takeoff_id=previous_takeoff AND l.line_no=NEW.line_no
  AND lower(btrim(l.item))=lower(btrim(NEW.item)) AND lower(btrim(coalesce(l.sheet,'')))=lower(btrim(coalesce(NEW.sheet,'')));
 IF old_line IS NULL THEN
  SELECT CASE WHEN count(*)=1 THEN min(l.id::text)::uuid END INTO old_line FROM public.mcp_estimate_takeoff_lines l WHERE l.takeoff_id=previous_takeoff
   AND lower(btrim(l.item))=lower(btrim(NEW.item)) AND lower(btrim(coalesce(l.sheet,'')))=lower(btrim(coalesce(NEW.sheet,'')));
 END IF;
 IF old_line IS NULL THEN RETURN NEW; END IF;
 FOR g IN SELECT * FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=current_job ORDER BY geometry_id,version DESC) heads WHERE line_id=old_line LOOP
  INSERT INTO public.mcp_takeoff_geometry(geometry_id,version,job_id,company_id,line_id,source_id,page,calibration_id,shape,measured,unit,status,source,reason,evidence)
  VALUES(g.geometry_id,g.version+1,g.job_id,g.company_id,NEW.id,g.source_id,g.page,g.calibration_id,g.shape,g.measured,g.unit,g.status,g.source,g.reason,g.evidence||jsonb_build_object('carried_from',g.id));
 END LOOP;
 FOR checkpoint IN SELECT * FROM (SELECT DISTINCT ON(pass_summary->>'pass_id') * FROM public.mcp_takeoff_markups WHERE job_id=current_job AND kind='pass' AND pass_summary->>'line_no'=NEW.line_no::text AND pass_summary->>'takeoff_version'=previous_version::text ORDER BY pass_summary->>'pass_id',created_at DESC) latest LOOP
  INSERT INTO public.mcp_takeoff_markups(job_id,company_id,source_id,page,kind,geometry_revs,pass_summary)
  VALUES(checkpoint.job_id,checkpoint.company_id,checkpoint.source_id,checkpoint.page,'pass','[]',checkpoint.pass_summary||jsonb_build_object('takeoff_version',current_version,'carried_from_takeoff_version',previous_version));
 END LOOP;
 RETURN NEW;
END $$;

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
  'dropped_lines',coalesce((SELECT jsonb_agg(jsonb_build_object('line_no',o.line_no,'item',o.item,'version',prev_ver,'had_geometry',EXISTS(SELECT 1 FROM public.mcp_takeoff_geometry g WHERE g.line_id=o.id AND g.status IN('accepted','proposed'))) ORDER BY o.line_no) FROM public.mcp_estimate_takeoff_lines o WHERE o.takeoff_id=prev AND NOT EXISTS(SELECT 1 FROM public.mcp_estimate_takeoff_lines n WHERE n.takeoff_id=tid AND lower(btrim(n.item))=lower(btrim(o.item)))),'[]'::jsonb),
  'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY line_no) FROM public.mcp_estimate_takeoff_lines l WHERE takeoff_id=tid),'[]'::jsonb),
  'calibrations',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT DISTINCT ON(source_id,page,region) * FROM public.mcp_takeoff_calibrations WHERE job_id=_job ORDER BY source_id,page,region,version DESC) c),'[]'::jsonb),
  'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'stale',EXISTS(SELECT 1 FROM public.mcp_drawing_versions newer WHERE newer.job_id=_job AND newer.kind='source' AND newer.source_key=s.source_key AND newer.version>s.version AND newer.version=(SELECT max(v.version) FROM public.mcp_drawing_versions v WHERE v.job_id=_job AND v.kind='source' AND v.source_key=s.source_key) AND (newer.content_hash<>s.content_hash OR newer.sheets<>s.sheets)))) FROM public.mcp_drawing_versions s WHERE s.job_id=_job AND s.kind='source'),'[]'::jsonb),
  'accepted_history',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=_job AND status='accepted' AND line_id IN(SELECT id FROM public.mcp_estimate_takeoff_lines WHERE takeoff_id=tid) ORDER BY geometry_id,version DESC) a),'[]'::jsonb),
  'geometry',coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=_job AND line_id IN(SELECT id FROM public.mcp_estimate_takeoff_lines WHERE takeoff_id=tid) ORDER BY geometry_id,version DESC) g),'[]'::jsonb),
  'passes',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT * FROM (SELECT DISTINCT ON(pass_summary->>'pass_id') * FROM public.mcp_takeoff_markups WHERE job_id=_job AND kind='pass' AND pass_summary->>'pass_id' IS NOT NULL ORDER BY pass_summary->>'pass_id',created_at DESC) checkpoints ORDER BY created_at DESC LIMIT 400) p),'[]'::jsonb));
END $$;

ALTER FUNCTION public.mcp_takeoff_get(uuid) VOLATILE;
