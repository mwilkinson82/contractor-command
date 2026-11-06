-- Staff replies on a support ticket, sent from the ticket's support address.
-- One row per reply. service_role only: members and anon cannot read, write or call these.
-- The recipient is fixed by the server: the ticket's customer, or Marshall for a test copy.

create table if not exists public.support_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id),
  brand text not null check (brand in ('athena', 'circle')),
  staff_user_id uuid not null,
  mode text not null check (mode in ('preview', 'customer')),
  to_email text not null,
  from_address text not null,
  subject text not null check (char_length(subject) between 1 and 300),
  body text not null check (char_length(body) between 1 and 8000),
  in_reply_to text check (in_reply_to is null or char_length(in_reply_to) <= 998),
  references_header text check (references_header is null or char_length(references_header) <= 8000),
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 200),
  state text not null default 'sending' check (state in ('sending', 'sent', 'failed', 'review')),
  attempts integer not null default 1,
  lease_until timestamptz,
  provider_email_id text,
  provider_message_id text,
  error text check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists support_replies_ticket_idx
  on public.support_replies (ticket_id, created_at);

alter table public.support_replies enable row level security;
revoke all on table public.support_replies from public, anon, authenticated;
grant select, insert, update on table public.support_replies to service_role;

create or replace function public.claim_support_reply(
  _ticket_id uuid,
  _staff_user_id uuid,
  _mode text,
  _to_email text,
  _from_address text,
  _subject text,
  _body text,
  _in_reply_to text,
  _references text,
  _idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  t public.support_tickets%rowtype;
  r public.support_replies%rowtype;
  expected_to text;
  expected_from text;
begin
  if _mode is null or _mode not in ('preview', 'customer') or _staff_user_id is null then
    raise exception 'invalid support reply';
  end if;
  select * into t from public.support_tickets where id = _ticket_id;
  if not found then raise exception 'ticket not found'; end if;
  expected_to := case when _mode = 'preview' then 'marshall@marshallwilkinson.com' else t.from_email end;
  expected_from := case when t.brand = 'athena'
    then 'Athena Support <support@meetathena.io>'
    else 'Circle Support <support@alpcontractorcircle.com>' end;
  if lower(btrim(_to_email)) is distinct from lower(expected_to)
    or _from_address is distinct from expected_from then
    raise exception 'invalid support reply recipients';
  end if;
  insert into public.support_replies (
    ticket_id, brand, staff_user_id, mode, to_email, from_address, subject, body,
    in_reply_to, references_header, idempotency_key, lease_until
  ) values (
    t.id, t.brand, _staff_user_id, _mode, lower(expected_to), expected_from, _subject, _body,
    _in_reply_to, _references, _idempotency_key, now() + interval '2 minutes'
  )
  on conflict (idempotency_key) do nothing
  returning * into r;
  if r.id is not null then
    return jsonb_build_object('state', 'ready', 'id', r.id, 'provider_email_id', null);
  end if;
  select * into r from public.support_replies where idempotency_key = _idempotency_key for update;
  if r.ticket_id <> t.id or r.mode <> _mode then raise exception 'support reply key mismatch'; end if;
  if r.state in ('sent', 'review') then
    return jsonb_build_object('state', r.state, 'id', r.id, 'provider_email_id', r.provider_email_id);
  end if;
  if r.state = 'sending' and r.lease_until > now() then
    return jsonb_build_object('state', 'busy', 'id', r.id, 'provider_email_id', r.provider_email_id);
  end if;
  -- Resend keeps an idempotency key for 24 hours. Past that a retry could send twice.
  if r.created_at < now() - interval '23 hours' then
    update public.support_replies set state = 'review', lease_until = null where id = r.id;
    return jsonb_build_object('state', 'review', 'id', r.id, 'provider_email_id', r.provider_email_id);
  end if;
  update public.support_replies
    set state = 'sending', lease_until = now() + interval '2 minutes', attempts = attempts + 1,
        error = null, staff_user_id = _staff_user_id
    where id = r.id
    returning * into r;
  return jsonb_build_object('state', 'ready', 'id', r.id, 'provider_email_id', r.provider_email_id);
end $$;

create or replace function public.finish_support_reply(
  _reply_id uuid,
  _result text,
  _provider_email_id text,
  _provider_message_id text,
  _error text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.support_replies%rowtype;
begin
  if _result is null or _result not in ('sent', 'failed', 'review', 'accepted') then
    raise exception 'invalid support reply outcome';
  end if;
  select * into r from public.support_replies where id = _reply_id for update;
  if not found then raise exception 'support reply not found'; end if;
  if r.state = 'sent' then return; end if;
  if _result = 'accepted' then
    -- Provider took the email. Keep its id so a retry looks it up instead of sending again.
    update public.support_replies set provider_email_id = coalesce(_provider_email_id, provider_email_id)
      where id = r.id;
    return;
  end if;
  update public.support_replies
    set state = _result,
        lease_until = null,
        provider_email_id = coalesce(_provider_email_id, provider_email_id),
        provider_message_id = coalesce(_provider_message_id, provider_message_id),
        error = case when _result = 'sent' then null else left(_error, 500) end,
        sent_at = case when _result = 'sent' then now() else sent_at end
    where id = r.id;
  if _result = 'sent' and r.mode = 'customer' then
    update public.support_tickets set status = 'replied' where id = r.ticket_id;
  end if;
end $$;

revoke all on function public.claim_support_reply(uuid, uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.finish_support_reply(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_support_reply(uuid, uuid, text, text, text, text, text, text, text, text)
  to service_role;
grant execute on function public.finish_support_reply(uuid, text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
