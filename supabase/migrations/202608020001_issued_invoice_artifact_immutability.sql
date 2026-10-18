create or replace function public.guard_issued_invoice()
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

  if old.issued_at is not null
    and old.artifact_path is not null
    and new.artifact_path is distinct from old.artifact_path then
    raise exception 'issued invoice artifact is immutable';
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

drop policy if exists invoice_artifacts_owner_update on storage.objects;
drop policy if exists invoice_artifacts_owner_delete on storage.objects;
