-- UNREGISTERED LOCAL PROPOSAL. Requires explicit release approval and supported Lovable verification.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Staged only. Purchase orders are commitments, not actual costs or payments.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE public.mcp_project_parties (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200), kind text NOT NULL CHECK(kind IN ('supplier','subcontractor','both')),
 trade text, contact_name text, contact_email text, contact_phone text, insurance_reference text, contract_reference text,
 version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_project_party_versions (
 party_id uuid NOT NULL REFERENCES public.mcp_project_parties(id), version integer NOT NULL, snapshot jsonb NOT NULL, reason text, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(party_id,version)
);
CREATE UNIQUE INDEX mcp_project_parties_name_idx ON public.mcp_project_parties(job_id,lower(btrim(name)));
CREATE TABLE public.mcp_po_terms_versions (
 id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.mcp_companies(id), job_id uuid REFERENCES public.mcp_jobs(id),
 party_id uuid REFERENCES public.mcp_project_parties(id), parent_id uuid REFERENCES public.mcp_po_terms_versions(id),
 scope text NOT NULL CHECK(scope IN ('company','supplier','po')), state text NOT NULL CHECK(state IN ('proposed','approved')), title text NOT NULL, body text NOT NULL,
 proposal_id uuid REFERENCES public.mcp_po_terms_versions(id), source text NOT NULL, change_note text, approved_by uuid, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((scope='company' AND job_id IS NULL AND party_id IS NULL) OR
        (scope IN ('supplier','po') AND job_id IS NOT NULL AND party_id IS NOT NULL AND parent_id IS NOT NULL)),
 CHECK ((state='proposed' AND scope<>'company' AND proposal_id IS NULL AND approved_by IS NULL) OR
        (state='approved' AND approved_by IS NOT NULL AND ((scope='company' AND proposal_id IS NULL) OR (scope<>'company' AND proposal_id IS NOT NULL))))
);
CREATE INDEX mcp_po_terms_company_idx ON public.mcp_po_terms_versions(company_id,scope,created_at DESC);
CREATE UNIQUE INDEX mcp_po_approved_proposal_idx ON public.mcp_po_terms_versions(proposal_id) WHERE state='approved' AND proposal_id IS NOT NULL;
CREATE TABLE public.mcp_po_company_defaults (
 company_id uuid PRIMARY KEY REFERENCES public.mcp_companies(id), terms_id uuid NOT NULL REFERENCES public.mcp_po_terms_versions(id),
 version integer NOT NULL CHECK(version>0), updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_purchase_orders (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
 party_id uuid NOT NULL REFERENCES public.mcp_project_parties(id), number text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mcp_po_number_idx ON public.mcp_purchase_orders(job_id,lower(btrim(number)));
ALTER TABLE public.mcp_po_terms_versions ADD COLUMN po_id uuid REFERENCES public.mcp_purchase_orders(id);
ALTER TABLE public.mcp_po_terms_versions ADD CONSTRAINT mcp_po_terms_po_scope CHECK ((scope='po') = (po_id IS NOT NULL));
CREATE TABLE public.mcp_po_default_events (company_id uuid NOT NULL REFERENCES public.mcp_companies(id), terms_id uuid NOT NULL REFERENCES public.mcp_po_terms_versions(id), version integer NOT NULL CHECK(version>0), actor_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,version));
CREATE TABLE public.mcp_purchase_order_versions (
 po_id uuid NOT NULL REFERENCES public.mcp_purchase_orders(id), version integer NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN ('draft','reviewed','approved','issued','accepted')),
 terms_id uuid NOT NULL REFERENCES public.mcp_po_terms_versions(id), party_snapshot jsonb NOT NULL, lines jsonb NOT NULL, order_date date NOT NULL, needed_by date NOT NULL,
 reason text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(po_id,version)
);
CREATE TABLE public.mcp_po_operations (
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), request_id uuid NOT NULL, actor_id uuid NOT NULL,
 action text NOT NULL, payload_hash bytea NOT NULL, review_id uuid NOT NULL, result jsonb NOT NULL, PRIMARY KEY(job_id,request_id)
);
CREATE TABLE public.mcp_po_reviews (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), actor_id uuid NOT NULL,
 request_id uuid NOT NULL, action text NOT NULL, payload_hash bytea NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_po_reviews_expiry_idx ON public.mcp_po_reviews(job_id, expires_at);
ALTER TABLE public.mcp_po_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_project_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_project_party_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_po_default_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_po_terms_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_po_company_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_purchase_order_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_po_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_project_parties,public.mcp_project_party_versions,public.mcp_po_default_events,public.mcp_po_terms_versions,public.mcp_po_company_defaults,public.mcp_purchase_orders,public.mcp_purchase_order_versions,public.mcp_po_operations,public.mcp_po_reviews FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mcp_project_parties,public.mcp_project_party_versions,public.mcp_po_default_events,public.mcp_po_terms_versions,public.mcp_po_company_defaults,public.mcp_purchase_orders,public.mcp_purchase_order_versions,public.mcp_po_operations,public.mcp_po_reviews TO service_role;
-- Immutable history, including issued/accepted snapshots. The API exposes no issue or acceptance operation.
CREATE TRIGGER mcp_party_versions_immutable BEFORE UPDATE OR DELETE ON public.mcp_project_party_versions FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_po_default_events_immutable BEFORE UPDATE OR DELETE ON public.mcp_po_default_events FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_po_terms_immutable BEFORE UPDATE OR DELETE ON public.mcp_po_terms_versions FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_purchase_orders_immutable BEFORE UPDATE OR DELETE ON public.mcp_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_po_versions_immutable BEFORE UPDATE OR DELETE ON public.mcp_purchase_order_versions FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();

CREATE FUNCTION public.mcp_project_purchase_orders_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE company uuid; is_owner boolean;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Purchase orders require full project access.'; END IF;
 SELECT company_id INTO company FROM public.mcp_jobs WHERE id=_job;
 is_owner:=public.mcp_member_role(company)='owner';
 RETURN jsonb_build_object(
  'parties',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version DESC) FROM public.mcp_project_party_versions v WHERE v.party_id=p.id)) ORDER BY p.name) FROM public.mcp_project_parties p WHERE p.job_id=_job),'[]'::jsonb),
  'default_history',CASE WHEN is_owner THEN coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.version DESC) FROM public.mcp_po_default_events e WHERE e.company_id=company),'[]'::jsonb) ELSE '[]'::jsonb END,
  'terms',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at) FROM public.mcp_po_terms_versions t WHERE t.company_id=company AND (is_owner AND (t.scope='company' OR t.job_id=_job) OR (NOT is_owner AND t.state='approved' AND (t.scope='company' OR t.job_id=_job) AND EXISTS (SELECT 1 FROM public.mcp_purchase_orders visible_po JOIN public.mcp_purchase_order_versions visible_ver ON visible_ver.po_id=visible_po.id WHERE visible_po.job_id=_job AND visible_ver.status='approved' AND visible_ver.terms_id=t.id)))),'[]'::jsonb),
  'default_terms_id',CASE WHEN is_owner THEN (SELECT d.terms_id FROM public.mcp_po_company_defaults d WHERE d.company_id=company) END,
  'default_version',CASE WHEN is_owner THEN coalesce((SELECT d.version FROM public.mcp_po_company_defaults d WHERE d.company_id=company),0) END,
  'orders',coalesce((SELECT jsonb_agg(to_jsonb(o)||jsonb_build_object('versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version DESC) FROM public.mcp_purchase_order_versions v WHERE v.po_id=o.id)) ORDER BY o.created_at DESC) FROM public.mcp_purchase_orders o WHERE o.job_id=_job),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_project_purchase_orders_get(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_project_purchase_orders_get(uuid) TO authenticated;

-- Contracts can read only project parties, PO identifiers and terms, not PO lines, prices or the financial ledger.
CREATE FUNCTION public.mcp_project_po_terms_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE company uuid; r text; scope text;
BEGIN
 PERFORM public.mcp_assert_active();
 SELECT company_id INTO company FROM public.mcp_jobs WHERE id=_job;
 r:=public.mcp_member_role(company); scope:=public.mcp_job_scope(_job);
 IF ((r='owner' AND scope='full') OR (r='contracts' AND scope IN ('contract','full'))) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Project terms access requires an owner or contracts role.'; END IF;
 RETURN jsonb_build_object(
  'parties',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'kind',p.kind,'version',p.version) ORDER BY p.name) FROM public.mcp_project_parties p WHERE p.job_id=_job),'[]'::jsonb),
  'terms',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at) FROM public.mcp_po_terms_versions t WHERE t.company_id=company AND ((r='owner' AND t.scope='company') OR (t.scope<>'company' AND t.job_id=_job) OR (r='contracts' AND t.scope='company' AND t.state='approved' AND EXISTS(SELECT 1 FROM public.mcp_purchase_orders po_ref JOIN public.mcp_purchase_order_versions v ON v.po_id=po_ref.id WHERE po_ref.job_id=_job AND v.status='approved' AND v.terms_id=t.id)))),'[]'::jsonb),
  'orders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'party_id',p.party_id) ORDER BY p.created_at DESC) FROM public.mcp_purchase_orders p WHERE p.job_id=_job),'[]'::jsonb),
  'default_terms_id',CASE WHEN r='owner' THEN (SELECT d.terms_id FROM public.mcp_po_company_defaults d WHERE d.company_id=company) END,
  'default_version',CASE WHEN r='owner' THEN coalesce((SELECT d.version FROM public.mcp_po_company_defaults d WHERE d.company_id=company),0) END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_project_po_terms_get(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_project_po_terms_get(uuid) TO authenticated;

-- The review binds actor, project, action and exact payload; the separate confirmation flag is a protocol signal, not proof of a human decision.
CREATE FUNCTION public.mcp_project_purchase_orders_review(_job uuid,_action text,_p jsonb,_review uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.mcp_jobs; old public.mcp_po_reviews; h bytea; rid uuid;
BEGIN
 PERFORM public.mcp_assert_active();
 IF (public.mcp_job_scope(_job)='full' OR (_action='terms' AND public.mcp_job_scope(_job)='contract' AND public.mcp_member_role((SELECT company_id FROM public.mcp_jobs WHERE id=_job))='contracts')) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Purchase orders require project access.'; END IF;
 IF _action='terms' AND public.mcp_member_role((SELECT company_id FROM public.mcp_jobs WHERE id=_job)) NOT IN ('owner','contracts') THEN RAISE EXCEPTION 'MCP_BAD:Only an owner or contracts role can propose terms.'; END IF;
 IF coalesce(_action,'') NOT IN ('party','terms','approve_terms','default_terms','order') OR jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>100000 OR _review IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Invalid review request.'; END IF;
 rid:=nullif(_p->>'request_id','')::uuid;
 IF rid IS NULL OR nullif(_p->>'id','')::uuid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Record and request IDs are required.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 IF (_action IN ('default_terms','approve_terms') OR (_action='terms' AND _p->>'scope'='company')) AND public.mcp_member_role(j.company_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only a company owner can approve or select company terms.'; END IF;
 h:=pg_catalog.sha256(pg_catalog.convert_to(_p::text,'UTF8'));
 DELETE FROM public.mcp_po_reviews WHERE job_id=_job AND expires_at < clock_timestamp() AND id<>_review;
 SELECT * INTO old FROM public.mcp_po_reviews WHERE id=_review;
 IF old.id IS NOT NULL THEN
  IF old.job_id IS DISTINCT FROM _job OR old.actor_id IS DISTINCT FROM auth.uid() OR old.action IS DISTINCT FROM _action OR old.request_id IS DISTINCT FROM rid OR old.payload_hash IS DISTINCT FROM h OR old.expires_at<clock_timestamp() THEN RAISE EXCEPTION 'MCP_BAD:Review is unavailable or belongs to different facts.'; END IF;
  RETURN jsonb_build_object('review_id',old.id,'expires_at',old.expires_at);
 END IF;
 IF (SELECT count(*) FROM public.mcp_po_reviews WHERE job_id=_job AND actor_id=auth.uid() AND expires_at>=clock_timestamp())>=100 THEN RAISE EXCEPTION 'MCP_BAD:Too many pending reviews; try again after they expire.'; END IF;
 INSERT INTO public.mcp_po_reviews(id,job_id,actor_id,request_id,action,payload_hash) VALUES(_review,_job,auth.uid(),rid,_action,h) RETURNING * INTO old;
 RETURN jsonb_build_object('review_id',old.id,'expires_at',old.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.mcp_project_purchase_orders_review(uuid,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_project_purchase_orders_review(uuid,text,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.mcp_project_purchase_orders_record(_job uuid,_action text,_p jsonb,_review uuid,_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.mcp_jobs; op public.mcp_po_operations; rid uuid; ident uuid; ref uuid; terms public.mcp_po_terms_versions; parent public.mcp_po_terms_versions;
 po public.mcp_purchase_orders; prev public.mcp_purchase_order_versions; party public.mcp_project_parties; n integer; current_default integer; h bytea; rev public.mcp_po_reviews; result jsonb; line jsonb; amount numeric; field text; cap integer;
BEGIN
 PERFORM public.mcp_assert_active();
 IF (public.mcp_job_scope(_job)='full' OR (_action='terms' AND public.mcp_job_scope(_job)='contract' AND public.mcp_member_role((SELECT company_id FROM public.mcp_jobs WHERE id=_job))='contracts')) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Purchase orders require project access.'; END IF;
 IF _action='terms' AND public.mcp_member_role((SELECT company_id FROM public.mcp_jobs WHERE id=_job)) NOT IN ('owner','contracts') THEN RAISE EXCEPTION 'MCP_BAD:Only an owner or contracts role can propose terms.'; END IF;
 IF _confirmed IS DISTINCT FROM true OR _review IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Review and confirm the exact facts first.'; END IF;
 IF coalesce(_action,'') NOT IN ('party','terms','approve_terms','default_terms','order') OR jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>100000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid request.'; END IF;
 rid:=nullif(_p->>'request_id','')::uuid; ident:=nullif(_p->>'id','')::uuid;
 IF rid IS NULL OR ident IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Record and request IDs are required.'; END IF;
 IF (_action IN ('default_terms','approve_terms') OR (_action='terms' AND _p->>'scope'='company')) AND public.mcp_member_role((SELECT company_id FROM public.mcp_jobs WHERE id=_job)) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only a company owner can approve or select company terms.'; END IF;
 -- Lock company before job for company-wide defaults, including the initial absent row.
 IF _action='default_terms' THEN
  PERFORM 1 FROM public.mcp_companies WHERE id=(SELECT company_id FROM public.mcp_jobs WHERE id=_job) FOR UPDATE;
 END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 h:=pg_catalog.sha256(pg_catalog.convert_to(_p::text,'UTF8'));
 SELECT * INTO op FROM public.mcp_po_operations WHERE job_id=_job AND request_id=rid;
 IF op.request_id IS NOT NULL THEN
  IF op.actor_id IS DISTINCT FROM auth.uid() OR op.action IS DISTINCT FROM _action OR op.payload_hash IS DISTINCT FROM h OR op.review_id IS DISTINCT FROM _review THEN RAISE EXCEPTION 'MCP_BAD:Request ID belongs to different content.'; END IF;
  RETURN op.result||jsonb_build_object('already_applied',true);
 END IF;
 SELECT * INTO rev FROM public.mcp_po_reviews WHERE id=_review AND job_id=_job AND actor_id=auth.uid() AND action=_action AND request_id=rid AND payload_hash=h AND expires_at>=clock_timestamp();
 IF rev.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Review expired or does not match these facts and actor.'; END IF;
 -- Enforce the same accepted field set and bounded optional text at the exposed RPC boundary.
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(_p) k WHERE k NOT IN ('id','request_id','expected_version','expected_default_version','name','kind','trade','contact_name','contact_email','contact_phone','insurance_reference','contract_reference','scope','title','body','source','change_note','parent_id','proposal_id','po_id','party_id','party_version','number','terms_id','status','lines','order_date','needed_by','reason')) THEN RAISE EXCEPTION 'MCP_BAD:Unexpected field.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(_p) k WHERE NOT (k=ANY(CASE _action
  WHEN 'party' THEN ARRAY['id','request_id','expected_version','name','kind','trade','contact_name','contact_email','contact_phone','insurance_reference','contract_reference','reason']
  WHEN 'terms' THEN ARRAY['id','request_id','scope','title','body','source','change_note','parent_id','po_id','party_id','party_version']
  WHEN 'approve_terms' THEN ARRAY['id','request_id','proposal_id']
  WHEN 'default_terms' THEN ARRAY['id','request_id','expected_default_version']
  ELSE ARRAY['id','request_id','expected_version','party_id','party_version','number','terms_id','status','lines','order_date','needed_by','reason'] END))) THEN RAISE EXCEPTION 'MCP_BAD:Field does not apply to this action.'; END IF;
 FOREACH field IN ARRAY ARRAY['id','request_id','name','kind','scope','title','body','source','change_note','parent_id','proposal_id','po_id','party_id','number','terms_id','status','order_date','needed_by','reason'] LOOP
  IF _p ? field AND jsonb_typeof(_p->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'MCP_BAD:Invalid text field.'; END IF;
 END LOOP;
 FOR field,cap IN SELECT * FROM (VALUES ('name',200),('title',200),('body',50000),('source',2000),('change_note',2000),('number',120),('reason',2000)) AS v(f,c) LOOP
  IF _p ? field AND (length(btrim(_p->>field))<1 OR length(_p->>field)>cap) THEN RAISE EXCEPTION 'MCP_BAD:Invalid text length.'; END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['id','request_id','parent_id','proposal_id','po_id','party_id','terms_id'] LOOP
  IF _p ? field THEN
   IF (_p->>field) !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' THEN RAISE EXCEPTION 'MCP_BAD:Invalid record reference.'; END IF;
   BEGIN PERFORM (_p->>field)::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'MCP_BAD:Invalid record reference.'; END;
  END IF;
 END LOOP;
 IF _p ? 'kind' AND _p->>'kind' NOT IN ('supplier','subcontractor','both') THEN RAISE EXCEPTION 'MCP_BAD:Invalid party type.'; END IF;
 IF _p ? 'scope' AND _p->>'scope' NOT IN ('company','supplier','po') THEN RAISE EXCEPTION 'MCP_BAD:Invalid terms scope.'; END IF;
 IF _p ? 'status' AND _p->>'status' NOT IN ('draft','reviewed','approved') THEN RAISE EXCEPTION 'MCP_BAD:Invalid order status.'; END IF;
 FOREACH field IN ARRAY ARRAY['expected_version','expected_default_version','party_version'] LOOP
  IF _p ? field THEN
   IF jsonb_typeof(_p->field) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Invalid version.'; END IF;
   IF (_p->>field)::numeric <> trunc((_p->>field)::numeric) OR (_p->>field)::numeric NOT BETWEEN 0 AND 2147483646 OR (field='party_version' AND (_p->>field)::numeric=0) THEN RAISE EXCEPTION 'MCP_BAD:Invalid version.'; END IF;
  END IF;
 END LOOP;
 FOR field,cap IN SELECT * FROM (VALUES ('trade',200),('contact_name',200),('contact_email',320),('contact_phone',100),('insurance_reference',2000),('contract_reference',2000)) AS v(f,c) LOOP
  IF _p ? field AND _p->field<>'null'::jsonb AND (jsonb_typeof(_p->field) IS DISTINCT FROM 'string' OR length(btrim(_p->>field)) NOT BETWEEN 1 AND cap) THEN RAISE EXCEPTION 'MCP_BAD:Invalid party detail.'; END IF;
 END LOOP;
 IF _action='party' THEN
  IF length(btrim(coalesce(_p->>'name',''))) NOT BETWEEN 1 AND 200 OR coalesce(_p->>'kind','') NOT IN ('supplier','subcontractor','both') THEN RAISE EXCEPTION 'MCP_BAD:Provide a name and type.'; END IF;
  IF EXISTS(SELECT 1 FROM public.mcp_project_parties WHERE job_id=_job AND id<>ident AND lower(btrim(name))=lower(btrim(_p->>'name'))) THEN RAISE EXCEPTION 'MCP_BAD:A project party with that name already exists.'; END IF;
  n:=coalesce(nullif(_p->>'expected_version','')::integer,0);
  SELECT * INTO party FROM public.mcp_project_parties WHERE id=ident AND job_id=_job FOR UPDATE;
  IF party.id IS NULL THEN
   IF n<>0 THEN RAISE EXCEPTION 'MCP_BAD:Party version changed.'; END IF;
   INSERT INTO public.mcp_project_parties(id,job_id,company_id,name,kind,trade,contact_name,contact_email,contact_phone,insurance_reference,contract_reference,created_by)
    VALUES(ident,_job,j.company_id,btrim(_p->>'name'),_p->>'kind',nullif(btrim(_p->>'trade'),''),nullif(btrim(_p->>'contact_name'),''),nullif(btrim(_p->>'contact_email'),''),nullif(btrim(_p->>'contact_phone'),''),nullif(btrim(_p->>'insurance_reference'),''),nullif(btrim(_p->>'contract_reference'),''),auth.uid()) RETURNING * INTO party;
  ELSE
   IF n<>party.version OR length(btrim(coalesce(_p->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Party version changed or revision reason missing.'; END IF;
   UPDATE public.mcp_project_parties SET name=btrim(_p->>'name'),kind=_p->>'kind',trade=CASE WHEN _p ? 'trade' THEN nullif(btrim(_p->>'trade'),'') ELSE party.trade END,contact_name=CASE WHEN _p ? 'contact_name' THEN nullif(btrim(_p->>'contact_name'),'') ELSE party.contact_name END,contact_email=CASE WHEN _p ? 'contact_email' THEN nullif(btrim(_p->>'contact_email'),'') ELSE party.contact_email END,contact_phone=CASE WHEN _p ? 'contact_phone' THEN nullif(btrim(_p->>'contact_phone'),'') ELSE party.contact_phone END,insurance_reference=CASE WHEN _p ? 'insurance_reference' THEN nullif(btrim(_p->>'insurance_reference'),'') ELSE party.insurance_reference END,contract_reference=CASE WHEN _p ? 'contract_reference' THEN nullif(btrim(_p->>'contract_reference'),'') ELSE party.contract_reference END,version=version+1 WHERE id=ident RETURNING * INTO party;
  END IF;
  INSERT INTO public.mcp_project_party_versions(party_id,version,snapshot,reason,recorded_by) VALUES(ident,party.version,to_jsonb(party),nullif(btrim(_p->>'reason'),''),auth.uid());
  result:=jsonb_build_object('id',ident);
 ELSIF _action='terms' THEN
  IF length(btrim(coalesce(_p->>'title',''))) NOT BETWEEN 1 AND 200 OR length(btrim(coalesce(_p->>'body',''))) NOT BETWEEN 1 AND 50000 OR length(btrim(coalesce(_p->>'source',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Provide the terms title, text and source.'; END IF;
  IF coalesce(_p->>'scope','') NOT IN ('company','supplier','po') THEN RAISE EXCEPTION 'MCP_BAD:Choose the terms scope.'; END IF;
  IF _p->>'scope'='company' THEN
   IF public.mcp_member_role(j.company_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only a company owner can approve company terms.'; END IF;
   IF _p ? 'party_id' OR _p ? 'po_id' THEN RAISE EXCEPTION 'MCP_BAD:Company terms cannot have a supplier or purchase order.'; END IF;
   IF _p ? 'parent_id' THEN
    SELECT * INTO parent FROM public.mcp_po_terms_versions WHERE id=nullif(_p->>'parent_id','')::uuid AND company_id=j.company_id AND scope='company' AND state='approved' AND approved_by IS NOT NULL;
    IF parent.id IS NULL OR length(btrim(coalesce(_p->>'change_note',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Select prior company terms and describe changes.'; END IF;
   END IF;
   INSERT INTO public.mcp_po_terms_versions(id,company_id,parent_id,scope,state,title,body,source,change_note,approved_by,created_by) VALUES(ident,j.company_id,parent.id,'company','approved',btrim(_p->>'title'),_p->>'body',btrim(_p->>'source'),nullif(btrim(_p->>'change_note'),''),auth.uid(),auth.uid());
  ELSE
   ref:=nullif(_p->>'party_id','')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.mcp_project_parties WHERE id=ref AND job_id=_job AND company_id=j.company_id AND version=nullif(_p->>'party_version','')::integer) THEN RAISE EXCEPTION 'MCP_BAD:Select the current party on this project and review again.'; END IF;
   SELECT * INTO parent FROM public.mcp_po_terms_versions t WHERE id=nullif(_p->>'parent_id','')::uuid AND company_id=j.company_id AND ((scope='company' AND (public.mcp_member_role(j.company_id)='owner' OR (public.mcp_member_role(j.company_id)='contracts' AND t.state='approved' AND EXISTS(SELECT 1 FROM public.mcp_purchase_orders base_po JOIN public.mcp_purchase_order_versions base_v ON base_v.po_id=base_po.id WHERE base_po.job_id=_job AND base_v.status='approved' AND base_v.terms_id=t.id)))) OR (job_id=_job AND party_id=ref));
   IF parent.id IS NULL OR (parent.scope='company' AND parent.approved_by IS NULL) OR length(btrim(coalesce(_p->>'change_note',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Select applicable base terms and describe the changes.'; END IF;
   IF _p->>'scope'='po' THEN
    IF NOT EXISTS(SELECT 1 FROM public.mcp_purchase_orders WHERE id=nullif(_p->>'po_id','')::uuid AND job_id=_job AND party_id=ref) THEN RAISE EXCEPTION 'MCP_BAD:Select the purchase order for these terms.'; END IF;
    IF parent.scope='po' AND parent.po_id IS DISTINCT FROM nullif(_p->>'po_id','')::uuid THEN RAISE EXCEPTION 'MCP_BAD:Base terms belong to a different purchase order.'; END IF;
   ELSIF _p ? 'po_id' OR parent.scope='po' THEN RAISE EXCEPTION 'MCP_BAD:Supplier terms cannot be based on PO-specific terms.'; END IF;
   INSERT INTO public.mcp_po_terms_versions(id,company_id,job_id,party_id,parent_id,po_id,scope,state,title,body,source,change_note,approved_by,created_by)
    VALUES(ident,j.company_id,_job,ref,parent.id,nullif(_p->>'po_id','')::uuid,_p->>'scope','proposed',btrim(_p->>'title'),_p->>'body',btrim(_p->>'source'),btrim(_p->>'change_note'),NULL,auth.uid());
  END IF;
  result:=jsonb_build_object('id',ident,'state',CASE WHEN _p->>'scope'='company' THEN 'approved' ELSE 'proposed' END);
 ELSIF _action='approve_terms' THEN
  IF public.mcp_member_role(j.company_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only the company owner can approve terms.'; END IF;
  SELECT * INTO parent FROM public.mcp_po_terms_versions WHERE id=nullif(_p->>'proposal_id','')::uuid AND company_id=j.company_id AND job_id=_job AND scope IN ('supplier','po') AND state='proposed';
  IF parent.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Select a proposed terms version on this job.'; END IF;
  IF EXISTS(SELECT 1 FROM public.mcp_po_terms_versions WHERE proposal_id=parent.id AND state='approved') THEN RAISE EXCEPTION 'MCP_BAD:This proposal was already approved.'; END IF;
  INSERT INTO public.mcp_po_terms_versions(id,company_id,job_id,party_id,parent_id,proposal_id,po_id,scope,state,title,body,source,change_note,approved_by,created_by)
   VALUES(ident,parent.company_id,parent.job_id,parent.party_id,parent.parent_id,parent.id,parent.po_id,parent.scope,'approved',parent.title,parent.body,parent.source,parent.change_note,auth.uid(),auth.uid());
  result:=jsonb_build_object('id',ident,'proposal_id',parent.id,'state','approved');
 ELSIF _action='default_terms' THEN
  IF public.mcp_member_role(j.company_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only a company owner can select default terms.'; END IF;
  SELECT * INTO terms FROM public.mcp_po_terms_versions WHERE id=ident AND company_id=j.company_id AND scope='company' AND state='approved' AND approved_by IS NOT NULL;
  IF terms.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Select approved company terms.'; END IF;
  IF jsonb_typeof(_p->'expected_default_version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Review the current company default first.'; END IF;
  IF (_p->>'expected_default_version')::numeric <> trunc((_p->>'expected_default_version')::numeric) OR (_p->>'expected_default_version')::numeric NOT BETWEEN 0 AND 2147483646 THEN RAISE EXCEPTION 'MCP_BAD:Review the current company default first.'; END IF;
  SELECT coalesce((SELECT version FROM public.mcp_po_company_defaults WHERE company_id=j.company_id),0) INTO current_default;
  IF current_default IS DISTINCT FROM (_p->>'expected_default_version')::integer THEN RAISE EXCEPTION 'MCP_BAD:Company default changed; review again.'; END IF;
  INSERT INTO public.mcp_po_company_defaults(company_id,terms_id,version,updated_by) VALUES(j.company_id,ident,current_default+1,auth.uid()) ON CONFLICT(company_id) DO UPDATE SET terms_id=EXCLUDED.terms_id,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=now();
  INSERT INTO public.mcp_po_default_events(company_id,terms_id,version,actor_id) VALUES(j.company_id,ident,current_default+1,auth.uid());
  result:=jsonb_build_object('id',ident,'version',current_default+1);
 ELSE
  n:=coalesce(nullif(_p->>'expected_version','')::integer,-1);
  SELECT * INTO po FROM public.mcp_purchase_orders WHERE id=ident AND job_id=_job;
  IF po.id IS NULL THEN
   IF n<>0 OR length(btrim(coalesce(_p->>'number',''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'MCP_BAD:Provide a new order number.'; END IF;
   ref:=nullif(_p->>'party_id','')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.mcp_project_parties WHERE id=ref AND job_id=_job AND company_id=j.company_id) THEN RAISE EXCEPTION 'MCP_BAD:Select a party on this project.'; END IF;
   IF EXISTS(SELECT 1 FROM public.mcp_purchase_orders WHERE job_id=_job AND lower(btrim(number))=lower(btrim(_p->>'number'))) THEN RAISE EXCEPTION 'MCP_BAD:That purchase order number already exists.'; END IF;
   IF coalesce(_p->>'status','')<>'draft' THEN RAISE EXCEPTION 'MCP_BAD:New orders begin as drafts.'; END IF;
   INSERT INTO public.mcp_purchase_orders(id,job_id,company_id,party_id,number,created_by) VALUES(ident,_job,j.company_id,ref,btrim(_p->>'number'),auth.uid()) RETURNING * INTO po;
  ELSE
   SELECT * INTO prev FROM public.mcp_purchase_order_versions WHERE po_id=ident ORDER BY version DESC LIMIT 1;
   IF prev.version IS DISTINCT FROM n THEN RAISE EXCEPTION 'MCP_BAD:Order version changed; review again.'; END IF;
   IF prev.status IN ('issued','accepted') THEN RAISE EXCEPTION 'MCP_BAD:Issued or accepted orders cannot be revised.'; END IF;
   IF length(btrim(coalesce(_p->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Explain the revision.'; END IF;
   IF nullif(_p->>'party_id','')::uuid IS DISTINCT FROM po.party_id OR btrim(coalesce(_p->>'number','')) IS DISTINCT FROM po.number THEN RAISE EXCEPTION 'MCP_BAD:Order identity cannot be changed.'; END IF;
  END IF;
  SELECT * INTO party FROM public.mcp_project_parties WHERE id=po.party_id AND job_id=_job AND version=nullif(_p->>'party_version','')::integer;
  IF party.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Party details changed; review again.'; END IF;
  IF coalesce(_p->>'status','') NOT IN ('draft','reviewed','approved') THEN RAISE EXCEPTION 'MCP_BAD:This workflow cannot issue or accept orders.'; END IF;
  IF _p->>'status'='approved' AND public.mcp_member_role(j.company_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only the owner can approve a reviewed order.'; END IF;
  SELECT * INTO terms FROM public.mcp_po_terms_versions t WHERE t.id=nullif(_p->>'terms_id','')::uuid AND t.company_id=j.company_id AND t.state='approved' AND t.approved_by IS NOT NULL AND ((t.scope='company' AND (public.mcp_member_role(j.company_id)='owner' OR EXISTS(SELECT 1 FROM public.mcp_purchase_orders seen_po JOIN public.mcp_purchase_order_versions seen_v ON seen_v.po_id=seen_po.id WHERE seen_po.job_id=_job AND seen_v.status='approved' AND seen_v.terms_id=t.id))) OR (t.job_id=_job AND t.party_id=po.party_id AND (t.scope='supplier' OR (t.scope='po' AND t.po_id=po.id)) AND (public.mcp_member_role(j.company_id)='owner' OR EXISTS(SELECT 1 FROM public.mcp_purchase_orders seen_po JOIN public.mcp_purchase_order_versions seen_v ON seen_v.po_id=seen_po.id WHERE seen_po.job_id=_job AND seen_v.status='approved' AND seen_v.terms_id=t.id))));
  IF terms.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Select applicable terms.'; END IF;
  IF jsonb_typeof(_p->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(_p->'lines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'MCP_BAD:Provide one or more order lines.'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(_p->'lines') LOOP
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(line) k WHERE k NOT IN ('description','quantity','unit','unit_price_cents')) OR length(btrim(coalesce(line->>'description',''))) NOT BETWEEN 1 AND 2000 OR length(btrim(coalesce(line->>'unit',''))) NOT BETWEEN 1 AND 100 OR jsonb_typeof(line->'quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(line->'unit_price_cents') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Each line needs description, unit, quantity and price.'; END IF;
   amount:=(line->>'quantity')::numeric; IF amount<=0 OR amount>1000000000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid quantity.'; END IF;
   amount:=(line->>'unit_price_cents')::numeric; IF amount<0 OR amount<>trunc(amount) OR amount>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid unit price.'; END IF;
  END LOOP;
  IF coalesce(_p->>'needed_by','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(_p->>'order_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Provide the order and needed-by dates.'; END IF;
  BEGIN PERFORM (_p->>'order_date')::date, (_p->>'needed_by')::date; EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'MCP_BAD:Provide valid order and needed-by dates.'; END;
  IF _p->>'status'='approved' THEN
   IF public.mcp_member_role(j.company_id) IS DISTINCT FROM 'owner' OR prev.status IS DISTINCT FROM 'reviewed' THEN RAISE EXCEPTION 'MCP_BAD:Only the owner can approve a reviewed order.'; END IF;
   IF prev.terms_id IS DISTINCT FROM terms.id OR prev.lines IS DISTINCT FROM _p->'lines' OR prev.order_date IS DISTINCT FROM (_p->>'order_date')::date OR prev.needed_by IS DISTINCT FROM (_p->>'needed_by')::date OR prev.party_snapshot IS DISTINCT FROM to_jsonb(party) THEN RAISE EXCEPTION 'MCP_BAD:The reviewed order changed; review again before approval.'; END IF;
  ELSIF prev.status='approved' AND _p->>'status'<>'draft' THEN RAISE EXCEPTION 'MCP_BAD:Revise an approved order as a new draft.'; END IF;
  INSERT INTO public.mcp_purchase_order_versions(po_id,version,status,terms_id,party_snapshot,lines,order_date,needed_by,reason,created_by)
   VALUES(ident,n+1,_p->>'status',terms.id,to_jsonb(party),_p->'lines',(_p->>'order_date')::date,(_p->>'needed_by')::date,nullif(btrim(_p->>'reason'),''),auth.uid());
  result:=jsonb_build_object('id',ident,'version',n+1);
 END IF;
 INSERT INTO public.mcp_po_operations(job_id,request_id,actor_id,action,payload_hash,review_id,result) VALUES(_job,rid,auth.uid(),_action,h,_review,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_project_purchase_orders_record(uuid,text,jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_project_purchase_orders_record(uuid,text,jsonb,uuid,boolean) TO authenticated;
