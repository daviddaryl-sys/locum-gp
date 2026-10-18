alter table public.encrypted_bank_settings
  drop constraint encrypted_bank_settings_vault_all_or_none;

alter table public.encrypted_bank_settings
  add constraint encrypted_bank_settings_envelope_all_or_none
  check (
    (
      ciphertext is null and salt is null and initialization_vector is null
      and kdf_parameters is null and encryption_version is null
    )
    or
    (
      ciphertext is not null and length(ciphertext) > 0
      and salt is not null and length(salt) > 0
      and initialization_vector is not null and length(initialization_vector) > 0
      and kdf_parameters is not null
      and encryption_version in (1, 2)
    )
  );

create function public.canonical_base64_decoded_length(candidate text)
returns integer
language plpgsql
immutable
returns null on null input
set search_path = ''
as $$
declare
  decoded bytea;
begin
  decoded := pg_catalog.decode(candidate, 'base64');
  if pg_catalog.replace(pg_catalog.encode(decoded, 'base64'), pg_catalog.chr(10), '') <> candidate then
    return null;
  end if;
  return pg_catalog.octet_length(decoded);
exception when others then
  return null;
end;
$$;

revoke all on function public.canonical_base64_decoded_length(text) from public, anon;
grant execute on function public.canonical_base64_decoded_length(text) to authenticated;

create function public.guard_encrypted_bank_settings_v2()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.encryption_version = 2 then
    if public.canonical_base64_decoded_length(new.ciphertext) is null
      or public.canonical_base64_decoded_length(new.ciphertext) <= 16
      or public.canonical_base64_decoded_length(new.salt) is distinct from 16
      or public.canonical_base64_decoded_length(new.initialization_vector) is distinct from 12
      or new.kdf_parameters <> '{"name":"HKDF","hash":"SHA-256","info":"locum-manager-payment:v2"}'::jsonb
      or pg_catalog.jsonb_typeof(new.profile) <> 'object'
      or exists (
        select 1 from pg_catalog.jsonb_each(new.profile) as field
        where field.key not in ('profession', 'doctorName', 'tradingName', 'address', 'email')
          or pg_catalog.jsonb_typeof(field.value) <> 'string'
      )
      or (new.profile ? 'profession' and new.profile ->> 'profession' not in ('gp', 'pharmacist'))
      or (new.profile ? 'doctorName' and pg_catalog.length(pg_catalog.btrim(new.profile ->> 'doctorName')) = 0)
      or (new.profile ? 'address' and pg_catalog.length(pg_catalog.btrim(new.profile ->> 'address')) = 0)
      or (new.profile ? 'email' and (new.profile ->> 'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
      raise exception 'Version 2 payment settings require canonical encrypted and public profile fields';
    end if;
  end if;

  if tg_op = 'DELETE' then
    if old.encryption_version = 2 and pg_trigger_depth() <= 1 then
      raise exception 'Version 2 payment settings cannot be downgraded or deleted';
    end if;
    return old;
  end if;

  if old.encryption_version = 2 and (new.encryption_version <> 2 or new.deleted_at is not null) then
    raise exception 'Version 2 payment settings cannot be downgraded or deleted';
  end if;
  return new;
end;
$$;

create trigger guard_encrypted_bank_settings_v2_transition
before insert or update or delete on public.encrypted_bank_settings
for each row execute function public.guard_encrypted_bank_settings_v2();

revoke all on function public.guard_encrypted_bank_settings_v2() from public, anon, authenticated;

create function public.payment_snapshot_contains_plaintext_key(candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item_key text;
  item_value jsonb;
begin
  if candidate is null then return false; end if;
  if pg_catalog.jsonb_typeof(candidate) = 'object' then
    for item_key, item_value in select entry.key, entry.value from pg_catalog.jsonb_each(candidate) as entry loop
      if pg_catalog.lower(item_key) = any(array[
        'accountname', 'sortcode', 'accountnumber', 'account_name', 'sort_code', 'account_number'
      ]) then return true; end if;
      if public.payment_snapshot_contains_plaintext_key(item_value) then return true; end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(candidate) = 'array' then
    for item_value in select entry.value from pg_catalog.jsonb_array_elements(candidate) as entry loop
      if public.payment_snapshot_contains_plaintext_key(item_value) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;

create function public.payment_snapshot_is_valid_v2(candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  issuer jsonb;
begin
  if candidate is null
    or pg_catalog.jsonb_typeof(candidate) <> 'object'
    or not candidate ?& array['version', 'ciphertext', 'salt', 'initializationVector', 'kdfParameters']
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(candidate) as field(key_name)
      where field.key_name not in ('version', 'ciphertext', 'salt', 'initializationVector', 'kdfParameters', 'issuer')
    )
    or candidate -> 'version' <> '2'::jsonb
    or pg_catalog.jsonb_typeof(candidate -> 'ciphertext') <> 'string'
    or public.canonical_base64_decoded_length(candidate ->> 'ciphertext') is null
    or public.canonical_base64_decoded_length(candidate ->> 'ciphertext') <= 16
    or pg_catalog.jsonb_typeof(candidate -> 'salt') <> 'string'
    or public.canonical_base64_decoded_length(candidate ->> 'salt') is distinct from 16
    or pg_catalog.jsonb_typeof(candidate -> 'initializationVector') <> 'string'
    or public.canonical_base64_decoded_length(candidate ->> 'initializationVector') is distinct from 12
    or candidate -> 'kdfParameters' <> pg_catalog.jsonb_build_object(
      'name', 'HKDF', 'hash', 'SHA-256', 'info', 'locum-manager-payment:v2'
    )
    or public.payment_snapshot_contains_plaintext_key(candidate) then
    return false;
  end if;

  if candidate ? 'issuer' then
    issuer := candidate -> 'issuer';
    if pg_catalog.jsonb_typeof(issuer) <> 'object'
      or not issuer ?& array['doctorName', 'tradingName', 'address', 'email']
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(issuer) as field(key_name)
        where field.key_name not in ('doctorName', 'tradingName', 'address', 'email')
      )
      or pg_catalog.jsonb_typeof(issuer -> 'doctorName') <> 'string'
      or pg_catalog.length(pg_catalog.btrim(issuer ->> 'doctorName')) = 0
      or pg_catalog.jsonb_typeof(issuer -> 'tradingName') <> 'string'
      or pg_catalog.jsonb_typeof(issuer -> 'address') <> 'string'
      or pg_catalog.length(pg_catalog.btrim(issuer ->> 'address')) = 0
      or pg_catalog.jsonb_typeof(issuer -> 'email') <> 'string'
      or (issuer ->> 'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      return false;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.payment_snapshot_contains_plaintext_key(jsonb) from public, anon;
revoke all on function public.payment_snapshot_is_valid_v2(jsonb) from public, anon;
grant execute on function public.payment_snapshot_contains_plaintext_key(jsonb) to authenticated;
grant execute on function public.payment_snapshot_is_valid_v2(jsonb) to authenticated;

create or replace function public.guard_issued_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.issued_at is not null and not public.payment_snapshot_is_valid_v2(new.payment_snapshot) then
      raise exception 'An exact version 2 encrypted payment snapshot is required';
    end if;
    if new.issued_at is not null and current_user <> 'postgres' then
      raise exception 'Only atomic issuance can issue an invoice';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.issued_at is not null then raise exception 'issued invoice content is immutable'; end if;
    return old;
  end if;

  if old.issued_at is null and new.issued_at is not null then
    if not public.payment_snapshot_is_valid_v2(new.payment_snapshot) then
      raise exception 'An exact version 2 encrypted payment snapshot is required';
    end if;
    if current_user <> 'postgres' then raise exception 'Only atomic issuance can issue an invoice'; end if;
  end if;

  if old.issued_at is not null and old.artifact_path is not null
    and new.artifact_path is distinct from old.artifact_path then
    raise exception 'issued invoice artifact is immutable';
  end if;

  if old.issued_at is not null and (
    new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
    or new.deleted_at is distinct from old.deleted_at
    or new.invoice_number is distinct from old.invoice_number
    or new.issue_date is distinct from old.issue_date or new.due_date is distinct from old.due_date
    or new.total_pence is distinct from old.total_pence
    or new.practice_snapshot is distinct from old.practice_snapshot
    or new.payment_snapshot is distinct from old.payment_snapshot
    or new.issued_at is distinct from old.issued_at
  ) then raise exception 'issued invoice content is immutable'; end if;
  return new;
end;
$$;

revoke all on function public.guard_issued_invoice() from public, anon, authenticated;
