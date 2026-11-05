-- Rollback for 20261106120000_athena_precon.sql.
-- 1. Drop the readers and writers, so nothing new is saved or read through Athena.
-- 2. The agreements table and every row in it are KEPT: they are the job's record. Drop it only with
--    Marshall's word (commented).
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.mcp_precon_invoice_share(uuid, jsonb);
DROP FUNCTION IF EXISTS public.mcp_precon_step(uuid, jsonb);
DROP FUNCTION IF EXISTS public.mcp_precon_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.mcp_precon_get(uuid);
DROP FUNCTION IF EXISTS mcp_private.precon_json(public.mcp_precon_agreements);
DROP FUNCTION IF EXISTS mcp_private.precon_invoice_json(uuid, uuid);
DROP FUNCTION IF EXISTS mcp_private.precon_change_json(uuid, uuid);
DROP FUNCTION IF EXISTS mcp_private.precon_has_sov(uuid);
DROP FUNCTION IF EXISTS mcp_private.precon_phase(public.mcp_precon_agreements);
DROP FUNCTION IF EXISTS mcp_private.precon_parts(bigint, integer, bigint, jsonb);
DROP FUNCTION IF EXISTS mcp_private.precon_job(uuid);
-- DROP TABLE IF EXISTS public.mcp_precon_agreements;
