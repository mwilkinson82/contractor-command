-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- vault_packets
create table public.vault_packets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('command','issue')),
  source text not null,
  title text not null,
  status text not null default 'Open',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index vault_packets_user_idx on public.vault_packets(user_id, created_at desc);
alter table public.vault_packets enable row level security;
create policy "own packets all" on public.vault_packets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- aos_links — each member can link their AOS account by email or code
create table public.aos_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  aos_email text,
  link_code text unique,
  verified_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.aos_links enable row level security;
create policy "own aos link all" on public.aos_links for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);