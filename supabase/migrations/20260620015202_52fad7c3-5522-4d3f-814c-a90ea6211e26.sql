CREATE OR REPLACE FUNCTION public.audit_email_queues()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pgmq
AS $$
DECLARE
  auth_ttl_minutes INT := 15;
  transactional_ttl_minutes INT := 60;
  audit_result JSONB;
BEGIN
  SELECT
    COALESCE(email_send_state.auth_email_ttl_minutes, auth_ttl_minutes),
    COALESCE(email_send_state.transactional_email_ttl_minutes, transactional_ttl_minutes)
  INTO auth_ttl_minutes, transactional_ttl_minutes
  FROM public.email_send_state
  WHERE id = 1;

  auth_ttl_minutes := COALESCE(auth_ttl_minutes, 15);
  transactional_ttl_minutes := COALESCE(transactional_ttl_minutes, 60);

  WITH queue_rows AS (
    SELECT
      'auth_emails'::TEXT AS queue_name,
      msg_id, read_ct, enqueued_at, vt, message,
      auth_ttl_minutes AS ttl_minutes
    FROM pgmq.q_auth_emails
    UNION ALL
    SELECT
      'transactional_emails'::TEXT AS queue_name,
      msg_id, read_ct, enqueued_at, vt, message,
      transactional_ttl_minutes AS ttl_minutes
    FROM pgmq.q_transactional_emails
  ),
  classified AS (
    SELECT
      q.queue_name, q.msg_id, q.read_ct, q.enqueued_at, q.vt, q.message, q.ttl_minutes,
      COALESCE(NULLIF(TRIM(q.message->>'label'), ''), q.queue_name) AS template_name,
      NULLIF(TRIM(q.message->>'to'), '') AS recipient_email,
      NULLIF(TRIM(q.message->>'message_id'), '') AS message_id,
      NULLIF(TRIM(q.message->>'queued_at'), '') AS payload_queued_at,
      (q.vt <= NOW()) AS visible_now,
      (
        NULLIF(TRIM(q.message->>'to'), '') IS NULL OR
        NULLIF(TRIM(q.message->>'from'), '') IS NULL OR
        NULLIF(TRIM(q.message->>'subject'), '') IS NULL OR
        NULLIF(TRIM(q.message->>'html'), '') IS NULL OR
        NULLIF(TRIM(q.message->>'text'), '') IS NULL
      ) AS missing_required_fields,
      (NULLIF(TRIM(q.message->>'queued_at'), '') IS NULL) AS missing_queued_at,
      COALESCE(
        (
          SELECT COUNT(*)::INT
          FROM public.email_send_log l
          WHERE l.message_id = NULLIF(TRIM(q.message->>'message_id'), '')
            AND l.status = 'failed'
        ),
        q.read_ct,
        0
      ) AS failed_attempts,
      EXISTS (
        SELECT 1
        FROM public.email_send_log l
        WHERE l.message_id = NULLIF(TRIM(q.message->>'message_id'), '')
          AND l.status = 'sent'
      ) AS already_sent,
      EXISTS (
        SELECT 1
        FROM public.suppressed_emails s
        WHERE s.email = LOWER(NULLIF(TRIM(q.message->>'to'), ''))
      ) AS suppressed_recipient,
      EXISTS (
        SELECT 1
        FROM public.email_unsubscribe_tokens t
        WHERE t.email = LOWER(NULLIF(TRIM(q.message->>'to'), ''))
          AND t.used_at IS NOT NULL
      ) AS used_unsubscribe_token,
      (
        COALESCE(
          (NULLIF(TRIM(q.message->>'queued_at'), ''))::TIMESTAMPTZ,
          q.enqueued_at
        ) < NOW() - MAKE_INTERVAL(mins => q.ttl_minutes)
      ) AS ttl_expired
    FROM queue_rows q
  ),
  outcomes AS (
    SELECT
      *,
      (failed_attempts >= 5) AS max_retries_exceeded,
      (suppressed_recipient OR used_unsubscribe_token) AS would_suppress,
      (visible_now AND (ttl_expired OR missing_required_fields OR failed_attempts >= 5)) AS would_move_to_dlq,
      (visible_now AND already_sent AND NOT ttl_expired AND NOT missing_required_fields AND failed_attempts < 5) AS would_skip_duplicate,
      (visible_now AND NOT already_sent AND NOT ttl_expired AND NOT missing_required_fields AND failed_attempts < 5 AND (suppressed_recipient OR used_unsubscribe_token)) AS would_suppress_now,
      (visible_now AND NOT already_sent AND NOT ttl_expired AND NOT missing_required_fields AND failed_attempts < 5 AND NOT (suppressed_recipient OR used_unsubscribe_token)) AS would_send
    FROM classified
  ),
  totals AS (
    SELECT
      COUNT(*)::INT AS total,
      COUNT(*) FILTER (WHERE visible_now)::INT AS visible_now,
      COUNT(*) FILTER (WHERE NOT visible_now)::INT AS hidden_until_visible,
      COUNT(*) FILTER (WHERE would_send)::INT AS would_send,
      COUNT(*) FILTER (WHERE would_move_to_dlq)::INT AS would_move_to_dlq,
      COUNT(*) FILTER (WHERE would_skip_duplicate)::INT AS would_skip_duplicate,
      COUNT(*) FILTER (WHERE would_suppress_now)::INT AS would_suppress,
      COUNT(*) FILTER (WHERE missing_queued_at)::INT AS missing_queued_at,
      COUNT(*) FILTER (WHERE visible_now AND missing_required_fields)::INT AS missing_required_fields,
      COUNT(*) FILTER (WHERE visible_now AND max_retries_exceeded)::INT AS max_retries_exceeded,
      COUNT(*) FILTER (WHERE visible_now AND ttl_expired)::INT AS ttl_expired
    FROM outcomes
  )
  SELECT jsonb_build_object(
    'generatedAt', NOW(),
    'ttlMinutes', jsonb_build_object(
      'auth_emails', auth_ttl_minutes,
      'transactional_emails', transactional_ttl_minutes
    ),
    'totals', (
      SELECT jsonb_build_object(
        'total', total, 'visibleNow', visible_now, 'hiddenUntilVisible', hidden_until_visible,
        'wouldSend', would_send, 'wouldMoveToDlq', would_move_to_dlq,
        'wouldSkipDuplicate', would_skip_duplicate, 'wouldSuppress', would_suppress,
        'missingQueuedAt', missing_queued_at, 'missingRequiredFields', missing_required_fields,
        'maxRetriesExceeded', max_retries_exceeded, 'ttlExpired', ttl_expired
      )
      FROM totals
    ),
    'queues', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'queueName', queue_name, 'total', total, 'visibleNow', visible_now,
          'wouldSend', would_send, 'wouldMoveToDlq', would_move_to_dlq,
          'wouldSkipDuplicate', would_skip_duplicate, 'wouldSuppress', would_suppress
        )
        ORDER BY queue_name
      )
      FROM (
        SELECT
          queue_name,
          COUNT(*)::INT AS total,
          COUNT(*) FILTER (WHERE visible_now)::INT AS visible_now,
          COUNT(*) FILTER (WHERE would_send)::INT AS would_send,
          COUNT(*) FILTER (WHERE would_move_to_dlq)::INT AS would_move_to_dlq,
          COUNT(*) FILTER (WHERE would_skip_duplicate)::INT AS would_skip_duplicate,
          COUNT(*) FILTER (WHERE would_suppress_now)::INT AS would_suppress
        FROM outcomes GROUP BY queue_name
      ) queue_summary
    ), '[]'::JSONB),
    'templates', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'queueName', queue_name, 'templateName', template_name, 'total', total,
          'visibleNow', visible_now, 'wouldSend', would_send,
          'wouldMoveToDlq', would_move_to_dlq, 'wouldSkipDuplicate', would_skip_duplicate,
          'wouldSuppress', would_suppress
        )
        ORDER BY total DESC, queue_name, template_name
      )
      FROM (
        SELECT
          queue_name, template_name,
          COUNT(*)::INT AS total,
          COUNT(*) FILTER (WHERE visible_now)::INT AS visible_now,
          COUNT(*) FILTER (WHERE would_send)::INT AS would_send,
          COUNT(*) FILTER (WHERE would_move_to_dlq)::INT AS would_move_to_dlq,
          COUNT(*) FILTER (WHERE would_skip_duplicate)::INT AS would_skip_duplicate,
          COUNT(*) FILTER (WHERE would_suppress_now)::INT AS would_suppress
        FROM outcomes GROUP BY queue_name, template_name
      ) template_summary
    ), '[]'::JSONB),
    'samples', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'queueName', queue_name, 'msgId', msg_id, 'templateName', template_name,
          'recipientEmail', recipient_email, 'visibleNow', visible_now,
          'queuedAt', COALESCE(payload_queued_at, enqueued_at::TEXT),
          'outcome',
            CASE
              WHEN NOT visible_now THEN 'hidden_until_visible'
              WHEN would_send THEN 'would_send'
              WHEN would_move_to_dlq AND ttl_expired THEN 'ttl_expired'
              WHEN would_move_to_dlq AND missing_required_fields THEN 'missing_required_fields'
              WHEN would_move_to_dlq AND max_retries_exceeded THEN 'max_retries_exceeded'
              WHEN would_skip_duplicate THEN 'already_sent_duplicate'
              WHEN would_suppress_now THEN 'would_suppress'
              ELSE 'needs_review'
            END
        )
      )
      FROM (
        SELECT * FROM outcomes
        ORDER BY visible_now DESC, would_send DESC, would_move_to_dlq DESC, enqueued_at ASC
        LIMIT 12
      ) sample_rows
    ), '[]'::JSONB),
    'recommendation', (
      SELECT
        CASE
          WHEN total = 0 THEN 'empty'
          WHEN would_send > 0 THEN 'would_send_live_email'
          WHEN would_move_to_dlq > 0 OR would_skip_duplicate > 0 OR would_suppress > 0 THEN 'safe_to_drain'
          WHEN hidden_until_visible > 0 THEN 'waiting_for_visibility'
          ELSE 'needs_review'
        END
      FROM totals
    )
  )
  INTO audit_result;

  RETURN audit_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_email_queues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_email_queues() TO service_role;