begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '81000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'profession-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '82000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'profession-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$ insert into public.encrypted_bank_settings
       (id, owner_id, profile, invoice_prefix)
     values
       ('83000000-0000-4000-8000-000000000003',
        '81000000-0000-4000-8000-000000000001',
        '{"profession":"pharmacist","doctorName":"Alex Example"}'::jsonb,
        'LOCUM') $$,
  'An owner can store a profession preference without a payment vault'
);

select results_eq(
  $$ select profile ->> 'profession', invoice_prefix
     from public.encrypted_bank_settings
     where id = '83000000-0000-4000-8000-000000000003' $$,
  $$ values ('pharmacist'::text, 'LOCUM'::text) $$,
  'The no-vault settings row retains profession and invoice prefix'
);

select throws_ok(
  $$ insert into public.encrypted_bank_settings
       (id, owner_id, profile)
     values
       ('84000000-0000-4000-8000-000000000004',
        '82000000-0000-4000-8000-000000000002',
        '{"profession":"gp"}'::jsonb) $$,
  '42501', null,
  'An owner cannot store another account profession preference'
);

select throws_ok(
  $$ update public.encrypted_bank_settings
     set ciphertext = 'partial-vault'
     where id = '83000000-0000-4000-8000-000000000003' $$,
  '23514', null,
  'A partial encrypted vault is rejected'
);

select throws_ok(
  $$ update public.encrypted_bank_settings
     set profile = '{"profession":null}'::jsonb
     where id = '83000000-0000-4000-8000-000000000003' $$,
  '23514', null,
  'A JSON null profession is rejected rather than passing a nullable CHECK'
);

select lives_ok(
  $$ update public.encrypted_bank_settings
     set ciphertext = 'opaque-ciphertext',
         salt = 'opaque-salt',
         initialization_vector = 'opaque-iv',
         kdf_parameters = '{"name":"PBKDF2","hash":"SHA-256","iterations":310000}'::jsonb,
         encryption_version = 1
     where id = '83000000-0000-4000-8000-000000000003' $$,
  'A complete encrypted vault remains valid'
);

select results_eq(
  $$ select count(*) from pg_class
     where oid = 'public.encrypted_bank_settings'::regclass
       and not relrowsecurity $$,
  $$ values (0::bigint) $$,
  'Profession storage retains row-level security'
);

select * from finish();
rollback;
