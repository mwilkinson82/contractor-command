alter table public.vault_packets drop constraint if exists vault_packets_kind_check;
alter table public.vault_packets
  add constraint vault_packets_kind_check
  check (kind in ('command','issue','intensive_lead','billing_question'));