#!/bin/sh
set -eu

: "${CALENDAR_DB_CONTAINER:?Set CALENDAR_DB_CONTAINER to the disposable Supabase database container}"

concurrency_tmp="$(mktemp -d)"
cleanup() {
  docker exec "$CALENDAR_DB_CONTAINER" psql -X -U postgres -d postgres -qAtc \
    "delete from auth.users where id = '46000000-0000-4000-8000-000000000001'" \
    >/dev/null 2>&1 || true
  find "$concurrency_tmp" -depth -delete
}
trap cleanup EXIT HUP INT TERM

docker exec -i "$CALENDAR_DB_CONTAINER" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt >/dev/null <<'SQL'
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '46000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'calendar-guard@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
select disposition from public.claim_google_calendar_setup(
  '46000000-0000-4000-8000-000000000001',
  '46100000-0000-4000-8000-000000000001', '2026-08-05 18:00+00'
);
select public.stage_google_calendar_setup(
  '46000000-0000-4000-8000-000000000001',
  '46100000-0000-4000-8000-000000000001', 'calendar-guard',
  '2026-08-05 18:01+00'
);
SQL

docker exec -i -e PGAPPNAME=calendar-guard-finalizer "$CALENDAR_DB_CONTAINER" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt \
  >"$concurrency_tmp/finalizer.out" 2>"$concurrency_tmp/finalizer.err" <<'SQL' &
begin;
select public.complete_google_calendar_setup(
  '46000000-0000-4000-8000-000000000001',
  '46100000-0000-4000-8000-000000000001', 'calendar-guard',
  '{"version":1,"iv":"i","ciphertext":"c","tag":"t"}'::jsonb,
  '2026-08-05 18:02+00'
);
select pg_sleep(3);
commit;
SQL
finalizer_pid=$!

finalizer_ready=0
attempt=0
while [ "$attempt" -lt 50 ]; do
  if docker exec "$CALENDAR_DB_CONTAINER" psql -X -U postgres -d postgres -qAtc \
    "select count(*) from pg_stat_activity where application_name = 'calendar-guard-finalizer' and query like 'select pg_sleep%'" \
    | grep -qx '1'; then
    finalizer_ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.05
done
test "$finalizer_ready" -eq 1

docker exec -i -e PGAPPNAME=calendar-guard-waiter "$CALENDAR_DB_CONTAINER" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt \
  >"$concurrency_tmp/waiter.out" 2>"$concurrency_tmp/waiter.err" <<'SQL' &
begin;
select disposition, calendar_id from public.claim_google_calendar_setup(
  '46000000-0000-4000-8000-000000000001',
  '46100000-0000-4000-8000-000000000002', '2026-08-05 18:03+00'
);
commit;
SQL
waiter_pid=$!

waiter_blocked=0
attempt=0
while [ "$attempt" -lt 50 ]; do
  if docker exec "$CALENDAR_DB_CONTAINER" psql -X -U postgres -d postgres -qAtc \
    "select count(*) from pg_stat_activity where application_name = 'calendar-guard-waiter' and wait_event_type = 'Lock'" \
    | grep -qx '1'; then
    waiter_blocked=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.05
done

wait "$finalizer_pid"
wait "$waiter_pid"
test "$waiter_blocked" -eq 1
grep -qx 'completed' "$concurrency_tmp/finalizer.out"
if ! grep -qx 'busy|' "$concurrency_tmp/waiter.out"; then
  echo "not ok - waiter returned $(tr -d '\n' <"$concurrency_tmp/waiter.out") after blocking" >&2
  exit 1
fi
test "$(docker exec "$CALENDAR_DB_CONTAINER" psql -X -U postgres -d postgres -qAtc \
  "select count(*) from public.google_calendar_owner_guards where owner_id = '46000000-0000-4000-8000-000000000001'")" = '1'

echo "ok - waiter blocked on the durable owner guard and returned busy after finalization"
