begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'cleanup-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '32000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'cleanup-b@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'cleanup-c@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.practice_records (id, owner_id, name, is_demo) values
  ('31100000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'Demo referenced practice', true),
  ('31100000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', 'Demo unreferenced practice', true),
  ('31100000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000001', 'Real practice', false),
  ('32100000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000002', 'Other owner demo practice', true),
  ('33100000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000003', 'Partial seed demo practice', true);

insert into public.expense_category_records (id, owner_id, name, is_demo) values
  ('31200000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'Demo referenced category', true),
  ('31200000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', 'Demo unreferenced category', true),
  ('32200000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000002', 'Other owner demo category', true);

insert into public.session_records (id, owner_id, practice_id, starts_at, ends_at, hourly_rate_pence, status, is_demo) values
  ('31300000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '31100000-0000-4000-8000-000000000001', '2026-07-01 09:00+00', '2026-07-01 13:00+00', 6000, 'completed', false),
  ('31300000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', '31100000-0000-4000-8000-000000000002', '2026-07-02 09:00+00', '2026-07-02 13:00+00', 6000, 'completed', true),
  ('32300000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000002', '32100000-0000-4000-8000-000000000001', '2026-07-03 09:00+00', '2026-07-03 13:00+00', 6000, 'completed', true);

insert into public.invoice_records (id, owner_id, practice_id, invoice_number, status, issue_date, due_date, total_pence, is_demo) values
  ('31400000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '31100000-0000-4000-8000-000000000001', 'REAL-A-1', 'draft', '2026-07-01', '2026-07-31', 24000, false),
  ('31400000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', '31100000-0000-4000-8000-000000000002', 'DEMO-A-1', 'draft', '2026-07-02', '2026-08-01', 24000, true),
  ('32400000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000002', '32100000-0000-4000-8000-000000000001', 'DEMO-B-1', 'draft', '2026-07-03', '2026-08-02', 24000, true);

insert into public.invoice_item_records (id, owner_id, invoice_id, description, quantity, unit_rate_pence, line_total_pence, is_demo) values
  ('31500000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '31400000-0000-4000-8000-000000000002', 'Demo item', 4, 6000, 24000, true),
  ('32500000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000002', '32400000-0000-4000-8000-000000000001', 'Other demo item', 4, 6000, 24000, true);

insert into public.expense_records (id, owner_id, expense_date, amount_pence, category_key, custom_category_id, practice_id, supplier_description, is_demo, receipt_object_key, receipt_original_name, receipt_mime_type, receipt_size_bytes, receipt_sync_status) values
  ('31600000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '2026-07-01', 1000, null, '31200000-0000-4000-8000-000000000001', '31100000-0000-4000-8000-000000000001', 'Real expense', false, null, null, null, null, 'none'),
  ('31600000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', '2026-07-02', 1100, 'home_office', null, '31100000-0000-4000-8000-000000000002', 'Demo expense', true, '31000000-0000-4000-8000-000000000001/31600000-0000-4000-8000-000000000002/demo.pdf', 'demo.pdf', 'application/pdf', 100, 'uploaded'),
  ('32600000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000002', '2026-07-03', 1200, 'home_office', null, '32100000-0000-4000-8000-000000000001', 'Other demo expense', true, null, null, null, null, 'none');

insert into public.demo_seed_state (owner_id, seed_version) values
  ('31000000-0000-4000-8000-000000000001', 1),
  ('32000000-0000-4000-8000-000000000002', 1);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$ select object_key from public.delete_owned_demo_data() $$,
  $$ values ('31000000-0000-4000-8000-000000000001/31600000-0000-4000-8000-000000000002/demo.pdf'::text) $$,
  'cleanup returns only the current owner receipt key'
);

reset role;

select results_eq($$ select count(*) from public.expense_records where owner_id = '31000000-0000-4000-8000-000000000001' and is_demo and deleted_at is null $$, $$ values (0::bigint) $$, 'GP A demo expenses are tombstoned');
select results_eq($$ select (select count(*) from public.session_records where owner_id = '31000000-0000-4000-8000-000000000001' and is_demo and deleted_at is null) + (select count(*) from public.invoice_records where owner_id = '31000000-0000-4000-8000-000000000001' and is_demo and deleted_at is null) + (select count(*) from public.invoice_item_records where owner_id = '31000000-0000-4000-8000-000000000001' and is_demo and deleted_at is null) $$, $$ values (0::bigint) $$, 'GP A demo sessions, invoices, and items are tombstoned');
select results_eq($$ select (select count(*) from public.practice_records where owner_id = '32000000-0000-4000-8000-000000000002' and is_demo and deleted_at is null) + (select count(*) from public.expense_records where owner_id = '32000000-0000-4000-8000-000000000002' and is_demo and deleted_at is null) + (select count(*) from public.invoice_records where owner_id = '32000000-0000-4000-8000-000000000002' and is_demo and deleted_at is null) $$, $$ values (3::bigint) $$, 'GP B demo rows remain active');
select results_eq($$ select count(*) from public.session_records where id = '31300000-0000-4000-8000-000000000001' and not is_demo and deleted_at is null $$, $$ values (1::bigint) $$, 'GP A real session is preserved');
select results_eq($$ select count(*) from public.invoice_records where id = '31400000-0000-4000-8000-000000000001' and not is_demo and deleted_at is null $$, $$ values (1::bigint) $$, 'GP A real invoice is preserved');
select results_eq($$ select count(*) from public.expense_records where id = '31600000-0000-4000-8000-000000000001' and not is_demo and deleted_at is null $$, $$ values (1::bigint) $$, 'GP A real expense is preserved');
select results_eq($$ select count(*) from public.practice_records where id = '31100000-0000-4000-8000-000000000001' and not is_demo and deleted_at is null $$, $$ values (1::bigint) $$, 'referenced demo practice is promoted');
select results_eq($$ select count(*) from public.expense_category_records where id = '31200000-0000-4000-8000-000000000001' and not is_demo and deleted_at is null $$, $$ values (1::bigint) $$, 'referenced demo category is promoted');
select results_eq($$ select (select count(*) from public.practice_records where id = '31100000-0000-4000-8000-000000000002' and deleted_at is not null) + (select count(*) from public.expense_category_records where id = '31200000-0000-4000-8000-000000000002' and deleted_at is not null) $$, $$ values (2::bigint) $$, 'unreferenced demo practice and category are tombstoned');
select results_eq($$ select count(*) from public.demo_seed_state where owner_id = '31000000-0000-4000-8000-000000000001' and demo_deleted_at is not null $$, $$ values (1::bigint) $$, 'cleanup records demo deletion state');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select results_eq($$ select count(*) from public.delete_owned_demo_data() $$, $$ values (1::bigint) $$, 'cleanup is safe to repeat and returns orphan receipt keys for retry');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select results_eq($$ select count(*) from public.delete_owned_demo_data() $$, $$ values (0::bigint) $$, 'partial demo fixtures without seed state can be cleaned up');
reset role;

select results_eq(
  $$ select count(*) from public.demo_seed_state where owner_id = '33000000-0000-4000-8000-000000000003' and demo_deleted_at is not null $$,
  $$ values (1::bigint) $$,
  'cleanup records a permanent deletion state after a partial seed failure'
);

select * from finish();
rollback;
