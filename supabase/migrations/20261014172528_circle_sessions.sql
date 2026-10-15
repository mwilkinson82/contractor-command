-- Apply only after staging verification and production approval. No events or jobs are seeded.
create table public.circle_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 160 and title !~* 'meet[.]google[.]com'),
  kind text not null default 'Biweekly Call' check (kind in ('Biweekly Call','Monthly Bootcamp')),
  starts_at timestamptz not null,
  time_zone text not null default 'America/New_York',
  duration_min integer not null check (duration_min between 15 and 480),
  meeting_url text not null unique check (meeting_url ~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$'),
  description text not null default '' check (length(description) <= 2000 and description !~* 'meet[.]google[.]com'),
  status text not null default 'scheduled' check (status in ('scheduled','canceled')),
  calendar_id text,
  calendar_event_id text,
  calendar_updated_at timestamptz,
  cadence_date date unique,
  rollover_enabled boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, calendar_event_id),
  check ((calendar_id is null) = (calendar_event_id is null)),
  check (not rollover_enabled or (calendar_event_id is not null and cadence_date is not null))
);
alter table public.circle_sessions enable row level security;
revoke all on public.circle_sessions from public, anon, authenticated;
grant select, insert, update on public.circle_sessions to service_role;
create index circle_sessions_upcoming on public.circle_sessions(starts_at) where status = 'scheduled';

create function public.circle_session_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.time_zone) then raise exception 'Invalid IANA time zone'; end if;
  if TG_OP = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function public.circle_session_version() from public, anon, authenticated;
create trigger circle_session_version before insert or update on public.circle_sessions for each row execute function public.circle_session_version();

-- Existing authorized service connector can call this RPC/SQL after rereading Google Calendar.
-- Never call with a pending conference, inferred event, recurring reusable conference, or guessed URL.
create function public.publish_circle_calendar_session(
  _calendar_id text, _event_id text, _title text, _starts_at timestamptz,
  _time_zone text, _duration_min integer, _meeting_url text, _calendar_updated_at timestamptz,
  _cadence_date date, _conference_status text, _description text default '', _rollover_enabled boolean default false
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid; existing public.circle_sessions;
begin
  if _conference_status is distinct from 'success' or nullif(_calendar_id,'') is null or nullif(_event_id,'') is null or _calendar_updated_at is null then
    raise exception 'Confirmed Calendar event and successful conference required';
  end if;
  -- Serialize the event identity; unique cadence and meeting constraints also guard conflicting events.
  perform pg_advisory_xact_lock(hashtextextended(_calendar_id || '/' || _event_id, 0));
  select * into existing from public.circle_sessions where calendar_id = _calendar_id and calendar_event_id = _event_id for update;
  if found then
    if existing.status = 'canceled' then raise exception 'Canceled session requires explicit review; cannot republish'; end if;
    if _calendar_updated_at <= existing.calendar_updated_at then return existing.id; end if;
    update public.circle_sessions set title = _title, starts_at = _starts_at, time_zone = _time_zone,
      duration_min = _duration_min, meeting_url = _meeting_url, calendar_updated_at = _calendar_updated_at,
      description = _description, rollover_enabled = _rollover_enabled
    where id = existing.id returning id into result;
  else
    if _starts_at <= now() then raise exception 'New Calendar session must be in the future'; end if;
    insert into public.circle_sessions (calendar_id, calendar_event_id, title, starts_at, time_zone,
      duration_min, meeting_url, calendar_updated_at, cadence_date, description, rollover_enabled)
    values (_calendar_id, _event_id, _title, _starts_at, _time_zone, _duration_min, _meeting_url,
      _calendar_updated_at, _cadence_date, _description, _rollover_enabled) returning id into result;
  end if;
  return result;
end $$;
revoke all on function public.publish_circle_calendar_session(text,text,text,timestamptz,text,integer,text,timestamptz,date,text,text,boolean) from public, anon, authenticated;
grant execute on function public.publish_circle_calendar_session(text,text,text,timestamptz,text,integer,text,timestamptz,date,text,text,boolean) to service_role;

alter table public.member_announcements add column announcement_mode text not null default 'general' check (announcement_mode in ('general','call'));
alter table public.member_announcements add column session_snapshot jsonb;
