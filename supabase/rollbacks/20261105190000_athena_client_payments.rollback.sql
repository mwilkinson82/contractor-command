-- Rollback for 20261105190000_athena_client_payments.sql: removes client payments, the connected account records
-- and the handled-event list. Billing receipts, applications and reversals they booked stay on the job, and money
-- already paid stays in the contractor's Stripe account.
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.mcp_portal_pay_refunded(text, text, bigint);
DROP FUNCTION IF EXISTS public.mcp_portal_pay_update(text, text, text, text, text, text, bigint, bigint, timestamptz);
DROP FUNCTION IF EXISTS public.mcp_stripe_connect_event_finish(text, boolean);
DROP FUNCTION IF EXISTS public.mcp_stripe_connect_event_claim(text, text, boolean, text);
DROP FUNCTION IF EXISTS public.mcp_portal_pay_opened(uuid, uuid, text, text, text, text[], bigint, bigint);
DROP FUNCTION IF EXISTS public.mcp_portal_pay_start(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.mcp_portal_payments_state(uuid, text);
DROP FUNCTION IF EXISTS public.mcp_client_payments_set_mode(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.mcp_client_payments_account_status(text, boolean, text);
DROP FUNCTION IF EXISTS public.mcp_client_payments_account_save(uuid, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.mcp_client_payments_server_get(uuid);
DROP FUNCTION IF EXISTS public.mcp_job_payments_list(uuid);
DROP FUNCTION IF EXISTS public.mcp_client_payments_settings(uuid, boolean, boolean, bigint);
DROP FUNCTION IF EXISTS public.mcp_client_payments_get(uuid);
DROP FUNCTION IF EXISTS mcp_private.client_payments_owner(uuid);
DROP FUNCTION IF EXISTS mcp_private.portal_payment_json(public.mcp_portal_payments);
DROP FUNCTION IF EXISTS mcp_private.client_payments_json(public.mcp_company_payments, boolean);
DROP TABLE IF EXISTS public.mcp_stripe_connect_events;
DROP TABLE IF EXISTS public.mcp_portal_payments;
DROP TABLE IF EXISTS public.mcp_company_payments;
