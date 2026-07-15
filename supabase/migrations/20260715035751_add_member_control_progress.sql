create table public.member_control_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  orientation_opened_at timestamptz,
  assessment_started_at timestamptz,
  baseline_saved_at timestamptz,
  latest_baseline_id uuid references public.vault_packets(id) on delete set null,
  latest_score integer check (latest_score between 0 and 100),
  primary_category text,
  primary_constraint text,
  plan_started_at timestamptz,
  plan_updated_at timestamptz,
  plan_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index member_control_progress_updated_idx
  on public.member_control_progress(updated_at desc);

alter table public.member_control_progress enable row level security;

grant select, insert, update on table public.member_control_progress to authenticated;
grant select, insert, update, delete on table public.member_control_progress to service_role;
revoke all on table public.member_control_progress from anon;

create policy "members read own control progress"
  on public.member_control_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "members create own control progress"
  on public.member_control_progress
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "members update own control progress"
  on public.member_control_progress
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger member_control_progress_updated_at
  before update on public.member_control_progress
  for each row execute function public.update_updated_at_column();
