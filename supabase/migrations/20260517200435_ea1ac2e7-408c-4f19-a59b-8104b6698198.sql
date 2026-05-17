
create table public.ask_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ask_threads_user_updated_idx on public.ask_threads(user_id, updated_at desc);

alter table public.ask_threads enable row level security;

create policy "own ask threads all" on public.ask_threads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger ask_threads_updated
  before update on public.ask_threads
  for each row execute function public.update_updated_at_column();

create table public.ask_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ask_threads(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index ask_messages_thread_idx on public.ask_messages(thread_id, created_at);

alter table public.ask_messages enable row level security;

create policy "own ask messages all" on public.ask_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
