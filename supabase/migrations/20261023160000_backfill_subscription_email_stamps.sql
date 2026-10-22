-- Backfill null subscription send stamps from the earliest successful
-- email_send_log row for that member. Only null columns are written.
-- This does not enqueue, send, or call the mailer.
--
-- Template names are the ones the hub mailer writes when a send succeeds:
--   circle-welcome -> welcome_sent_at
--   login-nudge    -> login_nudge_sent_at
--   discord-nudge  -> discord_nudge_sent_at
-- magic-link and athena-magic-link are sign-in mail, not the login nudge.
--
-- A log matches a subscription when the recipient is the subscription email,
-- the profile email for subscriptions.user_id, or metadata.user_id.

UPDATE public.subscriptions AS s
SET welcome_sent_at = src.sent_at
FROM (
  SELECT s2.id, min(l.created_at) AS sent_at
  FROM public.subscriptions AS s2
  JOIN public.email_send_log AS l
    ON l.status = 'sent'
   AND l.template_name = 'circle-welcome'
   AND (
     lower(btrim(l.recipient_email)) = lower(btrim(s2.email))
     OR (
       s2.user_id IS NOT NULL
       AND (
         EXISTS (
           SELECT 1
           FROM public.profiles AS p
           WHERE p.id = s2.user_id
             AND lower(btrim(p.email)) = lower(btrim(l.recipient_email))
         )
         OR s2.user_id = CASE
           WHEN coalesce(l.metadata->>'user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN (l.metadata->>'user_id')::uuid
           ELSE NULL
         END
       )
     )
   )
  WHERE s2.welcome_sent_at IS NULL
  GROUP BY s2.id
) AS src
WHERE s.id = src.id
  AND s.welcome_sent_at IS NULL;

UPDATE public.subscriptions AS s
SET login_nudge_sent_at = src.sent_at
FROM (
  SELECT s2.id, min(l.created_at) AS sent_at
  FROM public.subscriptions AS s2
  JOIN public.email_send_log AS l
    ON l.status = 'sent'
   AND l.template_name = 'login-nudge'
   AND (
     lower(btrim(l.recipient_email)) = lower(btrim(s2.email))
     OR (
       s2.user_id IS NOT NULL
       AND (
         EXISTS (
           SELECT 1
           FROM public.profiles AS p
           WHERE p.id = s2.user_id
             AND lower(btrim(p.email)) = lower(btrim(l.recipient_email))
         )
         OR s2.user_id = CASE
           WHEN coalesce(l.metadata->>'user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN (l.metadata->>'user_id')::uuid
           ELSE NULL
         END
       )
     )
   )
  WHERE s2.login_nudge_sent_at IS NULL
  GROUP BY s2.id
) AS src
WHERE s.id = src.id
  AND s.login_nudge_sent_at IS NULL;

UPDATE public.subscriptions AS s
SET discord_nudge_sent_at = src.sent_at
FROM (
  SELECT s2.id, min(l.created_at) AS sent_at
  FROM public.subscriptions AS s2
  JOIN public.email_send_log AS l
    ON l.status = 'sent'
   AND l.template_name = 'discord-nudge'
   AND (
     lower(btrim(l.recipient_email)) = lower(btrim(s2.email))
     OR (
       s2.user_id IS NOT NULL
       AND (
         EXISTS (
           SELECT 1
           FROM public.profiles AS p
           WHERE p.id = s2.user_id
             AND lower(btrim(p.email)) = lower(btrim(l.recipient_email))
         )
         OR s2.user_id = CASE
           WHEN coalesce(l.metadata->>'user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN (l.metadata->>'user_id')::uuid
           ELSE NULL
         END
       )
     )
   )
  WHERE s2.discord_nudge_sent_at IS NULL
  GROUP BY s2.id
) AS src
WHERE s.id = src.id
  AND s.discord_nudge_sent_at IS NULL;
