begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'expense-gp-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'expense-gp-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

insert into public.practice_records (id, owner_id, name)
values
  (
    'b1000000-0000-4000-8000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Fictional GP A Practice'
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'Fictional GP B Practice'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$ insert into public.expense_category_records
       (id, owner_id, name)
     values
       ('a1000000-0000-4000-8000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        'Locum bag') $$,
  'GP A can create an owned custom category'
);

select lives_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key,
        supplier_description)
     values
       ('a2000000-0000-4000-8000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        date '2026-04-06', 1250, 'parking_tolls_congestion',
        'Fictional parking') $$,
  'GP A can create an owned expense'
);

select results_eq(
  $$ select count(*) from public.expense_records
     where owner_id = '20000000-0000-0000-0000-000000000002' $$,
  $$ values (0::bigint) $$,
  'GP A cannot read GP B expenses'
);

select throws_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key,
        practice_id, supplier_description)
     values
       ('a3000000-0000-4000-8000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        date '2026-04-07', 2000, 'mileage_business_travel',
        'b1000000-0000-4000-8000-000000000002',
        'Cross-owner practice') $$,
  '23503', null,
  'An expense cannot link to another owner practice'
);

select throws_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key,
        custom_category_id, supplier_description)
     values
       ('a4000000-0000-4000-8000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        date '2026-04-08', 3000, 'home_office',
        'a1000000-0000-4000-8000-000000000001',
        'Two categories') $$,
  '23514', null,
  'Exactly one category source is required'
);

select results_eq(
  $$ select public.current_user_can_access_expense_receipt(
       '10000000-0000-0000-0000-000000000001/a2000000-0000-4000-8000-000000000001/file.pdf'
     ) $$,
  $$ values (true) $$,
  'An owner can access their receipt prefix'
);

select results_eq(
  $$ select public.current_user_can_access_expense_receipt(
       '20000000-0000-0000-0000-000000000002/a2000000-0000-4000-8000-000000000001/file.pdf'
     ) $$,
  $$ values (false) $$,
  'An owner cannot access another receipt prefix'
);

select throws_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key, supplier_description)
     values
       ('a5000000-0000-4000-8000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        date '2026-05-01', 0, 'home_office', 'Invalid amount') $$,
  '23514', null,
  'Expense amounts must be positive'
);

select throws_ok(
  $$ update public.expense_records
     set receipt_sync_status = 'unknown'
     where id = 'a2000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'Receipt status is constrained'
);

select throws_ok(
  $$ insert into public.expense_category_records
       (id, owner_id, name)
     values
       ('a6000000-0000-4000-8000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        '  LOCUM BAG  ') $$,
  '23505', null,
  'Active category names are unique after trim and case folding'
);

select results_eq(
  $$ select count(*)
     from pg_class
     where oid in (
       'public.expense_category_records'::regclass,
       'public.expense_records'::regclass,
       'public.demo_seed_state'::regclass
     ) and not relrowsecurity $$,
  $$ values (0::bigint) $$,
  'Every new account-owned table has row-level security enabled'
);

select results_eq(
  $$ select
       (select count(*) from information_schema.role_table_grants
        where grantee = 'anon'
          and table_schema = 'public'
          and table_name in ('expense_category_records', 'expense_records', 'demo_seed_state'))
       +
       (select count(*) from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and (roles::text like '%anon%' or roles::text like '%public%')
          and (qual like '%expense-receipts%' or with_check like '%expense-receipts%')) $$,
  $$ values (0::bigint) $$,
  'Anonymous roles have no table grant or receipt-bucket policy'
);

select * from finish();
rollback;
