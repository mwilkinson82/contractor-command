DO $short_verified_migration$
DECLARE
  payload text := $encoded_payload$-- LOCAL UNAPPLIED PROPOSAL. Requires quote coverage, GC/~r CAS and
-- the existing contract/spec upload schema. No new RPC or ~2 grant.
-- Apply only through the reviewed Lovable lane in one transaction.
DO $$
~k ~u text; ~r text; freeze_review text; freeze_save text;
BEGIN
  ~F prosrc INTO ~u FROM ~5
    ~P oid='~L(uuid)'::~X;
  ~F prosrc INTO ~r FROM ~5 ~P oid='~M(uuid,~Y)'::~X;
  ~F prosrc INTO freeze_review FROM ~5 ~P oid='~6(uuid,uuid,bigint)'::~X;
  ~F prosrc INTO freeze_save FROM ~5 ~P oid='~9(uuid,uuid,boolean)'::~X;
  IF md5(~u) IS ~N FROM '6e881a6a0b31eb36d8bec8605032c125'
    OR md5(~r) IS ~N FROM 'ffa7263c0a311974b403504ee6d174a7'
    OR md5(freeze_review) IS ~N FROM 'bf0bf89fd6f87890748d50ef1e9ec19c'
    OR md5(freeze_save) IS ~N FROM 'e60cefd6a9232ca0f99a35b4b5244b42'
    OR to_regclass('~h') IS NULL
    OR NOT ~w(~F 1 FROM information_schema.columns
      ~P table_schema='public' AND table_name='mcp_contract_documents' AND column_name='file_sha256')
    OR to_regprocedure('~R()') IS NULL THEN
    ~x ~T 'Requirement ~u dependencies differ from the reviewed baseline. Reconcile before installation.';
  END IF;
END $$;

~7 TABLE ~A (
  ~i uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  ~V text NOT NULL,
  ~f bigint NOT NULL,
  actor uuid NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  invalidated boolean NOT NULL DEFAULT false
);
REVOKE ALL ON ~A FROM PUBLIC,anon,~b;

~7 ~W ~J(_job uuid) RETURNS ~Y
LANGUAGE plpgsql SECURITY DEFINER SET ~z=pg_catalog,pg_temp AS $$
~k body text; body_hash text; clauses ~Y; ~j ~Y; ~e ~Y; ~t ~Y;
BEGIN
  ~3 ~g(_job);
  IF public.mcp_can_access_contract(_job) IS ~N FROM true THEN
    ~x ~T 'MCP_NO_JOB';
  END IF;
  -- The existing coverage reader already holds estimate_lock. The helper is
  -- private and cannot be called directly by an ~b/anonymous role.
  ~F d.body,encode(~0(~n(d.body,'UTF8')),'hex') INTO body,body_hash
    FROM ~c d ~P d.job_id=_job;
  ~F coalesce(jsonb_agg(~C(
    'id',c.id,'section',c.section,'~u',c.source,
    'text_sha256',encode(~0(~n(c.verbatim_text,'UTF8')),'hex'),
    'current_document_body_sha256',body_hash,
    'matches_current_document',CASE WHEN body IS NULL THEN NULL ELSE
      length(~p(c.verbatim_text))>0 AND
      position(~p(c.verbatim_text) IN ~p(body))>0 END
  ) ORDER BY c.id),'[]') INTO clauses
    FROM public.mcp_contract_clauses c ~P c.job_id=_job;
  ~F coalesce(jsonb_agg(q.provenance ORDER BY q.kind,q.id),'[]') INTO ~j FROM (
    ~F 'contract' AS kind,d.id,
      ~C('kind','contract','id',d.id,
        'body_sha256',encode(~0(~n(d.body,'UTF8')),'hex'),
        '~y',d.body_sha256,
        'declared_file_sha256',d.file_sha256) AS provenance
      FROM ~c d ~P d.job_id=_job
    UNION ALL
    ~F 'spec',d.id,
      ~C('kind','spec','id',d.id,
        'body_sha256',encode(~0(~n(d.body,'UTF8')),'hex'),
        '~y',d.body_sha256,
        'declared_file_sha256',d.file_sha256)
      FROM ~h d ~P d.job_id=_job
  ) q;
  ~F ~C('role',s.role,'~j',s.documents,'doc_review',s.doc_review)
    INTO ~t FROM public.mcp_estimate_setup s ~P s.job_id=_job;
  ~t:=coalesce(~t,~C('role',NULL,'~j','[]'::~Y,'doc_review',NULL));
  ~e:=~C('schema',1,'clauses',clauses,'~j',~j,
    'setup_input_sha256',encode(~0(~n(~t::text,'UTF8')),'hex'));
  RETURN ~e||~C('~0',encode(~0(~n(~e::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON ~W ~J(uuid) FROM PUBLIC,anon,~b;

-- Covers the canonical clause saver, contract/spec upload writer and existing
-- service-role direct writes without changing any caller's privileges.
~7 ~W ~B() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET ~z=pg_catalog,pg_temp AS $$
~k j uuid;
BEGIN
  j:=CASE WHEN TG_OP='DELETE' THEN ~m ELSE ~l END;
  IF TG_OP='DELETE' AND NOT ~w(~F 1 FROM public.mcp_jobs ~P id=j) THEN RETURN OLD; END IF;
  IF TG_OP='~8' AND ~m IS ~N FROM ~l THEN
    IF ~m::text<~l::text THEN
      ~3 ~I(~m); ~3 ~I(~l);
    ELSE
      ~3 ~I(~l); ~3 ~I(~m);
    END IF;
    ~8 ~K SET ~v=~v+1 ~P ~i IN (~m,~l);
    RETURN NEW;
  END IF;
  ~3 ~I(j);
  ~8 ~K SET ~v=~v+1 ~P ~i=j;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON ~W ~B() FROM PUBLIC,anon,~b;
~7 TRIGGER ~Z BEFORE INSERT OR ~8 OR DELETE
  ON public.mcp_contract_clauses FOR EACH ROW ~2 ~W ~B();
~7 TRIGGER ~Z BEFORE INSERT OR ~8 OR DELETE
  ON ~c FOR EACH ROW ~2 ~W ~B();
~7 TRIGGER ~Z BEFORE INSERT OR ~8 OR DELETE
  ON ~h FOR EACH ROW ~2 ~W ~B();

-- Delegate preserves the reviewed row/CAS behavior. The public replacement
-- keeps its ~S identity/ACL and binds scan evidence under the same lock.
DO $$
~k ~U text;
BEGIN
  ~F ~a(oid) INTO ~U FROM ~5
    ~P oid='~M(uuid,~Y)'::~X;
  ~2 ~q(~U,'~W ~M(',
    '~W ~D(');
END $$;
REVOKE ALL ON ~W ~D(uuid,~Y) FROM PUBLIC,anon,~b;

~7 OR REPLACE ~W ~M(_job uuid,~d ~Y) RETURNS ~Y
LANGUAGE plpgsql SECURITY DEFINER SET ~z TO 'public' AS $$
~k ver bigint; after_ver bigint; ~e ~Y; old_scan ~A;
  ~Q boolean; result ~Y; refs ~Y; ~1 text;
BEGIN
  ~3 ~g(_job);
  ver:=~I(_job);
  ~3 ~g(_job);
  IF ~o(~d)='object' THEN
    ~e:=~J(_job); ~1:=~e->>'~0';
    IF ~w(~F 1 FROM ~G(~e->'~j') d ~P d->>'body_sha256' IS ~N FROM d->>'~y') OR
      ~w(~F 1 FROM ~G(~e->'clauses') c ~P c->>'~u'='document' AND c->'matches_current_document' IS ~N FROM 'true'::~Y) THEN
      ~x ~T 'MCP_BAD:Re-review saved document text and verified clauses against the ~4 contract before scanning.';
    END IF;
    IF ~o(~d->'~V') IS ~N FROM 'string' OR ~d->>'~V' IS ~N FROM ~1 OR
      ~o(~d->'items') IS ~N FROM 'array' OR
      ~o(~d->'~s') IS ~N FROM 'array' OR
      ~w(~F 1 FROM ~G(~d->'~s') r ~P ~o(r)<>'string') THEN
      ~x ~T 'MCP_BAD:Read the ~4 requirement sources and explicitly review confirmations before saving.';
    END IF;
    refs:=~d->'~s';
    IF (~F count(*) FROM ~G(refs))<>(~F count(~N r) FROM ~G(refs) r) OR
      ~w(~F 1 FROM jsonb_array_elements_text(refs) ref ~P NOT ~w(~F 1 FROM ~G(~d->'items') r ~P r->>'ref'=ref AND (r->'confirmed'='true'::~Y OR r->'excluded'='true'::~Y))) THEN
      ~x ~T 'MCP_BAD:Each explicit confirmation must identify one confirmed requirement.';
    END IF;
    ~F * INTO old_scan FROM ~A ~P ~i=_job;
    ~Q:=NOT FOUND OR old_scan.invalidated OR old_scan.source_sha256 IS ~N FROM ~1;
    IF ~Q AND ~w(~F 1 FROM ~G(~d->'items') r
      ~P (r->'confirmed'='true'::~Y OR r->'excluded'='true'::~Y) AND NOT refs ? (r->>'ref')) THEN
      ~x ~T 'MCP_BAD:Requirement sources changed. Retain prices for review and explicitly reconfirm affected requirements.';
    END IF;
    IF ~Q AND ~w(~F 1 FROM public.mcp_estimate_requirements r
      ~P r.job_id=_job AND r.active AND (r.confirmed OR r.excluded) AND
      NOT ~w(~F 1 FROM ~G(~d->'items') i ~P i->>'ref'=r.ref)) THEN
      ~x ~T 'MCP_BAD:Requirement sources changed. Include saved ~r and review their confirmations before saving.';
    END IF;
    result:=~D(_job,~d);
    IF ~Q THEN
      INSERT INTO ~A(~i,~V,~f,actor)
        VALUES(_job,~1,ver,auth.uid()) ON CONFLICT(~i) DO ~8 SET
          ~V=excluded.source_sha256,~f=excluded.source_version,
          actor=excluded.actor,scanned_at=clock_timestamp(),invalidated=false;
      ~8 ~K SET ~v=~v+1 ~P ~i=_job;
    END IF;
  ELSE
    result:=~D(_job,~d);
    ~F ~v INTO after_ver FROM ~K ~P ~i=_job;
    IF after_ver<>ver THEN ~8 ~A SET invalidated=true ~P ~i=_job; END IF;
  END IF;
  ~F ~v INTO after_ver FROM ~K ~P ~i=_job;
  RETURN result||~C('~v',after_ver);
END $$;

-- Existing saved evidence remains readable. New freezes require a completed
-- ~4 ~u scan; this is not a contract award or pricing attestation.
~7 ~W ~E(_data ~Y) RETURNS boolean
LANGUAGE sql IMMUTABLE SET ~z=pg_catalog,pg_temp AS $$
  ~F coalesce(_data->'capabilities'->'~H'='true'::~Y AND
    _data->'requirement_scan'->'~4'='true'::~Y AND
    _data->'requirement_scan'->>'~V'=_data->'~H'->>'~0',false)
$$;
REVOKE ALL ON ~W ~E(~Y) FROM PUBLIC,anon,~b;
DO $$
~k ~S text; ~U text; ~Q text;
BEGIN
  ~F prosrc,~a(oid) INTO ~S,~U FROM ~5
    ~P oid='~6(uuid,uuid,bigint)'::~X;
  ~Q:=~q(~S,'data:=~L(_job);',
    'data:=~L(_job); IF NOT ~E(data) THEN ~x ~T ''MCP_BAD:Scan and review ~4 requirement sources before freezing a new estimate.''; END IF;');
  IF ~Q IS NOT ~N FROM ~S THEN ~x ~T 'Unexpected ~u review shape.'; END IF;
  ~2 ~q(~U,~S,~Q);
  ~F prosrc,~a(oid) INTO ~S,~U FROM ~5
    ~P oid='~9(uuid,uuid,boolean)'::~X;
  ~Q:=~q(~S,'IF ver<>r.source_version THEN',
    'IF NOT ~E(r.source_data) THEN ~x ~T ''MCP_BAD:Scan and review ~4 requirement sources before freezing a new estimate.''; END IF; IF ver<>r.source_version THEN');
  IF ~Q IS NOT ~N FROM ~S THEN ~x ~T 'Unexpected ~u save shape.'; END IF;
  ~2 ~q(~U,~S,~Q);
END $$;

-- Activate the capability only after every dependency and freeze guard exists.
DO $$
~k ~S text; ~U text; ~Q text;
BEGIN
  ~F prosrc,~a(oid) INTO ~S,~U FROM ~5
    ~P oid='~L(uuid)'::~X;
  IF md5(~S) IS ~N FROM '6e881a6a0b31eb36d8bec8605032c125' THEN
    ~x ~T 'Coverage reader drifted. Reconcile before enabling ~u capability.';
  END IF;
  ~Q:=~q(~S,
    '~k v bigint; selected ~O;',
    '~k v bigint; selected ~O; ~H ~Y;');
  ~Q:=~q(~Q,'~F * INTO selected FROM ~O ~P ~i=_job;',
    '~H:=~J(_job); ~F * INTO selected FROM ~O ~P ~i=_job;');
  ~Q:=~q(~Q,
    'to_regprocedure(''~R()'') IS NOT NULL),',
    'to_regprocedure(''~R()'') IS NOT NULL,''~H'',true),''~H'',~H,''requirement_scan'',coalesce((~F ~C(''~V'',r.source_sha256,''~f'',r.source_version,''~4'',NOT r.invalidated AND r.source_sha256=~H->>''~0'') FROM ~A r ~P r.job_id=_job),~C(''~V'',NULL,''~f'',NULL,''~4'',false)),');
  IF ~Q IS NOT ~N FROM ~S THEN
    ~x ~T 'Coverage reader shape differs. Source protocol was not enabled.';
  END IF;
  -- ~a is ~7 OR REPLACE: existing OID, owner, ACL,
  -- volatility, ~z and before/after-lock ~u guards stay intact.
  ~2 ~q(~U,~S,~Q);
END $$;

$encoded_payload$;
  dict jsonb := $dictionary$["mcp_private.estimate_requirement_scan","mcp_private.estimate_requirement_source_changed","jsonb_build_object","mcp_private.estimate_requirements_save_source_base","mcp_private.estimate_requirement_snapshot_current","SELECT","jsonb_array_elements","requirement_sources","mcp_private.estimate_lock","mcp_private.estimate_requirement_sources","mcp_private.estimate_revision","public.mcp_estimate_coverage_snapshot","public.mcp_estimate_requirements_save","DISTINCT","mcp_private.estimate_quote_selection","WHERE","changed","mcp_private.estimate_gc_requirements_cas_marker","original","EXCEPTION","definition","source_sha256","FUNCTION","regprocedure","jsonb","estimate_requirement_source_changed","pg_get_functiondef","authenticated","public.mcp_contract_documents","_items","manifest","source_version","public.mcp_estimate_guard","public.mcp_spec_documents","job_id","documents","DECLARE","NEW.job_id","OLD.job_id","convert_to","jsonb_typeof","public.mcp_clause_norm","replace","requirements","reviewed_confirmations","setup_inputs","source","version","EXISTS","RAISE","declared_body_sha256","search_path","sha256","source_hash","EXECUTE","PERFORM","current","pg_proc","public.mcp_estimate_snapshot_review","CREATE","UPDATE","public.mcp_estimate_snapshot_save"]$dictionary$::jsonb;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  i integer;
BEGIN
  FOR i IN 0..jsonb_array_length(dict)-1 LOOP
    payload := replace(payload, '~' || substr(alphabet, i+1, 1), dict->>i);
  END LOOP;
  IF encode(sha256(convert_to(payload, 'UTF8')), 'hex') IS DISTINCT FROM '251619f3d7284c04b594acd0cf87d8764bbd4b74d54ff83dfea11e064ac10bad' THEN
    RAISE EXCEPTION 'Migration payload SHA-256 mismatch';
  END IF;
  EXECUTE payload;
END
$short_verified_migration$;