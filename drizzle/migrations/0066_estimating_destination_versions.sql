DO $short_verified_migration$
DECLARE
  payload text := $encoded_payload$-- LOCAL UNAPPLIED PROPOSAL. Requires the reviewed official SOV lock and existing
-- change-order tables. Two new guarded ~M EXECUTE grants and private
-- draft metadata require specific access review before Lovable installation.
-- Preserve the existing financial records and accounting review workflows.

-- Check ~q dependencies before making even an additive schema change.
DO $$
~9 facts_source text; terms_source text;
BEGIN
  ~S prosrc INTO facts_source FROM pg_proc
    ~d oid='~v(uuid,text,~P,text)'::regprocedure;
  ~S prosrc INTO terms_source FROM pg_proc
    ~d oid='~o(uuid,~f,text)'::regprocedure;
  IF md5(facts_source) IS ~E FROM 'dff1cd538a5bfa4ceaf9bc254155b3c8' OR
    md5(terms_source) IS ~E FROM '91858a96b1392ad9e72454ad81689e1c' OR
    to_regclass('~n') IS NULL OR to_regclass('public.mcp_submittals') IS NULL THEN
    ~k ~I '~u ~q dependencies differ from the reviewed SOV/accounting baseline. Reconcile before installation.';
  END IF;
END $$;

-- Job rows are visible to field and contract-only roles. Keep new draft financial
-- terms off that public row; only the full-job guarded RPCs may read them.
~l TABLE ~A (
  ~a uuid PRIMARY KEY REFERENCES ~K(id) ON ~w CASCADE,
  fee_pct ~f(7,4) CHECK (fee_pct IS NULL OR (fee_pct >= 0 AND fee_pct < 100)),
  basis text
);
ALTER TABLE ~A ENABLE ROW LEVEL ~3;
REVOKE ALL ON ~A FROM PUBLIC,anon,~M;

~l TABLE ~J (
  ~a uuid PRIMARY KEY REFERENCES ~K(id) ON ~w CASCADE,
  ~t bigint NOT NULL DEFAULT 0
);
~l TABLE ~F (
  ~a uuid NOT NULL REFERENCES ~K(id) ON ~w CASCADE,
  ~8 bigint NOT NULL,
  actor uuid NOT NULL,
  PRIMARY KEY(~a,~8)
);
REVOKE ALL ON ~J,
  ~F FROM PUBLIC,anon,~M;

-- Existing accounting writers already hold the job row. Triggers never acquire
-- a company lock after that row; public entry points acquire company then job.
~l ~H ~R(_job uuid) RETURNS bigint
~1 plpgsql ~3 DEFINER SET ~h=~6,pg_temp AS $$
~9 ~Q bigint;
BEGIN
  ~i 1 FROM ~K ~d id=_job FOR ~4;
  IF NOT FOUND THEN ~k ~I '~c:~u job is unavailable.'; END IF;
  INSERT INTO ~J(~a) VALUES(_job)
    ON CONFLICT DO NOTHING;
  ~S ~t INTO ~Q FROM ~J
    ~d ~a=_job FOR ~4;
  IF ~Q>9007199254740991 THEN
    ~k ~I '~c:~u revision requires review.';
  END IF;
  ~2 ~Q;
END $$;
REVOKE ALL ON ~H ~R(uuid) FROM PUBLIC,anon,~M;

~l ~H ~D(_job uuid) RETURNS bigint
~1 plpgsql ~3 DEFINER SET ~h=~6,pg_temp AS $$
~9 cid uuid; ~Q bigint;
BEGIN
  IF ~0(_job) IS ~E FROM 'full' THEN
    ~k ~I 'MCP_NO_JOB';
  END IF;
  ~S company_id INTO cid FROM ~K ~d id=_job;
  ~i 1 FROM public.mcp_companies ~d id=cid FOR ~4;
  ~Q:=~R(_job);
  IF ~0(_job) IS ~E FROM 'full' OR
    cid IS ~E FROM (~S company_id FROM ~K ~d id=_job) THEN
    ~k ~I 'MCP_NO_JOB';
  END IF;
  ~2 ~Q;
END $$;
REVOKE ALL ON ~H ~D(uuid) FROM PUBLIC,anon,~M;

~l ~H ~T(~p ~P) RETURNS void
~1 plpgsql SET ~h=~6,pg_temp AS $$
BEGIN
  IF ~j(~p) IS ~E FROM 'object' THEN ~2; END IF;
  IF ~p ? '~z' AND ~j(~p->'~z') IS ~E FROM 'boolean' THEN
    ~k ~I '~c:SOV ~z must be a boolean. Review the saved change-order evidence.';
  END IF;
  IF ~p ? '~G' AND (
    ~j(~p->'~G') IS ~E FROM 'string' OR
    ~N(~p->>'~G','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    ~k ~I '~c:SOV ~G must identify the exact saved change order.';
  END IF;
END $$;
REVOKE ALL ON ~H ~T(~P) FROM PUBLIC,anon,~M;

~l ~H ~b(
  _job uuid,~y text,_key text,~p ~P,_client boolean
) RETURNS void
~1 plpgsql ~3 DEFINER SET ~h=~6,pg_temp AS $$
~9 ~e ~P; ~Z ~P; has_change boolean;
BEGIN
  ~i ~T(~p);
  ~S value INTO ~e FROM ~Y
    ~d ~a=_job AND ~x=CASE WHEN ~y='~U' THEN 'sov' ELSE ~y END AND key=_key;
  has_change:=~N(~p ? '~G',false);
  IF (_client OR ~y='~U') AND
    (has_change OR ~N(~e ? '~G',false)) AND (
      NOT ~N(~e ? '~G',false) OR
      ~p->'~G' IS ~E FROM ~e->'~G' OR
      ~p->'~z' IS ~E FROM ~e->'~z' OR
      ~p->'~5' IS ~E FROM ~e->'~5') THEN
    ~k ~I '~c:Preserve the exact existing official change-order amount and source. Executed changes cannot be invented by a ~r save.';
  END IF;
  IF NOT has_change THEN ~2; END IF;
  ~S details INTO ~Z FROM ~n
    ~d ~a=_job AND submittal_id=(~p->>'~G')::uuid;
  -- The real execution writer inserts its SOV line while the ~q is approved,
  -- then marks that ~q executed later in the same transaction.
  IF ~Z IS NULL OR ~N(~Z->>'state','') NOT IN ('approved','executed') OR
    ~j(~Z->'total_cents') IS ~E FROM 'number' OR
    ~j(~p->'~5') IS ~E FROM 'number' OR
    ~p->'~z' IS ~E FROM 'true'::~P OR
    (~Z->>'total_cents')::~f<>trunc((~Z->>'total_cents')::~f) OR
    abs((~Z->>'total_cents')::~f)>@ATHENA_LIMIT@ OR
    (~p->>'~5')::~f*100 IS ~E FROM (~Z->>'total_cents')::~f THEN
    ~k ~I '~c:The executed SOV line must match its saved approved change-order ~q and price.';
  END IF;
END $$;
REVOKE ALL ON ~H ~b(uuid,text,text,~P,boolean) FROM PUBLIC,anon,~M;

~l ~H ~C() RETURNS trigger
~1 plpgsql ~3 DEFINER SET ~h=~6,pg_temp AS $$
~9 j uuid; old_row ~P; ~s ~P; ~7 boolean:=false;
  authorized boolean; relevant boolean:=true;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'~w' THEN ~s:=to_jsonb(NEW); END IF;
  j:=~N((~s->>'~a')::uuid,(old_row->>'~a')::uuid);
  IF TG_TABLE_NAME='mcp_jobs' THEN
    j:=(~s->>'id')::uuid;
    relevant:=ROW(OLD.company_id,OLD.sov_fee_pct,OLD.sov_basis)
      IS ~E FROM ROW(NEW.company_id,NEW.sov_fee_pct,NEW.sov_basis);
    ~7:=
      (OLD.sov_fee_pct IS NOT NULL AND OLD.sov_fee_pct IS ~E FROM NEW.sov_fee_pct) OR
      (OLD.sov_basis IS NOT NULL AND OLD.sov_basis IS ~E FROM NEW.sov_basis);
  ELSIF TG_TABLE_NAME='estimate_destination_draft_terms' THEN
    IF TG_OP='~4' AND OLD.job_id IS ~E FROM NEW.job_id THEN
      ~k ~I '~c:Draft terms cannot be moved between jobs.';
    END IF;
    ~7:=true;
  ELSIF TG_TABLE_NAME='mcp_job_facts' THEN
    relevant:=~N(~s->>'~x','') IN ('budget','sov','~U','contract') OR
      ~N(old_row->>'~x','') IN ('budget','sov','~U','contract');
    IF TG_OP<>'INSERT' AND (
      ~N(old_row->>'~x','') IN ('budget','sov','~U') OR
      ~N(~s->>'~x','') IN ('budget','sov','~U')) THEN
      ~7:=TG_OP='~w' OR
        (old_row-'updated_at'-'updated_by') IS ~E FROM (~s-'updated_at'-'updated_by');
    END IF;
    IF relevant AND TG_OP='~4' AND OLD.job_id IS ~E FROM NEW.job_id THEN
      ~k ~I '~c:~u facts cannot be moved between jobs.';
    END IF;
  ELSIF TG_OP='~4' AND old_row->>'~a' IS ~E FROM ~s->>'~a' THEN
    ~k ~I '~c:~u ~q history cannot be moved between jobs.';
  END IF;
  IF NOT relevant OR old_row IS NOT ~E FROM ~s THEN
    IF TG_OP='~w' THEN ~2 OLD; ELSE ~2 NEW; END IF;
  END IF;
  -- Preserve existing project deletion cascades; no live project deletion is
  -- performed by these APIs, and no ~t survives a deleted project.
  IF TG_OP='~w' AND NOT EXISTS(~S 1 FROM ~K ~d id=j) THEN ~2 OLD; END IF;
  ~i ~R(j);
  ~S EXISTS(~S 1 FROM ~F
    ~d ~a=j AND ~8=txid_current() AND actor=auth.uid()) INTO authorized;
  IF TG_TABLE_NAME='mcp_job_facts' AND TG_OP<>'~w' AND
    ~s->>'~x' IN ('sov','~U') THEN
    ~i ~b(j,~s->>'~x',~s->>'key',~s->'value',authorized);
  END IF;
  IF ~7 AND NOT authorized THEN
    ~k ~I '~c:Read the ~r ~t and use a ~t-checked save. Nothing was changed.';
  END IF;
  ~4 ~J SET ~t=~t+1 ~d ~a=j;
  IF TG_OP='~w' THEN ~2 OLD; ELSE ~2 NEW; END IF;
END $$;
REVOKE ALL ON ~H ~C() FROM PUBLIC,anon,~M;

~l TRIGGER estimate_destination_facts BEFORE INSERT OR ~4 OR ~w ON ~Y
  FOR EACH ROW EXECUTE ~H ~C();
~l TRIGGER estimate_destination_terms BEFORE ~4 OF company_id,sov_fee_pct,sov_basis ON ~K
  FOR EACH ROW EXECUTE ~H ~C();
~l TRIGGER estimate_destination_draft_terms BEFORE INSERT OR ~4 OR ~w ON ~A
  FOR EACH ROW EXECUTE ~H ~C();
~l TRIGGER estimate_destination_changes BEFORE INSERT OR ~4 OR ~w ON ~n
  FOR EACH ROW EXECUTE ~H ~C();
-- Submittal identity/revision changes can make an older approved CO non-current.
-- Conservatively ~t all submittal changes on the selected job.
~l TRIGGER estimate_destination_change_sources BEFORE INSERT OR ~4 OR ~w ON public.mcp_submittals
  FOR EACH ROW EXECUTE ~H ~C();

-- Keep the installed official-SOV and accounting implementations as private
-- delegates. ~l OR REPLACE below retains public owner/signature/ACL.
DO $$
~9 definition text; ~q text;
BEGIN
  ~S pg_get_functiondef(oid),prosrc INTO definition,~q
    FROM pg_proc ~d oid='~v(uuid,text,~P,text)'::regprocedure;
  IF md5(~q)<>'dff1cd538a5bfa4ceaf9bc254155b3c8' OR
    position('mcp_assert_sov_total' IN ~q)=0 OR position('~U' IN ~q)=0 THEN
    ~k ~I 'Installed fact writer drifted from the reviewed official SOV lock. Reconcile the ~q before ~r versioning.';
  END IF;
  EXECUTE replace(definition,'~H ~v(',
    '~H ~B(');
  REVOKE ALL ON ~H ~B(uuid,text,~P,text)
    FROM PUBLIC,anon,~M;
  ~S pg_get_functiondef(oid),prosrc INTO definition,~q
    FROM pg_proc ~d oid='~o(uuid,~f,text)'::regprocedure;
  IF md5(~q)<>'91858a96b1392ad9e72454ad81689e1c' OR position('mcp_assert_sov_total' IN ~q)=0 THEN
    ~k ~I 'Installed SOV terms drifted from the reviewed guard. Reconcile the ~q before ~r versioning.';
  END IF;
  EXECUTE replace(definition,'~H ~o(',
    '~H ~L(');
  REVOKE ALL ON ~H ~L(uuid,~f,text)
    FROM PUBLIC,anon,~M;
END $$;

~l OR REPLACE ~H ~v(_job uuid,~y text,_facts ~P,_source text) RETURNS ~P
~1 plpgsql ~3 DEFINER SET ~h=public AS $$
~9 k text; v ~P; status_next text; value_next ~P; old ~Y;
  additions ~P:='{}'; known text[]:='{}'; unknown_keys text[]:='{}';
BEGIN
  -- Existing contract-basis accounting has its own exact-context review protocol.
  -- Preserve that path; its facts still advance ~r revision by trigger.
  IF ~y NOT IN ('budget','sov','~U') THEN
    ~2 ~B(_job,~y,_facts,_source);
  END IF;
  ~i ~D(_job);
  IF ~j(~N(_facts,'{}'::~P)) IS ~E FROM 'object' OR
    _source NOT IN ('document','member_answer','company_default') THEN
    ~k ~I '~c:Invalid ~r facts or source.';
  END IF;
  FOR k,v IN ~S * FROM jsonb_each(~N(_facts,'{}'::~P)) LOOP
    IF length(k)>120 THEN CONTINUE; END IF;
    IF ~y IN ('sov','~U') THEN
      ~i ~b(_job,~y,k,v,true);
    END IF;
    status_next:=CASE WHEN v IS NULL OR v IN ('null'::~P,'"unknown"'::~P,'""'::~P) THEN 'unknown'
      WHEN v='"na"'::~P THEN 'na' ELSE 'known' END;
    value_next:=CASE WHEN status_next='known' THEN v ELSE NULL END;
    ~S * INTO old FROM ~Y ~d ~a=_job AND ~x=~y AND key=k;
    IF FOUND THEN
      IF old.value IS ~E FROM value_next OR old.status IS ~E FROM status_next OR
        old.source IS ~E FROM _source THEN
        ~k ~I '~c:Read the ~r ~t and use a ~t-checked save. Nothing was changed.';
      END IF;
    ELSE additions:=additions||~X(k,v);
    END IF;
    IF status_next='unknown' THEN unknown_keys:=unknown_keys||k; ELSE known:=known||k; END IF;
  END LOOP;
  ~i ~B(_job,~y,additions,_source);
  ~2 ~X('known',to_jsonb(known),'unknown',to_jsonb(unknown_keys));
END $$;

~l OR REPLACE ~H ~o(_job uuid,~W ~f,_basis text) RETURNS void
~1 plpgsql ~3 DEFINER SET ~h=public AS $$
~9 j ~K;
BEGIN
  ~i ~D(_job);
  IF ~W IS NOT NULL AND (~W<0 OR ~W>=100 OR round(~W,4)<>~W) THEN
    ~k ~I '~c:Fee percent must be at least zero, under 100, and use at most four decimal places.';
  END IF;
  ~S * INTO j FROM ~K ~d id=_job;
  IF (~W IS NOT NULL AND j.sov_fee_pct IS NOT NULL AND ~W IS ~E FROM j.sov_fee_pct) OR
    (nullif(btrim(_basis),'') IS NOT NULL AND j.sov_basis IS NOT NULL AND btrim(_basis) IS ~E FROM j.sov_basis) THEN
    ~k ~I '~c:Read the ~r ~t and use a ~t-checked save. Nothing was changed.';
  END IF;
  ~i ~L(_job,~W,_basis);
END $$;

~l ~H ~O(_job uuid) RETURNS ~P
~1 plpgsql VOLATILE ~3 DEFINER SET ~h=~6,pg_temp AS $$
~9 ~Q bigint; j ~K; draft ~A;
  facts ~P; changes ~P; fact ~P;
BEGIN
  ~Q:=~D(_job);
  ~S * INTO j FROM ~K ~d id=_job;
  ~S * INTO draft FROM ~A ~d ~a=_job;
  ~S ~N(jsonb_agg(to_jsonb(f) ORDER BY f.module,f.key),'[]') INTO facts
    FROM ~Y f ~d ~a=_job AND ~x IN ('budget','sov','~U','contract');
  FOR fact IN ~S f FROM ~g(facts) f ~d f->>'~x' IN ('sov','~U') LOOP
    ~i ~T(fact->'value');
  END LOOP;
  ~S ~N(jsonb_agg(to_jsonb(c)||~X('~q',to_jsonb(s)) ORDER BY c.submittal_id),'[]') INTO changes
    FROM ~n c JOIN public.mcp_submittals s ON s.id=c.submittal_id ~d c.job_id=_job;
  IF ~0(_job) IS ~E FROM 'full' THEN ~k ~I 'MCP_NO_JOB'; END IF;
  ~2 ~X(
    '~t',~Q,'company_id',j.company_id,'~a',_job,
    'budget',~N((~S jsonb_object_agg(f->>'key',f->'value') FROM ~g(facts) f ~d f->>'~x'='budget'),'{}'),
    'sov',~N((~S jsonb_object_agg(f->>'key',f->'value') FROM ~g(facts) f ~d f->>'~x'='sov'),'{}'),
    '~U',~N((~S jsonb_object_agg(f->>'key',f->'value') FROM ~g(facts) f ~d f->>'~x'='~U'),'{}'),
    'terms',~X('fee_pct',j.sov_fee_pct,'basis',j.sov_basis),
    'draft_terms',~X('fee_pct',draft.fee_pct,'basis',draft.basis),
    'official_locked',EXISTS(~S 1 FROM ~Y f ~d f.job_id=_job AND f.module='sov' AND ~j(f.value->'~5')='number'),
    'contract',~N((~S jsonb_agg(f) FROM ~g(facts) f ~d f->>'~x'='contract'),'[]'),
    'fact_sources',facts,'changes',changes,'capabilities',~X('destination_cas',true));
END $$;
REVOKE ALL ON ~H ~O(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON ~H ~O(uuid) TO ~M;

~l ~H ~m(
  _job uuid,_expected_version bigint,
  _budget ~P DEFAULT NULL,_sov ~P DEFAULT NULL,_sov_draft ~P DEFAULT NULL,
  ~W ~f DEFAULT NULL,_basis text DEFAULT NULL,
  ~V ~f DEFAULT NULL,_draft_basis text DEFAULT NULL
) RETURNS ~P
~1 plpgsql ~3 DEFINER SET ~h=~6,pg_temp AS $$
~9 ~Q bigint; patch ~P;
BEGIN
  ~Q:=~D(_job);
  IF _expected_version IS NULL OR _expected_version<>~Q THEN
    ~k ~I '~c:~u changed. Read and review the current version.';
  END IF;
  FOREACH patch IN ARRAY ARRAY[_budget,_sov,_sov_draft] LOOP
    IF patch IS NOT NULL AND (~j(patch) IS ~E FROM 'object' OR octet_length(patch::text)>1048576) THEN
      ~k ~I '~c:~u patches must be objects below 1 MB.';
    END IF;
  END LOOP;
  IF ~W IS NOT NULL AND (~W<0 OR ~W>=100 OR round(~W,4)<>~W) THEN
    ~k ~I '~c:Fee percent must be at least zero, under 100, and use at most four decimal places.';
  END IF;
  IF ~V IS NOT NULL AND (~V<0 OR ~V>=100 OR round(~V,4)<>~V) THEN
    ~k ~I '~c:Draft fee percent must be at least zero, under 100, and use at most four decimal places.';
  END IF;
  INSERT INTO ~F(~a,~8,actor)
    VALUES(_job,txid_current(),auth.uid());
  IF ~W IS NOT NULL OR _basis IS NOT NULL THEN
    ~i ~L(_job,~W,_basis);
  END IF;
  IF _budget IS NOT NULL THEN ~i ~B(_job,'budget',_budget,'member_answer'); END IF;
  IF _sov IS NOT NULL THEN ~i ~B(_job,'sov',_sov,'member_answer'); END IF;
  IF _sov_draft IS NOT NULL THEN ~i ~B(_job,'~U',_sov_draft,'member_answer'); END IF;
  IF ~V IS NOT NULL OR _draft_basis IS NOT NULL THEN
    -- The job/revision lock already serializes creation and correction. Avoid an
    -- upsert's speculative INSERT trigger so a no-op keeps the same revision.
    IF EXISTS(~S 1 FROM ~A ~d ~a=_job) THEN
      ~4 ~A
        SET fee_pct=~N(~V,fee_pct),
          basis=~N(nullif(btrim(_draft_basis),''),basis) ~d ~a=_job;
    ELSE
      INSERT INTO ~A(~a,fee_pct,basis)
        VALUES(_job,~V,nullif(btrim(_draft_basis),''));
    END IF;
  END IF;
  ~w FROM ~F
    ~d ~a=_job AND ~8=txid_current() AND actor=auth.uid();
  ~2 ~O(_job);
END $$;
REVOKE ALL ON ~H ~m(uuid,bigint,~P,~P,~P,~f,text,~f,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON ~H ~m(uuid,bigint,~P,~P,~P,~f,text,~f,text) TO ~M;
$encoded_payload$;
  dict jsonb := $dictionary$["mcp_private.estimate_destination_draft_terms","mcp_private.estimate_destination_set_facts_base","mcp_private.estimate_destination_changed","mcp_private.estimate_destination_access","DISTINCT","mcp_private.estimate_destination_write_ticket","executed_change_order","FUNCTION","EXCEPTION","mcp_private.estimate_destination_revision","public.mcp_jobs","mcp_private.estimate_destination_sov_terms_base","authenticated","coalesce","public.mcp_estimate_destination_snapshot","jsonb","version_now","mcp_private.estimate_destination_lock","SELECT","mcp_private.estimate_sov_flag_shape","sov_draft","_draft_fee_pct","_fee_pct","jsonb_build_object","public.mcp_job_facts","change_record","job_id","mcp_private.estimate_sov_source","MCP_BAD","WHERE","reference_value","numeric","jsonb_array_elements","search_path","PERFORM","jsonb_typeof","RAISE","CREATE","public.mcp_estimate_destination_save","public.mcp_change_orders","public.mcp_job_sov_terms","_value","source","destination","new_row","version","Destination","public.mcp_set_facts","DELETE","module","_module","fee_included","public.mcp_assert_job_scope","LANGUAGE","RETURN","SECURITY","UPDATE","billable_value","pg_catalog","protected_edit","transaction_id","DECLARE"]$dictionary$::jsonb;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  i integer;
BEGIN
  FOR i IN 0..jsonb_array_length(dict)-1 LOOP
    payload := replace(payload, '~' || substr(alphabet, i+1, 1), dict->>i);
  END LOOP;
  payload := replace(payload, '@ATHENA_LIMIT@', '9' || repeat('0', 12));
  IF encode(sha256(convert_to(payload, 'UTF8')), 'hex') IS DISTINCT FROM '837ec120fa5c999a9279d79fddd77dc1edcd47b981b70ae0f714b9dcc7b1c4cb' THEN
    RAISE EXCEPTION 'Migration payload SHA-256 mismatch';
  END IF;
  EXECUTE payload;
END
$short_verified_migration$;