alter table public.practice_records
  add column is_demo boolean not null default false;
alter table public.session_records
  add column is_demo boolean not null default false;
alter table public.invoice_records
  add column is_demo boolean not null default false;
alter table public.invoice_item_records
  add column is_demo boolean not null default false;

create table public.expense_category_records (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (length(trim(name)) > 0 and length(trim(name)) <= 80),
  archived_at timestamptz,
  is_demo boolean not null default false,
  unique (owner_id, id)
);

create unique index expense_category_active_name_uidx
  on public.expense_category_records (owner_id, lower(trim(name)))
  where deleted_at is null and archived_at is null;

create table public.expense_records (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  expense_date date not null,
  amount_pence bigint not null check (amount_pence > 0),
  category_key text check (category_key is null or category_key in (
    'mileage_business_travel', 'public_transport_taxi',
    'parking_tolls_congestion', 'qualifying_accommodation',
    'qualifying_subsistence', 'practice_medical_supplies',
    'practice_printing_phone_postage', 'agency_booking_fees',
    'other_practice_specific', 'professional_indemnity',
    'professional_memberships', 'accountancy_legal_bank_fees',
    'professional_training', 'computer_software_phone_internet',
    'doctors_bag_equipment', 'uniform_protective_clothing',
    'home_office', 'other_general'
  )),
  custom_category_id uuid,
  practice_id uuid,
  supplier_description text not null
    check (length(trim(supplier_description)) > 0 and length(trim(supplier_description)) <= 160),
  notes text check (notes is null or length(notes) <= 2000),
  reimbursed_by_practice boolean not null default false,
  needs_accountant_review boolean not null default false,
  receipt_object_key text,
  receipt_original_name text,
  receipt_mime_type text check (receipt_mime_type is null or receipt_mime_type in (
    'image/jpeg', 'image/png', 'image/heic', 'application/pdf'
  )),
  receipt_size_bytes bigint check (
    receipt_size_bytes is null or receipt_size_bytes between 1 and 10485760
  ),
  receipt_sync_status text not null default 'none'
    check (receipt_sync_status in ('none', 'pending', 'uploaded', 'failed', 'delete-pending')),
  is_demo boolean not null default false,
  unique (owner_id, id),
  constraint expense_exactly_one_category check (
    (category_key is not null)::integer + (custom_category_id is not null)::integer = 1
  ),
  constraint expense_category_owner_fk foreign key (owner_id, custom_category_id)
    references public.expense_category_records(owner_id, id),
  constraint expense_practice_owner_fk foreign key (owner_id, practice_id)
    references public.practice_records(owner_id, id),
  constraint expense_receipt_metadata_consistent check (
    (
      receipt_object_key is null
      and receipt_original_name is null
      and receipt_mime_type is null
      and receipt_size_bytes is null
      and receipt_sync_status = 'none'
    )
    or
    (
      receipt_object_key is not null
      and receipt_original_name is not null
      and receipt_mime_type is not null
      and receipt_size_bytes is not null
      and receipt_sync_status <> 'none'
    )
  )
);

create table public.demo_seed_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  seed_version integer not null check (seed_version > 0),
  seeded_at timestamptz not null default now(),
  demo_deleted_at timestamptz
);

create index expense_category_owner_updated_idx
  on public.expense_category_records(owner_id, updated_at)
  where deleted_at is null;
create index expense_owner_date_idx
  on public.expense_records(owner_id, expense_date desc)
  where deleted_at is null;

alter table public.expense_category_records enable row level security;
alter table public.expense_records enable row level security;
alter table public.demo_seed_state enable row level security;

create policy expense_category_owner_all
  on public.expense_category_records
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy expense_owner_all
  on public.expense_records
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy demo_seed_owner_all
  on public.demo_seed_state
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.expense_category_records from public, anon;
revoke all on public.expense_records from public, anon;
revoke all on public.demo_seed_state from public, anon;
grant select, insert, update, delete on public.expense_category_records to authenticated;
grant select, insert, update, delete on public.expense_records to authenticated;
grant select, insert, update, delete on public.demo_seed_state to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts', 'expense-receipts', false, 10485760,
  array['image/jpeg', 'image/png', 'image/heic', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.current_user_can_access_expense_receipt(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select split_part(object_name, '/', 1) = (select auth.uid())::text;
$$;

revoke all on function public.current_user_can_access_expense_receipt(text) from public, anon;
grant execute on function public.current_user_can_access_expense_receipt(text) to authenticated;

create policy expense_receipt_owner_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'expense-receipts'
    and public.current_user_can_access_expense_receipt(name)
  );
create policy expense_receipt_owner_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'expense-receipts'
    and public.current_user_can_access_expense_receipt(name)
  );
create policy expense_receipt_owner_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'expense-receipts'
    and public.current_user_can_access_expense_receipt(name)
  )
  with check (
    bucket_id = 'expense-receipts'
    and public.current_user_can_access_expense_receipt(name)
  );
create policy expense_receipt_owner_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'expense-receipts'
    and public.current_user_can_access_expense_receipt(name)
  );
