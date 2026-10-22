-- Read-only duplicate check for Circle welcome and nudge sends.
-- Run in the SQL editor. This file does not update, enqueue, or send.
--
-- A member is listed when more than one status='sent' row exists for the
-- same template. Matching is the recipient email, or the profile user id
-- when that email belongs to a profile, so two addresses for one account
-- count together.
--
-- Templates are the names the hub mailer writes:
--   circle-welcome, login-nudge, discord-nudge.

WITH sent AS (
  SELECT
    l.template_name,
    lower(btrim(l.recipient_email)) AS recipient_email,
    p.id AS user_id,
    l.message_id,
    l.created_at
  FROM public.email_send_log AS l
  LEFT JOIN LATERAL (
    SELECT id
    FROM public.profiles
    WHERE lower(btrim(email)) = lower(btrim(l.recipient_email))
    ORDER BY created_at
    LIMIT 1
  ) AS p ON true
  WHERE l.status = 'sent'
    AND l.template_name IN ('circle-welcome', 'login-nudge', 'discord-nudge')
)
SELECT
  template_name,
  COALESCE(user_id::text, recipient_email) AS member_key,
  user_id,
  array_agg(DISTINCT recipient_email ORDER BY recipient_email) AS recipient_emails,
  count(*) AS sent_count,
  min(created_at) AS first_sent_at,
  max(created_at) AS last_sent_at,
  array_agg(message_id ORDER BY created_at) AS message_ids
FROM sent
GROUP BY template_name, COALESCE(user_id::text, recipient_email), user_id
HAVING count(*) > 1
ORDER BY sent_count DESC, template_name, member_key;
