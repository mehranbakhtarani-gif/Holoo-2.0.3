const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const writeStart = html.indexOf('function writeLocalMirror');
const pendingStart = html.indexOf('function listPendingOperations');
const ackStart = html.indexOf('function acknowledgeOperations');
const pushStart = html.indexOf('function pushOperationJournalToSupabase');

assert.ok(writeStart >= 0 && pendingStart > writeStart && ackStart > pendingStart && pushStart > ackStart,
  'local journal persistence, pending reads, acknowledgements and cloud replay must exist');
const writeBody = html.slice(writeStart, pendingStart);
const pendingBody = html.slice(pendingStart, ackStart);
const ackBody = html.slice(ackStart, pushStart);
const pushBody = html.slice(pushStart, pushStart + 12000);

assert.match(writeBody, /db\.transaction\(\[LOCAL_DB_STORE, OPERATION_DB_STORE\], 'readwrite'\)/,
  'snapshot mirror and operation must be committed in one IndexedDB transaction');
assert.match(writeBody, /if \(operation\) tx\.objectStore\(OPERATION_DB_STORE\)\.add\(operation\)/,
  'the operation must be durably appended to IndexedDB');
assert.match(pendingBody, /getAll\(\)/);
assert.match(pendingBody, /filter\(op => !op\.acknowledgedAt\)/,
  'unacknowledged operations must remain eligible after an app restart');
assert.match(pendingBody, /createdAt[\s\S]*sequence[\s\S]*operationId/,
  'replayed operations must retain deterministic ordering');
assert.match(ackBody, /store\.put\(\{ \.\.\.req\.result, acknowledgedAt: serverTimestamp \}\)/,
  'server acknowledgement must be persisted, not inferred from an in-memory queue');
assert.match(pushBody, /p_operation_id: operation\.operationId/);
assert.match(pushBody, /!\['applied', 'already_applied'\]\.includes\(result\.status\)/);
assert.match(pushBody, /await acknowledgeOperations\(\[operation\.operationId\]/,
  'an operation is acknowledged only after the RPC returns an accepted idempotent status');
assert.ok(!/acknowledgeOperations\(operations\.map/.test(pushBody),
  'the whole batch must not be acknowledged before individual server confirmations');

// A tiny IndexedDB stand-in: its Map survives construction of a new app runtime.
// This models a page reload/process restart without touching company data or Supabase.
const durableIndexedDb = new Map();
function makeRuntime() {
  return {
    append(operation) {
      assert.equal(durableIndexedDb.has(operation.operationId), false, 'operation IDs are unique in the local journal');
      durableIndexedDb.set(operation.operationId, structuredClone(operation));
    },
    pending() {
      return [...durableIndexedDb.values()]
        .filter(op => !op.acknowledgedAt)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)
          || a.sequence - b.sequence
          || a.operationId.localeCompare(b.operationId));
    },
    acknowledge(id, at) {
      const operation = durableIndexedDb.get(id);
      if (operation) durableIndexedDb.set(id, { ...operation, acknowledgedAt: at });
    }
  };
}

const writers = [
  { actor: 'mehran', deviceId: 'mehran-device:writer-a' },
  { actor: 'ehsan', deviceId: 'ehsan-device-1:writer-b' },
  { actor: 'ehsan', deviceId: 'ehsan-device-2:writer-c' }
];
const runtimeBeforeRestart = makeRuntime();
writers.forEach((writer, index) => runtimeBeforeRestart.append({
  operationId: 'restart-op-' + (index + 1),
  actor: writer.actor,
  deviceId: writer.deviceId,
  sequence: 1,
  createdAt: '2026-11-21T10:00:0' + index + '.000Z',
  payload: { syntheticAmount: (index + 1) * 100 },
  acknowledgedAt: null
}));

// Simulate a hard close: all in-memory runtime state is discarded.
const runtimeAfterRestart = makeRuntime();
assert.deepEqual(runtimeAfterRestart.pending().map(op => op.operationId),
  ['restart-op-1', 'restart-op-2', 'restart-op-3'],
  'all three devices must recover their durable unacknowledged work after restart');

// Simulate a server commit followed by a client crash before local acknowledgement.
// Retrying the same operation ID must be treated as a duplicate, not a second posting.
const serverJournal = new Map();
function fakeRpc(operation) {
  if (serverJournal.has(operation.operationId)) return { status: 'already_applied' };
  serverJournal.set(operation.operationId, structuredClone(operation.payload));
  return { status: 'applied' };
}
const uncertain = runtimeAfterRestart.pending()[0];
assert.equal(fakeRpc(uncertain).status, 'applied');
const runtimeAfterSecondRestart = makeRuntime();
assert.equal(runtimeAfterSecondRestart.pending()[0].operationId, uncertain.operationId,
  'a crash before local acknowledgement must preserve the same operation ID');
assert.equal(fakeRpc(runtimeAfterSecondRestart.pending()[0]).status, 'already_applied');
assert.equal(serverJournal.size, 1, 'retry after uncertain response must not apply the accounting operation twice');
runtimeAfterSecondRestart.acknowledge(uncertain.operationId, '2026-11-21T10:01:00.000Z');

// A conflict is deliberately not acknowledged and therefore survives another restart.
const conflictOperation = runtimeAfterSecondRestart.pending().find(op => op.operationId === 'restart-op-2');
assert.ok(conflictOperation, 'the other devices\' pending operations must remain queued');
const conflictRuntime = makeRuntime();
assert.ok(conflictRuntime.pending().some(op => op.operationId === 'restart-op-2'),
  'unresolved work must remain available for explicit reconciliation');

console.log('PASS: three-device restart recovery, durable outbox retention, idempotent retry and per-operation acknowledgement');
