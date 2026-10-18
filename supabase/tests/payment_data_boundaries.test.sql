begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'payment-boundary@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'invoice-boundary@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'cascade-boundary@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.encrypted_bank_settings (
  id, owner_id, ciphertext, salt, initialization_vector, kdf_parameters,
  encryption_version, profile, invoice_prefix
) values
  ('31000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   'legacy-ciphertext', 'legacy-salt', 'legacy-iv',
   '{"name":"PBKDF2","hash":"SHA-256","iterations":310000}', 1,
   '{"profession":"pharmacist","doctorName":"Dr Legacy","address":"1 Legacy Road","email":"legacy@example.test"}', 'OLD'),
  ('51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   'AQEBAQEBAQEBAQEBAQEBAQEB', 'AQEBAQEBAQEBAQEBAQEBAQ==', 'AQEBAQEBAQEBAQEB',
   '{"name":"HKDF","hash":"SHA-256","info":"locum-manager-payment:v2"}', 2,
   '{"profession":"gp","doctorName":"Dr Cascade","address":"3 Cascade Road","email":"cascade@example.test"}', 'CAS');

insert into public.practice_records (id, owner_id, name, billing_address, payment_terms_days)
values ('41000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  'Boundary Medical Centre', '{"formatted":"1 Boundary Road, London"}', 30);
insert into public.session_records (
  id, owner_id, practice_id, starts_at, ends_at, hourly_rate_pence, status
) values ('42000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001', '2026-08-15T08:00:00Z',
  '2026-08-15T12:00:00Z', 6500, 'completed');
insert into public.invoice_records (id, owner_id)
values ('43000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001');

select has_trigger('public', 'encrypted_bank_settings',
  'guard_encrypted_bank_settings_v2_transition', 'Version 2 settings transitions are guarded');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok($$
  update public.encrypted_bank_settings set
    encryption_version = 2,
    ciphertext = 'AAAAAAAAAAAAAAAAAAAAAAA=',
    salt = 'AAAAAAAAAAAAAAAAAAAAAA==',
    initialization_vector = 'AAAAAAAAAAAAAAAA',
    kdf_parameters = '{"name":"HKDF","hash":"SHA-256","info":"locum-manager-payment:v2"}',
    revision = revision + 1
  where owner_id = '30000000-0000-4000-8000-000000000001'
$$, 'An owner can upgrade canonical settings while retaining profession');

select is((select profile ->> 'profession' from public.encrypted_bank_settings
  where owner_id = '30000000-0000-4000-8000-000000000001'), 'pharmacist',
  'The saved profession survives the version 2 upgrade');

select throws_like($$
  update public.encrypted_bank_settings
  set profile = profile || '{"paymentDetails":{"accountNumber":"12345678"}}'
  where owner_id = '30000000-0000-4000-8000-000000000001'
$$, '%canonical encrypted and public profile fields%', 'Readable payment fields are rejected');

select throws_like($$
  update public.encrypted_bank_settings set profile = profile || '{"profession":"doctor"}'
  where owner_id = '30000000-0000-4000-8000-000000000001'
$$, '%canonical encrypted and public profile fields%', 'Invalid professions are rejected');

select throws_like($$
  update public.encrypted_bank_settings set encryption_version = 1
  where owner_id = '30000000-0000-4000-8000-000000000001'
$$, '%cannot be downgraded or deleted%', 'Version 2 settings cannot be downgraded');

select throws_like($$
  update public.encrypted_bank_settings set deleted_at = now()
  where owner_id = '30000000-0000-4000-8000-000000000001'
$$, '%cannot be downgraded or deleted%', 'Version 2 settings cannot be soft deleted');

select throws_like($$
  delete from public.encrypted_bank_settings
  where owner_id = '30000000-0000-4000-8000-000000000001'
$$, '%cannot be downgraded or deleted%', 'Version 2 settings cannot be directly deleted');

select throws_like($$
  update public.encrypted_bank_settings set ciphertext = 'AAAAAAAAAAAAAAAAAAAAAAB='
  where owner_id = '30000000-0000-4000-8000-000000000001'
$$, '%canonical encrypted and public profile fields%', 'Non-canonical base64 is rejected');

reset role;

select ok(public.payment_snapshot_contains_plaintext_key(
  '{"metadata":[{"accountNumber":"12345678"}]}'::jsonb),
  'Plaintext payment keys are found recursively');
select ok(not public.payment_snapshot_contains_plaintext_key(
  '{"version":2,"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA="}'::jsonb),
  'An encrypted envelope without payment keys is clean');
select ok(not public.payment_snapshot_is_valid_v2(
  '{"version":2,"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA=","salt":"AAAAAAAAAAAAAAAAAAAAAA==","initializationVector":"AAAAAAAAAAAAAAAA","kdfParameters":{"name":"PBKDF2","hash":"SHA-256","info":"locum-manager-payment:v2"}}'::jsonb),
  'A non-canonical KDF is rejected');
select ok(public.payment_snapshot_is_valid_v2(
  '{"version":2,"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA=","salt":"AAAAAAAAAAAAAAAAAAAAAA==","initializationVector":"AAAAAAAAAAAAAAAA","kdfParameters":{"name":"HKDF","hash":"SHA-256","info":"locum-manager-payment:v2"},"issuer":{"doctorName":"Dr Demo","tradingName":"Demo Locums","address":"1 Demo Road","email":"demo@example.test"}}'::jsonb),
  'The exact version 2 envelope and issuer are accepted');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_like($$
  select public.issue_invoice(
    '43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
    '2026-08-15',
    '{"version":1,"ciphertext":"opaque","salt":"salt","initializationVector":"iv","kdfParameters":{"name":"PBKDF2","hash":"SHA-256","iterations":310000}}',
    '[{"sessionId":"42000000-0000-4000-8000-000000000001","description":"GP locum session","quantity":4,"unitRatePence":6500}]', 'INV')
$$, '%exact version 2 encrypted payment snapshot%', 'New invoice issuance rejects version 1');

select throws_like($$
  select public.issue_invoice(
    '43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
    '2026-08-15',
    '{"version":2,"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA=","salt":"AAAAAAAAAAAAAAAAAAAAAA==","initializationVector":"AAAAAAAAAAAAAAAA","kdfParameters":{"name":"HKDF","hash":"SHA-256","info":"locum-manager-payment:v2"},"accountNumber":"12345678"}',
    '[{"sessionId":"42000000-0000-4000-8000-000000000001","description":"GP locum session","quantity":4,"unitRatePence":6500}]', 'INV')
$$, '%encrypted payment snapshot%', 'New invoice issuance rejects readable payment keys');

select is((select invoice_number from public.issue_invoice(
  '43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '2026-08-15',
  '{"version":2,"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA=","salt":"AAAAAAAAAAAAAAAAAAAAAA==","initializationVector":"AAAAAAAAAAAAAAAA","kdfParameters":{"name":"HKDF","hash":"SHA-256","info":"locum-manager-payment:v2"},"issuer":{"doctorName":"Dr Demo","tradingName":"Demo Locums","address":"1 Demo Road","email":"demo@example.test"}}',
  '[{"sessionId":"42000000-0000-4000-8000-000000000001","description":"GP locum session","quantity":4,"unitRatePence":6500}]', 'INV')),
  'INV-2026-0001', 'New invoice issuance accepts the exact version 2 snapshot');

select is((select payment_snapshot ->> 'version' from public.invoice_records
  where id = '43000000-0000-4000-8000-000000000001'), '2',
  'A newly issued invoice stores version 2');

reset role;

select lives_ok($$ delete from auth.users where id = '50000000-0000-4000-8000-000000000001' $$,
  'Deleting an account owner can cascade through version 2 protection');
select is((select count(*) from public.encrypted_bank_settings
  where owner_id = '50000000-0000-4000-8000-000000000001'), 0::bigint,
  'The account-owner cascade removes its settings row');

select * from finish();
rollback;
