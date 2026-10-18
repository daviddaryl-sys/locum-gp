begin;
create extension if not exists pgtap with schema extensions;
-- pgTAP 1.3.3 on the disposable test image has no hasnt_table_privilege helper.
-- Define this compatibility assertion in the rolled-back extension schema so
-- the required unqualified assertion calls remain valid without persistence.
create function extensions.hasnt_table_privilege(
  role_name text,
  relation_name text,
  privilege text,
  description text
)
returns text
language sql
as $$
  select ok(
    not has_table_privilege(role_name, relation_name, privilege),
    description
  );
$$;
set local search_path = extensions, public;
create function extensions.invoke_google_calendar_delete_completion(
  requested_owner uuid,
  requested_session uuid,
  requested_revision bigint,
  completed_at timestamptz
)
returns void
language plpgsql
as $$
begin
  perform public.complete_google_calendar_delete(
    requested_owner, requested_session,
    '49900000-0000-4000-8000-000000000001', 'calendar-race',
    requested_revision, completed_at
  );
end;
$$;
select plan(124);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '41000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'calendar-race@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.practice_records (
  id, owner_id, name, billing_address, default_hourly_rate_pence,
  payment_terms_days
) values (
  '41100000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'Calendar race practice', '{}'::jsonb, 6000, 14
);

insert into public.session_records (
  id, owner_id, practice_id, starts_at, ends_at, hourly_rate_pence, status
) values
  (
    '41200000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000001',
    '41100000-0000-4000-8000-000000000001',
    '2026-08-05 09:00+00', '2026-08-05 13:00+00', 6000, 'planned'
  ),
  (
    '41200000-0000-4000-8000-000000000002',
    '41000000-0000-4000-8000-000000000001',
    '41100000-0000-4000-8000-000000000001',
    '2026-08-06 09:00+00', '2026-08-06 13:00+00', 6000, 'planned'
  );

insert into public.google_calendar_connections (
  owner_id, status, calendar_id, refresh_token_envelope, connected_at
) values (
  '41000000-0000-4000-8000-000000000001', 'connected', 'calendar-race',
  '{}'::jsonb, '2026-08-01 09:00+00'
);

insert into public.google_calendar_event_links (
  owner_id, session_id, calendar_id, event_id, last_applied_revision, state
) values
  (
    '41000000-0000-4000-8000-000000000001',
    '41200000-0000-4000-8000-000000000001',
    'calendar-race', 'upsert-newer-event', 3, 'active'
  ),
  (
    '41000000-0000-4000-8000-000000000001',
    '41200000-0000-4000-8000-000000000002',
    'calendar-race', 'delete-newer-event', 3, 'active'
  );

insert into public.google_calendar_sync_jobs (
  owner_id, session_id, desired_action, target_revision
) values
  (
    '41000000-0000-4000-8000-000000000001',
    '41200000-0000-4000-8000-000000000001', 'upsert', 3
  ),
  (
    '41000000-0000-4000-8000-000000000001',
    '41200000-0000-4000-8000-000000000002', 'delete', 3
  );

select has_table('public', 'google_calendar_connections', 'Calendar connections exist');
select has_table('public', 'google_calendar_event_links', 'Calendar event links exist');
select has_table('public', 'google_calendar_sync_jobs', 'Calendar retry jobs exist');
select has_column('public', 'google_calendar_connections', 'refresh_token_envelope', 'Refresh tokens use an envelope');
select has_column('public', 'google_calendar_connections', 'calendar_id', 'Dedicated calendar id is retained');
select has_column('public', 'google_calendar_event_links', 'last_applied_revision', 'Links record applied revision');
select has_column('public', 'google_calendar_sync_jobs', 'next_attempt_at', 'Jobs retain retry schedule');
select has_pk('public', 'google_calendar_connections', 'One connection row is keyed by owner');
select has_pk('public', 'google_calendar_event_links', 'One event link is keyed by owner and session');
select has_pk('public', 'google_calendar_sync_jobs', 'One coalescing job is keyed by owner and session');
select results_eq(
  $$ select count(*) from pg_class where oid in (
       'public.google_calendar_connections'::regclass,
       'public.google_calendar_event_links'::regclass,
       'public.google_calendar_sync_jobs'::regclass
     ) and relrowsecurity $$,
  $$ values (3::bigint) $$,
  'Every Calendar table has RLS enabled'
);
select hasnt_table_privilege('authenticated', 'public.google_calendar_connections', 'select', 'Browser users cannot select token rows');
select hasnt_table_privilege('authenticated', 'public.google_calendar_connections', 'insert', 'Browser users cannot insert token rows');
select hasnt_table_privilege('authenticated', 'public.google_calendar_event_links', 'select', 'Browser users cannot select event ids');
select hasnt_table_privilege('authenticated', 'public.google_calendar_sync_jobs', 'select', 'Browser users cannot select retry jobs');
select hasnt_table_privilege('anon', 'public.google_calendar_connections', 'select', 'Anonymous users cannot select token rows');
select has_function('public', 'complete_google_calendar_upsert', 'Upsert completion is transactional');
select has_function('public', 'complete_google_calendar_delete', 'Delete completion is transactional');
select columns_are(
  'public', 'admin_google_calendar_health',
  array['account_id','connection_status','pending_job_count','last_sync_at','last_failure_at'],
  'Admin health contains only identifiers, counts, status and timestamps'
);
select results_eq(
  $$ select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'admin_google_calendar_health'
       and column_name in ('refresh_token_envelope','calendar_id','event_id','last_failure_category') $$,
  $$ values (0::bigint) $$,
  'Admin health excludes tokens, Google ids and provider failure details'
);

select has_table(
  'public', 'google_calendar_setup_claims',
  'Initial Calendar setup has a durable owner claim'
);
select has_table(
  'public', 'google_calendar_owner_guards',
  'Every owner has a stable cross-table serialization guard'
);
select columns_are(
  'public', 'google_calendar_owner_guards',
  array['owner_id','created_at'],
  'Owner guards contain only the owner UUID and creation timestamp'
);
select has_pk(
  'public', 'google_calendar_owner_guards',
  'One stable serialization guard exists per owner'
);
select columns_are(
  'public', 'google_calendar_setup_claims',
  array['owner_id','claim_token','started_at','lease_expires_at','staged_calendar_id','updated_at'],
  'Setup claims retain only owner, bounded claim, staged id and timestamps'
);
select has_pk(
  'public', 'google_calendar_setup_claims',
  'Only one setup claim can exist per owner'
);
select results_eq(
  $$ select count(*) from pg_class
     where oid = to_regclass('public.google_calendar_setup_claims')
       and relrowsecurity $$,
  $$ values (1::bigint) $$,
  'Setup claims have RLS enabled'
);
select results_eq(
  $$ select count(*) from pg_class
     where oid = to_regclass('public.google_calendar_owner_guards')
       and relrowsecurity $$,
  $$ values (1::bigint) $$,
  'Owner guards have RLS enabled'
);
select results_eq(
  $$ select count(*) from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'google_calendar_setup_claims'
       and grantee in ('PUBLIC','anon','authenticated') $$,
  $$ values (0::bigint) $$,
  'Browser and anonymous roles have no setup claim privileges'
);
select results_eq(
  $$ select count(*) from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'google_calendar_owner_guards'
       and grantee in ('PUBLIC','anon','authenticated') $$,
  $$ values (0::bigint) $$,
  'Browser and anonymous roles have no owner guard privileges'
);
select results_eq(
  $$ select count(*) from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'google_calendar_setup_claims'
       and grantee = 'service_role'
       and privilege_type in ('DELETE','INSERT','SELECT','UPDATE') $$,
  $$ values (4::bigint) $$,
  'Service role alone has the setup claim privileges it needs'
);
select results_eq(
  $$ select count(*) from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'google_calendar_owner_guards'
       and grantee = 'service_role'
       and privilege_type in ('INSERT','SELECT') $$,
  $$ values (2::bigint) $$,
  'Service role can create and lock owner guards but cannot delete them'
);
select has_index(
  'public', 'google_calendar_setup_claims',
  'google_calendar_setup_claims_lease_idx',
  'Setup claim lease expiry is indexed'
);
select has_function('public', 'claim_google_calendar_setup', 'Initial setup has an atomic claim transition');
select has_function('public', 'stage_google_calendar_setup', 'Initial setup can stage one created calendar');
select has_function('public', 'complete_google_calendar_setup', 'Initial setup finalization is transactional');
select has_function('public', 'release_google_calendar_setup', 'Known initial create failures can release their claim');

select public.complete_google_calendar_upsert(
  '41000000-0000-4000-8000-000000000001',
  '41200000-0000-4000-8000-000000000001',
  '49900000-0000-4000-8000-000000000001',
  'calendar-race', 'upsert-stale-event', 2, 'active', '2026-08-05 14:00+00'
);
select results_eq(
  $$ select count(*) from public.google_calendar_sync_jobs
     where owner_id = '41000000-0000-4000-8000-000000000001'
       and session_id = '41200000-0000-4000-8000-000000000001'
       and desired_action = 'upsert' and target_revision = 3 $$,
  $$ values (1::bigint) $$,
  'Stale upsert completion preserves the newer coalesced job'
);
select results_eq(
  $$ select last_applied_revision from public.google_calendar_event_links
     where owner_id = '41000000-0000-4000-8000-000000000001'
       and session_id = '41200000-0000-4000-8000-000000000001' $$,
  $$ values (3::bigint) $$,
  'Stale upsert completion never lowers the applied revision'
);
select has_function(
  'public', 'complete_google_calendar_delete',
  array['uuid','uuid','uuid','text','bigint','timestamp with time zone']::name[],
  'Delete completion requires claim, calendar and expected revision'
);
select extensions.invoke_google_calendar_delete_completion(
  '41000000-0000-4000-8000-000000000001',
  '41200000-0000-4000-8000-000000000002', 2, '2026-08-06 14:00+00'
);
select results_eq(
  $$ select count(*) from public.google_calendar_sync_jobs
     where owner_id = '41000000-0000-4000-8000-000000000001'
       and session_id = '41200000-0000-4000-8000-000000000002'
       and desired_action = 'delete' and target_revision = 3 $$,
  $$ values (1::bigint) $$,
  'Stale delete completion preserves the newer coalesced job'
);
select results_eq(
  $$ select last_applied_revision from public.google_calendar_event_links
     where owner_id = '41000000-0000-4000-8000-000000000001'
       and session_id = '41200000-0000-4000-8000-000000000002' $$,
  $$ values (3::bigint) $$,
  'Stale delete completion preserves the newer event link'
);

select has_table(
  'public', 'google_calendar_oauth_state_claims',
  'Durable OAuth state claims exist'
);
select columns_are(
  'public', 'google_calendar_oauth_state_claims',
  array['owner_id','state_digest','expires_at','created_at'],
  'OAuth claims retain only owner, digest, expiry and creation time'
);
select has_pk(
  'public', 'google_calendar_oauth_state_claims',
  'OAuth claims are owner scoped and uniquely digest keyed'
);
select results_eq(
  $$ select count(*) from pg_class
     where oid = to_regclass('public.google_calendar_oauth_state_claims')
       and relrowsecurity $$,
  $$ values (1::bigint) $$,
  'OAuth state claims have RLS enabled'
);
select results_eq(
  $$ select count(*) from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'google_calendar_oauth_state_claims'
       and grantee in ('PUBLIC', 'anon', 'authenticated') $$,
  $$ values (0::bigint) $$,
  'Browser and anonymous roles have no OAuth claim privileges'
);
select results_eq(
  $$ select count(*) from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'google_calendar_oauth_state_claims'
       and grantee = 'service_role'
       and privilege_type in ('DELETE', 'INSERT', 'SELECT') $$,
  $$ values (3::bigint) $$,
  'Service role has the OAuth claim privileges it needs'
);
select has_index(
  'public', 'google_calendar_oauth_state_claims',
  'google_calendar_oauth_state_claims_expiry_idx',
  'OAuth claim expiry is indexed'
);
select results_eq(
  $$ select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'google_calendar_oauth_state_claims'
       and column_name in (
         'state', 'verifier', 'sealed_state', 'cookie', 'token', 'provider_data'
       ) $$,
  $$ values (0::bigint) $$,
  'OAuth claims contain no plaintext authorization or provider data'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '41000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'calendar-claim@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.google_calendar_oauth_state_claims (
  owner_id, state_digest, expires_at, created_at
) values
  (
    '41000000-0000-4000-8000-000000000001', repeat('a', 43),
    '2026-08-05 10:10+00', '2026-08-05 10:00+00'
  ),
  (
    '41000000-0000-4000-8000-000000000001', repeat('b', 43),
    '2026-08-05 10:10+00', '2026-08-05 10:00+00'
  ),
  (
    '41000000-0000-4000-8000-000000000001', repeat('c', 43),
    '2026-08-05 09:59+00', '2026-08-05 09:50+00'
  );

select results_eq(
  $$ with claimed as (
       delete from public.google_calendar_oauth_state_claims
       where owner_id = '41000000-0000-4000-8000-000000000001'
         and state_digest = repeat('a', 43)
         and expires_at > '2026-08-05 10:00+00'
       returning state_digest
     ) select state_digest from claimed $$,
  $$ values (repeat('a', 43)) $$,
  'One atomic claim deletes and returns the unexpired owner digest'
);
select results_eq(
  $$ with claimed as (
       delete from public.google_calendar_oauth_state_claims
       where owner_id = '41000000-0000-4000-8000-000000000001'
         and state_digest = repeat('a', 43)
         and expires_at > '2026-08-05 10:00+00'
       returning state_digest
     ) select state_digest from claimed $$,
  $$ select null::text where false $$,
  'A second atomic claim cannot replay the same digest'
);
select results_eq(
  $$ with claimed as (
       delete from public.google_calendar_oauth_state_claims
       where owner_id = '41000000-0000-4000-8000-000000000002'
         and state_digest = repeat('b', 43)
         and expires_at > '2026-08-05 10:00+00'
       returning state_digest
     ) select state_digest from claimed $$,
  $$ select null::text where false $$,
  'A different owner cannot claim the digest'
);
select results_eq(
  $$ select count(*) from public.google_calendar_oauth_state_claims
     where owner_id = '41000000-0000-4000-8000-000000000001'
       and state_digest = repeat('b', 43) $$,
  $$ values (1::bigint) $$,
  'A wrong-owner attempt leaves the rightful claim intact'
);
select results_eq(
  $$ with claimed as (
       delete from public.google_calendar_oauth_state_claims
       where owner_id = '41000000-0000-4000-8000-000000000001'
         and state_digest = repeat('b', 43)
         and expires_at > '2026-08-05 10:00+00'
       returning state_digest
     ) select state_digest from claimed $$,
  $$ values (repeat('b', 43)) $$,
  'The rightful owner can claim after a wrong-owner attempt'
);
select results_eq(
  $$ with claimed as (
       delete from public.google_calendar_oauth_state_claims
       where owner_id = '41000000-0000-4000-8000-000000000001'
         and state_digest = repeat('c', 43)
         and expires_at > '2026-08-05 10:00+00'
       returning state_digest
     ) select state_digest from claimed $$,
  $$ select null::text where false $$,
  'An expired digest cannot be claimed'
);
select results_eq(
  $$ select count(*) from public.google_calendar_oauth_state_claims
     where owner_id = '41000000-0000-4000-8000-000000000001'
       and state_digest = repeat('c', 43) $$,
  $$ values (1::bigint) $$,
  'An expired claim is not mistaken for successful consumption'
);

select has_column('public', 'google_calendar_sync_jobs', 'claim_token', 'Sync jobs retain a durable claim token');
select has_column('public', 'google_calendar_sync_jobs', 'claimed_action', 'Sync jobs retain the claimed action snapshot');
select has_column('public', 'google_calendar_sync_jobs', 'claimed_revision', 'Sync jobs retain the claimed revision snapshot');
select has_column('public', 'google_calendar_sync_jobs', 'lease_expires_at', 'Sync job claims have a bounded lease');
select has_column('public', 'google_calendar_connections', 'replacement_claim_token', 'Replacement creation has an owner claim');
select has_column('public', 'google_calendar_connections', 'replacement_started_at', 'Replacement creation records when it began');
select has_column('public', 'google_calendar_connections', 'replacement_calendar_id', 'A created replacement can be staged durably');
select has_column('public', 'google_calendar_connections', 'replacement_lease_expires_at', 'Replacement claims have an explicit bounded lease');
select has_index(
  'public', 'google_calendar_connections',
  'google_calendar_connections_replacement_lease_idx',
  'Replacement claim lease expiry is indexed'
);
select has_function('public', 'claim_google_calendar_sync_jobs', 'Due Calendar jobs are claimed atomically');
select has_function(
  'public', 'complete_google_calendar_upsert',
  array['uuid','uuid','uuid','text','text','bigint','text','timestamp with time zone']::name[],
  'Upsert completion requires claim, actual calendar and revision'
);
select has_function(
  'public', 'complete_google_calendar_delete',
  array['uuid','uuid','uuid','text','bigint','timestamp with time zone']::name[],
  'Delete completion requires claim, actual calendar and revision'
);
select has_function('public', 'retry_google_calendar_sync_job', 'Retry releases only its durable job claim');
select has_function('public', 'claim_google_calendar_replacement', 'Calendar replacement has a durable owner claim');
select has_function('public', 'stage_google_calendar_replacement', 'Created replacement ids can be staged');
select has_function('public', 'complete_google_calendar_replacement', 'Replacement retention and invalidation are transactional');
select has_function('public', 'release_google_calendar_replacement', 'Known replacement failures can release their claim');
select results_eq(
  $$ select count(*) from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name in (
         'claim_google_calendar_sync_jobs',
         'complete_google_calendar_upsert',
         'complete_google_calendar_delete',
         'retry_google_calendar_sync_job',
         'claim_google_calendar_replacement',
         'stage_google_calendar_replacement',
         'complete_google_calendar_replacement',
         'release_google_calendar_replacement'
         ,'claim_google_calendar_setup'
         ,'stage_google_calendar_setup'
         ,'complete_google_calendar_setup'
         ,'release_google_calendar_setup'
       )
       and grantee in ('PUBLIC','anon','authenticated') $$,
  $$ values (0::bigint) $$,
  'Browser and anonymous roles cannot execute Calendar worker transitions'
);
select results_eq(
  $$ select count(distinct routine_name) from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name in (
         'claim_google_calendar_sync_jobs',
         'complete_google_calendar_upsert',
         'complete_google_calendar_delete',
         'retry_google_calendar_sync_job',
         'claim_google_calendar_replacement',
         'stage_google_calendar_replacement',
         'complete_google_calendar_replacement',
         'release_google_calendar_replacement'
         ,'claim_google_calendar_setup'
         ,'stage_google_calendar_setup'
         ,'complete_google_calendar_setup'
         ,'release_google_calendar_setup'
       )
       and grantee = 'service_role' and privilege_type = 'EXECUTE' $$,
  $$ values (12::bigint) $$,
  'Service role alone receives every Calendar worker transition'
);
select results_eq(
  $$ select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'admin_google_calendar_health'
       and column_name in (
         'claim_token','claimed_action','claimed_revision','lease_expires_at',
         'replacement_claim_token','replacement_calendar_id',
         'replacement_lease_expires_at','claim_token','staged_calendar_id',
         'google_calendar_owner_guards'
       ) $$,
  $$ values (0::bigint) $$,
  'Admin health excludes durable worker and replacement claims'
);

insert into public.practice_records (
  id, owner_id, name, billing_address, default_hourly_rate_pence,
  payment_terms_days
) values (
  '41100000-0000-4000-8000-000000000002',
  '41000000-0000-4000-8000-000000000002',
  'Calendar claim cap practice', '{}'::jsonb, 6000, 14
);
insert into public.google_calendar_connections (
  owner_id, status, calendar_id, refresh_token_envelope, connected_at
) values (
  '41000000-0000-4000-8000-000000000002', 'connected', 'calendar-cap',
  '{}'::jsonb, '2026-08-01 09:00+00'
);
insert into public.session_records (
  id, owner_id, practice_id, starts_at, ends_at, hourly_rate_pence, status
)
select
  ('41300000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  '41000000-0000-4000-8000-000000000002'::uuid,
  '41100000-0000-4000-8000-000000000002'::uuid,
  '2026-08-12 09:00+00'::timestamptz + sequence * interval '1 day',
  '2026-08-12 13:00+00'::timestamptz + sequence * interval '1 day',
  6000, 'planned'
from generate_series(1, 26) as sequence;
insert into public.google_calendar_sync_jobs (
  owner_id, session_id, desired_action, target_revision,
  next_attempt_at, updated_at
)
select
  '41000000-0000-4000-8000-000000000002'::uuid,
  ('41300000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  'upsert', 1, '2026-08-05 14:00+00', '2026-08-05 14:00+00'
from generate_series(1, 26) as sequence;
select results_eq(
  $$ select count(*) from public.claim_google_calendar_sync_jobs(
       '41000000-0000-4000-8000-000000000002',
       '2026-08-05 14:00+00', '2026-08-05 14:05+00', 99
     ) $$,
  $$ values (25::bigint) $$,
  'A claim invocation atomically returns at most 25 of 26 due jobs'
);
select results_eq(
  $$ select count(*) filter (where claim_token is not null),
            count(*) filter (where claim_token is null)
     from public.google_calendar_sync_jobs
     where owner_id = '41000000-0000-4000-8000-000000000002' $$,
  $$ values (25::bigint, 1::bigint) $$,
  'Exactly 25 jobs are claimed and one due job remains unclaimed'
);

update public.google_calendar_sync_jobs
set next_attempt_at = '2026-08-05 14:00+00', updated_at = '2026-08-05 14:00+00'
where owner_id = '41000000-0000-4000-8000-000000000001';

select results_eq(
  $$ select count(*) from public.claim_google_calendar_sync_jobs(
       '41000000-0000-4000-8000-000000000001',
       '2026-08-05 14:00+00', '2026-08-05 14:05+00', 99
     ) $$,
  $$ values (2::bigint) $$,
  'One worker atomically claims the owner due jobs with a hard maximum of 25'
);
select results_eq(
  $$ select count(*) from public.claim_google_calendar_sync_jobs(
       '41000000-0000-4000-8000-000000000001',
       '2026-08-05 14:00+00', '2026-08-05 14:05+00', 25
     ) $$,
  $$ values (0::bigint) $$,
  'A concurrent worker cannot claim active owner-session work'
);

update public.google_calendar_sync_jobs
set desired_action = 'upsert', target_revision = 4, updated_at = '2026-08-05 14:01+00'
where owner_id = '41000000-0000-4000-8000-000000000001'
  and session_id = '41200000-0000-4000-8000-000000000001';

select results_eq(
  $$ select public.complete_google_calendar_upsert(
       '41000000-0000-4000-8000-000000000001',
       '41200000-0000-4000-8000-000000000001', claim_token,
       'calendar-race', 'upsert-revision-three', 3, 'active',
       '2026-08-05 14:02+00'
     ) from public.google_calendar_sync_jobs
     where owner_id = '41000000-0000-4000-8000-000000000001'
       and session_id = '41200000-0000-4000-8000-000000000001' $$,
  $$ values ('superseded'::text) $$,
  'An older claimed upsert reports superseded after a newer revision is queued'
);
select results_eq(
  $$ select target_revision, claim_token is null, next_attempt_at
     from public.google_calendar_sync_jobs
     where owner_id = '41000000-0000-4000-8000-000000000001'
       and session_id = '41200000-0000-4000-8000-000000000001' $$,
  $$ values (4::bigint, true, '2026-08-05 14:02+00'::timestamptz) $$,
  'Superseded completion releases and immediately preserves the canonical latest job'
);
select results_eq(
  $$ select public.complete_google_calendar_upsert(
       '41000000-0000-4000-8000-000000000001',
       '41200000-0000-4000-8000-000000000001',
       '49900000-0000-4000-8000-000000000099',
       'calendar-race', 'stale-claim-event', 4, 'active',
       '2026-08-05 14:03+00'
     ) $$,
  $$ values ('stale_claim'::text) $$,
  'A non-owner claim token cannot complete a job'
);

select * from public.claim_google_calendar_sync_jobs(
  '41000000-0000-4000-8000-000000000001',
  '2026-08-05 14:03+00', '2026-08-05 14:08+00', 1
);
select results_eq(
  $$ select public.complete_google_calendar_upsert(
       '41000000-0000-4000-8000-000000000001',
       '41200000-0000-4000-8000-000000000001', claim_token,
       'calendar-not-current', 'wrong-calendar-event', 4, 'active',
       '2026-08-05 14:04+00'
     ) from public.google_calendar_sync_jobs
     where owner_id = '41000000-0000-4000-8000-000000000001'
       and session_id = '41200000-0000-4000-8000-000000000001' $$,
  $$ values ('stale_calendar'::text) $$,
  'Event completion is rejected when the actual calendar is no longer current'
);
select results_eq(
  $$ select count(*) from public.google_calendar_sync_jobs
     where owner_id = '41000000-0000-4000-8000-000000000001'
       and session_id = '41200000-0000-4000-8000-000000000001'
       and target_revision = 4 and claim_token is null $$,
  $$ values (1::bigint) $$,
  'A calendar mismatch releases but never discards canonical work'
);

select results_eq(
  $$ select disposition, calendar_id from public.claim_google_calendar_replacement(
       '41000000-0000-4000-8000-000000000001', 'calendar-race',
       '42000000-0000-4000-8000-000000000001', '2026-08-05 14:05+00'
     ) $$,
  $$ values ('create'::text, null::text) $$,
  'One owner worker wins the durable replacement creation claim'
);
select results_eq(
  $$ select disposition, calendar_id from public.claim_google_calendar_replacement(
       '41000000-0000-4000-8000-000000000001', 'calendar-race',
       '42000000-0000-4000-8000-000000000002', '2026-08-05 14:05+00'
     ) $$,
  $$ values ('busy'::text, null::text) $$,
  'A concurrent replacement worker cannot create another calendar'
);
select results_eq(
  $$ select (to_jsonb(connection)->>'replacement_lease_expires_at')::timestamptz
     from public.google_calendar_connections
       as connection
     where owner_id = '41000000-0000-4000-8000-000000000001' $$,
  $$ values ('2026-08-05 14:10+00'::timestamptz) $$,
  'Replacement claims persist an explicit five-minute lease'
);
select results_eq(
  $$ select public.stage_google_calendar_replacement(
       '41000000-0000-4000-8000-000000000001', 'calendar-race',
       '42000000-0000-4000-8000-000000000001', 'calendar-replacement',
       '2026-08-05 14:06+00'
     ) $$,
  $$ values (true) $$,
  'The winning worker stages the created replacement id durably'
);
select results_eq(
  $$ select disposition, calendar_id from public.claim_google_calendar_replacement(
       '41000000-0000-4000-8000-000000000001', 'calendar-race',
       '42000000-0000-4000-8000-000000000003', '2026-08-05 14:07+00'
     ) $$,
  $$ values ('busy'::text, null::text) $$,
  'A staged replacement stays busy until its active lease expires'
);
select results_eq(
  $$ select disposition, calendar_id from public.claim_google_calendar_replacement(
       '41000000-0000-4000-8000-000000000001', 'calendar-race',
       '42000000-0000-4000-8000-000000000003', '2026-08-05 14:10:01+00'
     ) $$,
  $$ values ('resume'::text, 'calendar-replacement'::text) $$,
  'Only an expired staged replacement transfers for verified resume'
);
select results_eq(
  $$ select public.complete_google_calendar_replacement(
       '41000000-0000-4000-8000-000000000001', 'calendar-race',
       '42000000-0000-4000-8000-000000000003', 'calendar-replacement',
       '2026-08-05 14:11+00'
     ) $$,
  $$ values ('completed'::text) $$,
  'The resumed replacement completes through its current durable claim'
);
select results_eq(
  $$ select calendar_id,
       (select count(*) from public.google_calendar_event_links l where l.owner_id = c.owner_id),
       (select count(*) from public.google_calendar_sync_jobs j where j.owner_id = c.owner_id)
     from public.google_calendar_connections c
     where owner_id = '41000000-0000-4000-8000-000000000001' $$,
  $$ values ('calendar-replacement'::text, 0::bigint, 0::bigint) $$,
  'Replacement atomically retains the new connection and invalidates old links and jobs'
);
select ok(
  position('update public.google_calendar_connections' in lower(pg_get_functiondef(
    'public.complete_google_calendar_replacement(uuid,text,uuid,text,timestamptz)'::regprocedure
  ))) < position('delete from public.google_calendar_event_links' in lower(pg_get_functiondef(
    'public.complete_google_calendar_replacement(uuid,text,uuid,text,timestamptz)'::regprocedure
  ))),
  'Replacement function retains the new connection before invalidating mappings inside one transaction'
);

select * from public.claim_google_calendar_replacement(
  '41000000-0000-4000-8000-000000000001', 'calendar-replacement',
  '42000000-0000-4000-8000-000000000004', '2026-08-05 14:12+00'
);
select results_eq(
  $$ select public.release_google_calendar_replacement(
       '41000000-0000-4000-8000-000000000001', 'calendar-replacement',
       '42000000-0000-4000-8000-000000000004', '2026-08-05 14:13+00'
     ) $$,
  $$ values (true) $$,
  'A known provider failure releases only the matching owner replacement claim'
);
select results_eq(
  $$ select disposition from public.claim_google_calendar_replacement(
       '41000000-0000-4000-8000-000000000001', 'calendar-replacement',
       '42000000-0000-4000-8000-000000000005', '2026-08-05 14:14+00'
     ) $$,
  $$ values ('create'::text) $$,
  'A replacement can be retried after an explicitly known failure release'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '41000000-0000-4000-8000-000000000003',
  'authenticated', 'authenticated', 'calendar-setup@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
), (
  '00000000-0000-0000-0000-000000000000',
  '41000000-0000-4000-8000-000000000004',
  'authenticated', 'authenticated', 'calendar-release@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select results_eq(
  $$ select disposition, calendar_id from public.claim_google_calendar_setup(
       '41000000-0000-4000-8000-000000000003',
       '43000000-0000-4000-8000-000000000001', '2026-08-05 15:00+00'
     ) $$,
  $$ values ('create'::text, null::text) $$,
  'Exactly one initial callback wins the durable create claim'
);
select results_eq(
  $$ select disposition, calendar_id from public.claim_google_calendar_setup(
       '41000000-0000-4000-8000-000000000003',
       '43000000-0000-4000-8000-000000000002', '2026-08-05 15:01+00'
     ) $$,
  $$ values ('busy'::text, null::text) $$,
  'A concurrent initial callback cannot create another calendar'
);
select results_eq(
  $$ select (to_jsonb(setup)->>'lease_expires_at')::timestamptz
     from public.google_calendar_setup_claims as setup
     where owner_id = '41000000-0000-4000-8000-000000000003' $$,
  $$ values ('2026-08-05 15:05+00'::timestamptz) $$,
  'Initial setup claims persist an explicit five-minute lease'
);
select is(
  public.stage_google_calendar_setup(
    '41000000-0000-4000-8000-000000000003',
    '43000000-0000-4000-8000-000000000002', 'calendar-loser',
    '2026-08-05 15:02+00'
  ), false,
  'A losing callback cannot stage a calendar'
);
select is(
  public.stage_google_calendar_setup(
    '41000000-0000-4000-8000-000000000003',
    '43000000-0000-4000-8000-000000000001', 'calendar-setup',
    '2026-08-05 15:03+00'
  ), true,
  'The winning callback stages its calendar through matching CAS'
);
select results_eq(
  $$ select disposition, calendar_id from public.claim_google_calendar_setup(
       '41000000-0000-4000-8000-000000000003',
       '43000000-0000-4000-8000-000000000003', '2026-08-05 15:04+00'
     ) $$,
  $$ values ('busy'::text, null::text) $$,
  'A staged initial calendar stays busy until its active lease expires'
);
select results_eq(
  $$ select disposition, calendar_id from public.claim_google_calendar_setup(
       '41000000-0000-4000-8000-000000000003',
       '43000000-0000-4000-8000-000000000003', '2026-08-05 15:05:01+00'
     ) $$,
  $$ values ('resume'::text, 'calendar-setup'::text) $$,
  'Only an expired staged setup transfers for verified resume'
);
select is(
  public.complete_google_calendar_setup(
    '41000000-0000-4000-8000-000000000003',
    '43000000-0000-4000-8000-000000000003', 'calendar-wrong',
    '{"version":1,"iv":"i","ciphertext":"c","tag":"t"}'::jsonb,
    '2026-08-05 15:06+00'
  ), 'stale_claim',
  'Setup finalization rejects a calendar other than the staged id'
);
select results_eq(
  $$ select count(*) from public.google_calendar_setup_claims
     where owner_id = '41000000-0000-4000-8000-000000000003' $$,
  $$ values (1::bigint) $$,
  'A rejected finalization retains the durable staged claim'
);
select is(
  public.complete_google_calendar_setup(
    '41000000-0000-4000-8000-000000000003',
    '43000000-0000-4000-8000-000000000003', 'calendar-setup',
    '{"version":1,"iv":"i","ciphertext":"c","tag":"t"}'::jsonb,
    '2026-08-05 15:07+00'
  ), 'completed',
  'The matching staged callback finalizes observably'
);
select results_eq(
  $$ select status, calendar_id, refresh_token_envelope
     from public.google_calendar_connections
     where owner_id = '41000000-0000-4000-8000-000000000003' $$,
  $$ values ('connected'::text, 'calendar-setup'::text,
       '{"iv":"i","tag":"t","version":1,"ciphertext":"c"}'::jsonb) $$,
  'Finalization retains the encrypted connection without exposing token material'
);
select results_eq(
  $$ select count(*) from public.google_calendar_setup_claims
     where owner_id = '41000000-0000-4000-8000-000000000003' $$,
  $$ values (0::bigint) $$,
  'Successful finalization removes its setup claim'
);
select results_eq(
  $$ select disposition from public.claim_google_calendar_setup(
       '41000000-0000-4000-8000-000000000003',
       '43000000-0000-4000-8000-000000000007', '2026-08-05 15:06:30+00'
     ) $$,
  $$ values ('busy'::text) $$,
  'A completed owner can never reacquire an initial create claim'
);
select ok(
  position('insert into public.google_calendar_connections' in lower(pg_get_functiondef(
    'public.complete_google_calendar_setup(uuid,uuid,text,jsonb,timestamptz)'::regprocedure
  ))) < position('delete from public.google_calendar_setup_claims' in lower(pg_get_functiondef(
    'public.complete_google_calendar_setup(uuid,uuid,text,jsonb,timestamptz)'::regprocedure
  ))),
  'Setup finalization retains the connection before deleting its claim in one transaction'
);
select results_eq(
  $$ select disposition from public.claim_google_calendar_setup(
       '41000000-0000-4000-8000-000000000004',
       '43000000-0000-4000-8000-000000000004', '2026-08-05 15:07+00'
     ) $$,
  $$ values ('create'::text) $$,
  'A separate owner can claim initial setup independently'
);
select is(
  public.release_google_calendar_setup(
    '41000000-0000-4000-8000-000000000004',
    '43000000-0000-4000-8000-000000000005'
  ), false,
  'A non-owner claim token cannot release setup'
);
select is(
  public.release_google_calendar_setup(
    '41000000-0000-4000-8000-000000000004',
    '43000000-0000-4000-8000-000000000004'
  ), true,
  'A known failed create releases only its matching unstaged claim'
);
select results_eq(
  $$ select disposition from public.claim_google_calendar_setup(
       '41000000-0000-4000-8000-000000000004',
       '43000000-0000-4000-8000-000000000006', '2026-08-05 15:08+00'
     ) $$,
  $$ values ('create'::text) $$,
  'Known failure release permits one explicit retry'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '41000000-0000-4000-8000-000000000005',
  'authenticated', 'authenticated', 'calendar-reconnect-race@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.google_calendar_connections (
  owner_id, status, calendar_id, refresh_token_envelope, connected_at
) values (
  '41000000-0000-4000-8000-000000000005', 'reconnect_required',
  'calendar-reconnect-missing', '{}'::jsonb, '2026-08-01 09:00+00'
);
select results_eq(
  $$ select disposition from public.claim_google_calendar_replacement(
       '41000000-0000-4000-8000-000000000005', 'calendar-reconnect-missing',
       '44000000-0000-4000-8000-000000000001', '2026-08-05 16:00+00'
     ) $$,
  $$ values ('create'::text) $$,
  'Reconnect-required replacement can claim without first overwriting its token'
);
select is(
  public.stage_google_calendar_replacement(
    '41000000-0000-4000-8000-000000000005', 'calendar-reconnect-missing',
    '44000000-0000-4000-8000-000000000001', 'calendar-reconnect-new',
    '2026-08-05 16:01+00'
  ), true,
  'Reconnect-required replacement stages through the same owner claim'
);
select is(
  public.complete_google_calendar_replacement(
    '41000000-0000-4000-8000-000000000005', 'calendar-reconnect-missing',
    '44000000-0000-4000-8000-000000000001', 'calendar-reconnect-new',
    '2026-08-05 16:02+00'
  ), 'completed',
  'Reconnect-required replacement completes before new token adoption'
);
select results_eq(
  $$ select status, calendar_id, refresh_token_envelope
     from public.google_calendar_connections
     where owner_id = '41000000-0000-4000-8000-000000000005' $$,
  $$ values ('reconnect_required'::text, 'calendar-reconnect-new'::text, '{}'::jsonb) $$,
  'Replacement completion preserves the retained status and envelope until callback adoption'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '41000000-0000-4000-8000-000000000006',
  'authenticated', 'authenticated', 'calendar-existing-cas@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
select results_eq(
  $$ select disposition from public.claim_google_calendar_setup(
       '41000000-0000-4000-8000-000000000006',
       '45000000-0000-4000-8000-000000000001', '2026-08-05 17:00+00'
     ) $$,
  $$ values ('create'::text) $$,
  'Initial setup wins only while no connection exists'
);
select is(
  public.stage_google_calendar_setup(
    '41000000-0000-4000-8000-000000000006',
    '45000000-0000-4000-8000-000000000001', 'calendar-staged',
    '2026-08-05 17:01+00'
  ), true,
  'The initial winner stages before finalization CAS'
);
insert into public.google_calendar_connections (
  owner_id, status, calendar_id, refresh_token_envelope, connected_at
) values (
  '41000000-0000-4000-8000-000000000006', 'connected',
  'calendar-existing-winner', '{}'::jsonb, '2026-08-05 17:01:30+00'
);
select is(
  public.complete_google_calendar_setup(
    '41000000-0000-4000-8000-000000000006',
    '45000000-0000-4000-8000-000000000001', 'calendar-staged',
    '{"version":1,"iv":"i","ciphertext":"c","tag":"t"}'::jsonb,
    '2026-08-05 17:02+00'
  ), 'stale_claim',
  'Setup finalization never overwrites an existing connection'
);
select results_eq(
  $$ select calendar_id, refresh_token_envelope
     from public.google_calendar_connections
     where owner_id = '41000000-0000-4000-8000-000000000006' $$,
  $$ values ('calendar-existing-winner'::text, '{}'::jsonb) $$,
  'The pre-existing connection remains byte-for-byte authoritative'
);
select results_eq(
  $$ select count(*) from public.google_calendar_setup_claims
     where owner_id = '41000000-0000-4000-8000-000000000006'
       and staged_calendar_id = 'calendar-staged' $$,
  $$ values (1::bigint) $$,
  'A stale finalization retains its staged claim for operator recovery'
);

select * from finish();
rollback;
