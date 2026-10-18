begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'gp-a@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'gp-b@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '30000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'admin@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"],"app_role":"admin"}',
    '{}',
    now(),
    now()
  );

insert into public.profiles (
  id,
  owner_id,
  account_status,
  last_sign_in_at
)
values
  (
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'active',
    now()
  ),
  (
    '22000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'active',
    now()
  ),
  (
    '33000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000003',
    'active',
    now()
  );

insert into public.sync_health (
  id,
  owner_id,
  last_sync_at,
  failed_sync_count,
  application_error_count
)
values
  (
    '12000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    now(),
    0,
    0
  ),
  (
    '23000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    now(),
    1,
    2
  ),
  (
    '34000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000003',
    now(),
    0,
    0
  );

insert into public.practice_records (id, owner_id, name)
values (
  '24000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000002',
  'GP B Practice'
);

insert into public.invoice_records (
  id,
  owner_id,
  status,
  total_pence
)
values (
  '25000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000002',
  'draft',
  12500
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into public.practice_records (id, owner_id, name)
    values (
      '14000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'GP A Practice'
    )
  $$,
  'GP A can create an owned practice'
);

select results_eq(
  $$
    select name
    from public.practice_records
    where id = '14000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('GP A Practice'::text) $$,
  'GP A can read an owned practice'
);

select lives_ok(
  $$
    update public.practice_records
    set name = 'GP A Practice Updated'
    where id = '14000000-0000-0000-0000-000000000001'
  $$,
  'GP A can update an owned practice'
);

select lives_ok(
  $$
    delete from public.practice_records
    where id = '14000000-0000-0000-0000-000000000001'
  $$,
  'GP A can delete an owned practice'
);

select results_eq(
  $$
    select count(*)
    from public.practice_records
    where owner_id = '20000000-0000-0000-0000-000000000002'
  $$,
  $$ values (0::bigint) $$,
  'GP A cannot read GP B practices'
);

select results_eq(
  $$
    update public.practice_records
    set name = 'Unauthorised change'
    where owner_id = '20000000-0000-0000-0000-000000000002'
    returning id
  $$,
  $$ select null::uuid where false $$,
  'GP A cannot mutate GP B practices'
);

select results_eq(
  $$ select count(*) from public.admin_account_health $$,
  $$ values (0::bigint) $$,
  'A GP cannot read the administrator account-health projection'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"app_role":"admin"}}',
  true
);

select results_eq(
  $$ select count(*) from public.admin_account_health $$,
  $$ values (3::bigint) $$,
  'An administrator can read account-health metadata'
);

select columns_are(
  'public',
  'admin_account_health',
  array[
    'account_id',
    'status',
    'created_at',
    'last_sign_in_at',
    'last_sync_at',
    'failed_sync_count',
    'application_error_count'
  ],
  'The administrator projection exposes only approved operational fields'
);

select results_eq(
  $$ select count(*) from public.practice_records $$,
  $$ values (0::bigint) $$,
  'An administrator cannot read GP practice records'
);

select results_eq(
  $$ select count(*) from public.invoice_records $$,
  $$ values (0::bigint) $$,
  'An administrator cannot read GP invoice records or totals'
);

reset role;

select results_eq(
  $$
    select count(*)
    from pg_class
    where oid in (
      'public.profiles'::regclass,
      'public.practice_records'::regclass,
      'public.session_records'::regclass,
      'public.invoice_records'::regclass,
      'public.invoice_item_records'::regclass,
      'public.encrypted_bank_settings'::regclass,
      'public.sync_mutation_receipts'::regclass,
      'public.sync_health'::regclass
    )
      and not relrowsecurity
  $$,
  $$ values (0::bigint) $$,
  'Every account-owned table has row-level security enabled'
);

select results_eq(
  $$
    select name
    from public.practice_records
    where id = '24000000-0000-0000-0000-000000000002'
  $$,
  $$ values ('GP B Practice'::text) $$,
  'The blocked GP A update left GP B data unchanged'
);

select * from finish();

rollback;
