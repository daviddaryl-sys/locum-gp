create table public.google_calendar_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('connected', 'reconnect_required', 'disconnected')),
  calendar_id text not null,
  refresh_token_envelope jsonb,
  connected_at timestamptz not null,
  last_sync_at timestamptz,
  last_failure_at timestamptz,
  last_failure_category text check (last_failure_category in (
    'authorization', 'rate_limited', 'transient', 'calendar_missing', 'permanent'
  )),
  replacement_claim_token uuid,
  replacement_started_at timestamptz,
  replacement_lease_expires_at timestamptz,
  replacement_calendar_id text,
  updated_at timestamptz not null default now(),
  constraint google_calendar_token_state_check check (
    (status = 'disconnected' and refresh_token_envelope is null)
    or (status in ('connected', 'reconnect_required') and refresh_token_envelope is not null)
  ),
  constraint google_calendar_replacement_state_check check (
    (replacement_claim_token is null
      and replacement_started_at is null
      and replacement_lease_expires_at is null
      and replacement_calendar_id is null)
    or (replacement_claim_token is not null
      and replacement_started_at is not null
      and replacement_lease_expires_at is not null)
  )
);

create table public.google_calendar_event_links (
  owner_id uuid not null,
  session_id uuid not null,
  calendar_id text not null,
  event_id text not null,
  last_applied_revision bigint not null check (last_applied_revision > 0),
  state text not null check (state in ('active', 'cancelled', 'delete_pending')),
  updated_at timestamptz not null default now(),
  primary key (owner_id, session_id),
  unique (owner_id, calendar_id, event_id),
  foreign key (owner_id) references auth.users(id) on delete cascade,
  foreign key (owner_id, session_id)
    references public.session_records(owner_id, id) on delete cascade
);

create table public.google_calendar_sync_jobs (
  owner_id uuid not null,
  session_id uuid not null,
  desired_action text not null check (desired_action in ('upsert', 'delete')),
  target_revision bigint not null check (target_revision > 0),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_failure_category text check (last_failure_category in (
    'authorization', 'rate_limited', 'transient', 'calendar_missing', 'permanent'
  )),
  claim_token uuid,
  claimed_action text check (claimed_action in ('upsert', 'delete')),
  claimed_revision bigint check (claimed_revision > 0),
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_id, session_id),
  foreign key (owner_id) references auth.users(id) on delete cascade,
  foreign key (owner_id, session_id)
    references public.session_records(owner_id, id) on delete cascade,
  constraint google_calendar_job_claim_state_check check (
    (claim_token is null and claimed_action is null
      and claimed_revision is null and lease_expires_at is null)
    or (claim_token is not null and claimed_action is not null
      and claimed_revision is not null and lease_expires_at is not null)
  )
);

create table public.google_calendar_oauth_state_claims (
  owner_id uuid not null references auth.users(id) on delete cascade,
  state_digest text not null check (
    char_length(state_digest) = 43
    and state_digest ~ '^[A-Za-z0-9_-]{43}$'
  ),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, state_digest)
);

create table public.google_calendar_setup_claims (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  claim_token uuid not null,
  started_at timestamptz not null,
  lease_expires_at timestamptz not null,
  staged_calendar_id text,
  updated_at timestamptz not null,
  constraint google_calendar_setup_staged_id_check check (
    staged_calendar_id is null or char_length(staged_calendar_id) > 0
  )
);

create table public.google_calendar_owner_guards (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index google_calendar_jobs_due_idx
  on public.google_calendar_sync_jobs(owner_id, next_attempt_at, lease_expires_at);
create index google_calendar_oauth_state_claims_expiry_idx
  on public.google_calendar_oauth_state_claims(expires_at);
create index google_calendar_setup_claims_lease_idx
  on public.google_calendar_setup_claims(lease_expires_at);
create index google_calendar_connections_replacement_lease_idx
  on public.google_calendar_connections(replacement_lease_expires_at)
  where replacement_claim_token is not null;

create function public.claim_google_calendar_sync_jobs(
  requested_owner uuid,
  claimed_at timestamptz,
  lease_until timestamptz,
  requested_limit integer
)
returns table (
  owner_id uuid,
  session_id uuid,
  desired_action text,
  target_revision bigint,
  attempts integer,
  next_attempt_at timestamptz,
  claim_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_owner is null or claimed_at is null or lease_until <= claimed_at then
    return;
  end if;

  return query
  with candidates as (
    select job.owner_id, job.session_id
    from public.google_calendar_sync_jobs as job
    join public.google_calendar_connections as connection
      on connection.owner_id = job.owner_id
    where job.owner_id = requested_owner
      and connection.status = 'connected'
      and job.next_attempt_at <= claimed_at
      and (job.claim_token is null or job.lease_expires_at <= claimed_at)
    order by job.next_attempt_at, job.session_id
    for update of job skip locked
    limit least(greatest(coalesce(requested_limit, 0), 0), 25)
  ), claimed as (
    update public.google_calendar_sync_jobs as job
    set claim_token = gen_random_uuid(),
        claimed_action = job.desired_action,
        claimed_revision = job.target_revision,
        lease_expires_at = lease_until,
        updated_at = claimed_at
    from candidates
    where job.owner_id = candidates.owner_id
      and job.session_id = candidates.session_id
    returning job.owner_id, job.session_id, job.claimed_action,
      job.claimed_revision, job.attempts, job.next_attempt_at,
      job.claim_token, job.lease_expires_at
  )
  select claimed.owner_id, claimed.session_id, claimed.claimed_action,
    claimed.claimed_revision, claimed.attempts, claimed.next_attempt_at,
    claimed.claim_token, claimed.lease_expires_at
  from claimed;
end;
$$;

create function public.complete_google_calendar_upsert(
  requested_owner uuid,
  requested_session uuid,
  requested_claim uuid,
  requested_calendar text,
  requested_event text,
  requested_revision bigint,
  requested_state text,
  completed_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_action text;
  current_revision bigint;
  current_calendar text;
  completion_result text;
begin
  if requested_state not in ('active', 'cancelled') then
    raise exception 'Invalid Calendar event state';
  end if;
  select job.desired_action, job.target_revision
    into current_action, current_revision
    from public.google_calendar_sync_jobs as job
    where job.owner_id = requested_owner
      and job.session_id = requested_session
      and job.claim_token = requested_claim
      and job.claimed_action = 'upsert'
      and job.claimed_revision = requested_revision
    for update;
  if not found then
    return 'stale_claim';
  end if;

  select connection.calendar_id
    into current_calendar
    from public.google_calendar_connections as connection
    where connection.owner_id = requested_owner
      and connection.status = 'connected'
    for update;
  if current_calendar is distinct from requested_calendar then
    update public.google_calendar_sync_jobs
    set claim_token = null, claimed_action = null, claimed_revision = null,
        lease_expires_at = null, attempts = 0,
        next_attempt_at = completed_at, updated_at = completed_at
    where owner_id = requested_owner and session_id = requested_session
      and claim_token = requested_claim;
    return 'stale_calendar';
  end if;
  insert into public.google_calendar_event_links (
    owner_id, session_id, calendar_id, event_id,
    last_applied_revision, state, updated_at
  ) values (
    requested_owner, requested_session, requested_calendar, requested_event,
    requested_revision, requested_state, completed_at
  )
  on conflict (owner_id, session_id) do update set
    calendar_id = excluded.calendar_id,
    event_id = excluded.event_id,
    last_applied_revision = excluded.last_applied_revision,
    state = excluded.state,
    updated_at = excluded.updated_at
  where public.google_calendar_event_links.last_applied_revision
    <= excluded.last_applied_revision;
  if current_action = 'upsert' and current_revision = requested_revision then
    delete from public.google_calendar_sync_jobs
      where owner_id = requested_owner
        and session_id = requested_session
        and claim_token = requested_claim;
    completion_result := 'completed';
  else
    update public.google_calendar_sync_jobs
    set claim_token = null, claimed_action = null, claimed_revision = null,
        lease_expires_at = null, attempts = 0,
        next_attempt_at = completed_at, last_failure_category = null,
        updated_at = completed_at
    where owner_id = requested_owner and session_id = requested_session
      and claim_token = requested_claim;
    completion_result := 'superseded';
  end if;
  update public.google_calendar_connections
    set last_sync_at = completed_at, last_failure_at = null,
        last_failure_category = null, updated_at = completed_at
    where owner_id = requested_owner;
  return completion_result;
end;
$$;

create function public.complete_google_calendar_delete(
  requested_owner uuid,
  requested_session uuid,
  requested_claim uuid,
  requested_calendar text,
  requested_revision bigint,
  completed_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_action text;
  current_revision bigint;
  current_calendar text;
  completion_result text;
begin
  select job.desired_action, job.target_revision
    into current_action, current_revision
    from public.google_calendar_sync_jobs as job
    where job.owner_id = requested_owner
      and job.session_id = requested_session
      and job.claim_token = requested_claim
      and job.claimed_action = 'delete'
      and job.claimed_revision = requested_revision
    for update;
  if not found then
    return 'stale_claim';
  end if;

  select connection.calendar_id
    into current_calendar
    from public.google_calendar_connections as connection
    where connection.owner_id = requested_owner
      and connection.status = 'connected'
    for update;
  if current_calendar is distinct from requested_calendar then
    update public.google_calendar_sync_jobs
    set claim_token = null, claimed_action = null, claimed_revision = null,
        lease_expires_at = null, attempts = 0,
        next_attempt_at = completed_at, updated_at = completed_at
    where owner_id = requested_owner and session_id = requested_session
      and claim_token = requested_claim;
    return 'stale_calendar';
  end if;
  delete from public.google_calendar_event_links
    where owner_id = requested_owner
      and session_id = requested_session
      and last_applied_revision <= requested_revision;
  if current_action = 'delete' and current_revision = requested_revision then
    delete from public.google_calendar_sync_jobs
      where owner_id = requested_owner
        and session_id = requested_session
        and claim_token = requested_claim;
    completion_result := 'completed';
  else
    update public.google_calendar_sync_jobs
    set claim_token = null, claimed_action = null, claimed_revision = null,
        lease_expires_at = null, attempts = 0,
        next_attempt_at = completed_at, last_failure_category = null,
        updated_at = completed_at
    where owner_id = requested_owner and session_id = requested_session
      and claim_token = requested_claim;
    completion_result := 'superseded';
  end if;
  update public.google_calendar_connections
    set last_sync_at = completed_at, last_failure_at = null,
        last_failure_category = null, updated_at = completed_at
    where owner_id = requested_owner;
  return completion_result;
end;
$$;

create function public.retry_google_calendar_sync_job(
  requested_owner uuid,
  requested_session uuid,
  requested_claim uuid,
  requested_category text,
  requested_retry_at timestamptz,
  failed_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  desired_action_snapshot text;
  desired_revision_snapshot bigint;
  claimed_action_snapshot text;
  claimed_revision_snapshot bigint;
  attempt_snapshot integer;
begin
  if requested_category not in (
    'authorization', 'rate_limited', 'transient', 'calendar_missing', 'permanent'
  ) then
    raise exception 'Invalid Calendar failure category';
  end if;
  select job.desired_action, job.target_revision, job.claimed_action,
      job.claimed_revision, job.attempts
    into desired_action_snapshot, desired_revision_snapshot,
      claimed_action_snapshot, claimed_revision_snapshot, attempt_snapshot
    from public.google_calendar_sync_jobs as job
    where job.owner_id = requested_owner
      and job.session_id = requested_session
      and job.claim_token = requested_claim
    for update;
  if not found then
    return 'stale_claim';
  end if;

  if desired_action_snapshot = claimed_action_snapshot
      and desired_revision_snapshot = claimed_revision_snapshot then
    update public.google_calendar_sync_jobs
    set attempts = attempt_snapshot + 1,
        next_attempt_at = requested_retry_at,
        last_failure_category = requested_category,
        claim_token = null, claimed_action = null, claimed_revision = null,
        lease_expires_at = null, updated_at = failed_at
    where owner_id = requested_owner and session_id = requested_session
      and claim_token = requested_claim;
    return 'scheduled';
  end if;

  update public.google_calendar_sync_jobs
  set attempts = 0, next_attempt_at = failed_at,
      last_failure_category = null, claim_token = null,
      claimed_action = null, claimed_revision = null,
      lease_expires_at = null, updated_at = failed_at
  where owner_id = requested_owner and session_id = requested_session
    and claim_token = requested_claim;
  return 'superseded';
end;
$$;

create function public.claim_google_calendar_replacement(
  requested_owner uuid,
  requested_calendar text,
  requested_claim uuid,
  claimed_at timestamptz
)
returns table (disposition text, calendar_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.google_calendar_connections%rowtype;
begin
  select row.* into connection
  from public.google_calendar_connections as row
  where row.owner_id = requested_owner
  for update;
  if not found or connection.calendar_id <> requested_calendar then
    return query select 'stale'::text, null::text;
    return;
  end if;
  if connection.replacement_claim_token is null then
    update public.google_calendar_connections
    set replacement_claim_token = requested_claim,
        replacement_started_at = claimed_at,
        replacement_lease_expires_at = claimed_at + interval '5 minutes',
        replacement_calendar_id = null,
        updated_at = claimed_at
    where owner_id = requested_owner;
    return query select 'create'::text, null::text;
    return;
  end if;
  if connection.replacement_calendar_id is not null
     and connection.replacement_lease_expires_at <= claimed_at then
    update public.google_calendar_connections
    set replacement_claim_token = requested_claim,
        replacement_started_at = claimed_at,
        replacement_lease_expires_at = claimed_at + interval '5 minutes',
        updated_at = claimed_at
    where owner_id = requested_owner;
    return query select 'resume'::text, connection.replacement_calendar_id;
    return;
  end if;
  return query select 'busy'::text, null::text;
end;
$$;

create function public.claim_google_calendar_setup(
  requested_owner uuid,
  requested_claim uuid,
  claimed_at timestamptz
)
returns table (disposition text, calendar_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup public.google_calendar_setup_claims%rowtype;
begin
  if requested_owner is null or requested_claim is null or claimed_at is null then
    return;
  end if;

  insert into public.google_calendar_owner_guards (owner_id)
  values (requested_owner)
  on conflict (owner_id) do nothing;
  perform 1 from public.google_calendar_owner_guards
  where owner_id = requested_owner for update;

  perform 1 from public.google_calendar_connections
  where owner_id = requested_owner;
  if found then
    return query select 'busy'::text, null::text;
    return;
  end if;

  insert into public.google_calendar_setup_claims (
    owner_id, claim_token, started_at, lease_expires_at,
    staged_calendar_id, updated_at
  ) values (
    requested_owner, requested_claim, claimed_at,
    claimed_at + interval '5 minutes', null, claimed_at
  ) on conflict (owner_id) do nothing;
  if found then
    return query select 'create'::text, null::text;
    return;
  end if;

  select row.* into setup
  from public.google_calendar_setup_claims as row
  where row.owner_id = requested_owner
  for update;
  if setup.staged_calendar_id is not null
     and setup.lease_expires_at <= claimed_at then
    update public.google_calendar_setup_claims
    set claim_token = requested_claim, started_at = claimed_at,
        lease_expires_at = claimed_at + interval '5 minutes',
        updated_at = claimed_at
    where owner_id = requested_owner;
    return query select 'resume'::text, setup.staged_calendar_id;
    return;
  end if;
  return query select 'busy'::text, null::text;
end;
$$;

create function public.stage_google_calendar_setup(
  requested_owner uuid,
  requested_claim uuid,
  requested_calendar text,
  staged_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_calendar is null or char_length(requested_calendar) = 0 then
    return false;
  end if;
  update public.google_calendar_setup_claims
  set staged_calendar_id = requested_calendar, updated_at = staged_at
  where owner_id = requested_owner
    and claim_token = requested_claim
    and lease_expires_at > staged_at
    and staged_calendar_id is null;
  return found;
end;
$$;

create function public.complete_google_calendar_setup(
  requested_owner uuid,
  requested_claim uuid,
  requested_calendar text,
  requested_envelope jsonb,
  completed_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_envelope is null then
    return 'stale_claim';
  end if;
  insert into public.google_calendar_owner_guards (owner_id)
  values (requested_owner)
  on conflict (owner_id) do nothing;
  perform 1 from public.google_calendar_owner_guards
  where owner_id = requested_owner for update;

  if exists (
    select 1 from public.google_calendar_connections
    where owner_id = requested_owner
  ) then
    return 'stale_claim';
  end if;

  perform 1 from public.google_calendar_setup_claims
  where owner_id = requested_owner
    and claim_token = requested_claim
    and staged_calendar_id = requested_calendar
    and lease_expires_at > completed_at
  for update;
  if not found then
    return 'stale_claim';
  end if;

  insert into public.google_calendar_connections (
    owner_id, status, calendar_id, refresh_token_envelope,
    connected_at, updated_at
  ) values (
    requested_owner, 'connected', requested_calendar, requested_envelope,
    completed_at, completed_at
  ) on conflict (owner_id) do nothing;
  if not found then
    return 'stale_claim';
  end if;

  delete from public.google_calendar_setup_claims
  where owner_id = requested_owner
    and claim_token = requested_claim
    and staged_calendar_id = requested_calendar;
  if not found then
    raise exception 'Calendar setup claim changed';
  end if;
  return 'completed';
end;
$$;

create function public.release_google_calendar_setup(
  requested_owner uuid,
  requested_claim uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.google_calendar_setup_claims
  where owner_id = requested_owner
    and claim_token = requested_claim
    and staged_calendar_id is null;
  return found;
end;
$$;

create function public.stage_google_calendar_replacement(
  requested_owner uuid,
  requested_calendar text,
  requested_claim uuid,
  requested_replacement text,
  staged_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.google_calendar_connections
  set replacement_calendar_id = requested_replacement, updated_at = staged_at
  where owner_id = requested_owner
    and calendar_id = requested_calendar
    and replacement_claim_token = requested_claim
    and replacement_lease_expires_at > staged_at
    and replacement_calendar_id is null;
  return found;
end;
$$;

create function public.complete_google_calendar_replacement(
  requested_owner uuid,
  requested_calendar text,
  requested_claim uuid,
  requested_replacement text,
  completed_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.google_calendar_connections
  where owner_id = requested_owner
    and calendar_id = requested_calendar
    and replacement_claim_token = requested_claim
    and replacement_calendar_id = requested_replacement
    and replacement_lease_expires_at > completed_at
  for update;
  if not found then
    if exists (
      select 1 from public.google_calendar_connections
      where owner_id = requested_owner
        and calendar_id = requested_replacement
        and replacement_claim_token is null
    ) then
      return 'completed';
    end if;
    return 'stale_claim';
  end if;

  update public.google_calendar_connections
  set calendar_id = requested_replacement, connected_at = completed_at,
      replacement_claim_token = null, replacement_started_at = null,
      replacement_lease_expires_at = null,
      replacement_calendar_id = null, last_failure_at = null,
      last_failure_category = null, updated_at = completed_at
  where owner_id = requested_owner;
  delete from public.google_calendar_event_links where owner_id = requested_owner;
  delete from public.google_calendar_sync_jobs where owner_id = requested_owner;
  return 'completed';
end;
$$;

create function public.release_google_calendar_replacement(
  requested_owner uuid,
  requested_calendar text,
  requested_claim uuid,
  released_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.google_calendar_connections
  set replacement_claim_token = null, replacement_started_at = null,
      replacement_lease_expires_at = null,
      updated_at = released_at
  where owner_id = requested_owner
    and calendar_id = requested_calendar
    and replacement_claim_token = requested_claim
    and replacement_calendar_id is null;
  return found;
end;
$$;

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_event_links enable row level security;
alter table public.google_calendar_sync_jobs enable row level security;
alter table public.google_calendar_oauth_state_claims enable row level security;
alter table public.google_calendar_setup_claims enable row level security;
alter table public.google_calendar_owner_guards enable row level security;

revoke all on public.google_calendar_connections from public, anon, authenticated;
revoke all on public.google_calendar_event_links from public, anon, authenticated;
revoke all on public.google_calendar_sync_jobs from public, anon, authenticated;
revoke all on public.google_calendar_oauth_state_claims from public, anon, authenticated;
revoke all on public.google_calendar_setup_claims from public, anon, authenticated;
revoke all on public.google_calendar_owner_guards from public, anon, authenticated;
grant select, insert, update, delete on public.google_calendar_connections to service_role;
grant select, insert, update, delete on public.google_calendar_event_links to service_role;
grant select, insert, update, delete on public.google_calendar_sync_jobs to service_role;
grant select, insert, delete on public.google_calendar_oauth_state_claims to service_role;
grant select, insert, update, delete on public.google_calendar_setup_claims to service_role;
grant select, insert on public.google_calendar_owner_guards to service_role;
revoke all on function public.claim_google_calendar_sync_jobs(uuid,timestamptz,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.complete_google_calendar_upsert(uuid,uuid,uuid,text,text,bigint,text,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_google_calendar_delete(uuid,uuid,uuid,text,bigint,timestamptz) from public, anon, authenticated;
revoke all on function public.retry_google_calendar_sync_job(uuid,uuid,uuid,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.claim_google_calendar_replacement(uuid,text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.stage_google_calendar_replacement(uuid,text,uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_google_calendar_replacement(uuid,text,uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.release_google_calendar_replacement(uuid,text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.claim_google_calendar_setup(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.stage_google_calendar_setup(uuid,uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_google_calendar_setup(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.release_google_calendar_setup(uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_google_calendar_sync_jobs(uuid,timestamptz,timestamptz,integer) to service_role;
grant execute on function public.complete_google_calendar_upsert(uuid,uuid,uuid,text,text,bigint,text,timestamptz) to service_role;
grant execute on function public.complete_google_calendar_delete(uuid,uuid,uuid,text,bigint,timestamptz) to service_role;
grant execute on function public.retry_google_calendar_sync_job(uuid,uuid,uuid,text,timestamptz,timestamptz) to service_role;
grant execute on function public.claim_google_calendar_replacement(uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.stage_google_calendar_replacement(uuid,text,uuid,text,timestamptz) to service_role;
grant execute on function public.complete_google_calendar_replacement(uuid,text,uuid,text,timestamptz) to service_role;
grant execute on function public.release_google_calendar_replacement(uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.claim_google_calendar_setup(uuid,uuid,timestamptz) to service_role;
grant execute on function public.stage_google_calendar_setup(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.complete_google_calendar_setup(uuid,uuid,text,jsonb,timestamptz) to service_role;
grant execute on function public.release_google_calendar_setup(uuid,uuid) to service_role;

create view public.admin_google_calendar_health
with (security_invoker = true)
as
select
  connection.owner_id as account_id,
  connection.status as connection_status,
  count(job.session_id)::bigint as pending_job_count,
  connection.last_sync_at,
  connection.last_failure_at
from public.google_calendar_connections as connection
left join public.google_calendar_sync_jobs as job
  on job.owner_id = connection.owner_id
group by connection.owner_id, connection.status,
  connection.last_sync_at, connection.last_failure_at;

revoke all on public.admin_google_calendar_health from public, anon, authenticated;
grant select on public.admin_google_calendar_health to service_role;

comment on table public.google_calendar_connections is
  'Server-only owner Calendar authorization state; token value is encrypted by the application.';
comment on table public.google_calendar_event_links is
  'Opaque owner/session to app-created Google event mappings.';
comment on table public.google_calendar_sync_jobs is
  'Coalesced latest desired Google Calendar action and bounded worker claim; never stores event payloads.';
comment on table public.google_calendar_oauth_state_claims is
  'Server-only, owner-scoped one-time OAuth state digests; contains no plaintext authorization data.';
comment on table public.google_calendar_setup_claims is
  'Server-only durable owner claim for initial app-created Calendar setup; never stores authorization secrets.';
comment on table public.google_calendar_owner_guards is
  'Persistent server-only per-owner serialization guard; contains no provider or authorization data.';
