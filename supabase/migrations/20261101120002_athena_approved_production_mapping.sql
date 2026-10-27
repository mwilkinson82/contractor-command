-- Approved mapping, daily revision snapshots, and quantity/rate reporting.
-- Apply via the managed migration flow after the billing migration.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.mcp_production_mapping_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL,
 version integer NOT NULL CHECK(version > 0), currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'), cpm_report_id uuid NOT NULL REFERENCES public.mcp_living_reports(id), cpm_version integer NOT NULL,
 effective_date date NOT NULL, source_snapshot jsonb NOT NULL, reason text NOT NULL, approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
 request_key uuid NOT NULL, request_payload jsonb NOT NULL, UNIQUE(job_id,version), UNIQUE(job_id,request_key), UNIQUE(id,job_id)
);
CREATE TABLE public.mcp_production_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mapping_id uuid NOT NULL, job_id uuid NOT NULL, company_id uuid NOT NULL,
 sov_fact_id uuid NOT NULL, sov_item text NOT NULL, activity_id text NOT NULL, allocated_cents bigint NOT NULL,
 planned_quantity numeric CHECK(planned_quantity > 0), unit text, planned_man_hours numeric CHECK(planned_man_hours > 0), planned_source text,
 FOREIGN KEY(mapping_id,job_id) REFERENCES public.mcp_production_mapping_versions(id,job_id),
 UNIQUE(mapping_id,sov_fact_id,activity_id), UNIQUE(id,job_id)
);
ALTER TABLE public.mcp_production_mapping_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_production_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "production mapping full read" ON public.mcp_production_mapping_versions FOR SELECT TO authenticated USING (public.mcp_gate() AND coalesce(public.mcp_job_scope(job_id) = 'full',false));
CREATE POLICY "production allocation full read" ON public.mcp_production_allocations FOR SELECT TO authenticated USING (public.mcp_gate() AND coalesce(public.mcp_job_scope(job_id) = 'full',false));
REVOKE ALL ON public.mcp_production_mapping_versions, public.mcp_production_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mcp_production_mapping_versions, public.mcp_production_allocations TO authenticated;
GRANT ALL ON public.mcp_production_mapping_versions, public.mcp_production_allocations TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_production_mapping_preview(_job uuid, _cpm uuid, _base_version integer, _effective date, _reason text, _allocations jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE report public.mcp_living_reports; current_version integer; x jsonb; f public.mcp_job_facts; amount numeric; v numeric; seen text[] := '{}'; pair text; ids uuid[] := '{}'; snapshot jsonb; totals record;
BEGIN
 PERFORM public.mcp_assert_active();
 IF auth.uid() IS NULL OR coalesce(public.mcp_job_scope(_job)='full',false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Full project access is required.'; END IF;
 SELECT coalesce(max(version),0) INTO current_version FROM public.mcp_production_mapping_versions WHERE job_id=_job;
 IF _base_version IS DISTINCT FROM current_version OR _effective IS NULL OR nullif(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Reload the mapping and provide its effective date and reason.'; END IF;
 SELECT * INTO report FROM public.mcp_living_reports WHERE id=_cpm AND job_id=_job AND report_type='cpm' AND status='approved';
 IF report.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A saved CPM version for this project is required.'; END IF;
 IF jsonb_typeof(_allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(_allocations) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'MCP_BAD:Provide allocations to review.'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(_allocations) LOOP
   SELECT * INTO f FROM public.mcp_job_facts WHERE id=(x->>'sov_fact_id')::uuid AND job_id=_job AND module='sov' AND status='known';
   IF f.id IS NULL OR jsonb_typeof(f.value->'billable_value') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Each SOV source must be a valued line from this project.'; END IF;
   v := (f.value->>'billable_value')::numeric * 100;
   IF v <> trunc(v) OR abs(v) > 9223372036854775807 THEN RAISE EXCEPTION 'MCP_BAD:The SOV amount is unsupported or not in cents.'; END IF;
   IF v < 0 AND (f.value->'fee_included' IS DISTINCT FROM 'true'::jsonb OR NOT EXISTS (
     SELECT 1 FROM public.mcp_change_orders c WHERE c.job_id=_job AND c.submittal_id::text=f.value->>'executed_change_order'
       AND c.details->>'state'='executed' AND c.details->'execution'->>'sov_item'=f.key
       AND jsonb_typeof(c.details->'total_cents')='number' AND (c.details->>'total_cents')::numeric=v
   )) THEN RAISE EXCEPTION 'MCP_BAD:A negative SOV line needs a matching executed credit change source.'; END IF;
   IF (SELECT count(*) FROM jsonb_array_elements(coalesce(report.data->'activities','[]'::jsonb)) a WHERE a->>'id'=x->>'activity_id') <> 1 THEN RAISE EXCEPTION 'MCP_BAD:Each activity must occur exactly once in the saved CPM.'; END IF;
   pair := f.id::text || ':' || coalesce(x->>'activity_id','');
   IF pair=ANY(seen) THEN RAISE EXCEPTION 'MCP_BAD:An SOV/activity pair is duplicated.'; END IF;
   seen := array_append(seen,pair); ids := array_append(ids,f.id);
   IF jsonb_typeof(x->'allocated_cents') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Allocated cents are required.'; END IF;
   amount := (x->>'allocated_cents')::numeric;
   IF amount <> trunc(amount) OR abs(amount) > 9223372036854775807 OR (v > 0 AND amount < 0) OR (v < 0 AND amount > 0) OR (v = 0 AND amount <> 0) THEN RAISE EXCEPTION 'MCP_BAD:Allocated cents must have the SOV line''s sign and be whole cents.'; END IF;
   IF x->>'planned_quantity' IS NOT NULL AND (jsonb_typeof(x->'planned_quantity') IS DISTINCT FROM 'number' OR (x->>'planned_quantity')::numeric <= 0 OR (x->>'planned_quantity')::numeric > 1000000000000) THEN RAISE EXCEPTION 'MCP_BAD:Planned quantity must be positive.'; END IF;
   IF x->>'planned_man_hours' IS NOT NULL AND (jsonb_typeof(x->'planned_man_hours') IS DISTINCT FROM 'number' OR (x->>'planned_man_hours')::numeric <= 0 OR (x->>'planned_man_hours')::numeric > 1000000000000) THEN RAISE EXCEPTION 'MCP_BAD:Planned man-hours must be positive.'; END IF;
   IF (x->>'planned_quantity' IS NOT NULL OR x->>'planned_man_hours' IS NOT NULL) AND (nullif(btrim(x->>'unit'),'') IS NULL OR nullif(btrim(x->>'planned_source'),'') IS NULL OR length(btrim(x->>'unit'))>20 OR length(btrim(x->>'planned_source'))>1000) THEN RAISE EXCEPTION 'MCP_BAD:Planned inputs require a unit and source.'; END IF;
 END LOOP;
 -- A new version is a complete successor for already mapped SOV lines, so an
 -- unrelated revision cannot silently remove previously approved references.
 IF current_version > 0 AND EXISTS (
   SELECT 1 FROM public.mcp_production_allocations a JOIN public.mcp_production_mapping_versions m ON m.id=a.mapping_id AND m.job_id=a.job_id
   WHERE m.job_id=_job AND m.version=current_version AND NOT (a.sov_fact_id=ANY(ids))
 ) THEN RAISE EXCEPTION 'MCP_BAD:Keep each previously mapped SOV line in the new version.'; END IF;
 FOR totals IN SELECT (a->>'sov_fact_id')::uuid id, sum((a->>'allocated_cents')::numeric) amount FROM jsonb_array_elements(_allocations) a GROUP BY 1 LOOP
   SELECT * INTO f FROM public.mcp_job_facts WHERE id=totals.id;
   IF totals.amount <> (f.value->>'billable_value')::numeric * 100 THEN RAISE EXCEPTION 'MCP_BAD:Allocations must reconcile to each included SOV line.'; END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('fact_id',sf.id,'item',sf.key,'value',sf.value,'status',sf.status,'source',sf.source,'updated_at',sf.updated_at,
   'executed_change',(SELECT jsonb_build_object('id',c.submittal_id,'details',c.details,'updated_at',c.updated_at) FROM public.mcp_change_orders c WHERE c.job_id=_job AND c.submittal_id::text=sf.value->>'executed_change_order')) ORDER BY sf.id)
 INTO snapshot FROM public.mcp_job_facts sf WHERE sf.id=ANY(ids) AND sf.job_id=_job AND sf.module='sov';
 RETURN jsonb_build_object('currency','USD','cpm_id',report.id,'cpm_version',report.version,'base_version',_base_version,'effective_date',_effective,'reason',btrim(_reason),'sov',snapshot,'allocations',_allocations);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_production_mapping_preview(uuid,uuid,integer,date,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_production_mapping_preview(uuid,uuid,integer,date,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_production_mapping_approve(_job uuid, _cpm uuid, _base_version integer, _effective date, _reason text, _request_key uuid, _preview jsonb, _allocations jsonb, _confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid uuid; ver integer; prior public.mcp_production_mapping_versions; snap jsonb; payload jsonb; mid uuid; x jsonb; fid uuid; item text;
BEGIN
 PERFORM public.mcp_assert_active();
 IF auth.uid() IS NULL OR coalesce(public.mcp_job_scope(_job)='full',false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Full project access is required.'; END IF;
 IF _confirmed IS NOT TRUE OR _request_key IS NULL OR _effective IS NULL OR nullif(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Approval, effective date, reason and request key are required.'; END IF;
 payload:=jsonb_build_object('cpm',_cpm,'base',_base_version,'effective',_effective,'reason',btrim(_reason),'preview',_preview,'allocations',_allocations);
 PERFORM pg_advisory_xact_lock(hashtext(_job::text||':production_mapping'));
 SELECT * INTO prior FROM public.mcp_production_mapping_versions WHERE job_id=_job AND request_key=_request_key;
 IF prior.id IS NOT NULL THEN
   IF prior.request_payload <> payload THEN RAISE EXCEPTION 'MCP_BAD:Request key already used for different mapping.'; END IF;
   RETURN jsonb_build_object('id',prior.id,'version',prior.version,'replayed',true,'is_current',prior.version=(SELECT max(version) FROM public.mcp_production_mapping_versions WHERE job_id=_job));
 END IF;
 SELECT coalesce(max(version),0) INTO ver FROM public.mcp_production_mapping_versions WHERE job_id=_job;
 IF _base_version IS DISTINCT FROM ver THEN RAISE EXCEPTION 'MCP_BAD:Mapping changed. Reload before approval.'; END IF;
 -- Lock source facts before rechecking the reviewed preview.
 PERFORM 1 FROM public.mcp_job_facts WHERE job_id=_job AND id IN (SELECT (a->>'sov_fact_id')::uuid FROM jsonb_array_elements(_allocations) a) ORDER BY id FOR SHARE;
 PERFORM c.submittal_id FROM public.mcp_change_orders c JOIN public.mcp_job_facts sf ON sf.job_id=c.job_id AND sf.value->>'executed_change_order'=c.submittal_id::text WHERE sf.job_id=_job AND sf.id IN (SELECT (a->>'sov_fact_id')::uuid FROM jsonb_array_elements(_allocations) a) ORDER BY c.submittal_id FOR SHARE OF c;
 snap:=public.mcp_production_mapping_preview(_job,_cpm,_base_version,_effective,_reason,_allocations);
 IF snap IS DISTINCT FROM _preview THEN RAISE EXCEPTION 'MCP_BAD:Source or allocations changed after review. Review again.'; END IF;
 SELECT company_id INTO cid FROM public.mcp_jobs WHERE id=_job;
 INSERT INTO public.mcp_production_mapping_versions(job_id,company_id,version,cpm_report_id,cpm_version,effective_date,source_snapshot,reason,approved_by,request_key,request_payload)
 VALUES(_job,cid,ver+1,_cpm,(snap->>'cpm_version')::integer,_effective,snap->'sov',btrim(_reason),auth.uid(),_request_key,payload) RETURNING id INTO mid;
 FOR x IN SELECT value FROM jsonb_array_elements(_allocations) LOOP
   fid:=(x->>'sov_fact_id')::uuid; SELECT key INTO item FROM public.mcp_job_facts WHERE id=fid AND job_id=_job;
   INSERT INTO public.mcp_production_allocations(mapping_id,job_id,company_id,sov_fact_id,sov_item,activity_id,allocated_cents,planned_quantity,unit,planned_man_hours,planned_source)
   VALUES(mid,_job,cid,fid,item,x->>'activity_id',(x->>'allocated_cents')::bigint,nullif(x->>'planned_quantity','')::numeric,nullif(btrim(x->>'unit'),''),nullif(x->>'planned_man_hours','')::numeric,nullif(btrim(x->>'planned_source'),''));
 END LOOP;
 RETURN jsonb_build_object('id',mid,'version',ver+1,'replayed',false,'is_current',true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_production_mapping_approve(uuid,uuid,integer,date,text,uuid,jsonb,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_production_mapping_approve(uuid,uuid,integer,date,text,uuid,jsonb,jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_production_mapping_sources(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE report public.mcp_living_reports; sov jsonb; ver integer;
BEGIN
 PERFORM public.mcp_assert_active();
 IF auth.uid() IS NULL OR coalesce(public.mcp_job_scope(_job)='full',false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Full project access is required.'; END IF;
 SELECT * INTO report FROM public.mcp_living_reports WHERE job_id=_job AND report_type='cpm' AND status='approved' ORDER BY version DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(jsonb_build_object('fact_id',id,'item',key,'value',value,'status',status,'source',source,'updated_at',updated_at) ORDER BY key),'[]'::jsonb) INTO sov FROM public.mcp_job_facts WHERE job_id=_job AND module='sov';
 SELECT coalesce(max(version),0) INTO ver FROM public.mcp_production_mapping_versions WHERE job_id=_job;
 RETURN jsonb_build_object('currency','USD','cpm_id',report.id,'cpm_version',report.version,'activities',coalesce(report.data->'activities','[]'::jsonb),'sov',sov,'mapping_version',ver);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_production_mapping_sources(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_production_mapping_sources(uuid) TO authenticated;

ALTER TABLE public.mcp_daily_work_lines ADD COLUMN production_allocation_id uuid;
ALTER TABLE public.mcp_daily_work_lines ADD COLUMN is_current boolean NOT NULL DEFAULT true;
ALTER TABLE public.mcp_production_rates ADD COLUMN work_line_id uuid;
ALTER TABLE public.mcp_production_rates ADD COLUMN is_current boolean NOT NULL DEFAULT true;
ALTER TABLE public.mcp_daily_work_lines DROP CONSTRAINT IF EXISTS mcp_daily_work_lines_daily_id_line_no_key;
CREATE UNIQUE INDEX mcp_daily_current_line_no ON public.mcp_daily_work_lines(daily_id,line_no) WHERE is_current;
CREATE INDEX mcp_daily_current_job_idx ON public.mcp_daily_work_lines(job_id) WHERE is_current;
CREATE INDEX mcp_rates_current_job_idx ON public.mcp_production_rates(job_id,created_at DESC) WHERE is_current;
DROP POLICY IF EXISTS "daily line read" ON public.mcp_daily_work_lines;
CREATE POLICY "daily line read" ON public.mcp_daily_work_lines FOR SELECT TO authenticated USING(is_current AND coalesce(public.mcp_job_scope(job_id) IN ('full','super'),false));
DROP POLICY IF EXISTS "production rate read" ON public.mcp_production_rates;
CREATE POLICY "production rate read" ON public.mcp_production_rates FOR SELECT TO authenticated USING(is_current AND coalesce(public.mcp_job_scope(job_id) IN ('full','super','contract'),false));
ALTER TABLE public.mcp_daily_work_lines ADD CONSTRAINT mcp_daily_work_line_id_job_unique UNIQUE(id,job_id);
ALTER TABLE public.mcp_daily_work_lines ADD CONSTRAINT mcp_daily_work_allocation_fk FOREIGN KEY(production_allocation_id,job_id) REFERENCES public.mcp_production_allocations(id,job_id);
ALTER TABLE public.mcp_production_rates ADD CONSTRAINT mcp_production_rate_work_fk FOREIGN KEY(work_line_id,job_id) REFERENCES public.mcp_daily_work_lines(id,job_id);
CREATE UNIQUE INDEX mcp_production_rate_work_unique ON public.mcp_production_rates(work_line_id) WHERE work_line_id IS NOT NULL;
CREATE TABLE public.mcp_daily_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), daily_id uuid NOT NULL REFERENCES public.mcp_daily_reports(id), job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>=0), report_date date NOT NULL, origin text NOT NULL CHECK(origin IN ('legacy_snapshot','legacy_compat','legacy','approved','void')), snapshot jsonb NOT NULL, payload jsonb, reason text, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(daily_id,revision), UNIQUE(id,job_id)
);
CREATE TABLE public.mcp_daily_revision_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision_id uuid NOT NULL, job_id uuid NOT NULL, company_id uuid NOT NULL, line_no integer NOT NULL,
 original_work_line_id uuid NOT NULL, allocation_id uuid, snapshot jsonb NOT NULL,
 FOREIGN KEY(revision_id,job_id) REFERENCES public.mcp_daily_revisions(id,job_id), FOREIGN KEY(original_work_line_id,job_id) REFERENCES public.mcp_daily_work_lines(id,job_id), FOREIGN KEY(allocation_id,job_id) REFERENCES public.mcp_production_allocations(id,job_id), UNIQUE(revision_id,line_no), UNIQUE(id,job_id)
);
CREATE TABLE public.mcp_daily_save_requests (
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), request_key uuid NOT NULL, payload jsonb NOT NULL, revision_id uuid NOT NULL REFERENCES public.mcp_daily_revisions(id),
 recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,request_key)
);
CREATE TABLE public.mcp_production_photo_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL, photo_id uuid NOT NULL REFERENCES public.mcp_progress_photos(id),
 revision_line_id uuid NOT NULL, request_key uuid NOT NULL, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(revision_line_id,job_id) REFERENCES public.mcp_daily_revision_lines(id,job_id), UNIQUE(job_id,request_key), UNIQUE(photo_id,revision_line_id)
);
CREATE TABLE public.mcp_production_photo_requests (
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), request_key uuid NOT NULL, photo_id uuid NOT NULL, revision_line_id uuid NOT NULL,
 link_id uuid NOT NULL REFERENCES public.mcp_production_photo_links(id), PRIMARY KEY(job_id,request_key)
);
ALTER TABLE public.mcp_production_photo_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_daily_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_daily_revision_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_daily_save_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_production_photo_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily revision read" ON public.mcp_daily_revisions FOR SELECT TO authenticated USING(public.mcp_gate() AND coalesce(public.mcp_job_scope(job_id) IN ('full','super'),false));
CREATE POLICY "daily revision line read" ON public.mcp_daily_revision_lines FOR SELECT TO authenticated USING(public.mcp_gate() AND coalesce(public.mcp_job_scope(job_id) IN ('full','super'),false));
CREATE POLICY "production photo association read" ON public.mcp_production_photo_links FOR SELECT TO authenticated USING(public.mcp_gate() AND coalesce(public.mcp_job_scope(job_id) IN ('full','super'),false));
REVOKE ALL ON public.mcp_daily_revisions, public.mcp_daily_revision_lines, public.mcp_daily_save_requests, public.mcp_production_photo_links, public.mcp_production_photo_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.mcp_daily_revisions, public.mcp_daily_revision_lines, public.mcp_production_photo_links TO authenticated;
GRANT ALL ON public.mcp_daily_revisions, public.mcp_daily_revision_lines, public.mcp_daily_save_requests, public.mcp_production_photo_links, public.mcp_production_photo_requests TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_daily_report_save_v2(_job uuid,_date date,_confirmed boolean,_weather text,_manpower text,_subs text,_deliveries text,_issues text,_delays text,_safety text,_transcript text,_lines jsonb,_expected_revision integer,_request_key uuid,_reason text,_mode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid uuid; did uuid; rid uuid; rev integer; req public.mcp_daily_save_requests; prior public.mcp_daily_revisions; payload jsonb; request_payload jsonb; snap jsonb; ln jsonb; a public.mcp_production_allocations; m public.mcp_production_mapping_versions;
 i integer:=0; wid uuid; sov text; act text; work text; qty numeric; unit text; crew numeric; hours numeric; pct numeric; affected text[]; activity text; latest record;
BEGIN
 cid:=public.mcp_field_guard(_job);
 IF auth.uid() IS NULL OR _confirmed IS NOT TRUE OR _request_key IS NULL OR _date IS NULL OR _expected_revision IS NULL OR _expected_revision<0 THEN RAISE EXCEPTION 'MCP_BAD:Confirmation, date, request key and expected revision are required.'; END IF;
 IF _mode NOT IN ('approved','legacy','legacy_compat','void') OR _mode IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Choose an approved, unlinked or void work action.'; END IF;
 IF _mode <> 'void' AND (nullif(btrim(_weather),'') IS NULL OR nullif(btrim(_manpower),'') IS NULL OR nullif(btrim(_subs),'') IS NULL OR nullif(btrim(_deliveries),'') IS NULL OR nullif(btrim(_issues),'') IS NULL OR nullif(btrim(_delays),'') IS NULL OR nullif(btrim(_safety),'') IS NULL) THEN RAISE EXCEPTION 'MCP_BAD:The daily is missing a section.'; END IF;
 IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' OR (_mode='void' AND jsonb_array_length(_lines)<>0) OR (_mode<>'void' AND jsonb_array_length(_lines) NOT BETWEEN 1 AND 80) THEN RAISE EXCEPTION 'MCP_BAD:The daily needs work lines.'; END IF;
 payload:=CASE WHEN _mode='void' THEN jsonb_build_object('date',_date,'mode','void') ELSE jsonb_build_object('mode',CASE WHEN _mode='legacy_compat' THEN 'legacy' ELSE _mode END,'date',_date,'weather',btrim(_weather),'manpower',btrim(_manpower),'subs',btrim(_subs),'deliveries',btrim(_deliveries),'issues',btrim(_issues),'delays',btrim(_delays),'safety',btrim(_safety),'transcript',nullif(btrim(_transcript),''),'lines',_lines) END;
 request_payload:=jsonb_build_object('content',payload,'expected_revision',_expected_revision,'reason',nullif(btrim(_reason),''),'client_mode',_mode);
 PERFORM pg_advisory_xact_lock(hashtext(_job::text||':daily-request:'||_request_key::text));
 PERFORM pg_advisory_xact_lock(hashtext(_job::text||':daily-project'));
 SELECT * INTO req FROM public.mcp_daily_save_requests WHERE job_id=_job AND request_key=_request_key;
 IF req.request_key IS NOT NULL THEN
   IF req.payload IS DISTINCT FROM request_payload THEN RAISE EXCEPTION 'MCP_BAD:Request key already used for a different daily.'; END IF;
   SELECT * INTO prior FROM public.mcp_daily_revisions WHERE id=req.revision_id;
   RETURN jsonb_build_object('id',prior.daily_id,'revision',prior.revision,'revision_id',prior.id,'lines',jsonb_array_length(prior.snapshot->'lines'),'replayed',true,'is_current',prior.revision=(SELECT max(revision) FROM public.mcp_daily_revisions WHERE daily_id=prior.daily_id));
 END IF;
 SELECT id INTO did FROM public.mcp_daily_reports WHERE job_id=_job AND report_date=_date FOR UPDATE;
 IF did IS NOT NULL THEN SELECT * INTO prior FROM public.mcp_daily_revisions WHERE daily_id=did ORDER BY revision DESC LIMIT 1; END IF;
 rev:=coalesce(prior.revision,0);
 IF _expected_revision<>rev THEN RAISE EXCEPTION 'MCP_BAD:The daily changed. Reload before saving.'; END IF;
 IF prior.id IS NOT NULL AND prior.payload=payload THEN
   INSERT INTO public.mcp_daily_save_requests VALUES(_job,_request_key,request_payload,prior.id,auth.uid(),now());
   RETURN jsonb_build_object('id',did,'revision',rev,'revision_id',prior.id,'lines',jsonb_array_length(_lines),'replayed',true,'is_current',true);
 END IF;
 IF _mode='void' AND did IS NULL THEN RAISE EXCEPTION 'MCP_BAD:No saved daily exists for that date.'; END IF;
 IF _mode IN ('legacy','legacy_compat') AND did IS NOT NULL AND EXISTS(SELECT 1 FROM public.mcp_daily_work_lines WHERE daily_id=did AND is_current AND production_allocation_id IS NOT NULL) THEN RAISE EXCEPTION 'MCP_BAD:This daily has approved work references. Review it in the updated workflow before changing it.'; END IF;
 IF _mode='legacy_compat' AND prior.origin='void' THEN RAISE EXCEPTION 'MCP_BAD:This work was voided. Use the updated workflow to restore it.'; END IF;
 IF (did IS NOT NULL OR _mode='void') AND _mode<>'legacy_compat' AND nullif(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A correction or void reason is required.'; END IF;
 -- Validate all work before changing the current projection.
 FOR ln IN SELECT value FROM jsonb_array_elements(_lines) LOOP
   sov:=btrim(coalesce(ln->>'sov_item','')); act:=btrim(coalesce(ln->>'activity_id',''));
   IF sov !~ '^\d{2}\.\d{2,3}$' OR act='' OR length(act)>20 THEN RAISE EXCEPTION 'MCP_BAD:Each work line needs its SOV item and activity.'; END IF;
   a:=NULL; m:=NULL;
   IF _mode='approved' THEN
     SELECT * INTO a FROM public.mcp_production_allocations WHERE id=(ln->>'allocation_id')::uuid AND job_id=_job;
     SELECT * INTO m FROM public.mcp_production_mapping_versions WHERE id=a.mapping_id AND job_id=_job;
     IF a.id IS NULL OR m.id IS NULL OR m.effective_date>_date OR a.sov_item IS DISTINCT FROM sov OR a.activity_id IS DISTINCT FROM act THEN RAISE EXCEPTION 'MCP_BAD:Each work line needs a matching approved mapping for this project and date.'; END IF;
   ELSIF nullif(ln->>'allocation_id','') IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:Unlinked work cannot carry an allocation.';
   END IF;
   IF _mode<>'legacy_compat' AND (jsonb_typeof(ln->'qty') IS DISTINCT FROM 'number' OR jsonb_typeof(ln->'crew') IS DISTINCT FROM 'number' OR jsonb_typeof(ln->'hours') IS DISTINCT FROM 'number' OR (ln->'pct_complete' IS NOT NULL AND ln->'pct_complete' <> 'null'::jsonb AND jsonb_typeof(ln->'pct_complete') IS DISTINCT FROM 'number')) THEN RAISE EXCEPTION 'MCP_BAD:Quantities and hours must be numeric.'; END IF;
   work:=btrim(coalesce(ln->>'work','')); unit:=btrim(coalesce(ln->>'unit','')); qty:=nullif(ln->>'qty','')::numeric; crew:=nullif(ln->>'crew','')::numeric; hours:=nullif(ln->>'hours','')::numeric; pct:=nullif(ln->>'pct_complete','')::numeric;
   IF work='' OR length(work)>400 OR unit='' OR length(unit)>20 OR qty IS NULL OR qty<=0 OR qty>1000000000000 OR crew IS NULL OR crew<=0 OR crew>1000000 OR hours IS NULL OR hours<=0 OR hours>1000000 OR (pct IS NOT NULL AND (pct<0 OR pct>100)) OR (a.unit IS NOT NULL AND a.unit<>unit) THEN RAISE EXCEPTION 'MCP_BAD:Invalid quantity, unit, crew, hours or percent.'; END IF;
 END LOOP;
 IF did IS NOT NULL AND prior.id IS NULL THEN
   SELECT jsonb_build_object('report',to_jsonb(d),'lines',coalesce((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.line_no) FROM public.mcp_daily_work_lines w WHERE w.daily_id=d.id AND w.is_current),'[]'::jsonb),'rates',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.mcp_production_rates r WHERE r.daily_id=d.id AND r.is_current),'[]'::jsonb)) INTO snap FROM public.mcp_daily_reports d WHERE d.id=did;
   INSERT INTO public.mcp_daily_revisions(daily_id,job_id,company_id,revision,report_date,origin,snapshot,reason,recorded_by) VALUES(did,_job,cid,0,_date,'legacy_snapshot',snap,NULL,auth.uid()) RETURNING id INTO rid;
   INSERT INTO public.mcp_daily_revision_lines(revision_id,job_id,company_id,line_no,original_work_line_id,allocation_id,snapshot) SELECT rid,_job,cid,w.line_no,w.id,NULL,to_jsonb(w) FROM public.mcp_daily_work_lines w WHERE w.daily_id=did AND w.is_current;
 END IF;
 SELECT array_agg(DISTINCT activity_id) INTO affected FROM public.mcp_daily_work_lines WHERE daily_id=did AND is_current;
 IF _mode='void' THEN UPDATE public.mcp_daily_reports SET updated_at=now() WHERE id=did; ELSE
 INSERT INTO public.mcp_daily_reports(job_id,company_id,report_date,weather,manpower,subs_on_site,deliveries,issues,delays,safety,transcript)
 VALUES(_job,cid,_date,btrim(_weather),btrim(_manpower),btrim(_subs),btrim(_deliveries),btrim(_issues),btrim(_delays),btrim(_safety),nullif(btrim(_transcript),''))
 ON CONFLICT(job_id,report_date) DO UPDATE SET weather=excluded.weather,manpower=excluded.manpower,subs_on_site=excluded.subs_on_site,deliveries=excluded.deliveries,issues=excluded.issues,delays=excluded.delays,safety=excluded.safety,transcript=excluded.transcript,updated_at=now() RETURNING id INTO did;
 END IF;
 UPDATE public.mcp_production_rates SET is_current=false WHERE daily_id=did AND is_current;
 UPDATE public.mcp_daily_work_lines SET is_current=false WHERE daily_id=did AND is_current;
 FOR ln IN SELECT value FROM jsonb_array_elements(_lines) LOOP
   i:=i+1; a:=NULL; IF _mode='approved' THEN SELECT * INTO a FROM public.mcp_production_allocations WHERE id=(ln->>'allocation_id')::uuid AND job_id=_job; END IF;
   sov:=btrim(ln->>'sov_item'); act:=btrim(ln->>'activity_id');
   work:=btrim(ln->>'work'); qty:=(ln->>'qty')::numeric; unit:=btrim(ln->>'unit'); crew:=(ln->>'crew')::numeric; hours:=(ln->>'hours')::numeric; pct:=nullif(ln->>'pct_complete','')::numeric;
   INSERT INTO public.mcp_daily_work_lines(daily_id,job_id,company_id,line_no,work,sov_item,activity_id,qty,unit,crew,hours,pct_complete,production_allocation_id)
   VALUES(did,_job,cid,i,work,sov,act,qty,unit,crew,hours,pct,a.id) RETURNING id INTO wid;
   INSERT INTO public.mcp_production_rates(job_id,company_id,daily_id,work,sov_item,activity_id,qty,unit,crew,hours,man_hours,qty_per_man_hour,work_line_id)
   VALUES(_job,cid,did,work,sov,act,qty,unit,crew,hours,crew*hours,qty/(crew*hours),wid);
   affected:=array_append(coalesce(affected,'{}'),act);
 END LOOP;
 -- Rebuild only affected feed entries, including when a correction removes the last percent.
 FOREACH activity IN ARRAY coalesce(affected,'{}') LOOP
   DELETE FROM public.mcp_field_schedule_feed WHERE job_id=_job AND activity_id=activity;
   SELECT w.pct_complete,d.report_date,d.id daily_id INTO latest FROM public.mcp_daily_work_lines w JOIN public.mcp_daily_reports d ON d.id=w.daily_id WHERE w.job_id=_job AND w.is_current AND w.activity_id=activity AND w.pct_complete IS NOT NULL ORDER BY d.report_date DESC,w.line_no DESC LIMIT 1;
   IF FOUND THEN INSERT INTO public.mcp_field_schedule_feed(job_id,company_id,activity_id,pct_complete,report_date,daily_id) VALUES(_job,cid,activity,latest.pct_complete,latest.report_date,latest.daily_id); END IF;
 END LOOP;
 SELECT jsonb_build_object('report',to_jsonb(d),'lines',coalesce((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.line_no) FROM public.mcp_daily_work_lines w WHERE w.daily_id=d.id AND w.is_current),'[]'::jsonb),'rates',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.mcp_production_rates r WHERE r.daily_id=d.id AND r.is_current),'[]'::jsonb)) INTO snap FROM public.mcp_daily_reports d WHERE d.id=did;
 INSERT INTO public.mcp_daily_revisions(daily_id,job_id,company_id,revision,report_date,origin,snapshot,payload,reason,recorded_by) VALUES(did,_job,cid,rev+1,_date,_mode,snap,payload,nullif(btrim(_reason),''),auth.uid()) RETURNING id INTO rid;
 INSERT INTO public.mcp_daily_revision_lines(revision_id,job_id,company_id,line_no,original_work_line_id,allocation_id,snapshot) SELECT rid,_job,cid,w.line_no,w.id,w.production_allocation_id,to_jsonb(w) FROM public.mcp_daily_work_lines w WHERE w.daily_id=did AND w.is_current;
 INSERT INTO public.mcp_daily_save_requests(job_id,request_key,payload,revision_id,recorded_by) VALUES(_job,_request_key,request_payload,rid,auth.uid());
 RETURN jsonb_build_object('id',did,'revision',rev+1,'revision_id',rid,'lines',i,'replayed',false,'is_current',true,'work_status',CASE WHEN _mode='void' THEN 'voided' WHEN _mode='approved' THEN 'approved' ELSE 'unlinked' END);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_daily_report_save_v2(uuid,date,boolean,text,text,text,text,text,text,text,text,jsonb,integer,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_daily_report_save_v2(uuid,date,boolean,text,text,text,text,text,text,text,text,jsonb,integer,uuid,text,text) TO authenticated;

-- Legacy authorized clients can continue saving unlinked dailies. Their resaves
-- are serialized and snapshotted; they cannot overwrite mapped or voided work.
CREATE OR REPLACE FUNCTION public.mcp_daily_report_save(_job uuid,_date date,_confirmed boolean,_weather text,_manpower text,_subs text,_deliveries text,_issues text,_delays text,_safety text,_transcript text,_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k uuid:=gen_random_uuid(); current_rev integer; previous_rev integer; latest_origin text; candidate jsonb; result jsonb;
BEGIN
 PERFORM public.mcp_field_guard(_job);
 IF _confirmed IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Ask the superintendent to confirm this daily first. Nothing was saved.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(_job::text||':daily-request:'||k::text));
 PERFORM pg_advisory_xact_lock(hashtext(_job::text||':daily-project'));
 SELECT coalesce(max(r.revision),0) INTO current_rev FROM public.mcp_daily_reports d LEFT JOIN public.mcp_daily_revisions r ON r.daily_id=d.id WHERE d.job_id=_job AND d.report_date=_date;
 SELECT r.origin INTO latest_origin FROM public.mcp_daily_revisions r JOIN public.mcp_daily_reports d ON d.id=r.daily_id WHERE d.job_id=_job AND d.report_date=_date ORDER BY r.revision DESC LIMIT 1;
 IF latest_origin='void' THEN RAISE EXCEPTION 'MCP_BAD:This work was voided. Use the updated workflow to restore it.'; END IF;
 candidate:=jsonb_build_object('mode','legacy','date',_date,'weather',btrim(_weather),'manpower',btrim(_manpower),'subs',btrim(_subs),'deliveries',btrim(_deliveries),'issues',btrim(_issues),'delays',btrim(_delays),'safety',btrim(_safety),'transcript',nullif(btrim(_transcript),''),'lines',_lines);
 SELECT max(r.revision) INTO previous_rev FROM public.mcp_daily_revisions r JOIN public.mcp_daily_reports d ON d.id=r.daily_id WHERE d.job_id=_job AND d.report_date=_date AND r.payload=candidate;
 IF previous_rev IS NOT NULL AND previous_rev<current_rev THEN RAISE EXCEPTION 'MCP_BAD:A later daily revision exists. Reload and use the updated workflow.'; END IF;
 result:=public.mcp_daily_report_save_v2(_job,_date,_confirmed,_weather,_manpower,_subs,_deliveries,_issues,_delays,_safety,_transcript,_lines,current_rev,k,NULL,'legacy_compat');
 RETURN result||jsonb_build_object('saved',true,'mapping_status','unlinked');
END $$;

CREATE OR REPLACE FUNCTION public.mcp_daily_work_void(_job uuid,_date date,_expected_revision integer,_request_key uuid,_reason text,_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 RETURN public.mcp_daily_report_save_v2(_job,_date,_confirmed,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,_expected_revision,_request_key,_reason,'void');
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_daily_work_void(uuid,date,integer,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_daily_work_void(uuid,date,integer,uuid,text,boolean) TO authenticated;

-- Preserve the established daily payload and add explicit work-void status.
CREATE OR REPLACE FUNCTION public.mcp_daily_report_get(_job uuid,_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE sc text; r public.mcp_daily_reports; lines jsonb; voided boolean;
BEGIN
 PERFORM public.mcp_assert_active(); sc:=public.mcp_job_scope(_job);
 IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
 IF sc NOT IN ('full','super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job.'; END IF;
 SELECT * INTO r FROM public.mcp_daily_reports WHERE job_id=_job AND report_date=_date;
 IF r.id IS NULL THEN RETURN jsonb_build_object('found',false,'page','daily'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('work',w.work,'sov_item',w.sov_item,'activity_id',w.activity_id,'qty',w.qty,'unit',w.unit,'crew',w.crew,'hours',w.hours,'pct_complete',w.pct_complete) ORDER BY w.line_no),'[]'::jsonb) INTO lines FROM public.mcp_daily_work_lines w WHERE w.daily_id=r.id AND w.is_current;
 SELECT coalesce((SELECT origin='void' FROM public.mcp_daily_revisions WHERE daily_id=r.id ORDER BY revision DESC LIMIT 1),false) INTO voided;
 RETURN jsonb_build_object('found',true,'page','daily','report_date',r.report_date,'weather',r.weather,'manpower',r.manpower,'subs_on_site',r.subs_on_site,'deliveries',r.deliveries,'issues',r.issues,'delays',r.delays,'safety',r.safety,'lines',lines,'work_voided',voided);
END $$;


CREATE OR REPLACE FUNCTION public.mcp_field_board(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; j public.mcp_jobs; co text; cpm jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT name INTO co FROM public.mcp_companies WHERE id = j.company_id;
  cpm := public.mcp_living_report_get(_job, 'cpm', NULL);
  RETURN jsonb_build_object(
    'page', 'field',
    'company', co,
    'job_number', j.job_number,
    'job_name', j.name,
    'scope', sc,
    'time_zone', j.time_zone,
    'data_date', cpm->>'data_date',
    'lookahead', public.mcp_report_latest_lookahead(_job),
    'activities', coalesce(cpm->'data'->'activities', '[]'::jsonb),
    'assignments', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'activity_id', a.activity_id, 'self_perform', a.self_perform, 'sub_name', a.sub_name, 'crew_size', a.crew_size))
      FROM public.mcp_field_activities a WHERE a.job_id = _job), '[]'::jsonb),
    'materials', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'item', l.item, 'material', l.material, 'qty', l.qty, 'unit', l.unit, 'trade', l.trade))
      FROM public.mcp_estimate_takeoff_lines l
      JOIN public.mcp_estimate_takeoffs t ON t.id = l.takeoff_id
      WHERE l.job_id = _job AND t.version = (SELECT max(version) FROM public.mcp_estimate_takeoffs WHERE job_id = _job)), '[]'::jsonb),
    'rates', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'activity_id', r.activity_id, 'sov_item', r.sov_item, 'unit', r.unit, 'qty_per_man_hour', r.qty_per_man_hour,
      'crew', r.crew, 'hours', r.hours) ORDER BY r.created_at DESC)
      FROM public.mcp_production_rates r WHERE r.job_id = _job AND r.is_current), '[]'::jsonb),
    'installed', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'activity_id', w.activity_id, 'sov_item', w.sov_item, 'qty', w.qty, 'unit', w.unit))
      FROM public.mcp_daily_work_lines w WHERE w.job_id = _job AND w.is_current), '[]'::jsonb),
    'items', public.mcp_report_open_items(_job, sc <> 'full')
  );
END $$;

-- Field references deliberately exclude mapping dollars and source documents.
CREATE OR REPLACE FUNCTION public.mcp_production_work_references(_job uuid,_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE refs jsonb;
BEGIN
 PERFORM public.mcp_field_guard(_job);
 IF _date IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A work date is required.'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('allocation_id',a.id,'mapping_id',m.id,'mapping_version',m.version,'effective_date',m.effective_date,'sov_item',a.sov_item,'activity_id',a.activity_id,'unit',a.unit) ORDER BY a.sov_item,a.activity_id),'[]'::jsonb)
 INTO refs FROM public.mcp_production_mapping_versions m JOIN public.mcp_production_allocations a ON a.mapping_id=m.id AND a.job_id=m.job_id
 WHERE m.job_id=_job AND m.id=(SELECT v.id FROM public.mcp_production_mapping_versions v WHERE v.job_id=_job AND v.effective_date<=_date ORDER BY v.effective_date DESC,v.version DESC LIMIT 1);
 RETURN refs;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_production_work_references(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_production_work_references(uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_production_photo_associate(_job uuid,_photo uuid,_line uuid,_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid uuid; prior public.mcp_production_photo_links; request public.mcp_production_photo_requests; l public.mcp_daily_revision_lines; d date; p public.mcp_progress_photos; newid uuid;
BEGIN
 cid:=public.mcp_field_guard(_job);
 IF auth.uid() IS NULL OR _key IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A request key is required.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(_job::text||':production_photo:'||_key::text));
 PERFORM pg_advisory_xact_lock(hashtext(_job::text||':production_photo_pair:'||_photo::text||':'||_line::text));
 SELECT * INTO request FROM public.mcp_production_photo_requests WHERE job_id=_job AND request_key=_key;
 IF request.request_key IS NOT NULL THEN
   IF request.photo_id<>_photo OR request.revision_line_id<>_line THEN RAISE EXCEPTION 'MCP_BAD:Request key already used for a different association.'; END IF;
   RETURN jsonb_build_object('id',request.link_id,'replayed',true);
 END IF;
 SELECT * INTO l FROM public.mcp_daily_revision_lines WHERE id=_line AND job_id=_job;
 SELECT report_date INTO d FROM public.mcp_daily_revisions WHERE id=l.revision_id AND job_id=_job;
 SELECT * INTO p FROM public.mcp_progress_photos WHERE id=_photo AND job_id=_job;
 IF l.id IS NULL OR l.allocation_id IS NULL OR p.id IS NULL OR p.taken_on<>d THEN RAISE EXCEPTION 'MCP_BAD:Photo and approved work revision must belong to this project and date.'; END IF;
 SELECT * INTO prior FROM public.mcp_production_photo_links WHERE photo_id=_photo AND revision_line_id=_line;
 IF prior.id IS NOT NULL THEN
   INSERT INTO public.mcp_production_photo_requests VALUES(_job,_key,_photo,_line,prior.id);
   RETURN jsonb_build_object('id',prior.id,'replayed',true);
 END IF;
 INSERT INTO public.mcp_production_photo_links(job_id,company_id,photo_id,revision_line_id,request_key,recorded_by) VALUES(_job,cid,_photo,_line,_key,auth.uid()) RETURNING id INTO newid;
 INSERT INTO public.mcp_production_photo_requests VALUES(_job,_key,_photo,_line,newid);
 RETURN jsonb_build_object('id',newid,'replayed',false);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_production_photo_associate(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_production_photo_associate(uuid,uuid,uuid,uuid) TO authenticated;

-- Quantity/rate progress only, with no earnings or billing calculations.
CREATE OR REPLACE FUNCTION public.mcp_weekly_production(_job uuid,_from date,_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE out_rows jsonb; unlinked integer;
BEGIN
 PERFORM public.mcp_field_guard(_job);
 IF _from IS NULL OR _to IS NULL OR _from>_to OR _to-_from>6 THEN RAISE EXCEPTION 'MCP_BAD:Choose a period of at most seven days.'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('allocation_id',a.id,'mapping_version',m.version,'sov_item',a.sov_item,'activity_id',a.activity_id,'unit',p.unit,
   'period_quantity',p.period_qty,'period_man_hours',p.period_hours,'actual_rate',CASE WHEN p.period_hours>0 THEN p.period_qty/p.period_hours END,
   'cumulative_quantity',p.cumulative_qty,'cumulative_man_hours',p.cumulative_hours,
   'planned_rate',CASE WHEN a.planned_quantity>0 AND a.planned_man_hours>0 AND a.unit=p.unit AND a.planned_source IS NOT NULL THEN a.planned_quantity/a.planned_man_hours END,
   'planned_source',a.planned_source) ORDER BY a.sov_item,a.activity_id,m.version,p.unit),'[]'::jsonb) INTO out_rows
 FROM public.mcp_production_allocations a JOIN public.mcp_production_mapping_versions m ON m.id=a.mapping_id AND m.job_id=a.job_id
 JOIN LATERAL (
   SELECT w.unit,sum(r.qty) FILTER(WHERE d.report_date BETWEEN _from AND _to) period_qty,sum(r.man_hours) FILTER(WHERE d.report_date BETWEEN _from AND _to) period_hours,
     sum(r.qty) cumulative_qty,sum(r.man_hours) cumulative_hours
   FROM public.mcp_daily_work_lines w JOIN public.mcp_daily_reports d ON d.id=w.daily_id JOIN public.mcp_production_rates r ON r.work_line_id=w.id AND r.job_id=w.job_id
   WHERE w.job_id=_job AND w.is_current AND r.is_current AND w.production_allocation_id=a.id AND d.report_date<=_to GROUP BY w.unit
 ) p ON true WHERE a.job_id=_job;
 SELECT count(*) INTO unlinked FROM public.mcp_daily_work_lines w JOIN public.mcp_daily_reports d ON d.id=w.daily_id WHERE w.job_id=_job AND w.is_current AND d.report_date<=_to AND w.production_allocation_id IS NULL;
 RETURN jsonb_build_object('from',_from,'to',_to,'rows',out_rows,'unmapped_current_lines',unlinked,'earned_value',NULL);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_weekly_production(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_weekly_production(uuid,date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_daily_revision_status(_job uuid,_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.mcp_daily_reports; r public.mcp_daily_revisions; lines jsonb;
BEGIN
 PERFORM public.mcp_field_guard(_job);
 SELECT * INTO d FROM public.mcp_daily_reports WHERE job_id=_job AND report_date=_date;
 IF d.id IS NULL THEN RETURN jsonb_build_object('found',false,'revision',0,'lines','[]'::jsonb); END IF;
 SELECT * INTO r FROM public.mcp_daily_revisions WHERE daily_id=d.id ORDER BY revision DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(jsonb_build_object('revision_line_id',l.id,'line_no',l.line_no,'allocation_id',l.allocation_id,'sov_item',l.snapshot->>'sov_item','activity_id',l.snapshot->>'activity_id','unit',l.snapshot->>'unit','mapping_version',m.version) ORDER BY l.line_no),'[]'::jsonb) INTO lines FROM public.mcp_daily_revision_lines l LEFT JOIN public.mcp_production_allocations a ON a.id=l.allocation_id AND a.job_id=l.job_id LEFT JOIN public.mcp_production_mapping_versions m ON m.id=a.mapping_id AND m.job_id=a.job_id WHERE l.revision_id=r.id;
 RETURN jsonb_build_object('found',true,'daily_id',d.id,'revision',coalesce(r.revision,0),'revision_id',r.id,'lines',lines,'legacy',r.id IS NULL,'work_voided',coalesce(r.origin='void',false));
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_daily_revision_status(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_daily_revision_status(uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_production_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'MCP_BAD:Production history is immutable; record a new revision.'; END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_production_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER production_mapping_immutable BEFORE UPDATE OR DELETE ON public.mcp_production_mapping_versions FOR EACH ROW EXECUTE FUNCTION public.mcp_production_immutable();
CREATE TRIGGER production_allocation_immutable BEFORE UPDATE OR DELETE ON public.mcp_production_allocations FOR EACH ROW EXECUTE FUNCTION public.mcp_production_immutable();
CREATE TRIGGER production_daily_revision_immutable BEFORE UPDATE OR DELETE ON public.mcp_daily_revisions FOR EACH ROW EXECUTE FUNCTION public.mcp_production_immutable();
CREATE TRIGGER production_daily_line_revision_immutable BEFORE UPDATE OR DELETE ON public.mcp_daily_revision_lines FOR EACH ROW EXECUTE FUNCTION public.mcp_production_immutable();
CREATE TRIGGER production_photo_link_immutable BEFORE UPDATE OR DELETE ON public.mcp_production_photo_links FOR EACH ROW EXECUTE FUNCTION public.mcp_production_immutable();
CREATE TRIGGER production_daily_request_immutable BEFORE UPDATE OR DELETE ON public.mcp_daily_save_requests FOR EACH ROW EXECUTE FUNCTION public.mcp_production_immutable();
CREATE TRIGGER production_photo_request_immutable BEFORE UPDATE OR DELETE ON public.mcp_production_photo_requests FOR EACH ROW EXECUTE FUNCTION public.mcp_production_immutable();

-- Original work and rate facts cannot be altered or deleted; only retire the current projection.
CREATE OR REPLACE FUNCTION public.mcp_production_retire_only() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MCP_BAD:Production facts are retained; record a revision.'; END IF;
 IF OLD.is_current IS NOT TRUE OR NEW.is_current IS NOT FALSE OR (to_jsonb(NEW)-'is_current') IS DISTINCT FROM (to_jsonb(OLD)-'is_current') THEN RAISE EXCEPTION 'MCP_BAD:Production facts are immutable; record a revision.'; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_production_retire_only() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER production_work_retire_only BEFORE UPDATE OR DELETE ON public.mcp_daily_work_lines FOR EACH ROW EXECUTE FUNCTION public.mcp_production_retire_only();
CREATE TRIGGER production_rate_retire_only BEFORE UPDATE OR DELETE ON public.mcp_production_rates FOR EACH ROW EXECUTE FUNCTION public.mcp_production_retire_only();
