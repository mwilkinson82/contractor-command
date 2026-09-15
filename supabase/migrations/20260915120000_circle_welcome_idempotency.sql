-- Prevent two Stripe events (checkout.session.completed +
-- customer.subscription.created) from enqueueing two circle-welcome messages
-- for the same subscription. Keep pending and sent unique separately so the
-- queue processor can insert a sent row with the same idempotency key.

DELETE FROM public.email_send_log a
USING public.email_send_log b
WHERE a.template_name = 'circle-welcome'
  AND b.template_name = 'circle-welcome'
  AND a.status = b.status
  AND a.status IN ('pending', 'sent')
  AND a.metadata->>'idempotency_key' IS NOT NULL
  AND a.metadata->>'idempotency_key' = b.metadata->>'idempotency_key'
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_circle_welcome_pending_key
  ON public.email_send_log (template_name, ((metadata->>'idempotency_key')))
  WHERE template_name = 'circle-welcome'
    AND status = 'pending'
    AND metadata->>'idempotency_key' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_circle_welcome_sent_key
  ON public.email_send_log (template_name, ((metadata->>'idempotency_key')))
  WHERE template_name = 'circle-welcome'
    AND status = 'sent'
    AND metadata->>'idempotency_key' IS NOT NULL;
