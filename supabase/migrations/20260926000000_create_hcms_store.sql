create table if not exists public.hcms_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.hcms_store enable row level security;

drop policy if exists hcms_store_public_read on public.hcms_store;
drop policy if exists hcms_store_public_write on public.hcms_store;

create policy hcms_store_public_read
  on public.hcms_store for select
  to anon, authenticated
  using (true);

create policy hcms_store_public_write
  on public.hcms_store for all
  to anon, authenticated
  using (true)
  with check (true);