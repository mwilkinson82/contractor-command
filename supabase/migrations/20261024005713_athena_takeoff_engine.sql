-- Additive takeoff measurement history. Apply production changes through Lovable Cloud only.
-- Source UUIDs are checked against mcp_drawing_versions inside every RPC. That table's
-- migration sorts later in historical fresh installs, so no forward table FK is declared.
-- Neither originals nor existing takeoff rows are updated by these functions.
CREATE TABLE public.mcp_takeoff_calibrations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
 company_id uuid NOT NULL REFERENCES public.mcp_companies(id), source_id uuid NOT NULL, page integer NOT NULL CHECK(page>0),
 region text NOT NULL CHECK(length(btrim(region)) BETWEEN 1 AND 100), version integer NOT NULL CHECK(version>0),
 width numeric NOT NULL CHECK(width>0 AND width<=144000), height numeric NOT NULL CHECK(height>0 AND height<=144000),
 bounds jsonb NOT NULL, reference jsonb NOT NULL, feet_per_point numeric NOT NULL CHECK(feet_per_point>0 AND feet_per_point<1000000),
 method text NOT NULL CHECK(method IN ('estimator','dimension_string','title_block')),
 confidence text NOT NULL CHECK(confidence IN ('high','medium','low')), confirmed boolean NOT NULL,
 created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(job_id,source_id,page,region,version)
);
CREATE TABLE public.mcp_takeoff_geometry (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), geometry_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
 line_id uuid NOT NULL REFERENCES public.mcp_estimate_takeoff_lines(id), source_id uuid, page integer CHECK(page>0),
 calibration_id uuid REFERENCES public.mcp_takeoff_calibrations(id), shape jsonb NOT NULL,
 measured numeric, unit text CHECK(unit IN ('EA','LF','SF','CY')), status text NOT NULL CHECK(status IN ('proposed','accepted','rejected','not_drawable')),
 source text NOT NULL CHECK(source IN ('athena','estimator')), reason text CHECK(length(reason)<=2000),
 evidence jsonb NOT NULL DEFAULT '{}' CHECK(octet_length(evidence::text)<=200000),
 created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((shape->>'kind'='not_drawable' AND status IN('not_drawable','rejected') AND coalesce(length(btrim(reason)),0)>0) OR (shape->>'kind'<>'not_drawable' AND source_id IS NOT NULL AND page IS NOT NULL AND measured>=0 AND unit IS NOT NULL)),
 UNIQUE(geometry_id,version)
);
CREATE TABLE public.mcp_takeoff_markups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
 company_id uuid NOT NULL REFERENCES public.mcp_companies(id), source_id uuid NOT NULL, page integer NOT NULL CHECK(page>0),
 kind text NOT NULL CHECK(kind IN ('pass','export')), geometry_revs jsonb NOT NULL DEFAULT '[]',
 pass_summary jsonb NOT NULL DEFAULT '{}', rendered_pdf text, rendered_png text, content_hash text,
 created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(octet_length(pass_summary::text)<=200000 AND octet_length(geometry_revs::text)<=200000)
);
CREATE INDEX mcp_takeoff_calibration_latest ON public.mcp_takeoff_calibrations(job_id,source_id,page,region,version DESC);
CREATE INDEX mcp_takeoff_geometry_line ON public.mcp_takeoff_geometry(job_id,line_id,geometry_id,version DESC);
CREATE INDEX mcp_takeoff_geometry_source ON public.mcp_takeoff_geometry(job_id,source_id,page);
CREATE INDEX mcp_takeoff_markup_latest ON public.mcp_takeoff_markups(job_id,source_id,page,kind,created_at DESC);
ALTER TABLE public.mcp_takeoff_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_takeoff_geometry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_takeoff_markups ENABLE ROW LEVEL SECURITY;
-- No direct table access, including guessed company/line/source IDs. Guarded RPCs only.
REVOKE ALL ON public.mcp_takeoff_calibrations, public.mcp_takeoff_geometry, public.mcp_takeoff_markups FROM public, anon, authenticated;

CREATE FUNCTION public.mcp_takeoff_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'MCP_BAD:Takeoff history is immutable. Save a new revision.'; END $$;
CREATE TRIGGER takeoff_calibration_immutable BEFORE UPDATE OR DELETE ON public.mcp_takeoff_calibrations FOR EACH ROW EXECUTE FUNCTION public.mcp_takeoff_immutable();
CREATE TRIGGER takeoff_geometry_immutable BEFORE UPDATE OR DELETE ON public.mcp_takeoff_geometry FOR EACH ROW EXECUTE FUNCTION public.mcp_takeoff_immutable();
CREATE TRIGGER takeoff_markup_immutable BEFORE UPDATE OR DELETE ON public.mcp_takeoff_markups FOR EACH ROW EXECUTE FUNCTION public.mcp_takeoff_immutable();
REVOKE ALL ON FUNCTION public.mcp_takeoff_immutable() FROM public,anon,authenticated;

CREATE FUNCTION public.mcp_takeoff_points(_points jsonb, _minimum integer) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE p jsonb;
BEGIN
 IF jsonb_typeof(_points) IS DISTINCT FROM 'array' OR jsonb_array_length(_points)<_minimum OR jsonb_array_length(_points)>1000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid measured boundary or pin list.'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(_points) LOOP
  IF jsonb_typeof(p->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'y') IS DISTINCT FROM 'number' OR NOT((p->>'x')::numeric BETWEEN 0 AND 1) OR NOT((p->>'y')::numeric BETWEEN 0 AND 1) THEN RAISE EXCEPTION 'MCP_BAD:Every point must be on the stored page.'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION public.mcp_takeoff_ring_area(_points jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE total numeric:=0; a jsonb; b jsonb; i integer; n integer;
BEGIN
 PERFORM public.mcp_takeoff_points(_points,3); n:=jsonb_array_length(_points);
 FOR i IN 0..n-1 LOOP a:=_points->i; b:=_points->((i+1)%n); total:=total+(a->>'x')::numeric*(b->>'y')::numeric-(b->>'x')::numeric*(a->>'y')::numeric; END LOOP;
 RETURN abs(total)/2;
END $$;
CREATE FUNCTION public.mcp_takeoff_measure(_shape jsonb,_width numeric,_height numeric,_scale numeric) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE points jsonb:=_shape->'points'; kind text:=_shape->>'kind'; v numeric:=0; a jsonb; b jsonb; h jsonb; i integer; n integer; d numeric; u text;
BEGIN
 IF _width IS NULL OR _height IS NULL OR NOT(_width>0 AND _height>0 AND _width<=144000 AND _height<=144000) THEN RAISE EXCEPTION 'MCP_BAD:Invalid stored page dimensions.'; END IF;
 PERFORM public.mcp_takeoff_points(points,1); n:=jsonb_array_length(points);
 IF kind='pins' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(points) p GROUP BY p HAVING count(*)>1) OR coalesce(jsonb_array_length(_shape->'holes'),0)>0 OR _shape ? 'depth' THEN RAISE EXCEPTION 'MCP_BAD:Invalid or repeated count pins.'; END IF;
  RETURN jsonb_build_object('value',n,'unit','EA');
 END IF;
 IF _scale IS NULL OR NOT(_scale>0 AND _scale<1000000) THEN RAISE EXCEPTION 'MCP_BAD:Calibrate this plan or detail first.'; END IF;
 IF kind='polyline' THEN
  IF n<2 OR coalesce(jsonb_array_length(_shape->'holes'),0)>0 OR _shape ? 'depth' THEN RAISE EXCEPTION 'MCP_BAD:Invalid measured run.'; END IF;
  FOR i IN 1..n-1 LOOP a:=points->(i-1); b:=points->i; v:=v+sqrt(power(((a->>'x')::numeric-(b->>'x')::numeric)*_width,2)+power(((a->>'y')::numeric-(b->>'y')::numeric)*_height,2)); END LOOP;
  v:=v*_scale; u:='LF';
 ELSIF kind IN ('polygon','rect') THEN
  PERFORM public.mcp_takeoff_validate_area(_shape);
  IF kind='rect' THEN
   IF n<>2 THEN RAISE EXCEPTION 'MCP_BAD:A rectangle needs two corners.'; END IF;
   v:=abs(((points->0->>'x')::numeric-(points->1->>'x')::numeric)*((points->0->>'y')::numeric-(points->1->>'y')::numeric));
  ELSE v:=public.mcp_takeoff_ring_area(points); END IF;
  IF coalesce(jsonb_array_length(_shape->'holes'),0)>100 THEN RAISE EXCEPTION 'MCP_BAD:Too many openings.'; END IF;
  FOR h IN SELECT value FROM jsonb_array_elements(coalesce(_shape->'holes','[]')) LOOP v:=v-public.mcp_takeoff_ring_area(h); END LOOP;
  v:=v*_width*_height*_scale*_scale; u:='SF';
  IF _shape ? 'depth' THEN
   IF nullif(btrim(_shape->'depth'->>'source_id'),'') IS NULL OR nullif(btrim(_shape->'depth'->>'sheet'),'') IS NULL OR nullif(btrim(_shape->'depth'->>'detail'),'') IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Depth requires a stored drawing and detail citation.'; END IF;
   d:=(_shape->'depth'->>'value')::numeric;
   d:=d*CASE _shape->'depth'->>'unit' WHEN 'ft' THEN 1 WHEN 'in' THEN 1.0/12 WHEN 'm' THEN 1.0/0.3048 WHEN 'mm' THEN 1.0/304.8 ELSE NULL END;
   IF d IS NULL OR NOT(d>0 AND d<1000000) THEN RAISE EXCEPTION 'MCP_BAD:Invalid concrete depth or unit.'; END IF;
   v:=v*d/27; u:='CY';
  END IF;
 ELSE RAISE EXCEPTION 'MCP_BAD:Unknown measurement geometry.'; END IF;
 IF NOT(v>0 AND v<1e15) THEN RAISE EXCEPTION 'MCP_BAD:The measured quantity must be positive and finite.'; END IF;
 RETURN jsonb_build_object('value',v,'unit',u);
END $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_points(jsonb,integer),public.mcp_takeoff_ring_area(jsonb),public.mcp_takeoff_measure(jsonb,numeric,numeric,numeric) FROM public,anon,authenticated;

CREATE FUNCTION public.mcp_takeoff_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid uuid; tid uuid; ver integer; result jsonb; legacy jsonb;
BEGIN
 cid:=public.mcp_estimate_guard(_job);
 SELECT id,version INTO tid,ver FROM public.mcp_estimate_takeoffs WHERE job_id=_job ORDER BY version DESC LIMIT 1;
 legacy:=public.mcp_estimate_get(_job);
 RETURN jsonb_build_object('available',true,'takeoff_version',ver,'exports',public.mcp_takeoff_exports(_job,NULL,NULL,NULL),
  'gaps',coalesce(legacy->'gaps','[]'::jsonb),'verdicts',coalesce(legacy->'verdicts','[]'::jsonb),'role',legacy->'setup'->'role','trades',coalesce(legacy->'setup'->'trades','[]'::jsonb),
  'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY line_no) FROM public.mcp_estimate_takeoff_lines l WHERE takeoff_id=tid),'[]'::jsonb),
  'calibrations',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT DISTINCT ON(source_id,page,region) * FROM public.mcp_takeoff_calibrations WHERE job_id=_job ORDER BY source_id,page,region,version DESC) c),'[]'::jsonb),
  'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'stale',EXISTS(SELECT 1 FROM public.mcp_drawing_versions newer WHERE newer.job_id=_job AND newer.kind='source' AND newer.source_key=s.source_key AND newer.version>s.version AND newer.version=(SELECT max(v.version) FROM public.mcp_drawing_versions v WHERE v.job_id=_job AND v.kind='source' AND v.source_key=s.source_key) AND (newer.content_hash<>s.content_hash OR newer.sheets<>s.sheets)))) FROM public.mcp_drawing_versions s WHERE s.job_id=_job AND s.kind='source'),'[]'::jsonb),
  'accepted_history',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=_job AND status='accepted' AND line_id IN(SELECT id FROM public.mcp_estimate_takeoff_lines WHERE takeoff_id=tid) ORDER BY geometry_id,version DESC) a),'[]'::jsonb),
  'geometry',coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=_job AND line_id IN(SELECT id FROM public.mcp_estimate_takeoff_lines WHERE takeoff_id=tid) ORDER BY geometry_id,version DESC) g),'[]'::jsonb),
  'passes',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT * FROM (SELECT DISTINCT ON(pass_summary->>'pass_id') * FROM public.mcp_takeoff_markups WHERE job_id=_job AND kind='pass' AND pass_summary->>'pass_id' IS NOT NULL ORDER BY pass_summary->>'pass_id',created_at DESC) checkpoints ORDER BY created_at DESC LIMIT 400) p),'[]'::jsonb));
END $$;

CREATE FUNCTION public.mcp_takeoff_calibrate(_job uuid,_source uuid,_page integer,_record jsonb,_expected integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid uuid; src record; prior public.mcp_takeoff_calibrations; saved public.mcp_takeoff_calibrations; seq integer; r jsonb:=_record->'reference'; b jsonb:=_record->'bounds'; a jsonb; z jsonb; w numeric; h numeric; known numeric; ratio numeric; g record; measured jsonb; p jsonb;
BEGIN
 cid:=public.mcp_estimate_guard(_job);
 SELECT * INTO src FROM public.mcp_drawing_versions WHERE id=_source AND job_id=_job AND kind='source';
 IF NOT FOUND OR _page IS NULL OR _page<1 OR _page>jsonb_array_length(src.sheets) THEN RAISE EXCEPTION 'MCP_BAD:Stored sheet not found on this job.'; END IF;
 IF octet_length(_record::text)>20000 THEN RAISE EXCEPTION 'MCP_BAD:Calibration is too large.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_job::text||':takeoff',0));
 SELECT * INTO prior FROM public.mcp_takeoff_calibrations WHERE job_id=_job AND source_id=_source AND page=_page AND region=_record->>'region' ORDER BY version DESC LIMIT 1;
 IF coalesce(prior.version,0) IS DISTINCT FROM _expected THEN RAISE EXCEPTION 'MCP_BAD:The calibration changed. Reload before saving.'; END IF;
 IF prior.method='estimator' AND _record->>'method'<>'estimator' THEN RAISE EXCEPTION 'MCP_BAD:An estimator calibration cannot be replaced by an automatic guess.'; END IF;
 w:=(_record->>'width')::numeric; h:=(_record->>'height')::numeric;
 IF w IS NULL OR h IS NULL OR NOT(w>0 AND h>0 AND w<=144000 AND h<=144000) THEN RAISE EXCEPTION 'MCP_BAD:Invalid physical page dimensions.'; END IF;
 IF b IS NULL OR NOT(b ?& array['x','y','width','height']) OR EXISTS(SELECT 1 FROM jsonb_each(b) e WHERE e.key IN('x','y','width','height') AND jsonb_typeof(e.value)<>'number') OR NOT((b->>'x')::numeric>=0 AND (b->>'y')::numeric>=0 AND (b->>'width')::numeric>0 AND (b->>'height')::numeric>0 AND (b->>'x')::numeric+(b->>'width')::numeric<=1 AND (b->>'y')::numeric+(b->>'height')::numeric<=1) THEN RAISE EXCEPTION 'MCP_BAD:Invalid calibration region.'; END IF;
 PERFORM public.mcp_takeoff_points(r->'points',2);
 IF jsonb_array_length(r->'points')<>2 THEN RAISE EXCEPTION 'MCP_BAD:A calibration needs exactly two reference points.'; END IF;
 a:=r->'points'->0; z:=r->'points'->1;
 FOR p IN SELECT value FROM jsonb_array_elements(r->'points') LOOP
  IF NOT((p->>'x')::numeric BETWEEN (b->>'x')::numeric AND (b->>'x')::numeric+(b->>'width')::numeric AND (p->>'y')::numeric BETWEEN (b->>'y')::numeric AND (b->>'y')::numeric+(b->>'height')::numeric) THEN RAISE EXCEPTION 'MCP_BAD:Reference points must be inside the calibration region.'; END IF;
 END LOOP;
 known:=(r->>'distance')::numeric*CASE r->>'unit' WHEN 'ft' THEN 1 WHEN 'in' THEN 1.0/12 WHEN 'm' THEN 1.0/0.3048 WHEN 'mm' THEN 1.0/304.8 ELSE NULL END;
 ratio:=sqrt(power(((a->>'x')::numeric-(z->>'x')::numeric)*w,2)+power(((a->>'y')::numeric-(z->>'y')::numeric)*h,2));
 IF known IS NULL OR known<=0 OR ratio<1 THEN RAISE EXCEPTION 'MCP_BAD:Use two distinct reference points and a positive known distance.'; END IF;
 INSERT INTO public.mcp_takeoff_calibrations(job_id,company_id,source_id,page,region,version,width,height,bounds,reference,feet_per_point,method,confidence,confirmed)
 VALUES(_job,cid,_source,_page,_record->>'region',coalesce(prior.version,0)+1,w,h,b,r,known/ratio,_record->>'method',_record->>'confidence',coalesce((_record->>'confirmed')::boolean,false)) RETURNING * INTO saved;
 -- Recalibration appends proposals; previously accepted measurements remain historical.
 FOR g IN SELECT * FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=_job AND source_id=_source AND page=_page ORDER BY geometry_id,version DESC) heads WHERE calibration_id=prior.id AND line_id IN(SELECT l.id FROM public.mcp_estimate_takeoff_lines l WHERE l.takeoff_id=(SELECT t.id FROM public.mcp_estimate_takeoffs t WHERE t.job_id=_job ORDER BY t.version DESC LIMIT 1)) LOOP
  IF g.status='rejected' THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM (SELECT q.value FROM jsonb_array_elements(g.shape->'points') q UNION ALL SELECT q.value FROM jsonb_array_elements(coalesce(g.shape->'holes','[]')) hole CROSS JOIN LATERAL jsonb_array_elements(hole.value) q) points WHERE NOT((value->>'x')::numeric BETWEEN(saved.bounds->>'x')::numeric AND(saved.bounds->>'x')::numeric+(saved.bounds->>'width')::numeric AND(value->>'y')::numeric BETWEEN(saved.bounds->>'y')::numeric AND(saved.bounds->>'y')::numeric+(saved.bounds->>'height')::numeric)) THEN
   INSERT INTO public.mcp_takeoff_geometry(geometry_id,version,job_id,company_id,line_id,source_id,page,calibration_id,shape,measured,unit,status,source,reason,evidence)
   VALUES(g.geometry_id,g.version+1,_job,cid,g.line_id,_source,_page,saved.id,g.shape,g.measured,g.unit,'rejected',g.source,'Calibration region changed; relocate this geometry before pricing.',g.evidence||jsonb_build_object('requires_relocation',true));
   CONTINUE;
  END IF;
  measured:=public.mcp_takeoff_measure(g.shape,w,h,saved.feet_per_point);
  INSERT INTO public.mcp_takeoff_geometry(geometry_id,version,job_id,company_id,line_id,source_id,page,calibration_id,shape,measured,unit,status,source,reason,evidence)
  VALUES(g.geometry_id,g.version+1,_job,cid,g.line_id,_source,_page,saved.id,g.shape,(measured->>'value')::numeric,measured->>'unit','proposed',g.source,'Calibration changed; estimator review required.',g.evidence||jsonb_build_object('prior_measurement',g.measured,'change_percent',abs((measured->>'value')::numeric-g.measured)/greatest(abs(g.measured),1e-12)*100));
 END LOOP;
 RETURN to_jsonb(saved);
END $$;

CREATE FUNCTION public.mcp_takeoff_geometry_save(_job uuid,_operation text,_record jsonb,_expected integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
<<takeoff_geometry>>
DECLARE cid uuid; tid uuid; line record; src record; prior public.mcp_takeoff_geometry; saved public.mcp_takeoff_geometry; cal public.mcp_takeoff_calibrations; gid uuid; shape jsonb; result jsonb; p jsonb; status text; w numeric; h numeric; duplicate public.mcp_takeoff_geometry;
BEGIN
 cid:=public.mcp_estimate_guard(_job);
 IF _operation IS NULL OR _operation NOT IN('save','propose','accept','reject','not_drawable') OR _record IS NULL OR octet_length(_record::text)>250000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid geometry operation.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_job::text||':takeoff',0));
 SELECT id INTO tid FROM public.mcp_estimate_takeoffs WHERE job_id=_job ORDER BY version DESC LIMIT 1;
 SELECT * INTO line FROM public.mcp_estimate_takeoff_lines WHERE takeoff_id=tid AND line_no=(_record->>'line_no')::integer;
 IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:Takeoff line not found in the current takeoff.'; END IF;
 IF (_record->>'takeoff_version')::integer IS DISTINCT FROM(SELECT version FROM public.mcp_estimate_takeoffs WHERE id=tid) THEN RAISE EXCEPTION 'MCP_BAD:The takeoff changed. Reload before saving geometry.'; END IF;
 gid:=coalesce(nullif(_record->>'geometry_id','')::uuid,gen_random_uuid());
 SELECT * INTO prior FROM public.mcp_takeoff_geometry WHERE geometry_id=gid AND job_id=_job ORDER BY version DESC LIMIT 1;
 IF coalesce(prior.version,0) IS DISTINCT FROM _expected THEN RAISE EXCEPTION 'MCP_BAD:The geometry changed. Reload before saving.'; END IF;
 IF prior.id IS NOT NULL AND prior.line_id<>line.id THEN RAISE EXCEPTION 'MCP_BAD:Geometry belongs to a different takeoff line.'; END IF;
 IF _operation IN('accept','reject') AND prior.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Read the proposal before deciding.'; END IF;
 IF _operation='reject' AND length(btrim(coalesce(_record->>'reason','')))<3 THEN RAISE EXCEPTION 'MCP_BAD:Record why this geometry is rejected.'; END IF;
 IF _operation='accept' AND prior.status NOT IN('proposed','accepted') THEN RAISE EXCEPTION 'MCP_BAD:Only a current proposal can be accepted.'; END IF;
 IF _operation='accept' AND prior.evidence ? 'pass_id' AND NOT EXISTS(SELECT 1 FROM public.mcp_takeoff_markups WHERE job_id=_job AND kind='pass' AND pass_summary->>'pass_id'=prior.evidence->>'pass_id' AND pass_summary->>'complete'='true') THEN RAISE EXCEPTION 'MCP_BAD:Finish the sheet read before accepting its partial quantity.'; END IF;
 IF _operation='accept' AND prior.status='accepted' THEN RETURN to_jsonb(prior); END IF;
 status:=CASE _operation WHEN 'accept' THEN 'accepted' WHEN 'reject' THEN 'rejected' WHEN 'not_drawable' THEN 'not_drawable' ELSE 'proposed' END;
 IF _operation='not_drawable' OR (_operation='reject' AND prior.shape->>'kind'='not_drawable') THEN
  IF _operation='reject' THEN shape:=prior.shape;
  ELSE
  IF length(btrim(coalesce(_record->>'reason','')))<3 OR coalesce(_record->>'exception_kind','') NOT IN('schedule_quantity','spec_only','allowance','by_others') THEN RAISE EXCEPTION 'MCP_BAD:Choose a non-drawable basis and record a reason.'; END IF;
  IF _record->>'exception_kind'<>'by_others' AND (jsonb_typeof(_record->'quantity') IS DISTINCT FROM 'number' OR NOT((_record->>'quantity')::numeric BETWEEN 0 AND 1e15) OR nullif(btrim(line.unit),'') IS NULL) THEN RAISE EXCEPTION 'MCP_BAD:Record the confirmed non-drawable quantity and set the line unit.'; END IF;
  shape:=jsonb_build_object('kind','not_drawable','exception_kind',_record->>'exception_kind','quantity',CASE WHEN _record->>'exception_kind'='by_others' THEN 0 ELSE (_record->>'quantity')::numeric END,'unit',line.unit);
  END IF;
 ELSE
  IF _operation IN('accept','reject') THEN
   -- Decision cannot smuggle in different coordinates, scale or source.
   shape:=prior.shape; _record:=_record||jsonb_build_object('source_id',prior.source_id,'page',prior.page,'calibration_id',prior.calibration_id,'width',prior.evidence->'width','height',prior.evidence->'height');
  ELSE shape:=_record->'shape';
   IF prior.shape->>'kind'='pins' AND shape->>'kind'='pins' AND jsonb_array_length(shape->'points')<jsonb_array_length(prior.shape->'points') AND length(btrim(coalesce(_record->>'reason','')))<3 THEN RAISE EXCEPTION 'MCP_BAD:Record why a pin is removed.'; END IF;
  END IF;
  SELECT * INTO src FROM public.mcp_drawing_versions WHERE id=(_record->>'source_id')::uuid AND job_id=_job AND kind='source';
  IF NOT FOUND OR _record->>'page' IS NULL OR (_record->>'page')::integer<1 OR (_record->>'page')::integer>jsonb_array_length(src.sheets) THEN RAISE EXCEPTION 'MCP_BAD:Stored source sheet not found on this job.'; END IF;
  IF _operation='accept' AND EXISTS(SELECT 1 FROM public.mcp_drawing_versions s JOIN LATERAL (SELECT content_hash,sheets FROM public.mcp_drawing_versions n WHERE n.job_id=_job AND n.kind='source' AND n.source_key=s.source_key ORDER BY version DESC LIMIT 1) latest ON true WHERE s.job_id=_job AND (s.id=src.id OR s.id=nullif(shape->'depth'->>'source_id','')::uuid) AND (s.content_hash<>latest.content_hash OR s.sheets<>latest.sheets)) THEN RAISE EXCEPTION 'MCP_BAD:The drawing or depth source has a newer revision. Check that sheet before accepting.'; END IF;
  IF shape ? 'depth' AND NOT EXISTS(SELECT 1 FROM public.mcp_drawing_versions WHERE id=(shape->'depth'->>'source_id')::uuid AND job_id=_job AND kind='source' AND sheets ? (shape->'depth'->>'sheet')) THEN RAISE EXCEPTION 'MCP_BAD:Depth citation is not a stored sheet on this job.'; END IF;
  SELECT * INTO cal FROM public.mcp_takeoff_calibrations WHERE id=nullif(_record->>'calibration_id','')::uuid AND job_id=_job AND source_id=src.id AND page=(_record->>'page')::integer;
  IF shape->>'kind'<>'pins' THEN
   IF cal.id IS NULL OR NOT cal.confirmed OR EXISTS(SELECT 1 FROM public.mcp_takeoff_calibrations c WHERE c.job_id=_job AND c.source_id=cal.source_id AND c.page=cal.page AND c.region=cal.region AND c.version>cal.version) THEN RAISE EXCEPTION 'MCP_BAD:Use the current confirmed calibration for this plan or detail.'; END IF;
   FOR p IN SELECT q.value FROM jsonb_array_elements(shape->'points') q UNION ALL SELECT q.value FROM jsonb_array_elements(coalesce(shape->'holes','[]')) hole CROSS JOIN LATERAL jsonb_array_elements(hole.value) q LOOP
    IF NOT((p->>'x')::numeric BETWEEN(cal.bounds->>'x')::numeric AND(cal.bounds->>'x')::numeric+(cal.bounds->>'width')::numeric AND(p->>'y')::numeric BETWEEN(cal.bounds->>'y')::numeric AND(cal.bounds->>'y')::numeric+(cal.bounds->>'height')::numeric) THEN RAISE EXCEPTION 'MCP_BAD:Geometry crosses the calibration region.'; END IF;
   END LOOP;
  END IF;
  w:=coalesce(cal.width,(_record->>'width')::numeric); h:=coalesce(cal.height,(_record->>'height')::numeric);
  result:=public.mcp_takeoff_measure(shape,w,h,cal.feet_per_point);
  IF line.measure_type IS NOT NULL AND (CASE line.measure_type WHEN 'count' THEN 'EA' WHEN 'linear' THEN 'LF' WHEN 'area' THEN 'SF' WHEN 'volume' THEN 'CY' END) IS DISTINCT FROM (result->>'unit') THEN RAISE EXCEPTION 'MCP_BAD:Geometry does not match the line measurement type.'; END IF;
  IF prior.id IS NULL THEN
   SELECT * INTO duplicate FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=_job AND line_id=line.id AND source_id=src.id AND page=(_record->>'page')::integer ORDER BY geometry_id,version DESC) heads WHERE heads.status IN('proposed','accepted') AND public.mcp_takeoff_signature(heads.shape)=public.mcp_takeoff_signature(takeoff_geometry.shape) LIMIT 1;
   IF duplicate.id IS NOT NULL THEN
    IF duplicate.calibration_id IS DISTINCT FROM cal.id OR duplicate.shape->'depth' IS DISTINCT FROM shape->'depth' THEN RAISE EXCEPTION 'MCP_BAD:This geometry is already located. Edit its exact revision to change calibration; do not count it twice.'; END IF;
    RETURN to_jsonb(duplicate)||jsonb_build_object('duplicate',true);
   END IF;
  END IF;
  IF shape->>'kind'='pins' AND EXISTS(SELECT 1 FROM (SELECT DISTINCT ON(geometry_id) * FROM public.mcp_takeoff_geometry WHERE job_id=_job AND line_id=line.id AND source_id=src.id AND page=(_record->>'page')::integer AND geometry_id<>gid ORDER BY geometry_id,version DESC) heads CROSS JOIN LATERAL jsonb_array_elements(heads.shape->'points') oldp CROSS JOIN LATERAL jsonb_array_elements(takeoff_geometry.shape->'points') newp WHERE heads.status IN('proposed','accepted') AND heads.shape->>'kind'='pins' AND abs((oldp.value->>'x')::numeric-(newp.value->>'x')::numeric)<1e-8 AND abs((oldp.value->>'y')::numeric-(newp.value->>'y')::numeric)<1e-8) THEN RAISE EXCEPTION 'MCP_BAD:A pin on this line is already located there. Edit its existing geometry instead of counting it twice.'; END IF;
  IF line.unit IS NOT NULL AND upper(line.unit) NOT IN(result->>'unit',CASE result->>'unit' WHEN 'EA' THEN 'EACH' WHEN 'LF' THEN 'FT' ELSE result->>'unit' END) THEN RAISE EXCEPTION 'MCP_BAD:Geometry units do not match the takeoff line.'; END IF;
 END IF;
 INSERT INTO public.mcp_takeoff_geometry(geometry_id,version,job_id,company_id,line_id,source_id,page,calibration_id,shape,measured,unit,status,source,reason,evidence)
 VALUES(gid,coalesce(prior.version,0)+1,_job,cid,line.id,nullif(_record->>'source_id','')::uuid,nullif(_record->>'page','')::integer,cal.id,shape,(result->>'value')::numeric,result->>'unit',status,CASE WHEN _operation='propose' THEN 'athena' WHEN _operation IN('accept','reject') THEN prior.source ELSE 'estimator' END,_record->>'reason',CASE WHEN _operation='reject' THEN prior.evidence-'requires_relocation' WHEN _operation='accept' THEN prior.evidence ELSE coalesce(_record->'evidence','{}') END||jsonb_build_object('width',w,'height',h)) RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;

CREATE FUNCTION public.mcp_takeoff_markup_save(_job uuid,_record jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid uuid; saved public.mcp_takeoff_markups; src record;
BEGIN
 cid:=public.mcp_estimate_guard(_job);
 SELECT * INTO src FROM public.mcp_drawing_versions WHERE id=(_record->>'source_id')::uuid AND job_id=_job AND kind='source';
 IF NOT FOUND OR _record->>'page' IS NULL OR (_record->>'page')::integer<1 OR (_record->>'page')::integer>jsonb_array_length(src.sheets) OR octet_length(_record::text)>400000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid stored takeoff render.'; END IF;
 IF _record->>'kind'='export' AND (_record->>'rendered_pdf' IS NULL OR (_record->>'rendered_pdf') NOT LIKE cid::text||'/'||_job::text||'/drawing-markup-%/%' OR (_record->>'rendered_pdf')~'(\.\.|\\)') THEN RAISE EXCEPTION 'MCP_BAD:Invalid dated takeoff PDF path.'; END IF;
 IF _record->>'rendered_png' IS NOT NULL AND ((_record->>'rendered_png') NOT LIKE cid::text||'/'||_job::text||'/drawing-markup-%/%' OR (_record->>'rendered_png')~'(\.\.|\\)') THEN RAISE EXCEPTION 'MCP_BAD:Invalid measured PNG path.'; END IF;
 IF jsonb_typeof(coalesce(_record->'geometry_revs','[]'))<>'array' THEN RAISE EXCEPTION 'MCP_BAD:Invalid geometry revision list.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(_record->'geometry_revs','[]')) ref WHERE NOT EXISTS(SELECT 1 FROM public.mcp_takeoff_geometry g WHERE g.id=ref.value::uuid AND g.job_id=_job AND g.source_id=src.id AND g.page=(_record->>'page')::integer)) THEN RAISE EXCEPTION 'MCP_BAD:Geometry revision does not belong to this stored sheet.'; END IF;
 INSERT INTO public.mcp_takeoff_markups(job_id,company_id,source_id,page,kind,geometry_revs,pass_summary,rendered_pdf,rendered_png,content_hash)
 VALUES(_job,cid,src.id,(_record->>'page')::integer,_record->>'kind',coalesce(_record->'geometry_revs','[]'),coalesce(_record->'pass_summary','{}'),_record->>'rendered_pdf',_record->>'rendered_png',_record->>'content_hash') RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_get(uuid),public.mcp_takeoff_calibrate(uuid,uuid,integer,jsonb,integer),public.mcp_takeoff_geometry_save(uuid,text,jsonb,integer),public.mcp_takeoff_markup_save(uuid,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_takeoff_get(uuid),public.mcp_takeoff_calibrate(uuid,uuid,integer,jsonb,integer),public.mcp_takeoff_geometry_save(uuid,text,jsonb,integer),public.mcp_takeoff_markup_save(uuid,jsonb) TO authenticated;

-- Geometry topology is checked at the RPC boundary too, not only in TypeScript.
CREATE FUNCTION public.mcp_takeoff_cross(a jsonb,b jsonb,c jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$ SELECT ((b->>'x')::numeric-(a->>'x')::numeric)*((c->>'y')::numeric-(a->>'y')::numeric)-((b->>'y')::numeric-(a->>'y')::numeric)*((c->>'x')::numeric-(a->>'x')::numeric) $$;
CREATE FUNCTION public.mcp_takeoff_on(p jsonb,a jsonb,b jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$ SELECT abs(public.mcp_takeoff_cross(a,b,p))<1e-10 AND(p->>'x')::numeric BETWEEN least((a->>'x')::numeric,(b->>'x')::numeric) AND greatest((a->>'x')::numeric,(b->>'x')::numeric) AND(p->>'y')::numeric BETWEEN least((a->>'y')::numeric,(b->>'y')::numeric) AND greatest((a->>'y')::numeric,(b->>'y')::numeric) $$;
CREATE FUNCTION public.mcp_takeoff_intersects(a jsonb,b jsonb,c jsonb,d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$ SELECT (public.mcp_takeoff_cross(a,b,c)*public.mcp_takeoff_cross(a,b,d)<-1e-10 AND public.mcp_takeoff_cross(c,d,a)*public.mcp_takeoff_cross(c,d,b)<-1e-10) OR public.mcp_takeoff_on(c,a,b) OR public.mcp_takeoff_on(d,a,b) OR public.mcp_takeoff_on(a,c,d) OR public.mcp_takeoff_on(b,c,d) $$;
CREATE FUNCTION public.mcp_takeoff_inside(p jsonb,r jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE inside boolean:=false; i integer; j integer; a jsonb; b jsonb; n integer:=jsonb_array_length(r);
BEGIN
 FOR i IN 0..n-1 LOOP j:=(i+n-1)%n; a:=r->i; b:=r->j;
  IF public.mcp_takeoff_on(p,a,b) THEN RETURN false; END IF;
  IF ((a->>'y')::numeric>(p->>'y')::numeric)<>((b->>'y')::numeric>(p->>'y')::numeric) THEN
   IF (p->>'x')::numeric<((b->>'x')::numeric-(a->>'x')::numeric)*((p->>'y')::numeric-(a->>'y')::numeric)/((b->>'y')::numeric-(a->>'y')::numeric)+(a->>'x')::numeric THEN inside:=NOT inside; END IF;
  END IF;
 END LOOP; RETURN inside;
END $$;
CREATE FUNCTION public.mcp_takeoff_validate_ring(r jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE n integer; i integer; j integer;
BEGIN
 PERFORM public.mcp_takeoff_points(r,3); n:=jsonb_array_length(r);
 IF r->0=r->(n-1) THEN r:=r-(n-1); n:=n-1; END IF;
 IF n<3 THEN RAISE EXCEPTION 'MCP_BAD:Incomplete measured area.'; END IF;
 FOR i IN 0..n-1 LOOP
  IF r->i=r->((i+1)%n) THEN RAISE EXCEPTION 'MCP_BAD:Repeated area vertex.'; END IF;
  FOR j IN i+1..n-1 LOOP
   IF j=(i+1)%n OR(j+1)%n=i THEN CONTINUE; END IF;
   IF public.mcp_takeoff_intersects(r->i,r->((i+1)%n),r->j,r->((j+1)%n)) THEN RAISE EXCEPTION 'MCP_BAD:Area boundary crosses or touches itself.'; END IF;
  END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION public.mcp_takeoff_validate_area(s jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE outer_ring jsonb:=s->'points'; holes jsonb:=coalesce(s->'holes','[]'); h jsonb; prior jsonb; p jsonb; a jsonb; b jsonb; i integer; j integer; k integer;
BEGIN
 IF jsonb_typeof(holes) IS DISTINCT FROM 'array' OR jsonb_array_length(holes)>100 OR coalesce((SELECT sum(jsonb_array_length(value)) FROM jsonb_array_elements(holes)),0)+jsonb_array_length(outer_ring)>1000 THEN RAISE EXCEPTION 'MCP_BAD:Split this area into smaller measured boundaries.'; END IF;
 IF s->>'kind'='rect' THEN
  PERFORM public.mcp_takeoff_points(outer_ring,2); a:=outer_ring->0; b:=outer_ring->1;
  outer_ring:=jsonb_build_array(a,jsonb_build_object('x',b->'x','y',a->'y'),b,jsonb_build_object('x',a->'x','y',b->'y'));
 END IF;
 PERFORM public.mcp_takeoff_validate_ring(outer_ring);
 FOR k IN 0..jsonb_array_length(holes)-1 LOOP
  h:=holes->k; PERFORM public.mcp_takeoff_validate_ring(h);
  FOR p IN SELECT value FROM jsonb_array_elements(h) LOOP IF NOT public.mcp_takeoff_inside(p,outer_ring) THEN RAISE EXCEPTION 'MCP_BAD:An opening must be inside the measured area.'; END IF; END LOOP;
  FOR i IN 0..jsonb_array_length(h)-1 LOOP FOR j IN 0..jsonb_array_length(outer_ring)-1 LOOP
   IF public.mcp_takeoff_intersects(h->i,h->((i+1)%jsonb_array_length(h)),outer_ring->j,outer_ring->((j+1)%jsonb_array_length(outer_ring))) THEN RAISE EXCEPTION 'MCP_BAD:Opening crosses the area boundary.'; END IF;
  END LOOP; END LOOP;
  IF k>0 THEN FOR prior IN SELECT value FROM jsonb_array_elements(holes) WITH ORDINALITY AS q(value,n) WHERE n<=k LOOP
   IF public.mcp_takeoff_inside(h->0,prior) OR public.mcp_takeoff_inside(prior->0,h) THEN RAISE EXCEPTION 'MCP_BAD:Openings overlap.'; END IF;
   FOR i IN 0..jsonb_array_length(h)-1 LOOP FOR j IN 0..jsonb_array_length(prior)-1 LOOP
    IF public.mcp_takeoff_intersects(h->i,h->((i+1)%jsonb_array_length(h)),prior->j,prior->((j+1)%jsonb_array_length(prior))) THEN RAISE EXCEPTION 'MCP_BAD:Openings overlap.'; END IF;
   END LOOP; END LOOP;
  END LOOP; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_cross(jsonb,jsonb,jsonb),public.mcp_takeoff_on(jsonb,jsonb,jsonb),public.mcp_takeoff_intersects(jsonb,jsonb,jsonb,jsonb),public.mcp_takeoff_inside(jsonb,jsonb),public.mcp_takeoff_validate_ring(jsonb),public.mcp_takeoff_validate_area(jsonb) FROM public,anon,authenticated;

-- A tile's proposals and its checkpoint commit atomically. Retrying a completed
-- cursor returns the existing checkpoint instead of counting the same tile twice.
CREATE FUNCTION public.mcp_takeoff_pass_save(_job uuid,_record jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid uuid; previous public.mcp_takeoff_markups; saved jsonb; proposal jsonb; refs jsonb:='[]'; summary jsonb:=_record->'pass_summary'; cursor integer; pid uuid; current_version integer;
BEGIN
 cid:=public.mcp_estimate_guard(_job);
 IF _record IS NULL OR octet_length(_record::text)>400000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid drawing pass.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_job::text||':takeoff',0));
 pid:=(summary->>'pass_id')::uuid; cursor:=(summary->>'cursor')::integer;
 SELECT version INTO current_version FROM public.mcp_estimate_takeoffs WHERE job_id=_job ORDER BY version DESC LIMIT 1;
 IF pid IS NULL OR cursor IS NULL OR cursor<0 OR (summary->>'takeoff_version')::integer IS DISTINCT FROM current_version THEN RAISE EXCEPTION 'MCP_BAD:The takeoff changed or the pass reference is invalid.'; END IF;
 SELECT * INTO previous FROM public.mcp_takeoff_markups WHERE job_id=_job AND kind='pass' AND pass_summary->>'pass_id'=pid::text ORDER BY created_at DESC LIMIT 1;
 IF previous.id IS NOT NULL THEN
  IF previous.source_id<>(_record->>'source_id')::uuid OR previous.page<>(_record->>'page')::integer OR previous.pass_summary->>'line_no' IS DISTINCT FROM summary->>'line_no' OR previous.pass_summary->'order' IS DISTINCT FROM summary->'order' THEN RAISE EXCEPTION 'MCP_BAD:Continue the original line and sheet for this pass.'; END IF;
  IF cursor<(previous.pass_summary->>'next_cursor')::integer THEN RETURN to_jsonb(previous); END IF;
  IF cursor<>(previous.pass_summary->>'next_cursor')::integer THEN RAISE EXCEPTION 'MCP_BAD:Reload the latest pass checkpoint.'; END IF;
 ELSIF cursor<>0 THEN RAISE EXCEPTION 'MCP_BAD:Start the drawing read at its first tile.'; END IF;
 IF (summary->>'next_cursor')::integer NOT BETWEEN cursor AND cursor+1 OR (summary->>'next_cursor')::integer>jsonb_array_length(summary->'order') OR (summary->>'complete')::boolean IS DISTINCT FROM ((summary->>'next_cursor')::integer=jsonb_array_length(summary->'order')) THEN RAISE EXCEPTION 'MCP_BAD:Invalid drawing coverage checkpoint.'; END IF;
 FOR proposal IN SELECT value FROM jsonb_array_elements(coalesce(_record->'proposals','[]')) LOOP
  IF proposal->>'line_no' IS DISTINCT FROM summary->>'line_no' OR proposal->>'source_id' IS DISTINCT FROM _record->>'source_id' OR proposal->>'page' IS DISTINCT FROM _record->>'page' OR proposal->>'takeoff_version' IS DISTINCT FROM summary->>'takeoff_version' OR proposal->'evidence'->>'pass_id' IS DISTINCT FROM pid::text THEN RAISE EXCEPTION 'MCP_BAD:Proposal does not belong to this pass.'; END IF;
  saved:=public.mcp_takeoff_geometry_save(_job,'propose',proposal,0); refs:=refs||jsonb_build_array(saved->'id');
 END LOOP;
 RETURN public.mcp_takeoff_markup_save(_job,jsonb_build_object('kind','pass','source_id',_record->'source_id','page',_record->'page','geometry_revs',refs,'pass_summary',summary));
END $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_pass_save(uuid,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_takeoff_pass_save(uuid,jsonb) TO authenticated;

-- A legacy save creates a new line UUID even for unchanged lines. Carry an exact
-- unchanged line's current geometry forward without rewriting prior history.
CREATE FUNCTION public.mcp_takeoff_carry_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_line uuid; current_job uuid; previous_takeoff uuid; g record; checkpoint record; current_version integer; previous_version integer;
BEGIN
 SELECT job_id INTO current_job FROM public.mcp_estimate_takeoffs WHERE id=NEW.takeoff_id;
 SELECT version INTO current_version FROM public.mcp_estimate_takeoffs WHERE id=NEW.takeoff_id;
 SELECT id,version INTO previous_takeoff,previous_version FROM public.mcp_estimate_takeoffs WHERE job_id=current_job AND version<(SELECT version FROM public.mcp_estimate_takeoffs WHERE id=NEW.takeoff_id) ORDER BY version DESC LIMIT 1;
 SELECT l.id INTO old_line FROM public.mcp_estimate_takeoff_lines l WHERE l.takeoff_id=previous_takeoff AND l.line_no=NEW.line_no AND (to_jsonb(l)-ARRAY['id','takeoff_id','created_at'])=(to_jsonb(NEW)-ARRAY['id','takeoff_id','created_at']);
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
CREATE TRIGGER takeoff_carry_unchanged AFTER INSERT ON public.mcp_estimate_takeoff_lines FOR EACH ROW EXECUTE FUNCTION public.mcp_takeoff_carry_line();
REVOKE ALL ON FUNCTION public.mcp_takeoff_carry_line() FROM public,anon,authenticated;

-- One estimator confirmation covers an exact displayed list of revisions.
-- Every decision commits together; a conflict cannot leave a partly accepted sheet.
CREATE FUNCTION public.mcp_takeoff_accept_batch(_job uuid,_source uuid,_page integer,_decisions jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid uuid; decision jsonb; g public.mcp_takeoff_geometry; line_no integer; takeoff_version integer; saved jsonb; output jsonb:='[]';
BEGIN
 cid:=public.mcp_estimate_guard(_job);
 IF jsonb_typeof(_decisions) IS DISTINCT FROM 'array' OR jsonb_array_length(_decisions)<1 OR jsonb_array_length(_decisions)>200 OR _source IS NULL OR _page IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Choose up to 200 displayed proposals from one stored sheet.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_job::text||':takeoff',0));
 SELECT t.version INTO takeoff_version FROM public.mcp_estimate_takeoffs t WHERE t.job_id=_job ORDER BY t.version DESC LIMIT 1;
 FOR decision IN SELECT value FROM jsonb_array_elements(_decisions) LOOP
  SELECT * INTO g FROM public.mcp_takeoff_geometry WHERE job_id=_job AND geometry_id=(decision->>'geometry_id')::uuid ORDER BY mcp_takeoff_geometry.version DESC LIMIT 1;
  IF g.id IS NULL OR g.source_id<>_source OR g.page<>_page OR g.version IS DISTINCT FROM (decision->>'expected_version')::integer OR g.status<>'proposed' OR coalesce((g.evidence->>'confidence')::numeric,0) NOT BETWEEN .8 AND 1 OR g.evidence->>'verification' IS DISTINCT FROM 'raster-ink-and-topology' THEN RAISE EXCEPTION 'MCP_BAD:The displayed proposals changed or have not passed verification. Reload before accepting.'; END IF;
  SELECT l.line_no INTO line_no FROM public.mcp_estimate_takeoff_lines l JOIN public.mcp_estimate_takeoffs t ON t.id=l.takeoff_id WHERE l.id=g.line_id AND t.job_id=_job AND t.version=takeoff_version;
  IF line_no IS NULL THEN RAISE EXCEPTION 'MCP_BAD:The takeoff changed. Reload before accepting.'; END IF;
  saved:=public.mcp_takeoff_geometry_save(_job,'accept',jsonb_build_object('geometry_id',g.geometry_id,'line_no',line_no,'takeoff_version',takeoff_version),g.version);output:=output||jsonb_build_array(saved);
 END LOOP;
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_accept_batch(uuid,uuid,integer,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_takeoff_accept_batch(uuid,uuid,integer,jsonb) TO authenticated;

CREATE FUNCTION public.mcp_takeoff_history(_job uuid,_geometry uuid DEFAULT NULL,_line integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.mcp_estimate_guard(_job);
 IF _geometry IS NULL AND _line IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Choose a geometry reference or takeoff line for history.'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(history)) FROM (SELECT g.*,l.line_no,l.item FROM public.mcp_takeoff_geometry g JOIN public.mcp_estimate_takeoff_lines l ON l.id=g.line_id WHERE g.job_id=_job AND (_geometry IS NULL OR g.geometry_id=_geometry) AND (_line IS NULL OR l.line_no=_line) ORDER BY g.created_at DESC,g.version DESC LIMIT 200) history),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_history(uuid,uuid,integer) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_takeoff_history(uuid,uuid,integer) TO authenticated;

CREATE FUNCTION public.mcp_takeoff_canonical_points(_points jsonb,_ring boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE normalized jsonb; forward jsonb:='[]'; backward jsonb:='[]'; start integer:=0; n integer; i integer; best text;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('x',round((value->>'x')::numeric,8),'y',round((value->>'y')::numeric,8)) ORDER BY ord) INTO normalized FROM jsonb_array_elements(_points) WITH ORDINALITY q(value,ord);
 n:=jsonb_array_length(normalized);IF _ring AND normalized->0=normalized->(n-1) THEN normalized:=normalized-(n-1);n:=n-1;END IF;
 IF _ring THEN FOR i IN 0..n-1 LOOP IF best IS NULL OR (normalized->i)::text<best THEN best:=(normalized->i)::text;start:=i;END IF;END LOOP; END IF;
 FOR i IN 0..n-1 LOOP
  forward:=forward||jsonb_build_array(normalized->((start+i)%n));
  backward:=backward||jsonb_build_array(normalized->CASE WHEN _ring THEN (start-i+n)%n ELSE n-i-1 END);
 END LOOP;
 RETURN CASE WHEN forward::text<backward::text THEN forward ELSE backward END;
END $$;
CREATE FUNCTION public.mcp_takeoff_signature(_shape jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE points jsonb:=_shape->'points'; holes jsonb; a jsonb; b jsonb;
BEGIN
 IF coalesce(_shape->>'kind','') NOT IN('pins','polyline','polygon','rect') OR jsonb_typeof(points) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 IF _shape->>'kind'='pins' THEN
  SELECT jsonb_agg(p ORDER BY p::text) INTO points FROM (SELECT jsonb_build_object('x',round((value->>'x')::numeric,8),'y',round((value->>'y')::numeric,8)) p FROM jsonb_array_elements(points)) q;
 ELSE
  IF _shape->>'kind'='rect' THEN a:=points->0;b:=points->1;points:=jsonb_build_array(a,jsonb_build_object('x',b->'x','y',a->'y'),b,jsonb_build_object('x',a->'x','y',b->'y')); END IF;
  points:=public.mcp_takeoff_canonical_points(points,_shape->>'kind'<>'polyline');
 END IF;
 SELECT coalesce(jsonb_agg(h ORDER BY h::text),'[]') INTO holes FROM (SELECT public.mcp_takeoff_canonical_points(value,true) h FROM jsonb_array_elements(coalesce(_shape->'holes','[]'))) q;
 RETURN jsonb_build_object('kind',CASE WHEN _shape->>'kind'='rect' THEN 'polygon' ELSE _shape->>'kind' END,'points',points,'holes',holes);
END $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_canonical_points(jsonb,boolean),public.mcp_takeoff_signature(jsonb) FROM public,anon,authenticated;

-- The legacy line version and every located proposal share one transaction.
-- A stale line, source, calibration or failed geometry rolls the whole save back.
CREATE FUNCTION public.mcp_takeoff_write(_job uuid,_revision text,_scales jsonb,_lines jsonb,_geometries jsonb,_expected integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_version integer; next_version integer; g jsonb;
BEGIN
 PERFORM public.mcp_estimate_guard(_job);
 PERFORM pg_advisory_xact_lock(hashtextextended(_job::text||':takeoff',0));
 SELECT version INTO current_version FROM public.mcp_estimate_takeoffs WHERE job_id=_job ORDER BY version DESC LIMIT 1;
 IF coalesce(current_version,0) IS DISTINCT FROM coalesce(_expected,0) THEN RAISE EXCEPTION 'MCP_BAD:The takeoff changed. Reload before saving.'; END IF;
 IF jsonb_typeof(_geometries) IS DISTINCT FROM 'array' OR jsonb_array_length(_geometries)>20 THEN RAISE EXCEPTION 'MCP_BAD:Save up to 20 located lines at a time.'; END IF;
 PERFORM public.mcp_estimate_takeoff_save(_job,_revision,_scales,_lines);
 SELECT version INTO next_version FROM public.mcp_estimate_takeoffs WHERE job_id=_job ORDER BY version DESC LIMIT 1;
 FOR g IN SELECT value FROM jsonb_array_elements(_geometries) LOOP
  PERFORM public.mcp_takeoff_geometry_save(_job,'save',g||jsonb_build_object('takeoff_version',next_version),0);
 END LOOP;
 RETURN public.mcp_takeoff_get(_job);
END $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_write(uuid,text,jsonb,jsonb,jsonb,integer) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_takeoff_write(uuid,text,jsonb,jsonb,jsonb,integer) TO authenticated;

CREATE FUNCTION public.mcp_takeoff_exports(_job uuid,_id uuid DEFAULT NULL,_source uuid DEFAULT NULL,_page integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.mcp_estimate_guard(_job);
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM (SELECT m.*,s.filename AS source_filename,s.sheets->>(m.page-1) AS sheet FROM public.mcp_takeoff_markups m JOIN public.mcp_drawing_versions s ON s.id=m.source_id AND s.job_id=_job WHERE m.job_id=_job AND m.kind='export' AND (_id IS NULL OR m.id=_id) AND (_source IS NULL OR m.source_id=_source) AND (_page IS NULL OR m.page=_page) ORDER BY m.created_at DESC LIMIT 100) e),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.mcp_takeoff_exports(uuid,uuid,uuid,integer) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_takeoff_exports(uuid,uuid,uuid,integer) TO authenticated;
