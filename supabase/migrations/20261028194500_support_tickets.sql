-- Additive support inbox. Numbers are per brand: ATH-0001 for support@meetathena.io,
-- CIR-0001 for support@alpcontractorcircle.com. Retries of the same Resend email id
-- or Message-ID return the original row. service_role only; members cannot read these rows.

create table public.support_ticket_counters (
  brand text primary key check (brand in ('athena', 'circle')),
  last_number integer not null default 0 check (last_number >= 0)
);

insert into public.support_ticket_counters (brand, last_number) values
  ('athena', 0),
  ('circle', 0);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique check (ticket_number ~ '^(ATH|CIR)-[0-9]{4,}$'),
  brand text not null check (brand in ('athena', 'circle')),
  from_email text not null check (from_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  subject text check (subject is null or char_length(subject) <= 500),
  message_id text check (message_id is null or char_length(message_id) <= 998),
  received_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'replied', 'closed')),
  raw_summary text check (raw_summary is null or char_length(raw_summary) <= 4000),
  resend_email_id text not null unique check (char_length(resend_email_id) between 1 and 200),
  autoreply_sent_at timestamptz,
  notify_sent_at timestamptz,
  autoreply_suppressed_reason text check (
    autoreply_suppressed_reason is null
    or (
      char_length(autoreply_suppressed_reason) between 1 and 40
      and autoreply_suppressed_reason ~ '^[a-z_]+$'
    )
  ),
  check (
    (brand = 'athena' and ticket_number like 'ATH-%')
    or (brand = 'circle' and ticket_number like 'CIR-%')
  )
);

create unique index support_tickets_message_id_uidx
  on public.support_tickets (lower(message_id))
  where message_id is not null;

alter table public.support_tickets enable row level security;
alter table public.support_ticket_counters enable row level security;

revoke all on table public.support_tickets from public, anon, authenticated;
revoke all on table public.support_ticket_counters from public, anon, authenticated;
grant select, insert, update on table public.support_tickets to service_role;
grant select, update on table public.support_ticket_counters to service_role;

create function public.open_support_ticket(
  _resend_email_id text,
  _brand text,
  _from_email text,
  _subject text,
  _message_id text,
  _received_at timestamptz,
  _raw_summary text
) returns table (
  id uuid,
  ticket_number text,
  brand text,
  from_email text,
  subject text,
  message_id text,
  received_at timestamptz,
  status text,
  raw_summary text,
  resend_email_id text,
  autoreply_sent_at timestamptz,
  notify_sent_at timestamptz,
  autoreply_suppressed_reason text,
  inserted boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing public.support_tickets%rowtype;
  n integer;
  num text;
  prefix text;
  normalized_message text;
  subject_clean text;
  from_clean text;
  summary_clean text;
  resend_clean text;
begin
  if _brand not in ('athena', 'circle') then
    raise exception 'unknown support brand';
  end if;

  resend_clean := btrim(coalesce(_resend_email_id, ''));
  if resend_clean = '' or char_length(resend_clean) > 200 then
    raise exception 'resend email id required';
  end if;

  from_clean := lower(btrim(coalesce(_from_email, '')));
  if from_clean ~ '<[^>]+>' then
    from_clean := lower(substring(from_clean from '<([^>]+)>'));
  end if;
  from_clean := btrim(from_clean);
  if from_clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid from email';
  end if;

  subject_clean := nullif(btrim(regexp_replace(coalesce(_subject, ''), '[\r\n]+', ' ', 'g')), '');
  if subject_clean is not null then
    subject_clean := left(subject_clean, 500);
  end if;

  summary_clean := nullif(left(btrim(coalesce(_raw_summary, '')), 4000), '');

  normalized_message := nullif(regexp_replace(coalesce(_message_id, ''), '[[:space:]]', '', 'g'), '');
  if normalized_message is not null
     and not (left(normalized_message, 1) = '<' and right(normalized_message, 1) = '>') then
    normalized_message := '<' || trim(both '<>' from normalized_message) || '>';
  end if;
  if normalized_message is not null and char_length(normalized_message) > 998 then
    raise exception 'message id too long';
  end if;

  perform 1 from public.support_ticket_counters where support_ticket_counters.brand = _brand for update;
  if not found then
    raise exception 'missing support ticket counter';
  end if;

  select * into existing
    from public.support_tickets
   where support_tickets.resend_email_id = resend_clean
      or (
        normalized_message is not null
        and support_tickets.message_id is not null
        and lower(support_tickets.message_id) = lower(normalized_message)
      )
   order by support_tickets.received_at
   limit 1;

  if found then
    return query
    select
      existing.id,
      existing.ticket_number,
      existing.brand,
      existing.from_email,
      existing.subject,
      existing.message_id,
      existing.received_at,
      existing.status,
      existing.raw_summary,
      existing.resend_email_id,
      existing.autoreply_sent_at,
      existing.notify_sent_at,
      existing.autoreply_suppressed_reason,
      false;
    return;
  end if;

  prefix := case _brand when 'athena' then 'ATH' else 'CIR' end;
  update public.support_ticket_counters
     set last_number = last_number + 1
   where support_ticket_counters.brand = _brand
   returning last_number into n;
  num := prefix || '-' || lpad(n::text, greatest(4, char_length(n::text)), '0');

  insert into public.support_tickets (
    ticket_number,
    brand,
    from_email,
    subject,
    message_id,
    received_at,
    status,
    raw_summary,
    resend_email_id
  ) values (
    num,
    _brand,
    from_clean,
    subject_clean,
    normalized_message,
    coalesce(_received_at, now()),
    'open',
    summary_clean,
    resend_clean
  )
  returning * into existing;

  return query
  select
    existing.id,
    existing.ticket_number,
    existing.brand,
    existing.from_email,
    existing.subject,
    existing.message_id,
    existing.received_at,
    existing.status,
    existing.raw_summary,
    existing.resend_email_id,
    existing.autoreply_sent_at,
    existing.notify_sent_at,
    existing.autoreply_suppressed_reason,
    true;
exception
  when unique_violation then
    select * into existing
      from public.support_tickets
     where support_tickets.resend_email_id = resend_clean
        or (
          normalized_message is not null
          and support_tickets.message_id is not null
          and lower(support_tickets.message_id) = lower(normalized_message)
        )
     limit 1;
    if not found then
      raise;
    end if;
    return query
    select
      existing.id,
      existing.ticket_number,
      existing.brand,
      existing.from_email,
      existing.subject,
      existing.message_id,
      existing.received_at,
      existing.status,
      existing.raw_summary,
      existing.resend_email_id,
      existing.autoreply_sent_at,
      existing.notify_sent_at,
      existing.autoreply_suppressed_reason,
      false;
end;
$$;

revoke all on function public.open_support_ticket(text, text, text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.open_support_ticket(text, text, text, text, text, timestamptz, text)
  to service_role;
