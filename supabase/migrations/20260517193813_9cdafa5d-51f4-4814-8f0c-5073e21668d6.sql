-- Companies: one per user for v1 (owner_user_id is UNIQUE).
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique,
  name text not null default '',
  address text,
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.companies enable row level security;

create policy "owner can read own company"
  on public.companies for select
  using (auth.uid() = owner_user_id);

create policy "owner can insert own company"
  on public.companies for insert
  with check (auth.uid() = owner_user_id);

create policy "owner can update own company"
  on public.companies for update
  using (auth.uid() = owner_user_id);

create policy "owner can delete own company"
  on public.companies for delete
  using (auth.uid() = owner_user_id);

-- Touch updated_at automatically.
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_updated_at
  before update on public.companies
  for each row execute function public.update_updated_at_column();

-- Link AOS workspace selection + future per-company stamping.
alter table public.aos_links add column if not exists company_id uuid;
alter table public.aos_links add column if not exists aos_company_id text;

alter table public.vault_packets add column if not exists company_id uuid;
create index if not exists vault_packets_company_id_idx
  on public.vault_packets(company_id);

-- Public storage bucket for company logos.
insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

-- Public read.
create policy "company logos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'company-logos');

-- Owner-only write under {user_id}/...
create policy "owner can upload own company logo"
  on storage.objects for insert
  with check (
    bucket_id = 'company-logos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "owner can update own company logo"
  on storage.objects for update
  using (
    bucket_id = 'company-logos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "owner can delete own company logo"
  on storage.objects for delete
  using (
    bucket_id = 'company-logos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );