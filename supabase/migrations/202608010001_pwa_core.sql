create extension if not exists pgcrypto with schema extensions;

create function public.current_user_is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'app_role' = 'admin',
    false
  );
$$;

revoke all on function public.current_user_is_admin() from public, anon;
grant execute on function public.current_user_is_admin() to authenticated;

create table public.profiles (
  id uuid primary key,
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  account_status text not null default 'active'
    check (account_status in ('invited', 'active', 'suspended')),
  last_sign_in_at timestamptz
);

create table public.practice_records (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (length(trim(name)) > 0),
  billing_address jsonb not null default '{}'::jsonb,
  default_hourly_rate_pence bigint not null default 0
    check (default_hourly_rate_pence >= 0),
  payment_terms_days integer not null default 30
    check (payment_terms_days >= 0),
  archived boolean not null default false,
  unique (owner_id, id)
);

create table public.session_records (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  practice_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hourly_rate_pence bigint not null check (hourly_rate_pence >= 0),
  status text not null default 'planned'
    check (status in ('planned', 'completed', 'invoiced', 'cancelled')),
  notes text,
  unique (owner_id, id),
  constraint session_records_practice_owner_fk
    foreign key (owner_id, practice_id)
    references public.practice_records (owner_id, id),
  constraint session_records_positive_duration
    check (ends_at > starts_at)
);

create table public.invoice_records (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  invoice_number text,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'cancelled')),
  issue_date date,
  due_date date,
  total_pence bigint not null default 0 check (total_pence >= 0),
  practice_snapshot jsonb,
  payment_snapshot jsonb,
  issued_at timestamptz,
  artifact_path text,
  unique (owner_id, id),
  unique (owner_id, invoice_number),
  constraint invoice_records_date_order
    check (due_date is null or issue_date is null or due_date >= issue_date)
);

create table public.invoice_item_records (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  invoice_id uuid not null,
  session_id uuid,
  description text not null check (length(trim(description)) > 0),
  quantity numeric(12, 4) not null check (quantity > 0),
  unit_rate_pence bigint not null check (unit_rate_pence >= 0),
  line_total_pence bigint not null check (line_total_pence >= 0),
  unique (owner_id, id),
  constraint invoice_item_records_invoice_owner_fk
    foreign key (owner_id, invoice_id)
    references public.invoice_records (owner_id, id)
    on delete cascade,
  constraint invoice_item_records_session_owner_fk
    foreign key (owner_id, session_id)
    references public.session_records (owner_id, id)
);

create table public.encrypted_bank_settings (
  id uuid primary key,
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  ciphertext text not null,
  salt text not null,
  initialization_vector text not null,
  kdf_parameters jsonb not null,
  encryption_version integer not null default 1 check (encryption_version > 0)
);

create table public.sync_mutation_receipts (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  idempotency_key uuid not null,
  mutation_type text not null,
  applied_at timestamptz not null default now(),
  result jsonb not null default '{}'::jsonb,
  unique (owner_id, id),
  unique (owner_id, idempotency_key)
);

create table public.sync_health (
  id uuid primary key,
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_sync_at timestamptz,
  failed_sync_count integer not null default 0 check (failed_sync_count >= 0),
  application_error_count integer not null default 0
    check (application_error_count >= 0),
  last_error_at timestamptz
);

create index practice_records_owner_updated_idx
  on public.practice_records (owner_id, updated_at)
  where deleted_at is null;
create index session_records_owner_updated_idx
  on public.session_records (owner_id, updated_at)
  where deleted_at is null;
create index invoice_records_owner_updated_idx
  on public.invoice_records (owner_id, updated_at)
  where deleted_at is null;
create index invoice_item_records_owner_updated_idx
  on public.invoice_item_records (owner_id, updated_at)
  where deleted_at is null;
create index encrypted_bank_settings_owner_updated_idx
  on public.encrypted_bank_settings (owner_id, updated_at)
  where deleted_at is null;
create index sync_mutation_receipts_owner_updated_idx
  on public.sync_mutation_receipts (owner_id, updated_at)
  where deleted_at is null;
create index sync_health_owner_updated_idx
  on public.sync_health (owner_id, updated_at)
  where deleted_at is null;

alter table public.profiles enable row level security;
alter table public.practice_records enable row level security;
alter table public.session_records enable row level security;
alter table public.invoice_records enable row level security;
alter table public.invoice_item_records enable row level security;
alter table public.encrypted_bank_settings enable row level security;
alter table public.sync_mutation_receipts enable row level security;
alter table public.sync_health enable row level security;

create policy profiles_owner_all
  on public.profiles
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy profiles_admin_select
  on public.profiles
  for select
  to authenticated
  using ((select public.current_user_is_admin()));

create policy practice_records_owner_all
  on public.practice_records
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy session_records_owner_all
  on public.session_records
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy invoice_records_owner_all
  on public.invoice_records
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy invoice_item_records_owner_all
  on public.invoice_item_records
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy encrypted_bank_settings_owner_all
  on public.encrypted_bank_settings
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy sync_mutation_receipts_owner_all
  on public.sync_mutation_receipts
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy sync_health_owner_all
  on public.sync_health
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy sync_health_admin_select
  on public.sync_health
  for select
  to authenticated
  using ((select public.current_user_is_admin()));

create view public.admin_account_health
with (security_invoker = true)
as
select
  profile.owner_id as account_id,
  profile.account_status as status,
  profile.created_at,
  profile.last_sign_in_at,
  health.last_sync_at,
  coalesce(health.failed_sync_count, 0) as failed_sync_count,
  coalesce(health.application_error_count, 0) as application_error_count
from public.profiles as profile
left join public.sync_health as health
  on health.owner_id = profile.owner_id
  and health.deleted_at is null
where profile.deleted_at is null
  and (select public.current_user_is_admin());

revoke all on public.profiles from public, anon;
revoke all on public.practice_records from public, anon;
revoke all on public.session_records from public, anon;
revoke all on public.invoice_records from public, anon;
revoke all on public.invoice_item_records from public, anon;
revoke all on public.encrypted_bank_settings from public, anon;
revoke all on public.sync_mutation_receipts from public, anon;
revoke all on public.sync_health from public, anon;
revoke all on public.admin_account_health from public, anon;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.practice_records to authenticated;
grant select, insert, update, delete on public.session_records to authenticated;
grant select, insert, update, delete on public.invoice_records to authenticated;
grant select, insert, update, delete on public.invoice_item_records to authenticated;
grant select, insert, update, delete on public.encrypted_bank_settings to authenticated;
grant select, insert, update, delete on public.sync_mutation_receipts to authenticated;
grant select, insert, update, delete on public.sync_health to authenticated;
grant select on public.admin_account_health to authenticated;
