create table public.invoice_sequences (
  owner_id uuid not null references auth.users (id) on delete cascade,
  invoice_year integer not null check (invoice_year between 2000 and 9999),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, invoice_year)
);

alter table public.invoice_sequences enable row level security;

revoke all on public.invoice_sequences from public, anon, authenticated;

alter table public.invoice_records
  add column practice_id uuid,
  add constraint invoice_records_practice_owner_fk
    foreign key (owner_id, practice_id)
    references public.practice_records (owner_id, id);

create unique index invoice_item_records_active_session_idx
  on public.invoice_item_records (owner_id, session_id)
  where session_id is not null and deleted_at is null;

create function public.guard_issued_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.issued_at is not null and current_user <> 'postgres' then
      raise exception 'Only atomic issuance can issue an invoice';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.issued_at is not null then
      raise exception 'issued invoice content is immutable';
    end if;
    return old;
  end if;

  if old.issued_at is null and new.issued_at is not null and current_user <> 'postgres' then
    raise exception 'Only atomic issuance can issue an invoice';
  end if;

  if old.issued_at is not null and (
    new.id is distinct from old.id
    or new.owner_id is distinct from old.owner_id
    or new.deleted_at is distinct from old.deleted_at
    or new.invoice_number is distinct from old.invoice_number
    or new.issue_date is distinct from old.issue_date
    or new.due_date is distinct from old.due_date
    or new.total_pence is distinct from old.total_pence
    or new.practice_snapshot is distinct from old.practice_snapshot
    or new.payment_snapshot is distinct from old.payment_snapshot
    or new.issued_at is distinct from old.issued_at
  ) then
    raise exception 'issued invoice content is immutable';
  end if;

  return new;
end;
$$;

create trigger guard_issued_invoice_content
before insert or update or delete on public.invoice_records
for each row execute function public.guard_issued_invoice();

create function public.guard_issued_invoice_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  invoice_was_issued boolean;
begin
  select invoice.issued_at is not null
  into invoice_was_issued
  from public.invoice_records as invoice
  where invoice.id = coalesce(new.invoice_id, old.invoice_id)
    and invoice.owner_id = coalesce(new.owner_id, old.owner_id);

  if coalesce(invoice_was_issued, false) then
    raise exception 'issued invoice line items are immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_issued_invoice_item_content
before insert or update or delete on public.invoice_item_records
for each row execute function public.guard_issued_invoice_item();

create function public.issue_invoice(
  requested_invoice_id uuid,
  requested_practice_id uuid,
  requested_issue_date date,
  requested_payment_snapshot jsonb,
  requested_items jsonb,
  requested_prefix text default 'INV'
)
returns setof public.invoice_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  draft public.invoice_records%rowtype;
  practice public.practice_records%rowtype;
  session_record public.session_records%rowtype;
  item jsonb;
  item_id uuid;
  item_session_id uuid;
  item_description text;
  item_quantity numeric(12, 4);
  item_unit_rate_pence bigint;
  item_line_total_pence bigint;
  computed_total_pence bigint := 0;
  sequence_year integer;
  next_sequence bigint;
  invoice_number_value text;
begin
  if caller_id is null then
    raise exception 'Authentication is required';
  end if;

  if requested_issue_date is null then
    raise exception 'An issue date is required';
  end if;

  requested_prefix := upper(trim(requested_prefix));
  if requested_prefix !~ '^[A-Z0-9]{1,10}$' then
    raise exception 'Invoice prefix must contain 1 to 10 letters or digits';
  end if;

  select invoice.*
  into draft
  from public.invoice_records as invoice
  where invoice.id = requested_invoice_id
    and invoice.owner_id = caller_id
    and invoice.deleted_at is null
    and invoice.issued_at is null
    and invoice.status = 'draft'
  for update;

  if not found then
    raise exception 'An owned draft invoice is required';
  end if;

  select candidate.*
  into practice
  from public.practice_records as candidate
  where candidate.id = requested_practice_id
    and candidate.owner_id = caller_id
    and candidate.deleted_at is null;

  if not found then
    raise exception 'An owned practice is required';
  end if;

  if jsonb_typeof(requested_payment_snapshot) <> 'object'
    or jsonb_typeof(requested_payment_snapshot -> 'ciphertext') <> 'string'
    or jsonb_typeof(requested_payment_snapshot -> 'salt') <> 'string'
    or jsonb_typeof(requested_payment_snapshot -> 'initializationVector') <> 'string'
    or jsonb_typeof(requested_payment_snapshot -> 'kdfParameters') <> 'object'
    or requested_payment_snapshot ?| array['accountName', 'sortCode', 'accountNumber'] then
    raise exception 'An encrypted payment snapshot is required';
  end if;

  if jsonb_typeof(requested_items) <> 'array'
    or jsonb_array_length(requested_items) = 0 then
    raise exception 'At least one invoice item is required';
  end if;

  update public.invoice_item_records
  set
    deleted_at = now(),
    revision = revision + 1,
    updated_at = now()
  where owner_id = caller_id
    and invoice_id = requested_invoice_id
    and deleted_at is null;

  for item in select value from jsonb_array_elements(requested_items)
  loop
    item_id := extensions.gen_random_uuid();
    item_description := trim(item ->> 'description');

    if item_description is null or item_description = '' then
      raise exception 'Every invoice item requires a description';
    end if;

    if item ? 'sessionId' and nullif(item ->> 'sessionId', '') is not null then
      begin
        item_session_id := (item ->> 'sessionId')::uuid;
      exception when invalid_text_representation then
        raise exception 'Every linked session ID must be a UUID';
      end;

      select candidate.*
      into session_record
      from public.session_records as candidate
      where candidate.id = item_session_id
        and candidate.owner_id = caller_id
        and candidate.practice_id = requested_practice_id
        and candidate.deleted_at is null
        and candidate.status = 'completed'
      for update;

      if not found then
        raise exception 'Each linked session must be completed and uninvoiced';
      end if;

      item_quantity := round(
        (extract(epoch from (session_record.ends_at - session_record.starts_at)) / 3600)::numeric,
        4
      );
      item_unit_rate_pence := session_record.hourly_rate_pence;
    else
      item_session_id := null;
      begin
        item_quantity := (item ->> 'quantity')::numeric(12, 4);
        item_unit_rate_pence := (item ->> 'unitRatePence')::bigint;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Every extra item requires a valid quantity and unit rate';
      end;

      if item_quantity is null or item_quantity <= 0
        or item_unit_rate_pence is null or item_unit_rate_pence < 0 then
        raise exception 'Every extra item requires a positive quantity and non-negative unit rate';
      end if;
    end if;

    item_line_total_pence := round(item_quantity * item_unit_rate_pence);
    computed_total_pence := computed_total_pence + item_line_total_pence;

    insert into public.invoice_item_records (
      id,
      owner_id,
      invoice_id,
      session_id,
      description,
      quantity,
      unit_rate_pence,
      line_total_pence
    ) values (
      item_id,
      caller_id,
      requested_invoice_id,
      item_session_id,
      item_description,
      item_quantity,
      item_unit_rate_pence,
      item_line_total_pence
    );

    if item_session_id is not null then
      update public.session_records
      set
        status = 'invoiced',
        revision = revision + 1,
        updated_at = now()
      where id = item_session_id
        and owner_id = caller_id;
    end if;
  end loop;

  sequence_year := extract(year from requested_issue_date)::integer;

  insert into public.invoice_sequences (owner_id, invoice_year, last_value)
  values (caller_id, sequence_year, 0)
  on conflict (owner_id, invoice_year) do nothing;

  select sequence.last_value + 1
  into next_sequence
  from public.invoice_sequences as sequence
  where sequence.owner_id = caller_id
    and sequence.invoice_year = sequence_year
  for update;

  update public.invoice_sequences
  set
    last_value = next_sequence,
    updated_at = now()
  where owner_id = caller_id
    and invoice_year = sequence_year;

  invoice_number_value := requested_prefix
    || '-'
    || sequence_year::text
    || '-'
    || lpad(next_sequence::text, 4, '0');

  update public.invoice_records
  set
    revision = revision + 1,
    updated_at = now(),
    invoice_number = invoice_number_value,
    practice_id = requested_practice_id,
    issue_date = requested_issue_date,
    due_date = requested_issue_date + practice.payment_terms_days,
    total_pence = computed_total_pence,
    practice_snapshot = jsonb_build_object(
      'id', practice.id,
      'name', practice.name,
      'billingAddress', practice.billing_address,
      'paymentTermsDays', practice.payment_terms_days
    ),
    payment_snapshot = requested_payment_snapshot,
    issued_at = now()
  where id = requested_invoice_id
    and owner_id = caller_id;

  return query
  select invoice.*
  from public.invoice_records as invoice
  where invoice.id = requested_invoice_id
    and invoice.owner_id = caller_id;
end;
$$;

revoke all on function public.guard_issued_invoice() from public, anon, authenticated;
revoke all on function public.guard_issued_invoice_item() from public, anon, authenticated;
revoke all on function public.issue_invoice(uuid, uuid, date, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.issue_invoice(uuid, uuid, date, jsonb, jsonb, text)
  to authenticated;

insert into storage.buckets (id, name, public)
values ('invoice-artifacts', 'invoice-artifacts', false)
on conflict (id) do update set public = false;

create policy invoice_artifacts_owner_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'invoice-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy invoice_artifacts_owner_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'invoice-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy invoice_artifacts_owner_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'invoice-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'invoice-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy invoice_artifacts_owner_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'invoice-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
