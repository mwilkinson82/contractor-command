-- Rollback for 20261104160000_athena_job_import.sql. Removes the job import functions.
-- The three tables are KEPT on purpose: they record what was imported, from where, and
-- the opening billing balances a job's pay apps rely on. Drop them only with Marshall's
-- word (last lines, commented). Rows already written into jobs, SOVs, change orders,
-- submittals and dailies stay; they are ordinary Athena records.
BEGIN;
DROP FUNCTION IF EXISTS public.mcp_job_import_apply(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.mcp_job_import_cancel(uuid);
DROP FUNCTION IF EXISTS public.mcp_job_import_stage(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.mcp_job_import_context(uuid, text, text);
COMMIT;
-- DROP TABLE IF EXISTS public.mcp_import_opening_balances;
-- DROP TABLE IF EXISTS public.mcp_import_records;
-- DROP TABLE IF EXISTS public.mcp_import_batches;
