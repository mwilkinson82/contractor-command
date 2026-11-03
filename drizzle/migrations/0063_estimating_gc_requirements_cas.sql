DO $short_verified_migration$
DECLARE
  payload text := $encoded_payload$-- Local proposal only. Apply after estimating-quote-coverage.sql and the
-- estimating reader volatility correction, never directly to a managed DB.
-- Preserve both existing public signatures, owners, ACLs and role checks.
-- Versioned callers send {"~E":~c,"lines":[...]} for GC
-- or {"~E":~c,"items":[...]} for ~s Legacy
-- arrays can create, repeat or add, but may not overwrite or omit saved facts.

CREATE OR REPLACE ~2 public.mcp_estimate_gc_save(_job uuid,_start date,_finish date,_days integer,~f ~o) RETURNS ~o
LANGUAGE plpgsql SECURITY DEFINER SET ~7 TO 'public' AS $$
DECLARE cid uuid; ver ~x; ~d ~x; data ~o; prior ~O;
BEGIN
  cid:=~R(_job);
  ver:=~r(_job);
  cid:=~R(_job);
  IF ~A(~f)='object' THEN
    IF ~A(~f->'~E') IS ~J FROM '~c'
       OR ~C(~f->>'~E','') !~ '^(0|[1-9][0-9]{0,15})$'
       OR ~A(~f->'lines') IS ~J FROM 'array' THEN
      ~Y ~D '~I:Read the current ~b and send valid general conditions. ~N was ~V';
    END IF;
    ~d:=(~f->>'~E')::~x;
    IF ~d<>ver THEN ~Y ~D '~I:Estimate changed. Refresh general ~8 before saving.'; END IF;
    data:=~f->'lines';
  ELSIF ~f IS NULL OR ~A(~f)='array' THEN
    data:=~C(~f,'[]'::~o);
  ELSE
    ~Y ~D '~I:Send valid general conditions. ~N was ~V';
  END IF;
  IF _days IS NOT NULL AND _days<1 THEN ~Y ~D '~I:Schedule duration has to be at least one day. ~N was ~V'; END IF;
  IF ~w(~T 1 FROM ~B(data) x ~m ~A(x)<>'object' OR ~C(~U(x->>'key'),'') NOT IN ('trailer','office','cad','water','supplies','supervision'))
     OR ~w(~T 1 FROM ~B(data) x GROUP BY x->>'key' HAVING count(*)>1) THEN
    ~Y ~D '~I:General condition keys must be present and unique. ~N was ~V';
  END IF;
  IF ~w (
    ~T 1 FROM ~B(data) x ~m
      (x ? '~K' AND ~A(x->'~K') IS ~J FROM '~Z') OR
      (x ? '~H' AND ~A(x->'~H') NOT IN ('~c','null')) OR
      (x ? 'qty' AND ~A(x->'qty') NOT IN ('~c','null')) OR
      (x ? 'rate' AND ~A(x->'rate') NOT IN ('~c','null')) OR
      CASE WHEN ~A(x->'~H')='~c' THEN (x->>'~H')::~j<0 ELSE ~n END OR
      CASE WHEN ~A(x->'qty')='~c' THEN (x->>'qty')::~j<0 ELSE ~n END OR
      CASE WHEN ~A(x->'rate')='~c' THEN (x->>'rate')::~j<0 ELSE ~n END
  ) THEN ~Y ~D '~I:General ~8 need nonnegative numbers and ~Z confirmation. ~N was ~V'; END IF;
  ~T * INTO prior FROM ~O ~m ~i=_job;
  IF ~d IS NULL AND prior.job_id IS NOT NULL THEN
    IF (~l IS NOT NULL AND ~l IS ~J FROM _start)
      OR (~k IS NOT NULL AND ~k IS ~J FROM _finish)
      OR (~h IS NOT NULL AND ~h IS ~J FROM _days)
      OR ~A(~6) IS ~J FROM 'array'
      OR ~w (
        ~T 1 FROM (~T ~v,count(*) AS n FROM ~B(~6) GROUP BY ~v) o
        LEFT JOIN (~T ~v,count(*) AS n FROM ~B(data) GROUP BY ~v) n ON n.value=o.value
        ~m ~C(n.n,0)<o.n
      ) THEN
      ~Y ~D '~I:Existing general ~8 changed or were removed. Refresh and use ~b-checked saving. ~N was ~V';
    END IF;
  END IF;
  IF prior.job_id IS NOT NULL AND ~l IS NOT ~J FROM _start
     AND ~k IS NOT ~J FROM _finish AND ~h IS NOT ~J FROM _days
     AND ~6=data THEN RETURN ~F('saved',true,'~b',ver); END IF;
  INSERT INTO ~O(~i,company_id,start_date,finish_date,duration_days,lines)
  VALUES(_job,cid,_start,_finish,_days,data)
  ON CONFLICT(~i) DO UPDATE SET start_date=excluded.start_date,finish_date=excluded.finish_date,
    duration_days=excluded.duration_days,lines=excluded.lines,updated_by=auth.uid(),updated_at=now();
  ~T ~b INTO ver FROM ~p ~m ~i=_job;
  RETURN ~F('saved',true,'~b',ver);
END $$;

CREATE OR REPLACE ~2 public.mcp_estimate_requirements_save(_job uuid,~e ~o) RETURNS ~o
LANGUAGE plpgsql SECURITY DEFINER SET ~7 TO 'public' AS $$
DECLARE cid uuid; ver ~x; ~d ~x; data ~o; it ~o; n int:=0; ~3 record; ~L ~o;
BEGIN
  cid:=~R(_job);
  ver:=~r(_job);
  cid:=~R(_job);
  IF ~A(~e)='object' THEN
    IF ~A(~e->'~E') IS ~J FROM '~c'
       OR ~C(~e->>'~E','') !~ '^(0|[1-9][0-9]{0,15})$'
       OR ~A(~e->'items') IS ~J FROM 'array' THEN
      ~Y ~D '~I:Read the current ~b and send valid ~s ~N was ~V';
    END IF;
    ~d:=(~e->>'~E')::~x;
    IF ~d<>ver THEN ~Y ~D '~I:Estimate changed. Refresh requirements before saving.'; END IF;
    data:=~e->'items';
  ELSIF ~e IS NULL OR ~A(~e)='array' THEN
    data:=~C(~e,'[]'::~o);
  ELSE
    ~Y ~D '~I:Send valid ~s ~N was ~V';
  END IF;
  IF ~w(~T 1 FROM ~B(data) i GROUP BY i->>'ref' HAVING count(*)>1) THEN
    ~Y ~D '~I:Requirement references must be unique. ~N was ~V';
  END IF;
  FOR it IN ~T ~v FROM ~B(data) LOOP
    IF ~A(it)<>'object' OR ~C(it->>'ref','') !~ '^R-[0-9]+$' THEN ~Y ~D '~I:Each ~g needs a number. ~N was ~V'; END IF;
    IF length(~U(~C(it->>'~X','')))<1 OR length(~U(~C(it->>'~P','')))<1 THEN
      ~Y ~D '~I:Each ~g cites a sheet, a spec section, or a contract clause. ~N was ~V';
    END IF;
    IF length(~U(~C(it->>'kind','')))<1 OR length(~U(it->>'kind'))>80 THEN
      ~Y ~D '~I:Name the ~g category, or use other with a description. ~N was ~V';
    END IF;
    IF lower(~U(it->>'kind'))='other' AND length(~U(~C(it->>'~M','')))<1 THEN
      ~Y ~D '~I:A ~g marked other needs a description. ~N was ~V';
    END IF;
    IF (it ? '~K' AND ~A(it->'~K') IS ~J FROM '~Z') OR
       (it ? '~S' AND ~A(it->'~S') IS ~J FROM '~Z') OR
       (it ? '~H' AND ~A(it->'~H') NOT IN ('~c','null')) OR
       (CASE WHEN ~A(it->'~H')='~c' THEN (it->>'~H')::~j<0 ELSE ~n END) THEN
      ~Y ~D '~I:Requirement amounts need nonnegative numbers and confirmations need booleans. ~N was ~V';
    END IF;
  END LOOP;
  IF ~w (
    ~T 1 FROM ~G r
    JOIN ~B(data) i ON i->>'ref'=r.ref
    ~m r.job_id=_job AND r.active IS NOT TRUE
  ) THEN
    ~Y ~D '~I:An inactive ~g cannot be reused without a reviewed reactivation workflow. ~N was ~V';
  END IF;
  IF ~d IS NULL THEN
    FOR ~3 IN ~T * FROM ~G ~m ~i=_job AND active LOOP
      ~T ~v INTO ~L FROM ~B(data) ~m ~v->>'ref'=current_row.ref;
      IF ~L IS NULL THEN CONTINUE; END IF;
      IF ~F('kind',left(~U(~L->>'kind'),80),
           '~M',~z(left(~U(~C(~L->>'~M','')),200),''),
           '~q',left(~U(~L->>'~q'),200),'~Q',~L->>'~Q',
           '~P',left(~U(~L->>'~P'),80),'~X',left(~U(~L->>'~X'),500),
           '~W',~C(~z(~L->>'~W',''),'own_line'),
           '~H',CASE WHEN ~L->>'~H' IS NULL OR ~L->>'~H'='' THEN NULL ELSE (~L->>'~H')::~j END,
           '~K',~C((~L->>'~K')::~Z,~n),'~S',~C((~L->>'~S')::~Z,~n))
         IS ~J FROM ~F('kind',current_row.kind,'~M',~t,'~q',current_row.label,
           '~Q',~u,'~P',~y,'~X',~4,
           '~W',~1,'~H',~9,'~K',~0,'~S',~5) THEN
        ~Y ~D '~I:Existing requirements changed or were removed. Refresh and use ~b-checked saving. ~N was ~V';
      END IF;
    END LOOP;
  END IF;
  FOR it IN ~T ~v FROM ~B(data) LOOP
    -- Skip identical rows before INSERT: BEFORE INSERT ~b triggers would
    -- otherwise advance the estimate even when ON CONFLICT is a no-op.
    ~T * INTO ~3 FROM ~G ~m ~i=_job AND ref=it->>'ref';
    IF FOUND AND current_row.active AND
       ~F('kind',left(~U(it->>'kind'),80),
         '~M',~z(left(~U(~C(it->>'~M','')),200),''),
         '~q',left(~U(it->>'~q'),200),'~Q',it->>'~Q',
         '~P',left(~U(it->>'~P'),80),'~X',left(~U(it->>'~X'),500),
         '~W',~C(~z(it->>'~W',''),'own_line'),
         '~H',CASE WHEN it->>'~H' IS NULL OR it->>'~H'='' THEN NULL ELSE (it->>'~H')::~j END,
         '~K',~C((it->>'~K')::~Z,~n),'~S',~C((it->>'~S')::~Z,~n))
       = ~F('kind',current_row.kind,'~M',~t,'~q',current_row.label,
         '~Q',~u,'~P',~y,'~X',~4,
         '~W',~1,'~H',~9,'~K',~0,'~S',~5) THEN
      n:=n+1;
      CONTINUE;
    END IF;
    INSERT INTO ~G(~i,company_id,ref,kind,~M,~q,~Q,~P,~X,~W,~H,~K,~S,active)
    VALUES(_job,cid,it->>'ref',left(~U(it->>'kind'),80),~z(left(~U(~C(it->>'~M','')),200),''),left(~U(it->>'~q'),200),it->>'~Q',left(~U(it->>'~P'),80),
      left(~U(it->>'~X'),500),~C(~z(it->>'~W',''),'own_line'),
      CASE WHEN it->>'~H' IS NULL OR it->>'~H'='' THEN NULL ELSE (it->>'~H')::~j END,
      ~C((it->>'~K')::~Z,~n),~C((it->>'~S')::~Z,~n),true)
    ON CONFLICT(~i,ref) DO UPDATE SET kind=excluded.kind,~M=excluded.description,~q=excluded.label,~Q=excluded.source_type,
      ~P=excluded.source_ref,~X=excluded.citation,~W=excluded.placement,~H=excluded.amount,~K=excluded.confirmed,
      ~S=excluded.excluded,active=true;
    n:=n+1;
  END LOOP;
  -- Omission never changes an existing requirement. Explicit ~S=true is
  -- the supported scoped decision; historical inactive rows stay intact.
  ~T ~b INTO ver FROM ~p ~m ~i=_job;
  RETURN ~F('saved',n,'~b',ver);
END $$;

-- Install only after both replacements above have succeeded. The existing
-- snapshot checks the marker's existence; it is not an exposed callable API.
CREATE ~2 ~a() RETURNS ~Z
LANGUAGE sql IMMUTABLE SET ~7=pg_catalog,pg_temp AS $$ ~T true $$;
REVOKE ALL ON ~2 ~a() FROM PUBLIC,anon,authenticated;
$encoded_payload$;
  dict jsonb := $dictionary$["jsonb_typeof","jsonb_array_elements","coalesce","EXCEPTION","expected_version","jsonb_build_object","public.mcp_estimate_requirements","amount","MCP_BAD","DISTINCT","confirmed","incoming","description","Nothing","public.mcp_estimate_general_conditions","source_ref","source_type","public.mcp_estimate_guard","excluded","SELECT","btrim","saved.","placement","citation","RAISE","boolean","mcp_private.estimate_gc_requirements_cas_marker","version","number","expected","_items","_lines","requirement","prior.duration_days","job_id","numeric","prior.finish_date","prior.start_date","WHERE","false","jsonb","mcp_private.estimate_revision","label","mcp_private.estimate_lock","requirements.","current_row.description","current_row.source_type","value","EXISTS","bigint","current_row.source_ref","nullif","current_row.confirmed","current_row.placement","FUNCTION","current_row","current_row.citation","current_row.excluded","prior.lines","search_path","conditions","current_row.amount"]$dictionary$::jsonb;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  i integer;
BEGIN
  FOR i IN 0..jsonb_array_length(dict)-1 LOOP
    payload := replace(payload, '~' || substr(alphabet, i+1, 1), dict->>i);
  END LOOP;
  IF encode(sha256(convert_to(payload, 'UTF8')), 'hex') IS DISTINCT FROM 'a7bf053579855b71424f3e6c416e0ed2bc16c251aa450dd041c614fb6397c568' THEN
    RAISE EXCEPTION 'Migration payload SHA-256 mismatch';
  END IF;
  EXECUTE payload;
END
$short_verified_migration$;
