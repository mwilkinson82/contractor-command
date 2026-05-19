
alter table public.subscriptions
  add column if not exists welcome_sent_at timestamptz,
  add column if not exists login_nudge_sent_at timestamptz,
  add column if not exists discord_nudge_sent_at timestamptz;

create table if not exists public.discord_members (
  email text primary key,
  discord_user_id text not null,
  discord_username text,
  joined_guild_at timestamptz not null default now()
);

alter table public.discord_members enable row level security;

create policy "admin reads discord members"
  on public.discord_members
  for select
  using (public.has_role(auth.uid(), 'admin'::public.app_role));
