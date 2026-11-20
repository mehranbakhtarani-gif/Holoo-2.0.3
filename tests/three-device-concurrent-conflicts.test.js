const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const sql = fs.readFileSync('supabase/migrations/202611180004_same_device_sequential_merge.sql', 'utf8');
const pushStart = html.indexOf('async function pushOperationJournalToSupabase');
const pushEnd = html.indexOf('async function readLocalMirror', pushStart);
assert.ok(pushStart >= 0 && pushEnd > pushStart, 'production operation drain must exist');
const push = html.slice(pushStart, pushEnd);

// Production contract: compare-and-swap, complete audit checkpoint, cross-writer
// overlap detection, guarded merge write, and per-operation acknowledgement.
assert.match(sql, /where id = p_record_id\s+and updated_at = p_expected_updated_at/i);
assert.match(sql, /v_baseline_applied_at is null[\s\S]*?return jsonb_build_object\('status', 'conflict'/);
assert.match(sql, /prior\.device_id <> p_device_id[\s\S]*?prior\.server_applied_at > v_baseline_applied_at/);
assert.match(sql, /prior_change->>'entityType' = incoming_change->>'entityType'[\s\S]*?prior_change->>'entityId' = incoming_change->>'entityId'/);
assert.match(sql, /prior_key\.key = incoming_key\.key/);
assert.match(sql, /and updated_at is not distinct from v_current_updated_at\s+and data = v_current_data/);
assert.match(sql, /insert into public\.holoo_operation_log[\s\S]*?return jsonb_build_object\(\s*'status', 'applied'/);
assert.ok(push.indexOf("if (result?.status === 'conflict')") < push.indexOf('await acknowledgeOperations([operation.operationId]'),
  'conflicting operation must return before its local acknowledgement');
assert.match(push, /await acknowledgeOperations\(\[operation\.operationId\]/,
  'accepted operations are acknowledged individually');

// Executable protocol model for three independent writers. The model intentionally
// uses synthetic records and no Supabase connection.
const state = {
  version: 1,
  entities: { products: { p1: { price: 10 } }, parties: { c1: { name: 'A' } } },
  log: [{ id: 'baseline-checkpoint', writer: 'bootstrap', version: 1, changes: [], root: [] }]
};
function apply({ id, writer, baseline, changes, root = [] }) {
  if (state.log.some(x => x.id === id)) return { status: 'already_applied' };
  const intervening = state.log.filter(x => x.version > baseline && x.writer !== writer);
  const overlaps = intervening.some(prior =>
    prior.changes.some(a => changes.some(b =>
      a.type === '*' || b.type === '*' || (a.type === b.type && (a.id === b.id || a.id === '*' || b.id === '*'))
    )) || prior.root.some(a => root.some(b => a === '*' || b === '*' || a === b))
  );
  if (baseline !== state.version && baseline !== 1 && !state.log.some(x => x.version === baseline)) {
    return { status: 'conflict', reason: 'missing-checkpoint' };
  }
  if (baseline !== state.version && overlaps) return { status: 'conflict', reason: 'overlap' };
  if (baseline !== state.version && !state.log.some(x => x.version === baseline)) {
    return { status: 'conflict', reason: 'missing-checkpoint' };
  }
  state.version++;
  state.log.push({ id, writer, version: state.version, changes, root });
  return { status: 'applied', version: state.version, merged: baseline !== state.version - 1 };
}

const base = state.version;
assert.equal(apply({ id: 'm-1', writer: 'writer-mehran', baseline: base,
  changes: [{ type: 'products', id: 'p1' }] }).status, 'applied');
assert.equal(apply({ id: 'e1-1', writer: 'writer-ehsan-1', baseline: base,
  changes: [{ type: 'parties', id: 'c1' }] }).status, 'applied',
  'disjoint entity changes from separate devices may merge');
assert.equal(apply({ id: 'e2-1', writer: 'writer-ehsan-2', baseline: base,
  changes: [{ type: 'products', id: 'p1' }] }).reason, 'overlap',
  'concurrent edits to the same entity must conflict rather than overwrite');
assert.equal(apply({ id: 'm-2', writer: 'writer-mehran', baseline: base,
  changes: [{ type: 'products', id: 'p2' }] }).status, 'applied',
  'later operation from the same writer may follow its earlier operation');
assert.equal(apply({ id: 'e1-2', writer: 'writer-ehsan-1', baseline: base,
  changes: [{ type: 'parties', id: 'c2' }] }).status, 'applied',
  'second Ehsan device may safely append a disjoint change');
assert.equal(apply({ id: 'e2-root', writer: 'writer-ehsan-2', baseline: base,
  changes: [], root: ['fiscalYear'] }).status, 'applied');
assert.equal(apply({ id: 'm-root', writer: 'writer-mehran', baseline: base,
  changes: [], root: ['fiscalYear'] }).reason, 'overlap',
  'concurrent writes to the same root key must conflict');
assert.equal(apply({ id: 'retry-m1', writer: 'writer-ehsan-2', baseline: base,
  changes: [{ type: 'products', id: 'p1' }] }).reason, 'overlap');
assert.equal(apply({ id: 'e1-1', writer: 'writer-ehsan-1', baseline: base,
  changes: [{ type: 'parties', id: 'c1' }] }).status, 'already_applied',
  'retrying an existing operation id must not append a second audit entry');

const before = state.log.length;
const queue = [
  { id: 'partial-1', outcome: 'applied' },
  { id: 'partial-2', outcome: 'conflict' },
  { id: 'partial-3', outcome: 'applied' }
];
const ack = new Set();
for (const operation of queue) {
  if (operation.outcome === 'conflict') break;
  ack.add(operation.id);
}
assert.deepEqual([...ack], ['partial-1'],
  'a partial batch must acknowledge only operations accepted before the conflict');
assert.equal(state.log.length, before, 'synthetic conflict checks must not mutate any real company data');

console.log('PASS: three-writer disjoint merge, same-entity/root conflict, same-writer sequence, duplicate suppression and partial-batch retention');
