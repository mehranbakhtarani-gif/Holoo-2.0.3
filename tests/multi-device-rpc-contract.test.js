const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202611180001_multi_device_operation_journal.sql', 'utf8');
const latestMigration = fs.readFileSync('supabase/migrations/202611180004_same_device_sequential_merge.sql', 'utf8');
const sequentialMergeMigration = fs.readFileSync('supabase/migrations/202611180004_same_device_sequential_merge.sql', 'utf8');

function quotedList(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `missing ${label}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]).sort();
}

const clientCollections = quotedList(
  html,
  /const SYNC_ENTITY_COLLECTIONS = \[([\s\S]*?)\];/,
  'client sync collection list'
);
const rpcCollections = quotedList(
  latestMigration,
  /v_entity_type not in \(([\s\S]*?)\) then/,
  'RPC entity allowlist'
);

assert.deepEqual(
  rpcCollections,
  clientCollections,
  'Supabase RPC allowlist must cover every collection emitted by the client'
);

for (const parameter of [
  'p_record_id', 'p_expected_updated_at', 'p_data', 'p_entity_changes',
  'p_root_changes', 'p_operation_id', 'p_actor', 'p_device_id',
  'p_device_sequence', 'p_operation_type', 'p_summary', 'p_client_created_at'
]) {
  assert.ok(html.includes(parameter), `client RPC payload missing ${parameter}`);
  assert.ok(migration.includes(parameter), `SQL RPC signature/body missing ${parameter}`);
}

assert.match(migration, /security invoker/i);
assert.match(migration, /before update or delete on public\.holoo_operation_log/i);
assert.match(migration, /where id = p_record_id\s+and updated_at = p_expected_updated_at/i);
assert.equal((sequentialMergeMigration.match(/prior\.device_id <> p_device_id/g) || []).length, 2,
  'same-device sequential operations must not conflict with their own earlier operations');
assert.match(html, /let didMerge = false/);
assert.match(html, /if \(result\.merged === true\)/);
assert.match(html, /دریافت نسخه ادغام‌شده پس از ثبت عملیات ناموفق بود/);
console.log('PASS: multi-device RPC contract, collection allowlist and sequential same-device merge safety');
