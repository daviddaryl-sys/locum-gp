begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'invoice-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'invoice-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

insert into public.practice_records (
  id, owner_id, name, billing_address, default_hourly_rate_pence,
  payment_terms_days
)
values
  (
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Riverside Medical Centre',
    '{"formatted":"1 Riverside Road, London"}',
    6500,
    30
  ),
  (
    '21000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'Northside Medical Centre',
    '{"formatted":"2 Northside Road, London"}',
    7000,
    14
  );

insert into public.session_records (
  id, owner_id, practice_id, starts_at, ends_at, hourly_rate_pence, status,
  notes
)
values
  (
    '12000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    '2026-08-12T08:00:00Z', '2026-08-12T12:00:00Z', 6500, 'completed', ''
  ),
  (
    '13000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    '2026-08-13T08:00:00Z', '2026-08-13T12:00:00Z', 6500, 'planned', ''
  ),
  (
    '14000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    '2026-08-14T08:00:00Z', '2026-08-14T12:00:00Z', 6500, 'completed', ''
  ),
  (
    '22000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '21000000-0000-0000-0000-000000000002',
    '2026-08-12T08:00:00Z', '2026-08-12T12:00:00Z', 7000, 'completed', ''
  );

insert into public.invoice_records (id, owner_id)
values
  ('15000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('16000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('17000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('26000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002');

select has_table('public', 'invoice_sequences', 'Invoice sequences are stored per owner and year');
select has_function(
  'public',
  'issue_invoice',
  array['uuid', 'uuid', 'date', 'jsonb', 'jsonb', 'text'],
  'Atomic invoice issuance is exposed as one authenticated function'
);
select col_is_pk(
  'public',
  'invoice_sequences',
  array['owner_id', 'invoice_year'],
  'Only one sequence row can exist for each owner and year'
);
select ok(
  position(
    'for update' in lower(
      pg_get_functiondef(
        'public.issue_invoice(uuid,uuid,date,jsonb,jsonb,text)'::regprocedure
      )
    )
  ) > 0,
  'Issuance locks the owner sequence row before allocating a number'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_like(
  $$
    select public.issue_invoice(
      '15000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001',
      '2026-08-12',
      '{"version":2,"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA=","salt":"AAAAAAAAAAAAAAAAAAAAAA==","initializationVector":"AAAAAAAAAAAAAAAA","kdfParameters":{"name":"HKDF","hash":"SHA-256","info":"locum-manager-payment:v2"}}',
      '[{"sessionId":"13000000-0000-0000-0000-000000000001","description":"GP locum session","quantity":4,"unitRatePence":6500}]',
      'INV'
    )
  $$,
  '%completed%uninvoiced%',
  'A planned or unavailable session aborts issuance'
);
select is(
  (select issued_at from public.invoice_records where id = '15000000-0000-0000-0000-000000000001'),
  null,
  'Failed issuance leaves the recoverable draft unissued'
);

select is(
  (
    select invoice_number
    from public.issue_invoice(
      '16000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001',
      '2026-08-12',
      '{"version":2,"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA=","salt":"AAAAAAAAAAAAAAAAAAAAAA==","initializationVector":"AAAAAAAAAAAAAAAA","kdfParameters":{"name":"HKDF","hash":"SHA-256","info":"locum-manager-payment:v2"}}',
      '[{"sessionId":"12000000-0000-0000-0000-000000000001","description":"GP locum session","quantity":4,"unitRatePence":6500}]',
      'INV'
    )
  ),
  'INV-2026-0001',
  'The first owner invoice receives sequence one'
);
select is(
  (select practice_snapshot ->> 'name' from public.invoice_records where id = '16000000-0000-0000-0000-000000000001'),
  'Riverside Medical Centre',
  'Issuance snapshots the owned practice identity'
);
select ok(
  (
    select payment_snapshot ->> 'ciphertext' = 'AAAAAAAAAAAAAAAAAAAAAAA='
      and not payment_snapshot ? 'accountNumber'
    from public.invoice_records
    where id = '16000000-0000-0000-0000-000000000001'
  ),
  'Issuance snapshots only the encrypted payment envelope'
);
select is(
  (select total_pence from public.invoice_records where id = '16000000-0000-0000-0000-000000000001'),
  26000::bigint,
  'The server calculates the invoice total in integer pence'
);
select is(
  (select session_id from public.invoice_item_records where invoice_id = '16000000-0000-0000-0000-000000000001'),
  '12000000-0000-0000-0000-000000000001'::uuid,
  'The issued line item links its selected session'
);
select is(
  (select status from public.session_records where id = '12000000-0000-0000-0000-000000000001'),
  'invoiced',
  'A linked session becomes immutable as invoiced'
);

select is(
  (
    select invoice_number
    from public.issue_invoice(
      '17000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001',
      '2026-08-12',
      '{"version":2,"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA=","salt":"AAAAAAAAAAAAAAAAAAAAAA==","initializationVector":"AAAAAAAAAAAAAAAA","kdfParameters":{"name":"HKDF","hash":"SHA-256","info":"locum-manager-payment:v2"}}',
      '[{"sessionId":"14000000-0000-0000-0000-000000000001","description":"GP locum session","quantity":4,"unitRatePence":6500}]',
      'INV'
    )
  ),
  'INV-2026-0002',
  'The same owner receives the next serialized number'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (
    select invoice_number
    from public.issue_invoice(
      '26000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000002',
      '2026-08-12',
      '{"version":2,"ciphertext":"AQEBAQEBAQEBAQEBAQEBAQEB","salt":"AQEBAQEBAQEBAQEBAQEBAQ==","initializationVector":"AQEBAQEBAQEBAQEB","kdfParameters":{"name":"HKDF","hash":"SHA-256","info":"locum-manager-payment:v2"}}',
      '[{"sessionId":"22000000-0000-0000-0000-000000000002","description":"GP locum session","quantity":4,"unitRatePence":7000}]',
      'INV'
    )
  ),
  'INV-2026-0001',
  'A different owner has an independent sequence'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_like(
  $$ update public.invoice_records set total_pence = 1 where id = '16000000-0000-0000-0000-000000000001' $$,
  '%issued invoice%immutable%',
  'Issued financial content cannot be changed'
);
select lives_ok(
  $$ update public.invoice_records set status = 'sent' where id = '16000000-0000-0000-0000-000000000001' $$,
  'An issued invoice can move to sent status explicitly'
);
select lives_ok(
  $$
    update public.invoice_records
    set artifact_path = '10000000-0000-0000-0000-000000000001/16000000-0000-0000-0000-000000000001/issued.pdf'
    where id = '16000000-0000-0000-0000-000000000001'
  $$,
  'An owner can link an artifact once after issuing an invoice'
);
select is(
  (
    select artifact_path
    from public.invoice_records
    where id = '16000000-0000-0000-0000-000000000001'
  ),
  '10000000-0000-0000-0000-000000000001/16000000-0000-0000-0000-000000000001/issued.pdf',
  'The first artifact link is retained on the issued invoice'
);
select throws_like(
  $$
    update public.invoice_records
    set artifact_path = '10000000-0000-0000-0000-000000000001/16000000-0000-0000-0000-000000000001/relinked.pdf'
    where id = '16000000-0000-0000-0000-000000000001'
  $$,
  '%issued invoice artifact is immutable%',
  'An issued invoice artifact cannot be relinked'
);
select throws_like(
  $$
    update public.invoice_records
    set artifact_path = null
    where id = '16000000-0000-0000-0000-000000000001'
  $$,
  '%issued invoice artifact is immutable%',
  'An issued invoice artifact cannot be cleared'
);
select throws_like(
  $$ update public.invoice_item_records set line_total_pence = 1 where invoice_id = '16000000-0000-0000-0000-000000000001' $$,
  '%issued invoice%immutable%',
  'Issued line items cannot be changed'
);
select throws_like(
  $$
    select public.issue_invoice(
      '26000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000002',
      '2026-08-12', '{}', '[]', 'INV'
    )
  $$,
  '%owned draft%',
  'An owner cannot issue another account draft'
);

reset role;

select is(
  (select public from storage.buckets where id = 'invoice-artifacts'),
  false,
  'Issued invoice artifacts use a private bucket'
);
select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, metadata)
    values (
      'invoice-artifacts',
      '20000000-0000-0000-0000-000000000002/26000000-0000-0000-0000-000000000002/owner-b.pdf',
      '{"origin":"owner-b"}'::jsonb
    )
  $$,
  'A fictional owner B artifact exists for isolation coverage'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$
    select count(*)
    from storage.objects
    where bucket_id = 'invoice-artifacts'
      and name = '20000000-0000-0000-0000-000000000002/26000000-0000-0000-0000-000000000002/owner-b.pdf'
  $$,
  $$ values (0::bigint) $$,
  'Owner A cannot see owner B private invoice artifacts'
);
select throws_like(
  $$
    insert into storage.objects (bucket_id, name, metadata)
    values (
      'invoice-artifacts',
      '20000000-0000-0000-0000-000000000002/26000000-0000-0000-0000-000000000002/owner-a-write.pdf',
      '{"origin":"owner-a"}'::jsonb
    )
  $$,
  '%row-level security%',
  'Owner A cannot insert an invoice artifact into owner B namespace'
);
select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, metadata)
    values (
      'invoice-artifacts',
      '10000000-0000-0000-0000-000000000001/16000000-0000-0000-0000-000000000001/issued.pdf',
      '{"origin":"retained"}'::jsonb
    )
  $$,
  'An owner can retain an artifact in the private bucket'
);
select results_eq(
  $$
    update storage.objects
    set metadata = '{"origin":"overwritten"}'::jsonb
    where bucket_id = 'invoice-artifacts'
      and name = '10000000-0000-0000-0000-000000000001/16000000-0000-0000-0000-000000000001/issued.pdf'
    returning metadata
  $$,
  $$ select null::jsonb where false $$,
  'An owner cannot overwrite a retained invoice artifact'
);
select set_config('storage.allow_delete_query', 'true', true);
select results_eq(
  $$
    delete from storage.objects
    where bucket_id = 'invoice-artifacts'
      and name = '10000000-0000-0000-0000-000000000001/16000000-0000-0000-0000-000000000001/issued.pdf'
    returning name
  $$,
  $$ select null::text where false $$,
  'An owner cannot delete a retained invoice artifact'
);
select results_eq(
  $$
    select metadata
    from storage.objects
    where bucket_id = 'invoice-artifacts'
      and name = '10000000-0000-0000-0000-000000000001/16000000-0000-0000-0000-000000000001/issued.pdf'
  $$,
  $$ values ('{"origin":"retained"}'::jsonb) $$,
  'The original private invoice artifact remains unchanged and present'
);
reset role;
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'invoice-artifacts'
      and name = '20000000-0000-0000-0000-000000000002/26000000-0000-0000-0000-000000000002/owner-a-write.pdf'
  ),
  0::bigint,
  'A rejected cross-owner artifact insert creates no storage object'
);
select results_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') like '%invoice-artifacts%'
        or coalesce(with_check, '') like '%invoice-artifacts%'
      )
    order by policyname
  $$,
  $$
    values
      ('invoice_artifacts_owner_insert'::name),
      ('invoice_artifacts_owner_select'::name)
  $$,
  'Invoice artifact storage policies allow only owner-scoped insert and select'
);

select * from finish();

rollback;
