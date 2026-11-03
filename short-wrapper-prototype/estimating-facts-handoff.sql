DO $short_verified_migration$
DECLARE
  payload text := $encoded_payload$-- LOCAL UNAPPLIED PROPOSAL. Requires immutable estimate source snapshots and
-- estimating-~I-versions.sql. ONE new service_role-only EXECUTE grant
-- requires specific access ~s before Lovable installation. No ~u
-- caller can submit an attested calculation or privileged actor.
~2 TABLE ~A (
  ~H uuid PRIMARY KEY,
  actor uuid NOT NULL,
  ~7 uuid NOT NULL,
  ~8 uuid NOT NULL ~n ~q(id),
  ~I text NOT NULL CHECK(~I IN ('~x','sov:official','sov:draft')),
  snapshot_id uuid NOT NULL ~n ~R(id),
  source_version ~w NOT NULL,
  observed_source_version ~w NOT NULL,
  ~f ~w NOT NULL,
  ~v uuid,
  ~L text NOT NULL,
  ~k text NOT NULL,
  ~J ~U NOT NULL,
  ~h text NOT NULL,
  review_result ~U NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT ~p()+interval '30 minutes'
);
~2 TABLE ~B (
  ~H uuid PRIMARY KEY ~n ~A(~H),
  accepted_seq ~w GENERATED ALWAYS AS IDENTITY,
  ~Z ~U NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT ~p()
);
-- Active projection only. Immutable ~s/~Q rows audit replacements.
~2 TABLE ~C (
  ~8 uuid NOT NULL ~n ~q(id),
  ~I text NOT NULL,
  ~0 text NOT NULL,
  ~H uuid NOT NULL ~n ~B(~H),
  PRIMARY KEY(~8,~I,~0)
);
~2 TABLE ~D (
  ~H uuid PRIMARY KEY ~n ~A(~H),
  cancelled_at timestamptz NOT NULL DEFAULT ~p()
);
REVOKE ALL ON ~A,
  ~B,
  ~C,
  ~D FROM PUBLIC,anon,~u;
~2 TRIGGER estimate_facts_review_immutable BEFORE UPDATE OR DELETE ON ~A FOR EACH ROW EXECUTE ~y ~l();
~2 TRIGGER estimate_facts_operation_immutable BEFORE UPDATE OR DELETE ON ~B FOR EACH ROW EXECUTE ~y ~l();
~2 TRIGGER estimate_facts_cancel_immutable BEFORE UPDATE OR DELETE ON ~D FOR EACH ROW EXECUTE ~y ~l();

~2 ~y ~V(
  _job uuid,_actor uuid,_step text,~W uuid,_p ~U
) RETURNS ~U LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  ~N text:=current_setting('~G',true);
  cid uuid; ~T ~w; ~d ~U; saved ~U;
  r ~A;
  s ~R;
  prior ~A;
  latest uuid; ~M uuid; ~1 ~U; ~J ~U; facts ~U; terms ~U;
  ~L text; ~c text; ~P text; ~h text;
  ~Z ~U; ~Q ~U; ~t boolean; ~j boolean; ~9 ~U;
BEGIN
  IF _job IS NULL OR _actor IS NULL OR ~W IS NULL OR
     ~S(_step,'') NOT IN ('~s','save','read','cancel') OR
     ~S(_p->>'kind','') NOT IN ('~x','sov') THEN
    ~X ~F '~O:Choose an exact member, job, ~I and request.';
  END IF;
  ~b ~a('~G',~K('sub',_actor,'role','~u')::text,true);
  ~e ~7 INTO cid FROM ~q ~i id=_job;
  ~b mcp_private.buyout_access(cid,_job,true);
  ~b 1 FROM public.mcp_companies ~i id=cid FOR UPDATE;
  ~b 1 FROM ~q ~i id=_job FOR UPDATE;
  ~T:=mcp_private.estimate_lock(_job);
  ~d:=public.mcp_estimate_destination_snapshot(_job);
  ~b mcp_private.buyout_access(cid,_job,true);
  IF public.mcp_estimate_guard(_job) IS ~E FROM cid THEN ~X ~F 'MCP_NO_ACCESS'; END IF;
  ~e * INTO r FROM ~A ~i ~H=~W;
  IF FOUND AND (r.actor IS ~E FROM _actor OR r.job_id IS ~E FROM _job OR
      r.company_id IS ~E FROM cid OR split_part(r.destination,':',1) IS ~E FROM _p->>'kind') THEN
    ~X ~F '~O:This request identifies a different handoff.';
  END IF;
  IF _step<>'~s' AND r.request_id IS NULL THEN
    ~X ~F '~O:Review the exact frozen source and ~I first.';
  END IF;
  IF r.request_id IS NOT NULL THEN
    ~e o.result INTO ~Q FROM ~B o ~i o.request_id=~W;
    ~t:=r.expires_at<~p();
    ~j:=EXISTS(~e 1 FROM ~D ~i ~H=~W);
    IF _step='read' THEN
      ~Z:=~S(~Q,~4)||~K(
        '~z',~Q IS NOT NULL,'~t',~t,'~j',~j,
        'source_current',~T=r.source_version,'~5',~d->'~o');
      ~b ~a('~G',~S(~N,''),true); ~6 ~Z;
    END IF;
    IF _step='cancel' THEN
      IF ~Q IS NULL THEN
        INSERT INTO ~D(~H) VALUES(~W) ON CONFLICT DO NOTHING;
      END IF;
      ~Z:=~K('~j',~Q IS NULL,'~z',~Q IS NOT NULL,'~H',~W);
      ~b ~a('~G',~S(~N,''),true); ~6 ~Z;
    END IF;
    IF _step='save' THEN
      IF _p->'confirmed' IS ~E FROM 'true'::~U THEN
        ~X ~F '~O:Explicitly confirm the exact source, split ~J and replacement values.';
      END IF;
      IF ~Q IS NOT NULL THEN
        ~Z:=~Q||~K('already_applied',true,'source_current',~T=r.source_version,'~5',~d->'~o');
        ~b ~a('~G',~S(~N,''),true); ~6 ~Z;
      END IF;
      IF ~t OR ~j THEN ~X ~F '~O:Review ~t or cancelled. Start a new review.'; END IF;
      IF ~T<>r.observed_source_version OR (~d->>'~o')::~w<>~Y THEN
        ~X ~F '~O:Source or ~I changed since review. Read current state and ~s again.';
      END IF;
    END IF;
  END IF;
  IF _step='~s' THEN
    ~h:=encode(sha256(convert_to(_p::text,'UTF8')),'hex');
    IF r.request_id IS NOT NULL THEN
      IF r.payload_hash IS ~E FROM ~h THEN ~X ~F '~O:This request identifies different facts.'; END IF;
      IF ~Q IS NOT NULL THEN
        ~b ~a('~G',~S(~N,''),true); ~6 ~Q||~K('already_applied',true);
      END IF;
      IF ~t OR ~j OR ~T<>r.observed_source_version OR
         (~d->>'~o')::~w<>~Y THEN
        ~X ~F '~O:Review changed, ~t or cancelled. Read and ~s again.';
      END IF;
      ~b ~a('~G',~S(~N,''),true); ~6 ~4;
    END IF;
    IF ~g(_p->'~3') IS ~E FROM 'number' OR
       (_p->>'~3')!~'^\d+$' OR
       (_p->>'~3')::numeric<> (~d->>'~o')::~w OR
       ~g(_p->'allow_historical') IS ~E FROM 'boolean' THEN
      ~X ~F '~O:Choose the current ~I ~o and explicit historical-source decision.';
    END IF;
    ~e * INTO s FROM ~R
      ~i id=(_p->>'snapshot_id')::uuid AND ~8=_job AND ~7=cid;
    IF NOT FOUND THEN ~X ~F '~O:Immutable source is unavailable on this job.'; END IF;
    IF ~m<>~T AND _p->'allow_historical' IS ~E FROM 'true'::~U THEN
      ~X ~F '~O:Explicitly choose historical source or ~s the current estimate.';
    END IF;
    ~L:=_p->>'~L'; ~c:=_p->>'~k';
    IF ~L IS NULL OR octet_length(~L)>8388608 OR
       ~c !~ '^[a-f0-9]{64}$' OR
       encode(sha256(convert_to(~L,'UTF8')),'hex') IS ~E FROM ~c THEN
      ~X ~F '~O:Trusted calculation fingerprint does not match.';
    END IF;
    ~1:=~L::~U;
    IF ~1->'schema' IS ~E FROM '1'::~U OR
       ~1->>'companyId' IS ~E FROM cid::text OR ~1->>'jobId' IS ~E FROM _job::text OR
       ~1->'snapshot' IS ~E FROM s.source_data THEN
      ~X ~F '~O:Calculation does not identify the immutable source.';
    END IF;
    IF octet_length(~S(_p->>'mapping_json','')) NOT BETWEEN 2 AND 4194304 THEN
      ~X ~F '~O:Trusted ~J is missing or too large.';
    END IF;
    ~J:=(_p->>'mapping_json')::~U;
    IF ~J->>'kind' IS ~E FROM _p->>'kind' OR
       ~J->'plan'->>'kind' IS ~E FROM _p->>'kind' OR
       ~g(~J->'facts') IS ~E FROM 'object' OR
       ~g(~J->'terms') IS ~E FROM 'object' OR
       ~g(~J->'target_keys') IS ~E FROM 'array' OR
       ~g(~J->'~r') IS ~E FROM 'array' OR
       ~J->'~s'->'source_total_cents' IS ~E FROM ~1->'breakdown'->'totalCents' THEN
      ~X ~F '~O:Trusted ~J does not reconcile to its source.';
    END IF;
    ~P:=CASE WHEN _p->>'kind'='~x' THEN '~x' ELSE 'sov:'||(~J->>'copy') END;
    IF ~P IS NULL OR ~P NOT IN ('~x','sov:official','sov:draft') OR
       EXISTS(~e 1 FROM jsonb_object_keys(~J->'facts') k ~i k<>CASE ~P WHEN '~x' THEN '~x' WHEN 'sov:official' THEN 'sov' ELSE 'sov_draft' END) OR
       EXISTS(~e 1 FROM jsonb_object_keys(~J->'terms') k ~i
         CASE ~P WHEN '~x' THEN true WHEN 'sov:official' THEN k NOT IN ('sov_fee_pct','sov_basis') ELSE k NOT IN ('sov_draft_fee_pct','sov_draft_basis') END) THEN
      ~X ~F '~O:Mapping attempts to change an unreviewed destination.';
    END IF;
    ~M:=nullif(_p->>'~v','')::uuid;
  ELSE
    ~P:=r.destination; ~M:=r.correction_of; ~J:=r.mapping;
  END IF;
  ~e old.request_id INTO latest
    FROM ~A old
    JOIN ~B o ON o.request_id=old.request_id
    ~i old.job_id=_job AND old.destination=~P ORDER BY o.accepted_seq DESC LIMIT 1;
  IF latest IS ~E FROM ~M THEN
    ~X ~F '~O:Review the latest ~z handoff explicitly before replacing its ~I allocation.';
  END IF;
  ~9:='[]'::~U;
  IF ~M IS NOT NULL THEN
    ~e * INTO prior FROM ~A ~i ~H=~M;
    IF EXISTS(~e 1 FROM jsonb_array_elements(prior.mapping->'target_keys') old
      ~i NOT EXISTS(~e 1 FROM jsonb_array_elements(~J->'target_keys') cur ~i cur=old)) THEN
      ~X ~F '~O:Explicitly map or zero every previous ~I target before replacing its allocation.';
    END IF;
    ~e ~S(jsonb_agg(~K('~0',c.component_id,'prior_request',c.request_id)),'[]') INTO ~9
      FROM ~C c ~i c.job_id=_job AND c.destination=~P AND c.request_id=~M;
  END IF;
  IF EXISTS(~e 1 FROM jsonb_array_elements_text(~J->'~r') component
      JOIN ~C c ON c.job_id=_job AND c.destination=~P AND c.component_id=component
      ~i c.request_id IS ~E FROM ~M) THEN
    ~X ~F '~O:A source component is already allocated by another active handoff.';
  END IF;
  IF _step='save' THEN
    facts:=~J->'facts'; terms:=~J->'terms';
    saved:=public.mcp_estimate_destination_save(
      _job,~Y,
      facts->'~x',facts->'sov',facts->'sov_draft',
      (terms->>'sov_fee_pct')::numeric,terms->>'sov_basis',
      (terms->>'sov_draft_fee_pct')::numeric,terms->>'sov_draft_basis');
    ~Z:=~4||~K(
      'status','~z','~z',true,'destination_version',saved->'~o',
      'released_components',~9,'commitment_approval',false,'payment_authorization',false);
    INSERT INTO ~B(~H,~Z) VALUES(~W,~Z);
    IF ~M IS NOT NULL THEN DELETE FROM ~C
      ~i ~8=_job AND ~I=~P AND ~H=~M; END IF;
    INSERT INTO ~C(~8,~I,~0,~H)
      ~e _job,~P,c,~W FROM jsonb_array_elements_text(~J->'~r') c;
    ~b ~a('~G',~S(~N,''),true); ~6 ~Z;
  END IF;
  ~Z:=~K(
    'status','~s','~z',false,'~H',~W,'~I',~P,
    'source_snapshot_id',s.id,'source_version',~m,'source_current',~m=~T,
    'source_sha256',s.source_sha256,'~k',~c,'calculation_schema',1,
    'destination_before',~d,
    '~f',~d->'~o','reason',_p->>'reason',
    '~J',~J,'~v',~M,'released_components',~9,
    'previous_handoff',CASE WHEN ~M IS NULL THEN NULL ELSE prior.review_result-'previous_handoff'-'destination_before' END);
  INSERT INTO ~A(
    ~H,actor,~7,~8,~I,snapshot_id,source_version,
    observed_source_version,~f,~v,
    ~L,~k,~J,~h,review_result)
  VALUES(~W,_actor,cid,_job,~P,s.id,~m,~T,
    (~d->>'~o')::~w,~M,~L,~c,~J,~h,~Z);
  ~b ~a('~G',~S(~N,''),true); ~6 ~Z;
END $$;
REVOKE ALL ON ~y ~V(uuid,uuid,text,uuid,~U) FROM PUBLIC,anon,~u;
GRANT EXECUTE ON ~y ~V(uuid,uuid,text,uuid,~U) TO service_role;
$encoded_payload$;
  dict jsonb := $dictionary$["mcp_private.estimate_facts_handoff_reviews","mcp_private.estimate_facts_handoff_operations","mcp_private.estimate_facts_handoff_claims","mcp_private.estimate_facts_handoff_cancellations","DISTINCT","EXCEPTION","request.jwt.claims","request_id","destination","mapping","jsonb_build_object","canonical_json","correction","previous_claims","MCP_BAD","dest_key","operation","mcp_private.estimate_source_snapshot","coalesce","source_now","jsonb","public.mcp_estimate_facts_handoff","_request","RAISE","r.expected_destination_version","result","set_config","PERFORM","canonical_sha","dest_now","SELECT","expected_destination_version","jsonb_typeof","payload_hash","WHERE","cancelled","canonical_sha256","public.mcp_block_change","s.source_version","REFERENCES","version","clock_timestamp","public.mcp_jobs","allocated_components","review","expired","authenticated","correction_of","bigint","budget","FUNCTION","accepted","component_id","receipt","CREATE","expected_version","r.review_result","destination_current_version","RETURN","company_id","job_id","released"]$dictionary$::jsonb;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  i integer;
BEGIN
  FOR i IN 0..jsonb_array_length(dict)-1 LOOP
    payload := replace(payload, '~' || substr(alphabet, i+1, 1), dict->>i);
  END LOOP;
  IF encode(sha256(convert_to(payload, 'UTF8')), 'hex') IS DISTINCT FROM '9486fb9470c2765059ab803ff3f2598096853688bc09210ef793f7e0a0cab3d3' THEN
    RAISE EXCEPTION 'Migration payload SHA-256 mismatch';
  END IF;
  EXECUTE payload;
END
$short_verified_migration$;