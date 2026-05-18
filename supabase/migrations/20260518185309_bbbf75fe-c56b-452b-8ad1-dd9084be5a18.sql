
create table public.call_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_email text not null,
  user_name text,
  kind text not null check (kind in ('Biweekly Call','Monthly Bootcamp')),
  title text not null,
  needs_pressure text,
  already_tried text,
  decision_avoided text,
  financial_consequence text,
  win_looks_like text,
  status text not null default 'pending' check (status in ('pending','selected','declined','used')),
  selected_at timestamptz,
  selected_for_session_date timestamptz,
  notified_user_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index call_topics_user_id_idx on public.call_topics(user_id);
create index call_topics_status_idx on public.call_topics(status);
create index call_topics_kind_idx on public.call_topics(kind);

alter table public.call_topics enable row level security;

create policy "members submit own topics"
  on public.call_topics for insert
  with check (auth.uid() = user_id);

create policy "members read own topics"
  on public.call_topics for select
  using (auth.uid() = user_id);

create policy "admin manages topics"
  on public.call_topics for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create trigger trg_call_topics_updated_at
  before update on public.call_topics
  for each row execute function public.update_updated_at_column();
