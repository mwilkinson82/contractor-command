-- Rollback for 20261105170000_athena_job_contracts.sql (drizzle 0088_athena_job_contracts.sql).
-- 1. Drop the writer and the reader, so nothing new is saved or read through Athena.
-- 2. The contract tables and every row in them are KEPT: they are the job's record. Drop them only with
--    Marshall's word (commented).
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.mcp_job_contract_rows(uuid);
DROP FUNCTION IF EXISTS public.mcp_job_contract_save(uuid, jsonb);
-- DROP TABLE IF EXISTS public.mcp_job_contract_versions;
-- DROP TABLE IF EXISTS public.mcp_job_contracts;
