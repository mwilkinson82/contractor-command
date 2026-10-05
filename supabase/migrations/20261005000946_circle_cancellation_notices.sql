-- Draft only. No activation or backfill. Apply through the reviewed Lovable workflow.
CREATE TABLE public.circle_cancellation_notices (
  notice_key text PRIMARY KEY,
  stripe_subscription_id text NOT NULL,
  episode text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('member', 'owner')),
  message_id uuid NOT NULL UNIQUE,
  recipient_email text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'suppressed')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stripe_subscription_id, episode, channel)
);
ALTER TABLE public.circle_cancellation_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.circle_cancellation_notices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.circle_cancellation_notices TO service_role;

-- The source snapshot, deduplication ledger, audit and queue commit together.
-- Shares the subscription advisory lock used by apply_circle_subscription_snapshot.
CREATE FUNCTION public.enqueue_circle_cancellation_notice(
  _subscription_id text, _observed_at timestamptz, _episode text, _channel text, _payload jsonb
) RETURNS text LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  s public.subscriptions;
  facts jsonb;
  recipient text;
  label text;
  notice text;
  message uuid := gen_random_uuid();
  token text;
  withheld text;
BEGIN
  IF _channel NOT IN ('member','owner') OR _subscription_id !~ '^sub_[A-Za-z0-9]+$'
    OR _episode IS NULL THEN RAISE EXCEPTION 'Invalid cancellation notice'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_subscription_id, 0));
  SELECT * INTO s FROM public.subscriptions WHERE stripe_subscription_id = _subscription_id;
  facts := s.metadata->'circle_cancellation_notice';
  IF s.tier IS DISTINCT FROM 'circle' OR facts->>'episode' IS DISTINCT FROM _episode
    OR NOT EXISTS (SELECT 1 FROM public.circle_subscription_evidence
      WHERE stripe_subscription_id = _subscription_id AND observed_at = _observed_at)
    THEN RETURN 'stale'; END IF;
  recipient := CASE WHEN _channel = 'owner' THEN 'wilkinson.marshall@gmail.com' ELSE lower(btrim(s.email)) END;
  label := CASE WHEN _channel = 'owner' THEN 'circle-cancellation-owner' ELSE 'circle-cancellation-confirmation' END;
  IF _payload->>'to' IS DISTINCT FROM recipient OR _payload->>'label' IS DISTINCT FROM label
    OR _payload->>'circle_cancellation_subscription_id' IS DISTINCT FROM _subscription_id
    OR _payload->>'circle_cancellation_episode' IS DISTINCT FROM _episode
    THEN RAISE EXCEPTION 'Cancellation recipient/source mismatch'; END IF;
  notice := 'circle-cancellation:' || _episode || ':' || _channel;
  IF EXISTS (SELECT 1 FROM public.circle_cancellation_notices WHERE notice_key = notice) THEN RETURN 'duplicate'; END IF;
  IF _channel = 'member' AND (facts->>'memberAllowed')::boolean IS DISTINCT FROM true THEN
    withheld := 'identity_review';
  ELSIF _channel = 'member' AND (facts->>'neverEmail')::boolean IS DISTINCT FROM false THEN
    withheld := 'existing_email_policy';
  ELSIF EXISTS (SELECT 1 FROM public.suppressed_emails WHERE email = recipient) THEN
    withheld := 'recipient_suppressed';
  ELSIF EXISTS (SELECT 1 FROM public.email_unsubscribe_tokens WHERE email = recipient AND used_at IS NOT NULL) THEN
    withheld := 'recipient_unsubscribed';
  END IF;
  INSERT INTO public.circle_cancellation_notices(notice_key,stripe_subscription_id,episode,channel,message_id,recipient_email,status,reason)
    VALUES(notice,_subscription_id,_episode,_channel,message,recipient,CASE WHEN withheld IS NULL THEN 'queued' ELSE 'suppressed' END,withheld);
  INSERT INTO public.email_send_log(message_id,template_name,recipient_email,status,error_message,metadata)
    VALUES(message::text,label,recipient,CASE WHEN withheld IS NULL THEN 'pending' ELSE 'suppressed' END,withheld,
      jsonb_build_object('idempotency_key',notice,'stripe_subscription_id',_subscription_id,'cancellation_episode',_episode));
  IF withheld IS NOT NULL THEN RETURN 'suppressed'; END IF;
  INSERT INTO public.email_unsubscribe_tokens(email,token) VALUES(recipient,replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''))
    ON CONFLICT(email) DO NOTHING;
  SELECT t.token INTO token FROM public.email_unsubscribe_tokens t WHERE email = recipient AND used_at IS NULL;
  -- Fail rather than queue if a simultaneous unsubscribe changed the token.
  IF token IS NULL THEN RAISE EXCEPTION 'Cancellation recipient unsubscribed during enqueue'; END IF;
  PERFORM public.enqueue_email('transactional_emails',_payload || jsonb_build_object(
    'message_id',message::text,'idempotency_key',notice,'unsubscribe_token',token,'queued_at',now()));
  RETURN 'queued';
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_circle_cancellation_notice(text,timestamptz,text,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_circle_cancellation_notice(text,timestamptz,text,text,jsonb) TO service_role;
