-- Review and apply through Lovable Cloud only, after the estimating correction.
-- Exact ordinary authenticated POST entry points with verified active callers.
-- Their unchanged member gate may lock/refresh existing provisioning/cache rows.
-- Correct transaction classification only; no body, ACL, policy or data change.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER FUNCTION public.mcp_daily_reminder_status(text) VOLATILE;
ALTER FUNCTION public.mcp_daily_report_get(uuid, date) VOLATILE;
ALTER FUNCTION public.mcp_field_board(uuid) VOLATILE;
ALTER FUNCTION public.mcp_field_reminder_preview(uuid) VOLATILE;
ALTER FUNCTION public.mcp_file_upload_get(uuid, uuid) VOLATILE;
ALTER FUNCTION public.mcp_guided_latest(uuid, text) VOLATILE;
ALTER FUNCTION public.mcp_living_report_get(uuid, text, integer) VOLATILE;
ALTER FUNCTION public.mcp_morning_brief_card_status() VOLATILE;
ALTER FUNCTION public.mcp_morning_brief_feed() VOLATILE;
ALTER FUNCTION public.mcp_progress_photos_list(uuid, date, date, text, text, boolean) VOLATILE;
ALTER FUNCTION public.mcp_project_record_search(uuid, date, date, text, text) VOLATILE;
ALTER FUNCTION public.mcp_submittal_chase_due() VOLATILE;
ALTER FUNCTION public.mcp_submittal_chase_rows(uuid) VOLATILE;
ALTER FUNCTION public.mcp_submittal_package_context(uuid, uuid) VOLATILE;
ALTER FUNCTION public.mcp_submittal_rows(uuid) VOLATILE;
NOTIFY pgrst, 'reload schema';
