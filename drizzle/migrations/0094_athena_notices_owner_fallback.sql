-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Plain SQL for Lovable to apply; nothing in this repo applies it. Apply after
-- 20261105180000_athena_job_notices.sql.
--
-- Job notice emails fall back to the company owner when a job has no PM.
-- Before: a client's approval, a submittal reply or a sub's confirmation emailed only the job's PM by default. On a
-- job with no PM, or a PM saved as a name with no email, nobody got the email.
-- After: when the job has no PM with an email, each company owner gets every email the PM would have had. An owner
-- choice set on the job still wins, so an owner who turned a topic off stays off. Once the job has a PM, owners go
-- back to their own defaults (client messages only).
-- Only mcp_private functions change. Grants are unchanged: both stay closed to every API role.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- True when the job's PM can be emailed: a member PM's sign-in email, or the PM contact's email.
CREATE OR REPLACE FUNCTION mcp_private.job_notice_has_pm(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT coalesce(nullif(btrim(u.email), ''), nullif(btrim(j.pm_email), '')) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      FROM public.mcp_jobs j LEFT JOIN auth.users u ON u.id = j.pm_user_id
     WHERE j.id = _job), false)
$$;
REVOKE ALL ON FUNCTION mcp_private.job_notice_has_pm(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- A role's choice for a topic on a job: the saved choice, else the default. With no PM, an owner's default is
-- whatever the PM would have received.
CREATE OR REPLACE FUNCTION mcp_private.job_notice_wants(_job uuid, _role text, _topic text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT p.email FROM public.mcp_job_notice_prefs p WHERE p.job_id = _job AND p.role = _role AND p.topic = _topic),
    CASE WHEN _role = 'owner' AND NOT mcp_private.job_notice_has_pm(_job) THEN
      mcp_private.job_notice_default('owner', _topic) OR coalesce(
        (SELECT p.email FROM public.mcp_job_notice_prefs p WHERE p.job_id = _job AND p.role = 'job_pm' AND p.topic = _topic),
        mcp_private.job_notice_default('job_pm', _topic))
    ELSE mcp_private.job_notice_default(_role, _topic) END)
$$;
REVOKE ALL ON FUNCTION mcp_private.job_notice_wants(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
