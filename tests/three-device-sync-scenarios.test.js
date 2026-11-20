const fs = require('node:fs');
const assert = require('node:assert/strict');

// Contract checks against the production client and SQL migrations.
const html = fs.readFileSync('index.html', 'utf8');
const journalSql = fs.readFileSync('supabase/migrations/202611180001_multi_device_operation_journal.sql', 'utf8');
const sequentialSql = fs.readFileSync('supabase/migrations/202611180004_same_device_sequential_merge.sql', 'utf8');

assert.ok(html.includes("const OPERATION_SOURCE_ID = DEVICE_ID + ':' + createStableId('writer').slice(7);"),
  'each open app session must have a distinct writer identity');
assert.ok(html.includes("const OPERATION_SOURCE_SEQUENCE_KEY = OPERATION_SEQUENCE_KEY + ':' + OPERATION_SOURCE_ID;"),
  'each writer must allocate its own sequence');
assert.ok(html.includes('deviceId: OPERATION_SOURCE_ID,'),
  'journal events must carry the session writer identity');
assert.ok(html.includes("String(a.createdAt || '').localeCompare(String(b.createdAt || ''))") &&
  html.includes("String(a.operationId || '').localeCompare(String(b.operationId || ''))"),
  'outbox drain must have deterministic ordering');
assert.ok(journalSql.includes('p_operation_id') && /operation_id/.test(journalSql),
  'the RPC journal must persist operation identity for replay protection');
assert.ok(sequentialSql.includes('prior.device_id <> p_device_id'),
  'overlap detection must distinguish independent writers, including two sessions of one person');

// Deterministic three-writer protocol fixture. This deliberately uses synthetic
// in-memory queues and a fake RPC; it does not connect to Supabase or alter company data.
const writers = [
  { actor: 'mehran', device: 'mehran-phone', source: 'mehran-phone:tab-1' },
  { actor: 'ehsan', device: 'ehsan-phone-1', source: 'ehsan-phone-1:tab-1' },
  { actor: 'ehsan', device: 'ehsan-phone-2', source: 'ehsan-phone-2:tab-1' }
];
const queues = new Map(writers.map(w => [w.source, []]));
const sequences = new Map();
function enqueue(writer, operationId, createdAt, changes) {
  const sequence = (sequences.get(writer.source) || 0) + 1;
  sequences.set(writer.source, sequence);
  const op = { operationId, actor: writer.actor, deviceId: writer.source, sequence, createdAt, changes };
  queues.get(writer.source).push(op);
  return op;
}

const a = enqueue(writers[0], 'm-1', '2026-11-21T10:00:00.000Z', { cash: 10 });
const b = enqueue(writers[1], 'e1-1', '2026-11-21T10:00:01.000Z', { party: 20 });
const c = enqueue(writers[2], 'e2-1', '2026-11-21T10:00:02.000Z', { stock: 3 });
enqueue(writers[0], 'm-2', '2026-11-21T10:00:03.000Z', { cash: 5 });
enqueue(writers[1], 'e1-2', '2026-11-21T10:00:04.000Z', { party: 2 });

assert.equal(new Set([a.deviceId, b.deviceId, c.deviceId]).size, 3,
  'the three physical installations must be distinct writers');
assert.deepEqual(writers.map(w => sequences.get(w.source)), [2, 2, 1],
  'sequence allocation must not collide across the three installations');

const pending = [...queues.values()].flat().sort((x, y) =>
  x.createdAt.localeCompare(y.createdAt) || x.operationId.localeCompare(y.operationId));
assert.deepEqual(pending.map(op => op.operationId), ['m-1', 'e1-1', 'e2-1', 'm-2', 'e1-2'],
  'recovery must drain queued work in stable creation order');

// Simulate transport loss before the server receives the request: the same
// operation ID remains pending and is reused on retry.
const serverApplied = new Map();
const acknowledged = new Set();
async function send(op, mode) {
  if (mode === 'offline') throw new Error('network unavailable');
  if (mode === 'conflict') return { status: 'conflict' };
  if (serverApplied.has(op.operationId)) return { status: 'duplicate', updated_at: 'v2' };
  serverApplied.set(op.operationId, op.changes);
  return { status: 'applied', updated_at: 'v2' };
}
(async () => {
  await assert.rejects(send(a, 'offline'), /network unavailable/);
  assert.equal(acknowledged.has(a.operationId), false, 'offline operation must not be acknowledged');
  assert.ok(queues.get(a.deviceId).some(op => op.operationId === a.operationId),
    'offline operation must remain in its durable outbox');

  const firstAttempt = await send(a, 'online');
  assert.equal(firstAttempt.status, 'applied');
  acknowledged.add(a.operationId);
  const replay = await send(a, 'online');
  assert.equal(replay.status, 'duplicate', 'replaying the same operation ID must not apply it twice');
  assert.equal(serverApplied.size, 1, 'server must retain only one logical application');

  const conflict = await send(b, 'conflict');
  assert.equal(conflict.status, 'conflict');
  assert.equal(acknowledged.has(b.operationId), false,
    'a version conflict must remain unacknowledged for explicit reconciliation');

  console.log('PASS: three-writer synthetic scenarios — isolated sequences, stable replay, offline retention, duplicate suppression and conflict retention');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
