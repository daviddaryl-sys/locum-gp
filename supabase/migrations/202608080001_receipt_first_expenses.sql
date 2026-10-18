alter table public.expense_records
  add column expense_kind text,
  add column journey_origin text,
  add column journey_destination text,
  add column distance_miles numeric(8, 2),
  add column mileage_rate_pence integer,
  add column linked_session_id uuid;

update public.expense_records
set expense_kind = 'standard'
where expense_kind is null;

alter table public.expense_records
  alter column expense_kind set default 'standard',
  alter column expense_kind set not null,
  add constraint expense_kind_check
    check (expense_kind in ('standard', 'mileage')),
  add constraint expense_mileage_fields_consistent
    check (
      (
        expense_kind = 'standard'
        and journey_origin is null
        and journey_destination is null
        and distance_miles is null
        and mileage_rate_pence is null
        and linked_session_id is null
      )
      or
      (
        expense_kind = 'mileage'
        and journey_origin is not null
        and length(trim(journey_origin)) > 0
        and journey_destination is not null
        and length(trim(journey_destination)) > 0
        and distance_miles is not null
        and distance_miles > 0
        and mileage_rate_pence is not null
        and mileage_rate_pence > 0
      )
    );

create function public.validate_expense_linked_session_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.linked_session_id is not null and not exists (
    select 1
    from public.session_records
    where id = new.linked_session_id
      and owner_id = new.owner_id
  ) then
    raise foreign_key_violation
      using message = 'Linked session must belong to the expense owner.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_expense_linked_session_owner()
  from public, anon, authenticated;

create trigger expense_linked_session_owner_check
before insert or update of owner_id, linked_session_id
on public.expense_records
for each row
execute function public.validate_expense_linked_session_owner();

comment on column public.expense_records.expense_kind is
  'Standard or mileage expense. Existing records are backfilled as standard.';
comment on column public.expense_records.distance_miles is
  'User-confirmed business journey distance for a mileage expense.';
comment on column public.expense_records.mileage_rate_pence is
  'User-confirmed whole-pence rate per mile for a mileage expense.';
comment on column public.expense_records.linked_session_id is
  'Optional same-owner session, including a soft-deleted historical session; validated by an owner-aware trigger.';
