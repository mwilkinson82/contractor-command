DO $short_verified_migration$
DECLARE
  payload text := $encoded_payload$-- LOCAL PROPOSAL ONLY. Requires estimating-quote-coverage.sql and the reader
-- volatility correction. Three new ~O ~m grants below require
-- specific ~7/security ~4 before any Lovable migration.
-- This captures ~5 facts, not a certified bid or ~7 to post.
~h TABLE ~A (
  ~U uuid NOT NULL REFERENCES ~f(id) ON ~z CASCADE,
  ~Z uuid NOT NULL,
  ~K uuid NOT NULL,
  actor uuid NOT NULL,
  ~E ~b NOT NULL,
  ~e ~l NOT NULL,
  ~Y text NOT NULL,
  saved_id uuid,
  PRIMARY KEY(~U, ~K)
);
~h TABLE ~B (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ~U uuid NOT NULL REFERENCES ~f(id) ON ~z CASCADE,
  ~Z uuid NOT NULL,
  ~K uuid NOT NULL,
  actor uuid NOT NULL,
  ~E ~b NOT NULL,
  ~e ~l NOT NULL,
  ~Y text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(~U,~K)
);
~t ALL ON ~A, ~B FROM ~s, anon, ~O;

~h ~G ~F() ~u trigger
~r ~x SET ~d=~j,~w AS $$
BEGIN
  -- A project deletion retains the existing cascade semantics.
  IF TG_OP='~z' AND NOT EXISTS(~1 1 FROM ~f ~2 id=OLD.job_id) THEN ~n OLD; END IF;
  ~c ~L '~Q:Saved ~5 snapshots cannot be ~3';
END $$;
~t ALL ON ~G ~F() FROM ~s,anon,~O;
~h TRIGGER estimate_source_snapshot_immutable BEFORE UPDATE OR ~z ON ~B
FOR EACH ROW ~m ~G ~F();

~h ~G ~I(_job uuid,~H uuid,~R ~b) ~u ~l
~r ~x ~0 DEFINER SET ~d=~j,~w AS $$
~9 cid uuid; ver ~b; r ~A; data ~l; hash text; ~o ~l;
BEGIN
  cid:=~C(_job);
  IF ~H IS NULL OR ~R IS NULL OR ~i() IS NULL THEN ~c ~L '~Q:Choose a ~g and ~X estimate version.'; END IF;
  ver:=~P(_job);
  cid:=~C(_job);
  ~1 * INTO r FROM ~A ~2 ~U=_job AND ~K=~H;
  IF FOUND THEN
    IF r.actor IS ~T FROM ~i() OR r.company_id IS ~T FROM cid OR ~D<>~R THEN
      ~c ~L '~Q:This ~g identifies a different review.';
    END IF;
    ~n ~J('~6',CASE WHEN ~k IS NULL THEN '~4' ELSE 'saved' END,'~g',~H,'~W',~k,'~E',~D,'~X',~D=ver,'~q',~S,'~a',~8);
  END IF;
  IF ver<>~R THEN ~c ~L '~Q:Estimate ~3 Refresh before reviewing.'; END IF;
  data:=public.mcp_estimate_coverage_snapshot(_job);
  ~o:=coalesce(data->'bid'->'pricing'->'~o','[]'::~l);
  IF jsonb_typeof(~o) IS ~T FROM 'array' THEN ~c ~L '~Q:Saved ~o need review.'; END IF;
  IF jsonb_array_length(~o)>0 AND coalesce((data->'selection'->>'~X')::~v,false) IS ~T FROM true THEN
    ~c ~L '~Q:Review ~X quote coverage first.';
  END IF;
  hash:=encode(~q(convert_to(data::text,'UTF8')),'hex');
  INSERT INTO ~A(~U,~Z,~K,actor,~E,~e,~Y)
    VALUES(_job,cid,~H,~i(),ver,data,hash);
  ~n ~J('~6','~4','~g',~H,'~W',NULL,'~E',ver,'~X',true,'~q',hash,'~a',data);
END $$;
~t ALL ON ~G ~I(uuid,uuid,~b) FROM ~s,anon,~p;
GRANT ~m ON ~G ~I(uuid,uuid,~b) TO ~O;

~h ~G ~N(_job uuid,~H uuid,_confirmed ~v) ~u ~l
~r ~x ~0 DEFINER SET ~d=~j,~w AS $$
~9 cid uuid; ver ~b; r ~A; ~V uuid;
BEGIN
  cid:=~C(_job);
  IF _confirmed IS ~T FROM true OR ~i() IS NULL THEN ~c ~L '~Q:Confirm the reviewed ~5 ~a first.'; END IF;
  ver:=~P(_job);
  cid:=~C(_job);
  ~1 * INTO r FROM ~A ~2 ~U=_job AND ~K=~H;
  IF NOT FOUND OR r.actor IS ~T FROM ~i() OR r.company_id IS ~T FROM cid THEN ~c ~L '~Q:Review this ~5 ~a first.'; END IF;
  IF ~k IS NOT NULL THEN
    ~n ~J('~6','saved','~g',~H,'~W',~k,'~E',~D,'~X',~D=ver,'~q',~S);
  END IF;
  IF ver<>~D THEN ~c ~L '~Q:Estimate ~3 Refresh and ~4 again.'; END IF;
  INSERT INTO ~B(~U,~Z,~K,actor,~E,~e,~Y)
    VALUES(_job,cid,~H,r.actor,~D,~8,~S) RETURNING id INTO ~V;
  UPDATE ~A SET saved_id=~V ~2 ~U=_job AND ~K=~H;
  ~n ~J('~6','saved','~g',~H,'~W',~V,'~E',~D,'~X',true,'~q',~S);
END $$;
~t ALL ON ~G ~N(uuid,uuid,~v) FROM ~s,anon,~p;
GRANT ~m ON ~G ~N(uuid,uuid,~v) TO ~O;

~h ~G ~M(_job uuid,_snapshot uuid) ~u ~l
~r ~x ~0 DEFINER SET ~d=~j,~w AS $$
~9 cid uuid; ver ~b; s ~B;
BEGIN
  cid:=~C(_job);
  ver:=~P(_job);
  cid:=~C(_job);
  ~1 * INTO s FROM ~B ~2 ~U=_job AND id=_snapshot AND ~Z=cid;
  IF NOT FOUND THEN ~c ~L '~Q:Source ~a not found for this job.'; END IF;
  ~n ~J('~W',s.id,'~E',~y,'~X',~y=ver,'~q',s.source_sha256,'~a',s.source_data,'saved_by',s.actor,'created_at',s.created_at);
END $$;
~t ALL ON ~G ~M(uuid,uuid) FROM ~s,anon,~p;
GRANT ~m ON ~G ~M(uuid,uuid) TO ~O;
$encoded_payload$;
  dict jsonb := $dictionary$["mcp_private.estimate_snapshot_review","mcp_private.estimate_source_snapshot","public.mcp_estimate_guard","r.source_version","source_version","mcp_private.estimate_source_snapshot_immutable","FUNCTION","_request","public.mcp_estimate_snapshot_review","jsonb_build_object","request_id","EXCEPTION","public.mcp_estimate_snapshot_read","public.mcp_estimate_snapshot_save","authenticated","mcp_private.estimate_lock","MCP_BAD","_expected_version","r.source_sha256","DISTINCT","job_id","saved_snapshot","snapshot_id","current","source_sha256","company_id","snapshot","bigint","RAISE","search_path","source_data","public.mcp_jobs","request","CREATE","auth.uid","pg_catalog","r.saved_id","jsonb","EXECUTE","RETURN","quotes","service_role","sha256","LANGUAGE","PUBLIC","REVOKE","RETURNS","boolean","pg_temp","plpgsql","s.source_version","DELETE","SECURITY","SELECT","WHERE","changed.","review","source","status","authorization","r.source_data","DECLARE"]$dictionary$::jsonb;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  i integer;
BEGIN
  FOR i IN 0..jsonb_array_length(dict)-1 LOOP
    payload := replace(payload, '~' || substr(alphabet, i+1, 1), dict->>i);
  END LOOP;
  IF encode(sha256(convert_to(payload, 'UTF8')), 'hex') IS DISTINCT FROM '2bf04de4391a243efd1d127738356cbb81cc6d207ddfbd1764eed06b86b7ef11' THEN
    RAISE EXCEPTION 'Migration payload SHA-256 mismatch';
  END IF;
  EXECUTE payload;
END
$short_verified_migration$;