-- Prevent duplicate circle-welcome (and other templated) sends when concurrent
-- Stripe webhook handlers both pass the SELECT-based dedupe check.

create unique index if not exists idx_email_send_log_template_idempotency
  on public.email_send_log (template_name, ((metadata ->> 'idempotency_key')))
  where metadata ? 'idempotency_key'
    and coalesce(metadata ->> 'idempotency_key', '') <> '';
