SELECT net.http_post(
  url := 'https://app.alpcontractorcircle.com/lovable/email/queue/process',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'Lovable-Context','cron',
    'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='email_queue_service_role_key')
  ),
  body := '{}'::jsonb
) AS req;