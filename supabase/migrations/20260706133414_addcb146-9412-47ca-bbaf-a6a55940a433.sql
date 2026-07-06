alter table public.ask_threads
  add column if not exists source text not null default 'unknown';

create index if not exists ask_threads_source_created_idx
  on public.ask_threads(source, created_at desc);