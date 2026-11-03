DO $short_verified_migration$
DECLARE
  payload text := $encoded_payload$-- LOCAL UNAPPLIED PROPOSAL. Requires the ~u-snapshot proposal and the
-- existing supplier/buyout workflow. One NEW service_role EXECUTE grant needs
-- specific access review before any Lovable installation. No ~7
-- EXECUTE surface is added. The server verifies the member and calculates the
-- immutable ~u; ordinary clients cannot attest a calculation or actor.
-- Existing ~4 review/record functions remain the only ~0 writer.
CREATE TABLE ~A (
  ~M uuid PRIMARY KEY, actor uuid NOT NULL, ~9 uuid NOT NULL,
  job_id uuid NOT NULL ~x ~z(id), snapshot_id uuid NOT NULL ~x ~b(id),
  ~l bigint NOT NULL, observed_version bigint NOT NULL,
  package_id uuid NOT NULL, ~U integer NOT NULL, buyout_review uuid NOT NULL, ~c uuid,
  payload_hash text NOT NULL, ~N text NOT NULL, ~Y text NOT NULL,
  ~I ~S NOT NULL, facts ~S NOT NULL, ~t text NOT NULL, review_result ~S NOT NULL
);
CREATE TABLE ~B (
  ~M uuid PRIMARY KEY ~x ~A(~M),
  ~g ~S NOT NULL, accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ~C (
  job_id uuid NOT NULL ~x ~z(id), ~Q text NOT NULL,
  ~M uuid NOT NULL ~x ~B(~M),
  PRIMARY KEY(job_id,~Q)
);
REVOKE ALL ON ~A,~B,~C FROM PUBLIC,anon,~7;
CREATE TRIGGER estimate_handoff_reviews_immutable BEFORE UPDATE OR DELETE ON ~A FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER estimate_handoff_operations_immutable BEFORE UPDATE OR DELETE ON ~B FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
-- Claims are a private active projection; corrections replace them atomically.
-- Reviews and operations retain the immutable acceptance/retirement history.
ALTER TABLE ~A ADD FOREIGN KEY (~c)
  ~x ~B(~M);

CREATE FUNCTION ~f(_job uuid,_actor uuid,_step text,~V uuid,_p ~S) RETURNS ~S
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ~W text:=current_setting('~L',true); cid uuid; ver bigint;
  rev ~A; src ~b;
  target ~a; prior ~S; facts ~S; ~g ~S; op ~S;
  payload ~S; b ~S; ~J ~S; ~I ~S; x ~S; comp ~S;
  mapped bigint:=0; excluded bigint:=0; included integer:=0; total numeric;
  ~m text; ~N text; hash text; ~t text; review_id uuid;
  ~e uuid; latest uuid; released ~S; ~1 ~S;
BEGIN
  IF _actor IS NULL OR _job IS NULL OR ~V IS NULL OR ~T(_step,'') NOT IN ('review','save','read','cancel') THEN ~P ~E '~H:An exact member, job and request are required.'; END IF;
  ~d ~q('~L',~F('sub',_actor,'role','~7')::text,true);
  ~K ~9 INTO cid FROM ~z ~Z id=_job;
  ~d mcp_private.buyout_access(cid,_job,true);
  -- Match the ~0's existing company-before-job lock order.
  ~d 1 FROM public.mcp_companies ~Z id=cid FOR UPDATE;
  ~d 1 FROM ~z ~Z id=_job FOR UPDATE;
  ver:=mcp_private.estimate_lock(_job);
  ~d mcp_private.buyout_access(cid,_job,true);
  IF public.mcp_estimate_guard(_job) IS ~G FROM cid THEN ~P ~E 'MCP_NO_ACCESS'; END IF;
  ~K * INTO rev FROM ~A ~Z ~M=~V;
  IF FOUND AND (rev.actor IS ~G FROM _actor OR rev.company_id IS ~G FROM cid OR rev.job_id IS ~G FROM _job) THEN ~P ~E '~H:This request belongs to another review.'; END IF;
  IF _step IN ('read','cancel','save') AND rev.request_id IS NULL THEN ~P ~E '~H:Review the exact frozen ~u and ~0 first.'; END IF;
  IF rev.request_id IS NOT NULL THEN
    ~K saved.result INTO op FROM ~B saved ~Z saved.request_id=~V;
    IF _step='read' THEN
      ~g:=~T(op,~k)||~F(
        '~v', op IS NOT NULL,
        '~2', rev.source_version=ver,
        'destination_current_version', (~K version FROM ~a ~Z id=~X),
        'cancelled', ~T((~K cancelled FROM ~r ~Z id=~j),false),
        'expired', ~T((~K expires_at<clock_timestamp() FROM ~r ~Z id=~j),true)
      );
      ~d ~q('~L',~T(~W,''),true); RETURN ~g;
    END IF;
    IF _step='cancel' THEN
      ~g:=public.mcp_buyout_review_cancel(cid,_job,~j)||~F('~M',~V,'~h',rev.snapshot_id);
      ~d ~q('~L',~T(~W,''),true); RETURN ~g;
    END IF;
    IF _step='save' THEN
      IF _p->'confirmed' IS ~G FROM 'true'::~S THEN ~P ~E '~H:Explicitly confirm the reviewed mapping and replacement budget.'; END IF;
      IF op IS NOT NULL THEN
        ~g:=op||~F(
          'already_applied',true,
          '~2',rev.source_version=ver,
          'destination_current_version',(~K version FROM ~a ~Z id=~X)
        );
        ~d ~q('~L',~T(~W,''),true); RETURN ~g;
      END IF;
      IF ver<>rev.observed_version THEN ~P ~E '~H:Estimate changed since ~0 review. Read and review again.'; END IF;
      ~K ~O INTO latest
        FROM ~A r
        JOIN ~B o ON o.request_id=~O
        ~Z r.job_id=_job AND ~n=~X
        ORDER BY (o.result->>'version')::integer DESC,o.accepted_at DESC LIMIT 1;
      IF latest IS ~G FROM ~s THEN
        ~P ~E '~H:The prior ~v handoff changed. Read and explicitly review the latest correction.';
      END IF;
      IF EXISTS(
        ~K 1 FROM ~D(rev.allocations) a
        JOIN ~C c ON c.job_id=_job AND ~o=a->>'~Q'
        JOIN ~A r ON ~O=~y
        ~Z a->'include'='true'::~S AND (~s IS NULL OR ~n<>~X)
      ) THEN ~P ~E '~H:A component is active on another package. Explicitly release it there before reallocating.'; END IF;
      ~g:=public.mcp_buyout_record(cid,_job,~X,'~4',rev.expected_version,rev.facts,rev.reason,~V,~j,true);
      ~g:=~k||~g||~F(
        'status', '~v',
        '~v', true,
        '~M', ~V,
        '~h', rev.snapshot_id,
        '~l', rev.source_version,
        '~Y', rev.canonical_sha256,
        'calculation_schema', 1,
        '~I', rev.allocations,
        '~c', ~s,
        '~5', ~k->'~5',
        'source_was_current_at_review', ~k->'~2',
        'effect', '~6',
        'commitment_approval', false,
        'payment_authorization', false
      );
      INSERT INTO ~B(~M,~g) VALUES(~V,~g);
      IF ~s IS NOT NULL THEN
        DELETE FROM ~C c
          USING ~A r
          ~Z c.job_id=_job AND ~y=~O AND ~n=~X;
      END IF;
      INSERT INTO ~C(job_id,~Q,~M)
        ~K _job,a->>'~Q',~V FROM ~D(rev.allocations) a ~Z a->'include'='true'::~S;
      ~d ~q('~L',~T(~W,''),true); RETURN ~g;
    END IF;
  END IF;
  IF _step<>'review' THEN ~P ~E '~H:Review before accepting.'; END IF;
  hash:=encode(sha256(convert_to(_p::text,'UTF8')),'hex');
  IF rev.request_id IS NOT NULL THEN
    IF hash IS ~G FROM rev.payload_hash THEN ~P ~E '~H:Request already identifies different facts. Start a new review.'; END IF;
    ~d public.mcp_buyout_review(cid,_job,~X,'~4',rev.expected_version,rev.facts,rev.reason,~V,~j);
    ~d ~q('~L',~T(~W,''),true); RETURN ~k;
  END IF;
  IF ~R(_p->'allow_historical') IS ~G FROM 'boolean' OR ~R(_p->'~U') IS ~G FROM 'number' OR (_p->>'~U')!~'^\d+$' OR (_p->>'~U')::numeric NOT BETWEEN 1 AND 2147483645 THEN ~P ~E '~H:Use a current ~0 version and explicit historical-~u choice.'; END IF;
  ~K * INTO src FROM ~b ~Z id=(_p->>'snapshot_id')::uuid AND job_id=_job AND ~9=cid;
  IF NOT FOUND THEN ~P ~E '~H:Saved ~u is unavailable on this job.'; END IF;
  IF ~i<>ver AND _p->'allow_historical' IS ~G FROM 'true'::~S THEN ~P ~E '~H:Explicitly review historical ~u or choose the current estimate.'; END IF;
  ~N:=_p->>'~N'; ~m:=_p->>'~Y';
  IF ~N IS NULL OR octet_length(~N)>8388608 OR ~m !~ '^[0-9a-f]{64}$' OR encode(sha256(convert_to(~N,'UTF8')),'hex') IS ~G FROM ~m THEN ~P ~E '~H:Trusted calculation fingerprint does not match.'; END IF;
  payload:=~N::~S; b:=payload->'breakdown';
  IF payload->'schema' IS ~G FROM '1'::~S OR payload->>'companyId' IS ~G FROM cid::text OR payload->>'jobId' IS ~G FROM _job::text OR payload->'snapshot' IS ~G FROM src.source_data THEN ~P ~E '~H:Calculation does not identify the immutable source.'; END IF;
  IF ~R(b->'direct') IS ~G FROM 'array' OR ~R(b->'generalConditions') IS ~G FROM 'array' OR ~R(b->'requirements') IS ~G FROM 'array' THEN ~P ~E '~H:Incomplete calculated components.'; END IF;
  ~K jsonb_agg(c) INTO ~J FROM (
    ~K ~F('id','direct:'||(v->>'ref'),'~8',v->'amountCents') c FROM ~D(b->'direct') v
    UNION ALL ~K ~F('id','gc:'||~T(v->>'ref',v->>'label'),'~8',v->'amountCents') FROM ~D(b->'generalConditions') v
    UNION ALL ~K ~F('id','requirement:'||(v->>'ref'),'~8',v->'amountCents') FROM ~D(b->'requirements') v
    UNION ALL ~K ~F('id','overhead','~8',b->'overheadCents')
    UNION ALL ~K ~F('id','profit','~8',b->'profitCents')
  ) q;
  IF EXISTS(~K 1 FROM ~D(~J) c ~Z c->>'id' IS NULL OR ~R(c->'~8') IS ~G FROM 'number' OR (c->>'~8')!~'^\d+$' OR (c->>'~8')::numeric>9007199254740991) OR (~K count(*) FROM ~D(~J))<>(~K count(~G c->>'id') FROM ~D(~J) c) THEN ~P ~E '~H:Ambiguous or invalid calculated components.'; END IF;
  ~K sum((c->>'~8')::numeric) INTO total FROM ~D(~J) c;
  IF ~R(b->'totalCents') IS ~G FROM 'number' OR total>9007199254740991 OR total IS ~G FROM (b->>'totalCents')::numeric THEN ~P ~E '~H:Calculated ~J do not reconcile.'; END IF;
  ~I:=_p->'~I';
  IF ~R(~I) IS ~G FROM 'array' OR ~p(~I)<>~p(~J) OR ~p(~I)>2000 OR (~K count(~G a->>'~Q') FROM ~D(~I) a)<>~p(~I) THEN ~P ~E '~H:Choose each component exactly once.'; END IF;
  FOR x IN ~K * FROM ~D(~I) LOOP
    ~d mcp_private.buyout_shape(x,'{"~Q":"text","include":"boolean","exclusion_reason":"text?"}');
    IF ~R(x->'include') IS ~G FROM 'boolean' THEN ~P ~E '~H:An inclusion must be a boolean.'; END IF;
    ~K c INTO comp FROM ~D(~J) c ~Z c->>'id'=x->>'~Q';
    IF NOT FOUND THEN ~P ~E '~H:Unknown ~u component.'; END IF;
    IF x->'include'='true'::~S THEN
      IF x->'exclusion_reason' IS ~G FROM 'null'::~S THEN ~P ~E '~H:Included ~J cannot also be excluded.'; END IF;
      mapped:=mapped+(comp->>'~8')::bigint; included:=included+1;
    ELSE
      IF ~T(length(btrim(x->>'exclusion_reason')),0)=0 THEN ~P ~E '~H:Give an explicit ~t for every excluded component.'; END IF;
      excluded:=excluded+(comp->>'~8')::bigint;
    END IF;
  END LOOP;
  IF mapped>9000000000000 THEN ~P ~E '~H:Choose ~J within the existing ~4 budget limit.'; END IF;
  ~K * INTO target FROM ~a ~Z id=(_p->>'package_id')::uuid AND ~9=cid AND job_id=_job AND kind='~4' AND version=(_p->>'~U')::integer;
  IF NOT FOUND THEN ~P ~E '~H:Destination changed or is unavailable. Read and review again.'; END IF;
  IF ~T(~R(_p->'~c'),'null') NOT IN ('null','string') THEN
    ~P ~E '~H:Choose the exact prior ~v handoff for a correction.';
  END IF;
  ~e:=(_p->>'~c')::uuid;
  ~K ~O INTO latest
    FROM ~A r
    JOIN ~B o ON o.request_id=~O
    ~Z r.job_id=_job AND ~n=~w
    ORDER BY (o.result->>'version')::integer DESC,o.accepted_at DESC LIMIT 1;
  IF ~e IS ~G FROM latest THEN
    IF latest IS NULL THEN ~P ~E '~H:This ~4 has no ~v handoff to correct.'; END IF;
    ~P ~E '~H:Explicit ~e required. Choose the latest ~v handoff for this package.';
  END IF;
  IF included=0 AND ~e IS NULL THEN
    ~P ~E '~H:Choose included ~J, or explicitly correct a prior handoff to release all.';
  END IF;
  IF EXISTS(
    ~K 1 FROM ~D(~I) a
    JOIN ~C c ON c.job_id=_job AND ~o=a->>'~Q'
    JOIN ~A r ON ~O=~y
    ~Z a->'include'='true'::~S AND (~e IS NULL OR ~n<>~w)
  ) THEN ~P ~E '~H:A component is active on another package. Explicitly release it there before reallocating.'; END IF;
  ~K ~T(jsonb_agg(~F(
    '~Q',~o,'~M',~y,
    'amount_cents',(~K part->'~8' FROM ~D(r.review_result->'~J') part ~Z part->>'id'=~o),
    '~h',r.snapshot_id,'~l',r.source_version
  ) ORDER BY ~o),'[]'::~S) INTO released
    FROM ~C c
    JOIN ~A r ON ~O=~y
    ~Z c.job_id=_job AND ~n=~w;
  ~K ~F(
    '~M',~O,'package_version',o.result->'version',
    'budget_cents',r.review_result->'proposed_budget_cents','~I',r.allocations,
    '~J',r.review_result->'~J','~h',r.snapshot_id,
    '~l',r.source_version,'~Y',r.canonical_sha256
  ) INTO ~1
    FROM ~A r
    JOIN ~B o ON o.request_id=~O
    ~Z ~O=~e;
  ~K v.facts INTO prior FROM public.mcp_buyout_versions v ~Z v.record_id=~w AND v.version=~3;
  IF prior->>'status'='cancelled' THEN ~P ~E '~H:A cancelled ~4 cannot receive a handoff.'; END IF;
  ~t:=_p->>'~t';
  IF ~T(length(btrim(~t)),0) NOT BETWEEN 1 AND 1000 THEN ~P ~E '~H:Give the explicit mapping ~u and reason.'; END IF;
  facts:=prior||~F('budget_cents',mapped,'~u','Estimate snapshot '||src.id::text||' v'||~i::text||'; handoff '||~V::text||'. '||~t);
  review_id:=gen_random_uuid();
  ~d public.mcp_buyout_review(cid,_job,~w,'~4',~3,facts,~t,~V,review_id);
  ~g:=~F(
    'status', 'review',
    '~v', false,
    'expires_at', (~K expires_at FROM ~r ~Z id=review_id),
    '~M', ~V,
    '~h', src.id,
    '~l', ~i,
    '~2', ~i=ver,
    'source_sha256', src.source_sha256,
    '~Y', ~m,
    'calculation_schema', 1,
    'package_id', ~w,
    '~U', ~3,
    '~c', ~e,
    '~1', ~1,
    '~5', released,
    '~t', ~t,
    'previous_source', prior->>'~u',
    'proposed_source', facts->>'~u',
    'previous_budget_cents', prior->'budget_cents',
    'proposed_budget_cents', mapped,
    'excluded_cents', excluded,
    'source_total_cents', total,
    '~J', ~J,
    '~I', ~I,
    'preserved_package_facts', prior-'budget_cents'-'~u',
    'effect', '~6'
  );
  INSERT INTO ~A(~M,actor,~9,job_id,snapshot_id,~l,observed_version,package_id,~U,buyout_review,~c,payload_hash,~N,~Y,~I,facts,~t,review_result)
    VALUES(~V,_actor,cid,_job,src.id,~i,ver,~w,~3,review_id,~e,hash,~N,~m,~I,facts,~t,~g);
  ~d ~q('~L',~T(~W,''),true); RETURN ~g;
END $$;
REVOKE ALL ON FUNCTION ~f(uuid,uuid,text,uuid,~S) FROM PUBLIC,anon,~7;
GRANT EXECUTE ON FUNCTION ~f(uuid,uuid,text,uuid,~S) TO service_role;
$encoded_payload$;
  dict jsonb := $dictionary$["mcp_private.estimate_handoff_reviews","mcp_private.estimate_handoff_operations","mcp_private.estimate_handoff_component_claims","jsonb_array_elements","EXCEPTION","jsonb_build_object","DISTINCT","MCP_BAD","allocations","components","SELECT","request.jwt.claims","request_id","canonical_json","r.request_id","RAISE","component_id","jsonb_typeof","jsonb","coalesce","expected_version","_request","previous_claims","rev.package_id","canonical_sha256","WHERE","public.mcp_buyout_records","mcp_private.estimate_source_snapshot","correction_of","PERFORM","correction","public.mcp_estimate_buyout_handoff","result","source_snapshot_id","src.source_version","rev.buyout_review","rev.review_result","source_version","canonical_sha","r.package_id","c.component_id","jsonb_array_length","set_config","public.mcp_buyout_reviews","rev.correction_of","reason","source","accepted","target.id","REFERENCES","c.request_id","public.mcp_jobs","destination","prior_accepted","source_current","target.version","package","released_components","replace_internal_package_budget_only","authenticated","cents","company_id"]$dictionary$::jsonb;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  i integer;
BEGIN
  FOR i IN 0..jsonb_array_length(dict)-1 LOOP
    payload := replace(payload, '~' || substr(alphabet, i+1, 1), dict->>i);
  END LOOP;
  IF encode(sha256(convert_to(payload, 'UTF8')), 'hex') IS DISTINCT FROM '96f481a4ec56699b9a464df180a27941ded93f94b567694d1265f4189c6ae11c' THEN
    RAISE EXCEPTION 'Migration payload SHA-256 mismatch';
  END IF;
  EXECUTE payload;
END
$short_verified_migration$;