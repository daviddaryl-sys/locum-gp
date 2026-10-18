begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select has_column('public', 'expense_records', 'mtd_category', 'Expenses store an HMRC category');
select has_column('public', 'expense_records', 'allowable_percentage', 'Expenses store an allowable percentage');
select col_not_null('public', 'expense_records', 'mtd_category', 'MTD category is required');
select col_not_null('public', 'expense_records', 'allowable_percentage', 'Allowable percentage is required');
select has_column('public', 'invoice_records', 'paid_at', 'Invoices store the payment-received date');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '30000000-0000-4000-8000-000000000003',
  'authenticated', 'authenticated', 'mtd-gp@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select lives_ok(
  $$ insert into public.expense_records
       (id, owner_id, expense_date, amount_pence, category_key, supplier_description)
     values
       ('c1000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000003',
        date '2026-04-06', 1250, 'home_office', 'Fictional office') $$,
  'Safe MTD defaults support older offline inserts'
);

select throws_ok(
  $$ update public.expense_records set mtd_category = 'made_up'
     where id = 'c1000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'Unsupported HMRC categories are rejected'
);

select throws_ok(
  $$ update public.expense_records set allowable_percentage = 101
     where id = 'c1000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'Allowable percentage stays between zero and 100'
);

insert into public.invoice_records (
  id, owner_id, invoice_number, status, issue_date, due_date, total_pence
) values (
  'c2000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  'MTD-2026-0001', 'paid', date '2026-04-06', date '2026-05-06', 48000
);

select lives_ok(
  $$ update public.invoice_records set paid_at = date '2026-05-01'
     where id = 'c2000000-0000-4000-8000-000000000002' $$,
  'Paid invoices can store the date payment was received'
);

select throws_ok(
  $$ update public.invoice_records set status = 'sent'
     where id = 'c2000000-0000-4000-8000-000000000002' $$,
  '23514', null,
  'A non-paid invoice cannot retain a payment-received date'
);

select results_eq(
  $$ select count(*) from pg_class
     where oid in ('public.invoice_records'::regclass, 'public.expense_records'::regclass)
       and relrowsecurity $$,
  $$ values (2::bigint) $$,
  'Existing owner RLS remains enabled on MTD bookkeeping tables'
);

select * from finish();
rollback;
