-- Extend the existing Holoo operation RPC to merge payroll and depreciation records.
-- Apply after the original multi-device operation journal migration.
-- This migration changes only the RPC entity allowlist; it does not alter RLS policies.

create or replace function public.holoo_apply_state_operation(
  p_record_id text,
  p_expected_updated_at timestamptz,
  p_data jsonb,
  p_entity_changes jsonb,
  p_root_changes jsonb,
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
  v_current_data jsonb;
  v_current_updated_at timestamptz;
  v_baseline_applied_at timestamptz;
  v_merged_data jsonb;
  v_change jsonb;
  v_entity_type text;
  v_entity_id text;
  v_change_type text;
  v_array jsonb;
  v_root_key text;
  v_root_value jsonb;
  v_overlap boolean;
  v_merged boolean := false;
begin
  if p_record_id is null or p_record_id = '' then
    raise exception 'record id is required';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'state payload must be a JSON object';
  end if;
  if p_entity_changes is null or jsonb_typeof(p_entity_changes) <> 'array' then
    raise exception 'entity changes must be a JSON array';
  end if;
  if p_root_changes is null or jsonb_typeof(p_root_changes) <> 'object' then
    raise exception 'root changes must be a JSON object';
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

  perform set_config('holoo.operation_rpc', 'on', true);

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
    -- The snapshot changed since this device's baseline. Attempt a safe
    -- entity-level merge only when the audit trail proves the intervening writes.
    select data, updated_at into v_current_data, v_current_updated_at
    from public.holoo_sync
    where id = p_record_id;

    if not found or p_expected_updated_at is null or v_current_updated_at is null then
      return jsonb_build_object('status', 'conflict', 'operation_id', p_operation_id, 'updated_at', v_current_updated_at);
    end if;

    select min(server_applied_at) into v_baseline_applied_at
    from public.holoo_operation_log
    where company_record_id = p_record_id
      and server_updated_at = p_expected_updated_at;

    -- No checkpoint means history is incomplete; do not guess.
    if v_baseline_applied_at is null
       or not exists (
         select 1 from public.holoo_operation_log
         where company_record_id = p_record_id
           and server_updated_at = v_current_updated_at
       ) then
      return jsonb_build_object('status', 'conflict', 'operation_id', p_operation_id, 'updated_at', v_current_updated_at);
    end if;

    select exists (
      select 1
      from public.holoo_operation_log prior
      cross join lateral jsonb_array_elements(prior.entity_changes) as prior_items(prior_change)
      cross join lateral jsonb_array_elements(p_entity_changes) as incoming_items(incoming_change)
      where prior.company_record_id = p_record_id
        and prior.server_applied_at > v_baseline_applied_at
        and (
          prior_change->>'entityType' = '*'
          or incoming_change->>'entityType' = '*'
          or (
            prior_change->>'entityType' = incoming_change->>'entityType'
            and (
              prior_change->>'entityId' = incoming_change->>'entityId'
              or prior_change->>'entityId' = '*'
              or incoming_change->>'entityId' = '*'
            )
          )
        )
    ) into v_overlap;

    if not v_overlap then
      select exists (
        select 1
        from public.holoo_operation_log prior
        cross join lateral jsonb_object_keys(prior.root_changes) prior_key(key)
        cross join lateral jsonb_object_keys(p_root_changes) incoming_key(key)
        where prior.company_record_id = p_record_id
          and prior.server_applied_at > v_baseline_applied_at
          and (
            prior_key.key = '*'
            or incoming_key.key = '*'
            or prior_key.key = incoming_key.key
          )
      ) into v_overlap;
    end if;

    if v_overlap then
      return jsonb_build_object('status', 'conflict', 'operation_id', p_operation_id, 'updated_at', v_current_updated_at);
    end if;

    v_merged_data := v_current_data;
    for v_change in select value from jsonb_array_elements(p_entity_changes)
    loop
      v_entity_type := v_change->>'entityType';
      v_entity_id := v_change->>'entityId';
      v_change_type := v_change->>'changeType';

      if v_entity_type is null or v_entity_id is null or v_change_type is null
         or v_entity_type not in (
        'warehouses', 'products', 'parties', 'invoices', 'orders', 'imports',
        'fxCommitments', 'accountCatalog', 'bankAccounts', 'checks', 'treasuryTxs', 'bankReconcileItems',
        'employees', 'payrollRuns', 'fixedAssets', 'depreciationEntries', 'guarantees', 'payableCommitments', 'vouchers', 'approvals', 'auditLogs', 'customUnits'
      ) then
        raise exception 'unsupported entity collection: %', v_entity_type;
      end if;

      v_array := coalesce(v_merged_data->v_entity_type, '[]'::jsonb);
      if jsonb_typeof(v_array) <> 'array' then
        raise exception 'entity collection is not an array: %', v_entity_type;
      end if;

      if v_change_type = 'replace' then
        if jsonb_typeof(v_change->'payload') <> 'array' then
          raise exception 'replacement payload must be an array';
        end if;
        v_array := v_change->'payload';
      elsif v_change_type = 'upsert' then
        if jsonb_typeof(v_change->'payload') <> 'object'
           or v_change->'payload'->>'id' is distinct from v_entity_id then
          raise exception 'upsert entity id does not match its payload';
        end if;
        select coalesce(jsonb_agg(item), '[]'::jsonb) into v_array
        from jsonb_array_elements(v_array) as items(item)
        where item->>'id' is distinct from v_entity_id;
        v_array := v_array || jsonb_build_array(v_change->'payload');
      elsif v_change_type = 'delete' then
        select coalesce(jsonb_agg(item), '[]'::jsonb) into v_array
        from jsonb_array_elements(v_array) as items(item)
        where item->>'id' is distinct from v_entity_id;
      else
        raise exception 'unsupported entity change type: %', v_change_type;
      end if;
      v_merged_data := jsonb_set(v_merged_data, array[v_entity_type], v_array, true);
    end loop;

    for v_root_key, v_root_value in select key, value from jsonb_each(p_root_changes)
    loop
      if v_root_value->>'changeType' = 'delete' then
        v_merged_data := v_merged_data - v_root_key;
      elsif v_root_value->>'changeType' = 'upsert' then
        v_merged_data := jsonb_set(v_merged_data, array[v_root_key], v_root_value->'value', true);
      else
        raise exception 'unsupported root change type for key: %', v_root_key;
      end if;
    end loop;

    update public.holoo_sync
       set data = v_merged_data,
           updated_at = clock_timestamp()
     where id = p_record_id
       and updated_at is not distinct from v_current_updated_at
       and data = v_current_data
    returning updated_at into v_updated_at;

    if v_updated_at is null then
      select updated_at into v_current_updated_at from public.holoo_sync where id = p_record_id;
      return jsonb_build_object('status', 'conflict', 'operation_id', p_operation_id, 'updated_at', v_current_updated_at);
    end if;
    v_merged := true;
  end if;

  -- Snapshot update and audit insert commit or roll back as one transaction.
  insert into public.holoo_operation_log (
    operation_id, company_record_id, actor, device_id, device_sequence,
    operation_type, summary, entity_changes, root_changes, client_created_at, server_updated_at
  ) values (
    p_operation_id, p_record_id, p_actor, p_device_id, p_device_sequence,
    coalesce(nullif(p_operation_type, ''), 'state_snapshot'),
    coalesce(p_summary, ''),
    p_entity_changes,
    p_root_changes,
    coalesce(p_client_created_at, clock_timestamp()),
    v_updated_at
  );

  return jsonb_build_object(
    'status', 'applied',
    'operation_id', p_operation_id,
    'updated_at', v_updated_at,
    'merged', v_merged
  );
end;
$$;

grant execute on function public.holoo_apply_state_operation(
  text, timestamptz, jsonb, jsonb, jsonb, uuid, text, text, bigint, text, text, timestamptz
) to anon, authenticated;

comment on function public.holoo_apply_state_operation(
  text, timestamptz, jsonb, jsonb, jsonb, uuid, text, text, bigint, text, text, timestamptz
) is
  'Atomically compare-and-swaps the company snapshot and appends an idempotent operation audit record. Supports payrollRuns, depreciationEntries, guarantees and payableCommitments collections; does not modify RLS policies.';
