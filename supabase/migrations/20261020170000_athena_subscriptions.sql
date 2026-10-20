-- Athena standalone subscriptions (second access source for the Athena MCP).
-- Written by the Stripe webhook (service role) only. Members never read the table directly;
-- the MCP asks public.mcp_athena_roles() for the signed-in user's roles.
-- Circle members and owner grants keep getting everything through mcp_gate() (unchanged).

create table if not exists public.athena_subscriptions (
  stripe_subscription_id text primary key,
  stripe_customer_id text not null,
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  product_key text not null check (product_key in ('athena_pm', 'athena_office')),
  status text not null,
  trial_end timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- 7-day grace after Stripe's standard retries end on a failed payment.
  grace_until timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists athena_subscriptions_email_idx on public.athena_subscriptions (lower(email));
create index if not exists athena_subscriptions_user_idx on public.athena_subscriptions (user_id);

create table if not exists public.athena_tier_roles (
  product_key text not null,
  role text not null check (role in ('pm', 'contracts', 'estimating', 'ap')),
  primary key (product_key, role)
);
insert into public.athena_tier_roles (product_key, role) values
  ('athena_pm', 'pm'),
  ('athena_office', 'pm'), ('athena_office', 'contracts'),
  ('athena_office', 'estimating'), ('athena_office', 'ap')
on conflict do nothing;

alter table public.athena_subscriptions enable row level security;
alter table public.athena_tier_roles enable row level security;
revoke all on public.athena_subscriptions from anon, authenticated;
revoke all on public.athena_tier_roles from anon, authenticated;

-- Same rule as src/lib/mcp/entitlement.ts athenaRowGrantsAccess():
-- active / trialing / past_due (Stripe still retrying) grant access;
-- after retries end (unpaid, or canceled for non-payment) access runs until grace_until.
create or replace function public.mcp_athena_roles()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct r.role order by r.role), '{}')
  from public.athena_subscriptions s
  join public.athena_tier_roles r on r.product_key = s.product_key
  where (
      s.user_id = auth.uid()
      or (s.user_id is null and lower(s.email) = lower((select u.email from auth.users u where u.id = auth.uid())))
    )
    and (
      s.status in ('active', 'trialing', 'past_due')
      or (s.grace_until is not null and s.grace_until > now())
    );
$$;
revoke all on function public.mcp_athena_roles() from public, anon;
grant execute on function public.mcp_athena_roles() to authenticated;
