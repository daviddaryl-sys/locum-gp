begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

select has_column('public', 'expense_records', 'expense_kind', 'Expenses store their kind');
select has_column('public', 'expense_records', 'journey_origin', 'Mileage stores its origin');
select has_column('public', 'expense_records', 'journey_destination', 'Mileage stores its destination');
select has_column('public', 'expense_records', 'distance_miles', 'Mileage stores distance');
select has_column('public', 'expense_records', 'mileage_rate_pence', 'Mileage stores its rate');
select has_column('public', 'expense_records', 'linked_session_id', 'Mileage can link to a session');
select col_not_null('public', 'expense_records', 'expense_kind', 'Expense kind is required');
select col_default_is(
  'public', 'expense_records', 'expense_kind', 'standard',
  'Legacy inserts default to standard expenses'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '81000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'mileage-owner-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '82000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'mileage-owner-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

insert into public.practice_records (id, owner_id, name) values
  (
    '81100000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'Fictional Owner A Practice'
  ),
  (
    '82100000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000002',
    'Fictional Owner B Practice'
  );

insert into public.session_records (
  id, owner_id, practice_id, starts_at, ends_at, hourly_rate_pence
) values
  (
    '81200000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '81100000-0000-4000-8000-000000000001',
    '2026-08-10 09:00:00+00', '2026-08-10 13:00:00+00', 9000
  ),
  (
    '82200000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000002',
    '82100000-0000-4000-8000-000000000002',
    '2026-08-11 09:00:00+00', '2026-08-11 13:00:00+00', 9000
  );

insert into public.session_records (
  id, owner_id, practice_id, starts_at, ends_at, hourly_rate_pence, deleted_at
) values (
  '81200000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000001',
  '81100000-0000-4000-8000-000000000001',
  '2026-08-09 09:00:00+00', '2026-08-09 13:00:00+00', 9000, now()
);

insert into public.expense_records (
  id, owner_id, expense_date, amount_pence, category_key, supplier_description
) values (
  '82300000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000002',
  date '2026-08-08', 2400, 'home_office', 'Fictional Owner B expense'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$ select count(*)
     from public.expense_records
     where id = '82300000-0000-4000-8000-000000000002' $$,
  $$ values (0::bigint) $$,
  'Owner A cannot read Owner B expenses'
);

select results_eq(
  $$ with changed as (
       update public.expense_records
       set amount_pence = 9999
       where id = '82300000-0000-4000-8000-000000000002'
       returning 1
     )
     select count(*) from changed $$,
  $$ values (0::bigint) $$,
  'Owner A cannot update Owner B expenses'
);

select lives_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key, supplier_description)
     values
       ('81300000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        date '2026-08-08', 1250, 'home_office', 'Fictional standard expense') $$,
  'Older clients can insert a standard expense without mileage fields'
);

select results_eq(
  $$ select expense_kind, amount_pence, category_key
     from public.expense_records
     where id = '81300000-0000-4000-8000-000000000001' $$,
  $$ values ('standard'::text, 1250::bigint, 'home_office'::text) $$,
  'Legacy expense values are preserved while kind defaults to standard'
);

select throws_ok(
  $$ update public.expense_records
     set journey_origin = 'Fictional origin'
     where id = '81300000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'Standard expenses reject mileage fields'
);

select throws_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key,
        supplier_description, expense_kind, journey_origin,
        distance_miles, mileage_rate_pence)
     values
       ('81400000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        date '2026-08-08', 1375, 'mileage_business_travel',
        'Incomplete fictional journey', 'mileage', 'Fictional origin', 25, 55) $$,
  '23514', null,
  'Mileage requires all journey fields'
);

select throws_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key,
        supplier_description, expense_kind, journey_origin, journey_destination,
        distance_miles, mileage_rate_pence)
     values
       ('81500000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        date '2026-08-08', 1375, 'mileage_business_travel',
        'Zero fictional journey', 'mileage', 'Fictional origin',
        'Fictional destination', 0, 55) $$,
  '23514', null,
  'Mileage distance must be positive'
);

select throws_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key,
        supplier_description, expense_kind, journey_origin, journey_destination,
        distance_miles, mileage_rate_pence)
     values
       ('81600000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        date '2026-08-08', 1375, 'mileage_business_travel',
        'Invalid rate journey', 'mileage', 'Fictional origin',
        'Fictional destination', 25, 0) $$,
  '23514', null,
  'Mileage rate must be positive'
);

select lives_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key,
        supplier_description, expense_kind, journey_origin, journey_destination,
        distance_miles, mileage_rate_pence, linked_session_id)
     values
       ('81700000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        date '2026-08-08', 1375, 'mileage_business_travel',
        'Unlinked fictional journey', 'mileage', 'Fictional origin',
        'Fictional destination', 25, 55, null) $$,
  'Mileage can omit its session link'
);

select lives_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key,
        supplier_description, expense_kind, journey_origin, journey_destination,
        distance_miles, mileage_rate_pence, linked_session_id)
     values
       ('81800000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        date '2026-08-08', 1375, 'mileage_business_travel',
        'Owned fictional journey', 'mileage', 'Fictional origin',
        'Fictional destination', 25, 55,
        '81200000-0000-4000-8000-000000000001') $$,
  'Mileage can link to an owned session'
);

select lives_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key,
        supplier_description, expense_kind, journey_origin, journey_destination,
        distance_miles, mileage_rate_pence, linked_session_id)
     values
       ('81a00000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        date '2026-08-08', 1375, 'mileage_business_travel',
        'Historical fictional journey', 'mileage', 'Fictional origin',
        'Fictional destination', 25, 55,
        '81200000-0000-4000-8000-000000000002') $$,
  'Mileage can retain a same-owner soft-deleted historical session link'
);

select throws_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key,
        supplier_description, expense_kind, journey_origin, journey_destination,
        distance_miles, mileage_rate_pence, linked_session_id)
     values
       ('81900000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        date '2026-08-08', 1375, 'mileage_business_travel',
        'Cross-owner fictional journey', 'mileage', 'Fictional origin',
        'Fictional destination', 25, 55,
        '82200000-0000-4000-8000-000000000002') $$,
  '23503', null,
  'Mileage cannot link to another owner session'
);

select results_eq(
  $$ select count(*) from pg_class
     where oid = 'public.expense_records'::regclass and relrowsecurity $$,
  $$ values (1::bigint) $$,
  'Existing expense owner RLS remains enabled'
);

select is(
  has_table_privilege('anon', 'public.expense_records', 'SELECT'),
  false,
  'Anonymous SELECT access to expenses remains revoked'
);

select is(
  has_table_privilege('anon', 'public.expense_records', 'INSERT'),
  false,
  'Anonymous INSERT access to expenses remains revoked'
);

select is(
  has_table_privilege('anon', 'public.expense_records', 'UPDATE'),
  false,
  'Anonymous UPDATE access to expenses remains revoked'
);

select is(
  has_table_privilege('anon', 'public.expense_records', 'DELETE'),
  false,
  'Anonymous DELETE access to expenses remains revoked'
);

select * from finish();
rollback;
