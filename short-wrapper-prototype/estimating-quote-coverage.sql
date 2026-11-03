DO $short_verified_migration$
DECLARE
  payload text := $encoded_payload$-- Local review proposal only. Do not apply without migration/security review.
-- Requires the estimating tables, drawing/takeoff engine, and the separately
-- reviewed VOLATILE correction for estimating reads. Existing ACLs are unchanged.
-- New callable RPCs use the same mcp_estimate_guard as the existing estimate RPCs.
-- Legacy mcp_estimate_pricing_save remains callable. Quote comparisons are
-- append-only: editing/removing old entries now rejects; append the revised ~6
-- and classify the older ~6 as comparison until a reviewed removal workflow
-- exists. This deliberately changes legacy ~6-replacement behavior. Legacy
-- rate and factor-~t saves may create, preserve or append unique entries;
-- changing/removing an existing entry requires a ~O-checked save.
-- Native multi-session PostgreSQL concurrency/deadlock tests are mandatory before
-- release. Legacy ~z can lock a tuple before its BEFORE trigger gets the job
-- lock while a versioned writer holds the job lock and waits on the tuple. Postgres
-- aborts a deadlock victim atomically; callers must re-read before any retry.

~r TABLE ~G (
  ~U uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  ~O ~d NOT NULL DEFAULT 0
);
~r TABLE ~H (
  ~U uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  ~n uuid NOT NULL,
  actor uuid NOT NULL,
  ~O ~d NOT NULL,
  input ~M NOT NULL,
  ~p ~M NOT NULL,
  saved_version ~d,
  PRIMARY KEY(~U, ~n)
);
~r TABLE ~T (
  ~U uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  ~n uuid NOT NULL,
  actor uuid NOT NULL,
  ~O ~d NOT NULL,
  ~p ~M NOT NULL
);

-- A single advisory transaction lock is taken before every ~t-table write
-- and by all snapshot/review/save operations. Hash collisions only serialize
-- unrelated jobs. The ~O row and all writes roll back with the transaction.
~r ~L ~B(_job uuid) ~3 ~d
~v ~4 ~5 DEFINER SET ~a=~m,pg_temp AS $$
~2 v ~d;
BEGIN
  ~e pg_advisory_xact_lock(hashtextextended('estimate-coverage:' || _job::text, 0));
  INSERT INTO ~G(~U) VALUES(_job) ON CONFLICT DO NOTHING;
  ~S ~O INTO v FROM ~G ~y ~U=_job FOR ~z;
  ~w v;
END $$;
REVOKE ALL ON ~L ~B(uuid) FROM PUBLIC, anon, ~W;

~r ~L ~x() ~3 trigger
~v ~4 ~5 DEFINER SET ~a=~m,pg_temp AS $$
~2 j uuid;
BEGIN
  j := CASE WHEN TG_OP='DELETE' THEN ~9 ELSE ~8 END;
  IF TG_OP='~z' AND ~9 IS ~F FROM ~8 THEN
    -- Invalidate both jobs, taking the advisory locks in deterministic order.
    IF ~9::text < ~8::text THEN
      ~e ~B(~9);
      ~e ~B(~8);
    ELSE
      ~e ~B(~8);
      ~e ~B(~9);
    END IF;
    ~z ~G SET ~O=~O+1 ~y ~U IN (~9,~8);
    ~w NEW;
  END IF;
  ~e ~B(j);
  ~z ~G SET ~O=~O+1 ~y ~U=j;
  ~w CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON ~L ~x() FROM PUBLIC, anon, ~W;

~r ~L ~i() ~3 trigger
~v ~4 SET ~a=~m,pg_temp AS $$
BEGIN
  IF ~A(OLD.quotes) IS ~F FROM 'array' OR ~A(NEW.quotes) IS ~F FROM 'array' THEN
    ~R ~D '~J:Existing ~s must be preserved as an array.';
  END IF;
  IF EXISTS (
    ~S 1 FROM (~S value, count(*) AS n FROM ~P(OLD.quotes) GROUP BY value) o
    LEFT JOIN (~S value, count(*) AS n FROM ~P(NEW.quotes) GROUP BY value) n ON n.value=o.value
    ~y ~K(n.n,0)<o.n
  ) THEN
    ~R ~D '~J:Existing ~s cannot be removed or changed. Refresh and append the revised ~6; keep the earlier ~6 for comparison.';
  END IF;
  ~w NEW;
END $$;
REVOKE ALL ON ~L ~i() FROM PUBLIC, anon, ~W;
~r TRIGGER estimate_preserve_quotes BEFORE ~z OF ~s ON ~N
  FOR EACH ROW ~7 ~L ~i();

DO $$
~2 tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'mcp_estimate_setup','mcp_estimate_takeoffs','mcp_estimate_takeoff_lines',
    'mcp_estimate_gap_items','mcp_estimate_verdicts','mcp_estimate_pricing',
    'mcp_estimate_general_conditions','mcp_estimate_requirements','mcp_estimate_bids',
    'mcp_takeoff_calibrations','mcp_takeoff_geometry','mcp_takeoff_markups','mcp_drawing_versions'
  ] LOOP
    ~7 format('~r TRIGGER estimate_coverage_changed BEFORE INSERT OR ~z OR DELETE ON public.%I FOR EACH ROW ~7 ~L ~x()',tbl);
  END LOOP;
END $$;

~r ~L ~h(_job uuid) ~3 ~M
~v ~4 ~5 DEFINER SET ~a=~m,pg_temp AS $$
~2 v ~d; selected ~T;
BEGIN
  ~e ~C(_job);
  v := ~B(_job);
  -- The job lock can wait while membership or job scope changes.
  ~e ~C(_job);
  ~S * INTO selected FROM ~T ~y ~U=_job;
  ~w ~I('~O',v,'estimate',public.mcp_estimate_get(_job),
    'takeoff',public.mcp_takeoff_get(_job),'bid',public.mcp_estimate_bid_get(_job),
    'capabilities',~I('gc_requirements_cas',
      to_regprocedure('mcp_private.estimate_gc_requirements_cas_marker()') IS NOT NULL),
    'requirements_max_ref',~K((~S max(substring(ref from 3)::~f) FROM public.mcp_estimate_requirements ~y ~U=_job AND ref ~ '^R-[0-9]+$'),0),
    'selection',CASE WHEN selected.job_id IS NULL THEN NULL ELSE ~I(
      '~O',selected.version,'current',selected.version=v,'~p',selected.decisions) END);
END $$;
REVOKE ALL ON ~L ~h(uuid) FROM PUBLIC,anon,service_role;
GRANT ~7 ON ~L ~h(uuid) TO ~W;

~r ~L ~l(_job uuid,~j uuid,~Q ~d,_decisions ~M) ~3 ~M
~v ~4 ~5 DEFINER SET ~a=~m,pg_temp AS $$
~2 v ~d; old ~H; ~s ~M; d ~M; q ~M; ln ~M;
  idx integer; r text; choice text; result ~M := '[]'::~M; seen integer[] := '{}'; carried text[] := '{}'; tid uuid;
BEGIN
  ~e ~C(_job);
  IF ~j IS NULL OR auth.uid() IS NULL OR ~Q IS NULL OR ~A(_decisions) IS ~F FROM 'array' THEN
    ~R ~D '~J:Review needs a request, current ~O and ~6 decisions.';
  END IF;
  v := ~B(_job);
  ~e ~C(_job);
  ~S * INTO old FROM ~H ~y ~U=_job AND ~n=~j;
  IF FOUND THEN
    IF old.actor IS ~F FROM auth.uid() OR old.version <> ~Q OR old.input <> _decisions THEN
      ~R ~D '~J:This request already identifies a different review.';
    END IF;
    ~w ~I('request',~j,'~O',~K(old.saved_version,old.version),
      'current',~K(old.saved_version,old.version)=v,'status',CASE WHEN old.saved_version IS NULL THEN 'review' ELSE 'saved' END,'~p',old.decisions);
  END IF;
  IF v <> ~Q THEN ~R ~D '~J:Estimate changed. Refresh and review ~6 coverage again.'; END IF;
  ~S ~K(p.quotes,'[]'::~M) INTO ~s FROM ~N p ~y p.job_id=_job;
  ~s:=~K(~s,'[]'::~M);
  IF ~A(~s) <> 'array' OR ~1(~s)=0 OR ~1(_decisions) <> ~1(~s) THEN
    ~R ~D '~J:Review every current ~6 exactly once.';
  END IF;
  ~S id INTO tid FROM public.mcp_estimate_takeoffs ~y ~U=_job ORDER BY ~O DESC LIMIT 1;
  FOR d IN ~S value FROM ~P(_decisions) LOOP
    IF ~A(d) <> 'object' OR ~K(d->>'quote_index','') !~ '^(0|[1-9][0-9]{0,3})$' THEN
      ~R ~D '~J:Each decision needs a current ~6 index.';
    END IF;
    idx := (d->>'quote_index')::int;
    IF idx >= ~1(~s) OR idx=ANY(seen) THEN ~R ~D '~J:Quote indices must identify each ~6 exactly once.'; END IF;
    seen := array_append(seen,idx);
    q := ~s->idx; choice:=d->>'decision'; r:=nullif(btrim(d->>'ref'),'');
    IF choice NOT IN ('carry','compare') OR choice IS NULL THEN ~R ~D '~J:Choose carry or compare for each quote.'; END IF;
    IF choice='carry' THEN
      IF r IS NULL OR r !~ '^T-[1-9][0-9]*$' OR r=ANY(carried) OR d->'replace_labor_and_material' IS ~F FROM 'true'::~M
        OR d->'exclusive_to_line' IS ~F FROM 'true'::~M
        OR ~A(d->'source_note') IS ~F FROM 'string' OR ~A(d->'scope_note') IS ~F FROM 'string'
        OR ~A(d->'exclusions_note') IS ~F FROM 'string'
        OR ~K(length(btrim(d->>'source_note')),0)=0 OR ~K(length(btrim(d->>'scope_note')),0)=0 OR ~K(length(btrim(d->>'exclusions_note')),0)=0 THEN
        ~R ~D '~J:For each carried ~6 identify one whole line, ~t, scope and exclusions, confirm replacement of labor and material, and confirm the ~6 covers only that line and no other priced scope or cost, including direct lines, gaps, general conditions or requirements.';
      END IF;
      IF ~A(q->'amount') IS ~F FROM 'number' OR (q->>'amount')::~f < 0 OR (q->>'amount')::~f <> round((q->>'amount')::~f,2) OR (q->>'amount')::~f > 90071992547409 THEN
        ~R ~D '~J:A carried ~6 needs a valid amount in cents.';
      END IF;
      ~S to_jsonb(l) INTO ln FROM public.mcp_estimate_takeoff_lines l ~y l.takeoff_id=tid AND l.line_no=(substring(r from 3))::int;
      IF ln IS NULL THEN ~R ~D '~J:Select a current takeoff line.'; END IF;
      IF nullif(btrim(q->>'ref'),'') IS NOT NULL AND btrim(q->>'ref') <> r THEN
        ~R ~D '~J:Quote reference conflicts with the selected line.';
      END IF;
      carried:=array_append(carried,r);
    ELSE
      ln:=NULL;
    END IF;
    result:=result || jsonb_build_array(~I('quote_index',idx,'decision',choice,'ref',r,
      '~6',q,'line',ln,'replace_labor_and_material',CASE WHEN choice='carry' THEN true ELSE false END,
      'exclusive_to_line',CASE WHEN choice='carry' THEN true ELSE false END,
      'source_note',CASE WHEN choice='carry' THEN btrim(d->>'source_note') ELSE NULL END,
      'scope_note',CASE WHEN choice='carry' THEN btrim(d->>'scope_note') ELSE NULL END,
      'exclusions_note',CASE WHEN choice='carry' THEN btrim(d->>'exclusions_note') ELSE NULL END));
  END LOOP;
  INSERT INTO ~H(~U,~n,actor,~O,input,~p)
    VALUES(_job,~j,auth.uid(),v,_decisions,result);
  ~w ~I('request',~j,'~O',v,'current',true,'status','review','~p',result);
END $$;
REVOKE ALL ON ~L ~l(uuid,uuid,~d,~M) FROM PUBLIC,anon,service_role;
GRANT ~7 ON ~L ~l(uuid,uuid,~d,~M) TO ~W;

~r ~L ~q(_job uuid,~j uuid,_confirmed boolean) ~3 ~M
~v ~4 ~5 DEFINER SET ~a=~m,pg_temp AS $$
~2 v ~d; r ~H;
BEGIN
  ~e ~C(_job);
  IF _confirmed IS ~F FROM true THEN ~R ~D '~J:Confirm the reviewed selection before saving.'; END IF;
  v:=~B(_job);
  ~e ~C(_job);
  ~S * INTO r FROM ~H ~y ~U=_job AND ~n=~j;
  IF NOT FOUND OR r.actor IS ~F FROM auth.uid() THEN ~R ~D '~J:Review this selection first.'; END IF;
  IF r.saved_version IS NOT NULL THEN
    ~w ~I('request',~j,'~O',r.saved_version,'current',r.saved_version=v,'status','saved','~p',r.decisions);
  END IF;
  IF r.version <> v THEN ~R ~D '~J:Estimate changed. Refresh and review ~6 coverage again.'; END IF;
  ~z ~G SET ~O=~O+1 ~y ~U=_job RETURNING ~O INTO v;
  INSERT INTO ~T(~U,~n,actor,~O,~p)
    VALUES(_job,~j,auth.uid(),v,r.decisions)
    ON CONFLICT(~U) DO ~z SET ~n=excluded.request_id,actor=excluded.actor,~O=excluded.version,~p=excluded.decisions;
  ~z ~H SET saved_version=v ~y ~U=_job AND ~n=~j;
  ~w ~I('request',~j,'~O',v,'current',true,'status','saved','~p',r.decisions);
END $$;
REVOKE ALL ON ~L ~q(uuid,uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT ~7 ON ~L ~q(uuid,uuid,boolean) TO ~W;

-- An unversioned request cannot distinguish an intentional replacement from a
-- stale one. Preserve its signature and ACL while allowing only non-destructive
-- creates, no-ops and additions of unique references. All checks and the write
-- hold the same job lock as versioned saves. The entire request rolls back on a
-- conflict, including any otherwise-valid changes to its other arrays.
~r OR REPLACE ~L public.mcp_estimate_pricing_save(_job uuid,~0 ~M,~X ~M,~u ~M,~Y ~M) ~3 ~M
~v ~4 ~5 DEFINER SET ~a TO 'public' AS $$
~2 cid uuid; prior ~N; part record;
BEGIN
  cid:=~C(_job);
  ~e ~B(_job);
  cid:=~C(_job);
  IF (~0 IS NOT NULL AND ~A(~0) IS ~F FROM 'array') OR
     (~X IS NOT NULL AND ~A(~X) IS ~F FROM 'array') OR
     (~u IS NOT NULL AND ~A(~u) IS ~F FROM 'array') OR
     (~Y IS NOT NULL AND ~A(~Y) IS ~F FROM 'array') THEN
    ~R ~D '~J:Pricing fields must be arrays or omitted. ~b was ~o';
  END IF;
  ~S * INTO prior FROM ~N ~y ~U=_job;
  FOR part IN ~S * FROM (VALUES
    ('labor',~K(prior.labor,'[]'::~M),~0,'ref'),
    ('material',~K(prior.material,'[]'::~M),~X,'ref'),
    ('factor sources',~K(prior.rate_sources,'[]'::~M),~Y,'~t')
  ) AS components(label,existing,incoming,~V) LOOP
    IF part.incoming IS NOT NULL THEN
      IF ~A(part.existing) IS ~F FROM 'array' OR EXISTS (
        ~S 1 FROM (~S value,count(*) AS n FROM ~P(part.existing) GROUP BY value) o
        LEFT JOIN (~S value,count(*) AS n FROM ~P(part.incoming) GROUP BY value) n ON n.value=o.value
        ~y ~K(n.n,0)<o.n
      ) THEN
        ~R ~D '~J:Existing % changed or was removed. Reload and use ~O-checked pricing. ~b was ~o',part.label;
      END IF;
      IF EXISTS (
        ~S 1 FROM
          (~S ~K(value->>part.key_name,'') AS k,count(*) AS n FROM ~P(part.incoming) GROUP BY 1) i
        LEFT JOIN
          (~S ~K(value->>part.key_name,'') AS k,count(*) AS n FROM ~P(part.existing) GROUP BY 1) o ON o.k=i.k
        ~y (i.k='' AND i.n>~K(o.n,0)) OR (i.n>1 AND i.n>~K(o.n,0))
      ) THEN
        ~R ~D '~J:New % entries need unique references. Reload and use ~O-checked pricing. ~b was ~o',part.label;
      END IF;
    END IF;
  END LOOP;
  IF prior.job_id IS NOT NULL AND (~0 IS NULL OR ~0=prior.labor) AND
     (~X IS NULL OR ~X=prior.material) AND (~u IS NULL OR ~u=prior.quotes) AND
     (~Y IS NULL OR ~Y=prior.rate_sources) THEN
    ~w ~I('saved',true);
  END IF;
  INSERT INTO ~N(~U,company_id,labor,material,~s,rate_sources)
  VALUES(_job,cid,~K(~0,'[]'::~M),~K(~X,'[]'::~M),~K(~u,'[]'::~M),~K(~Y,'[]'::~M))
  ON CONFLICT(~U) DO ~z SET
    labor=CASE WHEN ~0 IS NULL THEN public.mcp_estimate_pricing.labor ELSE EXCLUDED.labor END,
    material=CASE WHEN ~X IS NULL THEN public.mcp_estimate_pricing.material ELSE EXCLUDED.material END,
    ~s=CASE WHEN ~u IS NULL THEN public.mcp_estimate_pricing.quotes ELSE EXCLUDED.quotes END,
    rate_sources=CASE WHEN ~Y IS NULL THEN public.mcp_estimate_pricing.rate_sources ELSE EXCLUDED.rate_sources END,
    updated_by=auth.uid(),updated_at=now();
  ~w ~I('saved',true);
END $$;

~r ~L ~c(_job uuid,~Q ~d,~0 ~M,~X ~M,~u ~M,~Y ~M) ~3 ~M
~v ~4 ~5 DEFINER SET ~a=~m,pg_temp AS $$
~2 v ~d; cid uuid;
BEGIN
  cid:=~C(_job);
  v:=~B(_job);
  cid:=~C(_job);
  IF ~Q IS NULL OR ~Q <> v THEN ~R ~D '~J:Estimate changed. Refresh pricing before saving.'; END IF;
  IF (~0 IS NOT NULL AND ~A(~0) <> 'array') OR (~X IS NOT NULL AND ~A(~X) <> 'array') OR
     (~u IS NOT NULL AND ~A(~u) <> 'array') OR (~Y IS NOT NULL AND ~A(~Y) <> 'array') THEN
    ~R ~D '~J:Pricing fields must be arrays or omitted.';
  END IF;
  IF ~Y IS NOT NULL AND EXISTS (
    ~S 1 FROM ~P(~Y) s GROUP BY s->>'~t'
    HAVING ~K(s->>'~t','')='' OR count(*)>1
  ) THEN ~R ~D '~J:Factor sources need unique references. ~b was ~o'; END IF;
  -- This replacement is permitted only after the matching-~O check. The
  -- existing table trigger still prevents removing or changing saved quotes.
  INSERT INTO ~N(~U,company_id,labor,material,~s,rate_sources)
  VALUES(_job,cid,~K(~0,'[]'::~M),~K(~X,'[]'::~M),~K(~u,'[]'::~M),~K(~Y,'[]'::~M))
  ON CONFLICT(~U) DO ~z SET
    labor=CASE WHEN ~0 IS NULL THEN public.mcp_estimate_pricing.labor ELSE EXCLUDED.labor END,
    material=CASE WHEN ~X IS NULL THEN public.mcp_estimate_pricing.material ELSE EXCLUDED.material END,
    ~s=CASE WHEN ~u IS NULL THEN public.mcp_estimate_pricing.quotes ELSE EXCLUDED.quotes END,
    rate_sources=CASE WHEN ~Y IS NULL THEN public.mcp_estimate_pricing.rate_sources ELSE EXCLUDED.rate_sources END,
    updated_by=auth.uid(),updated_at=now();
  ~S ~O INTO v FROM ~G ~y ~U=_job;
  ~w ~I('saved',true,'~O',v);
END $$;
REVOKE ALL ON ~L ~c(uuid,~d,~M,~M,~M,~M) FROM PUBLIC,anon,service_role;
GRANT ~7 ON ~L ~c(uuid,~d,~M,~M,~M,~M) TO ~W;

~r ~L ~g(_job uuid,~Q ~d,_overhead ~f,_profit ~f) ~3 ~M
~v ~4 ~5 DEFINER SET ~a=~m,pg_temp AS $$
~2 v ~d;
BEGIN
  ~e ~C(_job);
  v:=~B(_job);
  ~e ~C(_job);
  IF ~Q IS NULL OR ~Q <> v THEN ~R ~D '~J:Estimate changed. Refresh the bid before saving.'; END IF;
  ~e public.mcp_estimate_bid_save(_job,_overhead,_profit);
  ~S ~O INTO v FROM ~G ~y ~U=_job;
  ~w ~I('saved',true,'~O',v);
END $$;
REVOKE ALL ON ~L ~g(uuid,~d,~f,~f) FROM PUBLIC,anon,service_role;
GRANT ~7 ON ~L ~g(uuid,~d,~f,~f) TO ~W;
-- Strict persisted pricing type validation, part of this local proposal.
-- No new callable RPC, roles, policies, or permissions are added. Historical
-- malformed rows can be left untouched, but canonical pricing holds them.
~r ~L ~Z() ~3 trigger
~v ~4 SET ~a=~m,pg_temp AS $$
~2 component text; rows ~M; ~E ~M; ~V text; ~k ~f;
BEGIN
  FOR component, rows IN
    ~S * FROM (VALUES
      ('labor', CASE WHEN TG_OP='INSERT' OR NEW.labor IS ~F FROM OLD.labor THEN NEW.labor ELSE NULL END),
      ('material', CASE WHEN TG_OP='INSERT' OR NEW.material IS ~F FROM OLD.material THEN NEW.material ELSE NULL END),
      ('~t', CASE WHEN TG_OP='INSERT' OR NEW.rate_sources IS ~F FROM OLD.rate_sources THEN NEW.rate_sources ELSE NULL END)
    ) AS inputs(kind, value)
  LOOP
    IF rows IS NULL THEN CONTINUE; END IF;
    IF ~A(rows) IS ~F FROM 'array' THEN
      ~R ~D '~J:Pricing entries must be arrays. ~b was ~o';
    END IF;
    FOR ~E IN ~S value FROM ~P(rows) LOOP
      IF ~A(~E) IS ~F FROM 'object' THEN
        ~R ~D '~J:Each pricing entry must be an object. ~b was ~o';
      END IF;
      IF component='~t' THEN
        IF ~A(~E->'~t') IS ~F FROM 'string' OR ~E->>'~t' NOT IN ('rsmeans','neca','smacna','mcaa') OR
           ~A(~E->'carry') IS ~F FROM 'boolean' THEN
          ~R ~D '~J:Each factor ~t needs a recognized identity and a true or false carry decision. ~b was ~o';
        END IF;
        IF ~E ? 'confirmed' AND ~A(~E->'confirmed') IS ~F FROM 'boolean' THEN
          ~R ~D '~J:Factor confirmation must be true or false. ~b was ~o';
        END IF;
        IF ~E ? 'metro' AND ~A(~E->'metro') <> 'null' AND
           (~A(~E->'metro') IS ~F FROM 'string' OR ~E->>'metro' NOT IN ('NYC','Chicago','Miami','Austin','Dallas','LA','SF','Boston','Philly','DC')) THEN
          ~R ~D '~J:Factor location is not recognized. ~b was ~o';
        END IF;
        IF ~E ? 'work_type' AND ~A(~E->'work_type') <> 'null' AND
           (~A(~E->'work_type') IS ~F FROM 'string' OR ~E->>'work_type' NOT IN ('commercial','residential','industrial','healthcare')) THEN
          ~R ~D '~J:Factor work type is not recognized. ~b was ~o';
        END IF;
        FOR ~V IN ~S unnest(ARRAY['location_factor','work_factor']) LOOP
          IF ~E ? ~V AND ~A(~E->~V) <> 'null' THEN
            IF ~A(~E->~V) IS ~F FROM 'number' THEN
              ~R ~D '~J:Factors must be ~f and greater than zero. ~b was ~o';
            END IF;
            ~k:=(~E->>~V)::~f;
            IF ~k<=0 THEN ~R ~D '~J:Factors must be ~f and greater than zero. ~b was ~o'; END IF;
          END IF;
        END LOOP;
      ELSE
        IF ~A(~E->'ref') IS ~F FROM 'string' OR ~K(length(btrim(~E->>'ref')),0)=0 THEN
          ~R ~D '~J:Each rate needs a reference. ~b was ~o';
        END IF;
        FOREACH ~V IN ARRAY ARRAY['confirmed','apply_factor'] LOOP
          IF ~E ? ~V AND ~A(~E->~V) IS ~F FROM 'boolean' THEN
            ~R ~D '~J:Rate confirmation and factor application must be true or false. ~b was ~o';
          END IF;
        END LOOP;
        IF ~E ? '~t' AND ~A(~E->'~t') <> 'null' AND
           (~A(~E->'~t') IS ~F FROM 'string' OR ~E->>'~t' NOT IN ('rsmeans','neca','smacna','mcaa')) THEN
          ~R ~D '~J:Rate ~t is not recognized. ~b was ~o';
        END IF;
        FOR ~V IN ~S unnest(CASE WHEN component='labor' THEN
          ARRAY['production_per_man_hour','man_hours','man_days','crew_size','hours_per_day','hourly_rate','crew_rate'] ELSE ARRAY['unit_price'] END) LOOP
          IF ~E ? ~V AND ~A(~E->~V) <> 'null' THEN
            IF ~A(~E->~V) IS ~F FROM 'number' THEN
              ~R ~D '~J:Rate values must be numeric. ~b was ~o';
            END IF;
            ~k:=(~E->>~V)::~f;
            IF ~k<0 OR (~V IN ('production_per_man_hour','crew_size','hours_per_day') AND ~k=0) OR
               (~V='hours_per_day' AND ~k>24) THEN
              ~R ~D '~J:Rate values are outside the supported range. ~b was ~o';
            END IF;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
  ~w NEW;
END $$;
REVOKE ALL ON ~L ~Z() FROM PUBLIC,anon,~W;
~r TRIGGER estimate_pricing_validate_types BEFORE INSERT OR ~z ON ~N
  FOR EACH ROW ~7 ~L ~Z();
$encoded_payload$;
  dict jsonb := $dictionary$["jsonb_typeof","mcp_private.estimate_lock","public.mcp_estimate_guard","EXCEPTION","row_value","DISTINCT","mcp_private.estimate_revision","mcp_private.estimate_quote_review","jsonb_build_object","MCP_BAD","coalesce","FUNCTION","jsonb","public.mcp_estimate_pricing","version","jsonb_array_elements","_expected_version","RAISE","SELECT","mcp_private.estimate_quote_selection","job_id","key_name","authenticated","_material","_sources","mcp_private.validate_estimate_pricing_types","search_path","Nothing","public.mcp_estimate_pricing_save_versioned","bigint","PERFORM","numeric","public.mcp_estimate_bid_save_versioned","public.mcp_estimate_coverage_snapshot","mcp_private.estimate_preserve_quotes","_request","numeric_value","public.mcp_estimate_coverage_review","pg_catalog","request_id","saved.","decisions","public.mcp_estimate_coverage_save","CREATE","quotes","source","_quotes","LANGUAGE","RETURN","mcp_private.estimate_changed","WHERE","UPDATE","_labor","jsonb_array_length","DECLARE","RETURNS","plpgsql","SECURITY","quote","EXECUTE","NEW.job_id","OLD.job_id"]$dictionary$::jsonb;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  i integer;
BEGIN
  FOR i IN 0..jsonb_array_length(dict)-1 LOOP
    payload := replace(payload, '~' || substr(alphabet, i+1, 1), dict->>i);
  END LOOP;
  IF encode(sha256(convert_to(payload, 'UTF8')), 'hex') IS DISTINCT FROM '373f682e84fd7f3a1488134680ae7dddff75dc3314b92f6e6e8275ae320b3dd5' THEN
    RAISE EXCEPTION 'Migration payload SHA-256 mismatch';
  END IF;
  EXECUTE payload;
END
$short_verified_migration$;