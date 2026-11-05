-- Rollback for the four 20261105100000 to 20261105100300 athena_job_logs part files.
-- 1. Put mcp_living_report_save back as 20261020213000 defined it (re-run that
--    CREATE OR REPLACE block). Do this only when no plain (unloaded) CPM is
--    saved, or the next save of one will be refused.
-- 2. Put the job import functions back as 20261105090000 left them (re-run its
--    three CREATE OR REPLACE FUNCTION blocks).
-- 3. Drop the new writers. The log tables and every row in them are KEPT: they
--    are the job's record. Drop them only with Marshall's word (commented).
--    RFIs recorded outside Athena stay as ordinary RFI rows; the widened request
--    check and the sent_outside patch stay, since those rows need them.
DROP FUNCTION IF EXISTS public.mcp_job_log_rows(uuid, text);
DROP FUNCTION IF EXISTS public.mcp_job_log_record(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.mcp_request_record_outside(uuid, jsonb);
-- DROP TABLE IF EXISTS public.mcp_job_log_operations;
-- DROP TABLE IF EXISTS public.mcp_claim_events;
-- DROP TABLE IF EXISTS public.mcp_claims;
-- DROP TABLE IF EXISTS public.mcp_inspections;
-- DROP TABLE IF EXISTS public.mcp_decisions;
