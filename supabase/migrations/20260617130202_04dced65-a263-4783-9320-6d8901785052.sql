DO $$
DECLARE
  v_count int;
BEGIN
  UPDATE pgmq.q_transactional_emails
  SET message = jsonb_set(
        jsonb_set(message, '{html}', to_jsonb(replace(message->>'html', 'discord.gg/QMHyMuyV', 'discord.gg/yvVN2N3qvN'))),
        '{text}', to_jsonb(replace(message->>'text', 'discord.gg/QMHyMuyV', 'discord.gg/yvVN2N3qvN'))
      )
  WHERE message->>'label' = 'discord-nudge'
    AND (message->>'html' LIKE '%QMHyMuyV%' OR message->>'text' LIKE '%QMHyMuyV%');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Patched % queued discord-nudge messages', v_count;
END $$;