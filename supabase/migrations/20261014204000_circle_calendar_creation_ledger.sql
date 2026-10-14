-- REVIEW PROPOSAL ONLY. Apply after the original circle_sessions migration.
-- This file has no Calendar calls, jobs, emails, seeds, secrets, or frontend changes.
-- Execute as the existing authorized Lovable database owner, after review.
begin;

-- GRANT is additive: undo service_role default grants before narrowing them.
revoke all on public.circle_sessions from service_role;
grant select, insert, update on public.circle_sessions to service_role;
alter table public.circle_sessions
  add constraint circle_sessions_finite_start check (isfinite(starts_at)),
  add constraint circle_sessions_positive_version check (version > 0),
  add column calendar_verified_at timestamptz,
  add column calendar_verification_method text
    check (calendar_verification_method in ('normalized_event_read'));

create table public.circle_calendar_attempts (
  cadence_date date primary key check (isfinite(cadence_date) and extract(isodow from cadence_date) = 7),
  marker uuid not null unique default gen_random_uuid(),
  calendar_id text not null check (length(btrim(calendar_id)) > 0),
  source_session_id uuid references public.circle_sessions(id),
  source_version integer,
  source_event_id text not null check (length(btrim(source_event_id)) > 0),
  source_cadence_date date not null check (isfinite(source_cadence_date)),
  source_starts_at timestamptz not null,
  source_meeting_url text not null check (source_meeting_url ~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$'),
  starts_at timestamptz not null,
  state text not null default 'reserved' check (state in ('reserved','attempted','event_recorded','published')),
  attempt_id uuid unique,
  attempted_at timestamptz,
  calendar_event_id text check (length(btrim(calendar_event_id)) > 0),
  session_id uuid unique references public.circle_sessions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(calendar_id, calendar_event_id),
  check (cadence_date = source_cadence_date + 14),
  check ((source_session_id is null) = (source_version is null)),
  check (source_version is null or source_version > 0),
  check (source_starts_at = (source_cadence_date + time '17:00') at time zone 'America/New_York'),
  check (starts_at = (cadence_date + time '17:00') at time zone 'America/New_York'),
  check ((attempt_id is null) = (attempted_at is null)),
  check ((state = 'reserved' and attempt_id is null and calendar_event_id is null and session_id is null)
    or (state = 'attempted' and attempt_id is not null and calendar_event_id is null and session_id is null)
    or (state = 'event_recorded' and calendar_event_id is not null and session_id is null)
    or (state = 'published' and calendar_event_id is not null and session_id is not null))
);
alter table public.circle_calendar_attempts enable row level security;
revoke all on public.circle_calendar_attempts from public, anon, authenticated, service_role;
grant select, insert, update on public.circle_calendar_attempts to service_role;

-- Immutable identity + monotone state. A timeout never releases a create attempt.
create function public.guard_circle_calendar_attempt() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.cadence_date,new.marker,new.calendar_id,new.source_session_id,new.source_version,
      new.source_event_id,new.source_cadence_date,new.source_starts_at,new.source_meeting_url,new.starts_at,new.created_at)
     is distinct from
     row(old.cadence_date,old.marker,old.calendar_id,old.source_session_id,old.source_version,
      old.source_event_id,old.source_cadence_date,old.source_starts_at,old.source_meeting_url,old.starts_at,old.created_at)
  then raise exception 'Reservation identity is immutable'; end if;
  if (old.attempt_id is not null and row(new.attempt_id,new.attempted_at) is distinct from row(old.attempt_id,old.attempted_at))
    or (old.calendar_event_id is not null and new.calendar_event_id is distinct from old.calendar_event_id)
    or (old.session_id is not null and new.session_id is distinct from old.session_id)
  then raise exception 'Recorded attempt/event/session identity is immutable'; end if;
  if not (new.state = old.state
    or (old.state = 'reserved' and new.state in ('attempted','event_recorded'))
    or (old.state = 'attempted' and new.state = 'event_recorded')
    or (old.state = 'event_recorded' and new.state = 'published'))
  then raise exception 'Calendar attempt cannot be reset'; end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.guard_circle_calendar_attempt() from public, anon, authenticated, service_role;
create trigger guard_circle_calendar_attempt before update on public.circle_calendar_attempts
  for each row execute function public.guard_circle_calendar_attempt();

-- Future runs use a real persisted source. The separately reviewed bootstrap SQL
-- is the only initial reservation path; never infer the anchor from today's date.
create function public.reserve_circle_rollover(_source_id uuid, _expected_version integer)
returns public.circle_calendar_attempts language plpgsql security invoker set search_path = '' as $$
declare s public.circle_sessions; a public.circle_calendar_attempts; d date; t timestamptz;
begin
  select * into s from public.circle_sessions where id = _source_id for share;
  if not found or s.version is distinct from _expected_version or s.status <> 'scheduled'
    or not s.rollover_enabled or s.kind <> 'Biweekly Call' or s.calendar_id is null
    or s.calendar_event_id is null or s.cadence_date is null or s.duration_min <> 90
    or s.time_zone <> 'America/New_York' or extract(isodow from s.cadence_date) <> 7
    or s.starts_at <> (s.cadence_date + time '17:00') at time zone 'America/New_York'
    or now() <= s.starts_at
  then raise exception 'Source is not an unchanged due biweekly session'; end if;
  d := s.cadence_date + 14;
  t := (d + time '17:00') at time zone 'America/New_York';
  select * into a from public.circle_calendar_attempts where cadence_date = d;
  if found then
    if a.source_session_id is distinct from s.id or a.source_version is distinct from s.version
      or a.calendar_id <> s.calendar_id then raise exception 'Reservation source changed'; end if;
    return a;
  end if;
  if t <= now() then raise exception 'Missed cadence requires review'; end if;
  if exists (select 1 from public.circle_sessions where cadence_date = d
    or (status = 'scheduled' and starts_at < t + interval '90 minutes'
      and starts_at + duration_min * interval '1 minute' > t))
  then raise exception 'Existing target session requires reconciliation'; end if;
  insert into public.circle_calendar_attempts(cadence_date,calendar_id,source_session_id,source_version,
      source_event_id,source_cadence_date,source_starts_at,source_meeting_url,starts_at)
  values(d,s.calendar_id,s.id,s.version,s.calendar_event_id,s.cadence_date,s.starts_at,s.meeting_url,t)
  on conflict(cadence_date) do nothing;
  select * into a from public.circle_calendar_attempts where cadence_date = d;
  if a.source_session_id is distinct from s.id or a.source_version is distinct from s.version
    or a.calendar_id <> s.calendar_id then raise exception 'Conflicting reservation'; end if;
  return a;
end $$;
revoke all on function public.reserve_circle_rollover(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.reserve_circle_rollover(uuid,integer) to service_role;

-- Call only after full source reread and complete target search. Exactly the
-- invocation returning allow_create=true may call create_event ONCE.
-- If this SQL response is lost, do not create: a retry will return false.
create function public.begin_circle_calendar_create(_cadence_date date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.circle_calendar_attempts; s public.circle_sessions;
begin
  select * into a from public.circle_calendar_attempts where cadence_date = _cadence_date for update;
  if not found then raise exception 'Reservation required'; end if;
  if a.state <> 'reserved' then return jsonb_build_object('allow_create',false,'reservation',to_jsonb(a)); end if;
  if now() <= a.source_starts_at or now() >= a.starts_at then raise exception 'Outside allowed rollover window'; end if;
  if a.source_session_id is not null then
    select * into s from public.circle_sessions where id = a.source_session_id for share;
    if not found or s.status <> 'scheduled' or not s.rollover_enabled or s.version <> a.source_version
    then raise exception 'Source changed; reconcile before creation'; end if;
  end if;
  if exists (select 1 from public.circle_sessions where cadence_date = a.cadence_date
    or (status = 'scheduled' and starts_at < a.starts_at + interval '90 minutes'
      and starts_at + duration_min * interval '1 minute' > a.starts_at))
  then raise exception 'Target session already exists or overlaps'; end if;
  update public.circle_calendar_attempts set state='attempted',attempt_id=gen_random_uuid(),attempted_at=now()
    where cadence_date = _cadence_date returning * into a;
  return jsonb_build_object('allow_create',true,'reservation',to_jsonb(a));
end $$;
revoke all on function public.begin_circle_calendar_create(date) from public, anon, authenticated, service_role;
grant execute on function public.begin_circle_calendar_create(date) to service_role;

-- Persist returned ID immediately, before conference polling or publication.
-- For a found preexisting event, call from reserved with _attempt_id=NULL only
-- after verifying its exact stored marker. For unknown outcomes, a unique exact
-- marker match may be recorded after reconciliation; zero matches never permits create.
create function public.record_circle_calendar_event(_cadence_date date, _attempt_id uuid, _event_id text, _marker uuid)
returns public.circle_calendar_attempts language plpgsql security invoker set search_path = '' as $$
declare a public.circle_calendar_attempts;
begin
  select * into a from public.circle_calendar_attempts where cadence_date = _cadence_date for update;
  if not found or a.marker is distinct from _marker or nullif(btrim(_event_id),'') is null
    then raise exception 'Exact reservation marker and event identity required'; end if;
  if a.attempt_id is distinct from _attempt_id then raise exception 'Wrong creation attempt'; end if;
  if a.calendar_event_id is not null then
    if a.calendar_event_id <> _event_id then raise exception 'Event identity cannot be replaced'; end if;
    return a;
  end if;
  update public.circle_calendar_attempts set calendar_event_id=_event_id,state='event_recorded'
    where cadence_date=_cadence_date returning * into a;
  return a;
end $$;
revoke all on function public.record_circle_calendar_event(date,uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_circle_calendar_event(date,uuid,text,uuid) to service_role;

-- This call makes the canonical session and completion receipt atomic. The
-- trusted runner supplies fields from a fresh read of the exact stored event.
-- SQL cannot independently prove Google Calendar facts: the read is mandatory.
create function public.publish_circle_reserved_session(
  _cadence_date date, _calendar_id text, _event_id text, _title text,
  _starts_at timestamptz, _ends_at timestamptz, _time_zone text,
  _event_status text, _is_recurring boolean,
  _meeting_url text, _description text default '')
returns uuid language plpgsql security invoker set search_path = '' as $$
declare a public.circle_calendar_attempts; s public.circle_sessions; result uuid;
begin
  select * into a from public.circle_calendar_attempts where cadence_date=_cadence_date for update;
  if not found or a.state not in ('event_recorded','published') then raise exception 'Recorded event required'; end if;
  if _calendar_id is distinct from a.calendar_id or _event_id is distinct from a.calendar_event_id
    or _starts_at is distinct from a.starts_at or _ends_at is distinct from a.starts_at + interval '90 minutes'
    or _time_zone is distinct from 'America/New_York' or _event_status is distinct from 'confirmed'
    or _is_recurring is distinct from false
    or _meeting_url is null or _meeting_url = a.source_meeting_url
    or _meeting_url !~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$'
  then raise exception 'Exact standalone event and fresh verified Meet URL required'; end if;
  if a.state = 'published' then
    select * into s from public.circle_sessions where id=a.session_id;
    if not found or s.status <> 'scheduled' or s.calendar_id is distinct from a.calendar_id
      or s.calendar_event_id is distinct from a.calendar_event_id or s.cadence_date is distinct from a.cadence_date
      or s.starts_at is distinct from _starts_at or s.duration_min <> 90 or s.time_zone <> _time_zone
      or s.meeting_url is distinct from _meeting_url or s.title is distinct from _title
      or s.description is distinct from _description or not s.rollover_enabled
    then raise exception 'Published session changed; reconcile explicitly'; end if;
    return a.session_id;
  end if;
  if a.source_session_id is not null then
    select * into s from public.circle_sessions where id=a.source_session_id for share;
    if not found or s.status <> 'scheduled' or not s.rollover_enabled or s.version <> a.source_version
    then raise exception 'Source changed; retain event and reconcile'; end if;
  end if;
  if _starts_at <= now() then raise exception 'Target session has already started'; end if;
  if exists (select 1 from public.circle_sessions where status='scheduled'
    and starts_at < _ends_at and starts_at + duration_min * interval '1 minute' > _starts_at
    and (calendar_id is distinct from _calendar_id or calendar_event_id is distinct from _event_id))
  then raise exception 'Conflicting session overlaps target; retain event for review'; end if;
  -- The connector does not expose provider updated/conferenceData. Never invent
  -- either: retain calendar_updated_at=NULL and record our observation separately.
  perform pg_advisory_xact_lock(hashtextextended(_calendar_id || '/' || _event_id, 0));
  select * into s from public.circle_sessions
    where calendar_id=_calendar_id and calendar_event_id=_event_id for update;
  if found then
    if s.status <> 'scheduled' or s.cadence_date is distinct from _cadence_date
      or s.starts_at is distinct from _starts_at or s.time_zone <> _time_zone
      or s.duration_min <> 90 or s.meeting_url is distinct from _meeting_url
      or s.title is distinct from _title or s.description is distinct from _description
      or not s.rollover_enabled
    then raise exception 'Existing canonical event differs; reconcile explicitly'; end if;
    result := s.id;
  else
    insert into public.circle_sessions(calendar_id,calendar_event_id,title,starts_at,time_zone,
      duration_min,meeting_url,cadence_date,description,rollover_enabled,calendar_verified_at,calendar_verification_method)
    values(_calendar_id,_event_id,_title,_starts_at,_time_zone,90,_meeting_url,_cadence_date,_description,true,
      statement_timestamp(),'normalized_event_read') returning id into result;
  end if;
  select * into s from public.circle_sessions where id=result;
  if s.cadence_date is distinct from a.cadence_date or s.starts_at is distinct from a.starts_at
    or s.meeting_url is distinct from _meeting_url or s.status <> 'scheduled' or not s.rollover_enabled
    then raise exception 'Canonical row differs; transaction rolled back'; end if;
  update public.circle_calendar_attempts set session_id=result,state='published' where cadence_date=_cadence_date;
  return result;
end $$;
revoke all on function public.publish_circle_reserved_session(date,text,text,text,timestamptz,timestamptz,text,text,boolean,text,text) from public, anon, authenticated, service_role;
grant execute on function public.publish_circle_reserved_session(date,text,text,text,timestamptz,timestamptz,text,text,boolean,text,text) to service_role;
commit;
