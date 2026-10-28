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
 scope text NOT NULL CHECK(scope IN ('company','supplier','po')), title text NOT NULL, body text NOT NULL,
 source text NOT NULL, change_note text, approved_by uuid, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((scope='company' AND job_id IS NULL AND party_id IS NULL) OR
        (scope IN ('supplier','po') AND job_id IS NOT NULL AND party_id IS NOT NULL AND parent_id IS NOT NULL))
);
CREATE INDEX mcp_po_terms_company_idx ON public.mcp_po_terms_versions(company_id,scope,created_at DESC);
CREATE TABLE public.mcp_po_company_defaults (
 company_id uuid PRIMARY KEY REFERENCES public.mcp_companies(id), terms_id uuid NOT NULL REFERENCES public.mcp_po_terms_versions(id),
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_purchase_orders (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
 party_id uuid NOT NULL REFERENCES public.mcp_project_parties(id), number text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mcp_po_number_idx ON public.mcp_purchase_orders(job_id,lower(btrim(number)));
ALTER TABLE public.mcp_po_terms_versions ADD COLUMN po_id uuid REFERENCES public.mcp_purchase_orders(id);
ALTER TABLE public.mcp_po_terms_versions ADD CONSTRAINT mcp_po_terms_po_scope CHECK ((scope='po') = (po_id IS NOT NULL));
CREATE TABLE public.mcp_po_default_events (company_id uuid NOT NULL REFERENCES public.mcp_companies(id), terms_id uuid NOT NULL REFERENCES public.mcp_po_terms_versions(id), actor_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.mcp_purchase_order_versions (
 po_id uuid NOT NULL REFERENCES public.mcp_purchase_orders(id), version integer NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN ('draft','reviewed','issued','accepted')),
 terms_id uuid NOT NULL REFERENCES public.mcp_po_terms_versions(id), party_snapshot jsonb NOT NULL, lines jsonb NOT NULL, order_date date NOT NULL, needed_by date NOT NULL,
 reason text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(po_id,version)
);
CREATE TABLE public.mcp_po_operations (
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), request_id uuid NOT NULL, actor_id uuid NOT NULL,
 signature text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(job_id,request_id)
);
ALTER TABLE public.mcp_project_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_project_party_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_po_default_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_po_terms_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_po_company_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_purchase_order_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_po_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_project_parties,public.mcp_project_party_versions,public.mcp_po_default_events,public.mcp_po_terms_versions,public.mcp_po_company_defaults,public.mcp_purchase_orders,public.mcp_purchase_order_versions,public.mcp_po_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mcp_project_parties,public.mcp_project_party_versions,public.mcp_po_default_events,public.mcp_po_terms_versions,public.mcp_po_company_defaults,public.mcp_purchase_orders,public.mcp_purchase_order_versions,public.mcp_po_operations TO service_role;
-- Immutable history, including issued/accepted snapshots. The API exposes no issue or acceptance operation.
CREATE TRIGGER mcp_party_versions_immutable BEFORE UPDATE OR DELETE ON public.mcp_project_party_versions FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_po_default_events_immutable BEFORE UPDATE OR DELETE ON public.mcp_po_default_events FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_po_terms_immutable BEFORE UPDATE OR DELETE ON public.mcp_po_terms_versions FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_purchase_orders_immutable BEFORE UPDATE OR DELETE ON public.mcp_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_po_versions_immutable BEFORE UPDATE OR DELETE ON public.mcp_purchase_order_versions FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();

CREATE FUNCTION public.mcp_project_purchase_orders_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE company uuid;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Purchase orders require full project access.'; END IF;
 SELECT company_id INTO company FROM public.mcp_jobs WHERE id=_job;
 RETURN jsonb_build_object(
  'parties',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version DESC) FROM public.mcp_project_party_versions v WHERE v.party_id=p.id)) ORDER BY p.name) FROM public.mcp_project_parties p WHERE p.job_id=_job),'[]'::jsonb),
  'default_history',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.recorded_at DESC) FROM public.mcp_po_default_events e WHERE e.company_id=company),'[]'::jsonb),
  'terms',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at) FROM public.mcp_po_terms_versions t WHERE t.company_id=company AND (t.scope='company' OR t.job_id=_job)),'[]'::jsonb),
  'default_terms_id',(SELECT d.terms_id FROM public.mcp_po_company_defaults d WHERE d.company_id=company),
  'orders',coalesce((SELECT jsonb_agg(to_jsonb(o)||jsonb_build_object('versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version DESC) FROM public.mcp_purchase_order_versions v WHERE v.po_id=o.id)) ORDER BY o.created_at DESC) FROM public.mcp_purchase_orders o WHERE o.job_id=_job),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_project_purchase_orders_get(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_project_purchase_orders_get(uuid) TO authenticated;

CREATE FUNCTION public.mcp_project_purchase_orders_record(_job uuid,_action text,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs; op public.mcp_po_operations; rid uuid; ident uuid; ref uuid; terms public.mcp_po_terms_versions; parent public.mcp_po_terms_versions;
 po public.mcp_purchase_orders; prev public.mcp_purchase_order_versions; party public.mcp_project_parties; n integer; sig text; result jsonb; line jsonb; amount numeric;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Purchase orders require full project access.'; END IF;
 IF coalesce(_action,'') NOT IN ('party','terms','default_terms','order') OR jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>100000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid request.'; END IF;
 rid:=nullif(_p->>'request_id','')::uuid; ident:=nullif(_p->>'id','')::uuid;
 IF rid IS NULL OR ident IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Record and request IDs are required.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 sig:=md5(jsonb_build_object('action',_action,'payload',_p)::text);
 SELECT * INTO op FROM public.mcp_po_operations WHERE job_id=_job AND request_id=rid;
 IF op.request_id IS NOT NULL THEN
  IF op.actor_id IS DISTINCT FROM auth.uid() OR op.signature IS DISTINCT FROM sig THEN RAISE EXCEPTION 'MCP_BAD:Request ID belongs to different content.'; END IF;
  RETURN op.result||jsonb_build_object('already_applied',true);
 END IF;
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
    SELECT * INTO parent FROM public.mcp_po_terms_versions WHERE id=nullif(_p->>'parent_id','')::uuid AND company_id=j.company_id AND scope='company' AND approved_by IS NOT NULL;
    IF parent.id IS NULL OR length(btrim(coalesce(_p->>'change_note',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Select prior company terms and describe changes.'; END IF;
   END IF;
   INSERT INTO public.mcp_po_terms_versions(id,company_id,parent_id,scope,title,body,source,change_note,approved_by,created_by) VALUES(ident,j.company_id,parent.id,'company',btrim(_p->>'title'),_p->>'body',btrim(_p->>'source'),nullif(btrim(_p->>'change_note'),''),auth.uid(),auth.uid());
  ELSE
   ref:=nullif(_p->>'party_id','')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.mcp_project_parties WHERE id=ref AND job_id=_job AND company_id=j.company_id AND version=nullif(_p->>'party_version','')::integer) THEN RAISE EXCEPTION 'MCP_BAD:Select the current party on this project and review again.'; END IF;
   SELECT * INTO parent FROM public.mcp_po_terms_versions WHERE id=nullif(_p->>'parent_id','')::uuid AND company_id=j.company_id AND (scope='company' OR (job_id=_job AND party_id=ref));
   IF parent.id IS NULL OR (parent.scope='company' AND parent.approved_by IS NULL) OR length(btrim(coalesce(_p->>'change_note',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Select applicable base terms and describe the changes.'; END IF;
   IF _p->>'scope'='po' THEN
    IF NOT EXISTS(SELECT 1 FROM public.mcp_purchase_orders WHERE id=nullif(_p->>'po_id','')::uuid AND job_id=_job AND party_id=ref) THEN RAISE EXCEPTION 'MCP_BAD:Select the purchase order for these terms.'; END IF;
    IF parent.scope='po' AND parent.po_id IS DISTINCT FROM nullif(_p->>'po_id','')::uuid THEN RAISE EXCEPTION 'MCP_BAD:Base terms belong to a different purchase order.'; END IF;
   ELSIF _p ? 'po_id' OR parent.scope='po' THEN RAISE EXCEPTION 'MCP_BAD:Supplier terms cannot be based on PO-specific terms.'; END IF;
   INSERT INTO public.mcp_po_terms_versions(id,company_id,job_id,party_id,parent_id,po_id,scope,title,body,source,change_note,approved_by,created_by)
    VALUES(ident,j.company_id,_job,ref,parent.id,nullif(_p->>'po_id','')::uuid,_p->>'scope',btrim(_p->>'title'),_p->>'body',btrim(_p->>'source'),btrim(_p->>'change_note'),NULL,auth.uid());
  END IF;
  result:=jsonb_build_object('id',ident);
 ELSIF _action='default_terms' THEN
  IF public.mcp_member_role(j.company_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only a company owner can select default terms.'; END IF;
  SELECT * INTO terms FROM public.mcp_po_terms_versions WHERE id=ident AND company_id=j.company_id AND scope='company' AND approved_by IS NOT NULL;
  IF terms.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Select approved company terms.'; END IF;
  INSERT INTO public.mcp_po_company_defaults(company_id,terms_id,updated_by) VALUES(j.company_id,ident,auth.uid()) ON CONFLICT(company_id) DO UPDATE SET terms_id=EXCLUDED.terms_id,updated_by=EXCLUDED.updated_by,updated_at=now();
  INSERT INTO public.mcp_po_default_events(company_id,terms_id,actor_id) VALUES(j.company_id,ident,auth.uid());
  result:=jsonb_build_object('id',ident);
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
  IF coalesce(_p->>'status','') NOT IN ('draft','reviewed') THEN RAISE EXCEPTION 'MCP_BAD:This workflow cannot issue or accept orders.'; END IF;
  SELECT * INTO terms FROM public.mcp_po_terms_versions WHERE id=nullif(_p->>'terms_id','')::uuid AND company_id=j.company_id AND (scope<>'company' OR approved_by IS NOT NULL) AND (scope='company' OR (job_id=_job AND party_id=po.party_id AND (scope='supplier' OR (scope='po' AND po_id=po.id))));
  IF terms.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Select applicable terms.'; END IF;
  IF jsonb_typeof(_p->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(_p->'lines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'MCP_BAD:Provide one or more order lines.'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(_p->'lines') LOOP
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR length(btrim(coalesce(line->>'description',''))) NOT BETWEEN 1 AND 2000 OR length(btrim(coalesce(line->>'unit',''))) NOT BETWEEN 1 AND 100 OR jsonb_typeof(line->'quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(line->'unit_price_cents') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Each line needs description, unit, quantity and price.'; END IF;
   amount:=(line->>'quantity')::numeric; IF amount<=0 OR amount>1000000000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid quantity.'; END IF;
   amount:=(line->>'unit_price_cents')::numeric; IF amount<0 OR amount<>trunc(amount) OR amount>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid unit price.'; END IF;
  END LOOP;
  IF coalesce(_p->>'needed_by','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(_p->>'order_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Provide the order and needed-by dates.'; END IF;
  INSERT INTO public.mcp_purchase_order_versions(po_id,version,status,terms_id,party_snapshot,lines,order_date,needed_by,reason,created_by)
   VALUES(ident,n+1,_p->>'status',terms.id,to_jsonb(party),_p->'lines',(_p->>'order_date')::date,(_p->>'needed_by')::date,nullif(btrim(_p->>'reason'),''),auth.uid());
  result:=jsonb_build_object('id',ident,'version',n+1);
 END IF;
 INSERT INTO public.mcp_po_operations(job_id,request_id,actor_id,signature,result) VALUES(_job,rid,auth.uid(),sig,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_project_purchase_orders_record(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_project_purchase_orders_record(uuid,text,jsonb) TO authenticated;
