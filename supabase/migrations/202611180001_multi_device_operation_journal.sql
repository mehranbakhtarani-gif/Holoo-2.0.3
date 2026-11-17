-- Multi-device operation journal for the single-company Holoo deployment.
-- This migration intentionally does NOT alter policies or RLS on public.holoo_sync.
-- Apply only after taking a verified database backup.

create table if not exists public.holoo_operation_log (
  operation_id uuid primary key,
  company_record_id text not null,
  actor text not null check (actor in ('mehran', 'ehsan')),
  device_id text not null,
  device_sequence bigint not null,
  operation_type text not null,
  summary text not null default '',
  client_created_at timestamptz not null,
  server_applied_at timestamptz not null default clock_timestamp(),
  server_updated_at timestamptz not null
);

create index if not exists holoo_operation_log_company_time_idx
  on public.holoo_operation_log (company_record_id, server_applied_at desc);

create index if not exists holoo_operation_log_device_sequence_idx
  on public.holoo_operation_log (device_id, device_sequence);

create or replace function public.reject_holoo_operation_log_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'holoo_operation_log is append-only';
end;
$$;

drop trigger if exists holoo_operation_log_immutable on public.holoo_operation_log;
create trigger holoo_operation_log_immutable
before update or delete on public.holoo_operation_log
for each row execute function public.reject_holoo_operation_log_mutation();

revoke all on table public.holoo_operation_log from public, anon, authenticated;
grant select, insert on table public.holoo_operation_log to anon, authenticated;

create or replace function public.holoo_apply_state_operation(
  p_record_id text,
  p_expected_updated_at timestamptz,
  p_data jsonb,
  p_operation_id uuid,
  p_actor text,
  p_device_id text,
  p_device_sequence bigint,
  p_operation_type text,
  p_summary text,
  p_client_created_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_updated_at timestamptz;
  v_existing public.holoo_operation_log%rowtype;
begin
  if p_record_id is null or p_record_id = '' then
    raise exception 'record id is required';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'state payload must be a JSON object';
  end if;
  if p_operation_id is null then
    raise exception 'operation id is required';
  end if;
  if p_actor not in ('mehran', 'ehsan') then
    raise exception 'unsupported actor';
  end if;
  if p_device_id is null or length(p_device_id) < 12 then
    raise exception 'valid device id is required';
  end if;

  -- Idempotency: a retry of an already-applied operation never reapplies it.
  select * into v_existing
  from public.holoo_operation_log
  where operation_id = p_operation_id;

  if found then
    if v_existing.company_record_id <> p_record_id
       or v_existing.device_id <> p_device_id then
      raise exception 'operation id was already used by a different source';
    end if;
    return jsonb_build_object(
      'status', 'already_applied',
      'operation_id', p_operation_id,
      'updated_at', v_existing.server_updated_at
    );
  end if;

  -- A null baseline means create-only. It must never overwrite an existing row.
  if p_expected_updated_at is null then
    insert into public.holoo_sync (id, data, updated_at)
    values (p_record_id, p_data, clock_timestamp())
    on conflict (id) do nothing
    returning updated_at into v_updated_at;
  else
    update public.holoo_sync
       set data = p_data,
           updated_at = clock_timestamp()
     where id = p_record_id
       and updated_at = p_expected_updated_at
    returning updated_at into v_updated_at;
  end if;

  if v_updated_at is null then
    select updated_at into v_updated_at
    from public.holoo_sync
    where id = p_record_id;

    return jsonb_build_object(
      'status', 'conflict',
      'operation_id', p_operation_id,
      'updated_at', v_updated_at
    );
  end if;

  -- Snapshot update and audit insert commit or roll back as one transaction.
  insert into public.holoo_operation_log (
    operation_id, company_record_id, actor, device_id, device_sequence,
    operation_type, summary, client_created_at, server_updated_at
  ) values (
    p_operation_id, p_record_id, p_actor, p_device_id, p_device_sequence,
    coalesce(nullif(p_operation_type, ''), 'state_snapshot'),
    coalesce(p_summary, ''),
    coalesce(p_client_created_at, clock_timestamp()),
    v_updated_at
  );

  return jsonb_build_object(
    'status', 'applied',
    'operation_id', p_operation_id,
    'updated_at', v_updated_at
  );
end;
$$;

revoke all on function public.holoo_apply_state_operation(
  text, timestamptz, jsonb, uuid, text, text, bigint, text, text, timestamptz
) from public;
grant execute on function public.holoo_apply_state_operation(
  text, timestamptz, jsonb, uuid, text, text, bigint, text, text, timestamptz
) to anon, authenticated;

comment on table public.holoo_operation_log is
  'Append-only operational audit metadata for multi-device Holoo state commits. Actor/device ids are operational labels, not authentication.';
comment on function public.holoo_apply_state_operation(
  text, timestamptz, jsonb, uuid, text, text, bigint, text, text, timestamptz
) is
  'Atomically compare-and-swaps the company snapshot and appends an idempotent operation audit record. Does not modify RLS policies.';
