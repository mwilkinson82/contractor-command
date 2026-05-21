CREATE UNIQUE INDEX IF NOT EXISTS pending_claims_stripe_subscription_id_key
ON public.pending_claims (stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;