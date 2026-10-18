create or replace function public.delete_owned_demo_data()
returns table(object_key text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_owner uuid := auth.uid();
  cleanup_time timestamptz := now();
begin
  if requested_owner is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
    select e.receipt_object_key
    from public.expense_records e
    where e.owner_id = requested_owner
      and e.is_demo
      and e.receipt_object_key is not null;

  update public.practice_records p
  set is_demo = false, revision = revision + 1, updated_at = cleanup_time
  where p.owner_id = requested_owner and p.is_demo and p.deleted_at is null
    and (
      exists (
        select 1 from public.session_records s
        where s.owner_id = p.owner_id and s.practice_id = p.id
          and not s.is_demo and s.deleted_at is null
      )
      or exists (
        select 1 from public.invoice_records i
        where i.owner_id = p.owner_id and i.practice_id = p.id
          and not i.is_demo and i.deleted_at is null
      )
      or exists (
        select 1 from public.expense_records e
        where e.owner_id = p.owner_id and e.practice_id = p.id
          and not e.is_demo and e.deleted_at is null
      )
    );

  update public.expense_category_records c
  set is_demo = false, revision = revision + 1, updated_at = cleanup_time
  where c.owner_id = requested_owner and c.is_demo and c.deleted_at is null
    and exists (
      select 1 from public.expense_records e
      where e.owner_id = c.owner_id and e.custom_category_id = c.id
        and not e.is_demo and e.deleted_at is null
    );

  update public.invoice_item_records
  set deleted_at = cleanup_time, revision = revision + 1, updated_at = cleanup_time
  where owner_id = requested_owner and is_demo and deleted_at is null;

  update public.invoice_records
  set deleted_at = cleanup_time, revision = revision + 1, updated_at = cleanup_time
  where owner_id = requested_owner and is_demo and deleted_at is null;

  update public.session_records
  set deleted_at = cleanup_time, revision = revision + 1, updated_at = cleanup_time
  where owner_id = requested_owner and is_demo and deleted_at is null;

  update public.expense_records
  set deleted_at = cleanup_time, revision = revision + 1, updated_at = cleanup_time,
      receipt_sync_status = case
        when receipt_object_key is null then 'none'
        else 'delete-pending'
      end
  where owner_id = requested_owner and is_demo and deleted_at is null;

  update public.expense_category_records
  set deleted_at = cleanup_time, revision = revision + 1, updated_at = cleanup_time
  where owner_id = requested_owner and is_demo and deleted_at is null;

  update public.practice_records
  set deleted_at = cleanup_time, revision = revision + 1, updated_at = cleanup_time
  where owner_id = requested_owner and is_demo and deleted_at is null;

  insert into public.demo_seed_state (owner_id, seed_version, demo_deleted_at)
  values (requested_owner, 1, cleanup_time)
  on conflict (owner_id) do update
  set demo_deleted_at = coalesce(public.demo_seed_state.demo_deleted_at, excluded.demo_deleted_at);
end;
$$;

revoke all on function public.delete_owned_demo_data() from public, anon;
grant execute on function public.delete_owned_demo_data() to authenticated;
