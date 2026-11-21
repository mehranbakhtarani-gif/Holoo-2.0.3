const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('async function prepareLocalStorageMirror');
const end = html.indexOf('function isValidBackupData', start);
assert.ok(start >= 0 && end > start, 'production startup recovery function must exist');
const productionFunction = html.slice(start, end).trim();

function makeHarness({ actor = 'ehsan', outbox = 'pending', localTime = '2026-11-21T10:02:00.000Z',
  mirrorTime = '2026-11-21T10:01:00.000Z', failWrite = false } = {}) {
  const values = new Map([
    ['state', JSON.stringify({ activeRole: actor, products: [{ id: 'p1', price: 20 }], auditLogs: [] })],
    ['local-updated', localTime],
    ['outbox', outbox],
    ['sequence', '7'],
    ['actor', actor],
    ['baseline', '2026-11-21T09:59:00.000Z']
  ]);
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const localData = JSON.parse(values.get('state'));
  const mirror = {
    updatedAt: mirrorTime,
    payload: { activeRole: 'mehran', products: [{ id: 'p1', price: 10 }], auditLogs: [] }
  };
  const writes = [];
  const context = {
    localStorage,
    STORE_KEY: 'state',
    LOCAL_UPDATED_KEY: 'local-updated',
    CLOUD_OUTBOX_KEY: 'outbox',
    OPERATION_SOURCE_SEQUENCE_KEY: 'sequence',
    DEVICE_ACTOR_KEY: 'actor',
    CLOUD_BASELINE_KEY: 'baseline',
    OPERATION_SCHEMA_VERSION: 1,
    OPERATION_SOURCE_ID: 'device-writer-123456',
    cloudConfig: { recordId: 'main_company_state' },
    state: { activeRole: 'mehran', products: [], auditLogs: [] },
    lastSavedState: null,
    readLocalMirror: async () => structuredClone(mirror),
    isValidBackupData: value => !!value && typeof value === 'object' && Array.isArray(value.products),
    ensureAuditLogIds: () => {},
    setCloudBadge: () => {},
    restoreLocalStateFromSupabase: async () => { throw new Error('cloud restore must not be used in this scenario'); },
    createStableId: () => 'op_recovery-runtime-id',
    buildEntityChangeSet: (before, after, sequence) => ({
      entityChanges: [{ entityType: 'products', entityId: 'p1', changeType: 'upsert', sequence,
        payload: structuredClone(after.products[0]), previous: structuredClone(before.products[0]) }],
      rootChanges: {}
    }),
    writeLocalMirror: async (snapshot, operation, updatedAt) => {
      if (failWrite) throw new Error('simulated IndexedDB transaction abort');
      writes.push({ snapshot: structuredClone(snapshot), operation: operation && structuredClone(operation), updatedAt });
    },
    console: { warn: () => {} },
    Date,
    JSON,
    Number,
    String
  };
  return { context, values, writes, mirror, localData };
}

async function run(harness) {
  const invocation = vm.runInNewContext('(' + productionFunction + ')()', harness.context);
  return await invocation;
}

(async () => {
  // Exercise the actual production recovery function, not a reimplementation of its branch logic.
  const ehsan = makeHarness();
  assert.equal(await run(ehsan), true, 'a recoverable interrupted save should complete');
  assert.equal(ehsan.writes.length, 1, 'the repaired snapshot and journal entry must be persisted together');
  const operation = ehsan.writes[0].operation;
  assert.equal(operation.actor, 'ehsan', 'recovery must retain the device-assigned operator');
  assert.equal(operation.payload.activeRole, 'ehsan', 'the recovered snapshot must preserve Ehsan as the local active role');
  assert.equal(operation.deviceId, 'device-writer-123456');
  assert.equal(operation.operationType, 'state_snapshot_recovered');
  assert.equal(operation.sequence, 8, 'recovery must advance the local writer sequence');
  assert.equal(operation.expectedUpdatedAt, '2026-11-21T09:59:00.000Z');
  assert.equal(operation.createdAt, '2026-11-21T10:02:00.000Z');
  assert.equal(operation.entityChanges[0].previous.price, 10);
  assert.equal(operation.entityChanges[0].payload.price, 20);
  assert.equal(ehsan.values.get('sequence'), '8');
  assert.equal(ehsan.context.state.products[0].price, 20);

  // The durable write must succeed before the sequence and in-memory durable baseline advance.
  const aborted = makeHarness({ failWrite: true });
  assert.equal(await run(aborted), false, 'an IndexedDB abort must fail closed');
  assert.equal(aborted.values.get('sequence'), '7', 'failed commit must not advance the writer sequence');
  assert.equal(aborted.context.state.products.length, 0, 'failed commit must not promote the recovered state');
  assert.equal(aborted.writes.length, 0);

  // Ambiguous timestamps must stop recovery without writing or guessing.
  const invalidTime = makeHarness({ localTime: 'not-a-time' });
  assert.equal(await run(invalidTime), false);
  assert.equal(invalidTime.writes.length, 0);
  assert.equal(invalidTime.values.get('sequence'), '7');

  // Without an outbox marker, a newer local snapshot is mirrored but not fabricated into an operation.
  const noOutbox = makeHarness({ outbox: null });
  assert.equal(await run(noOutbox), true);
  assert.equal(noOutbox.writes.length, 1);
  assert.equal(noOutbox.writes[0].operation, undefined);


  // Exercise the ordinary production saveState path for both fixed device identities.
  const saveStart = html.indexOf('function saveState()');
  const saveEnd = html.indexOf('// =========================================================================', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart, 'production saveState function must exist');
  const saveFunction = html.slice(saveStart, saveEnd).trim();
  for (const actor of ['mehran', 'ehsan']) {
    const stored = new Map([
      ['actor', actor], ['state', ''], ['updated', ''], ['sequence', '2'], ['outbox', '']
    ]);
    const saveWrites = [];
    const saveContext = {
      state: { activeRole: actor, products: [{ id: 'p1', price: 42 }], auditLogs: [] },
      lastSavedState: { activeRole: actor, products: [{ id: 'p1', price: 41 }], auditLogs: [] },
      lastQueuedAuditId: null,
      localStorage: {
        getItem: key => stored.has(key) ? stored.get(key) : null,
        setItem: (key, value) => stored.set(key, String(value)),
        removeItem: key => stored.delete(key)
      },
      STORE_KEY: 'state', LOCAL_UPDATED_KEY: 'updated', OPERATION_SOURCE_SEQUENCE_KEY: 'sequence',
      CLOUD_OUTBOX_KEY: 'outbox', DEVICE_ACTOR_KEY: 'actor', OPERATION_SCHEMA_VERSION: 1,
      OPERATION_SOURCE_ID: 'writer-' + actor, cloudConfig: { recordId: 'main_company_state' },
      createStableId: () => 'op_save_runtime_id',
      buildEntityChangeSet: () => ({ entityChanges: [], rootChanges: {} }),
      writeLocalMirror: async (snapshot, operation) => { saveWrites.push({ snapshot, operation }); },
      operationJournalBarrier: Promise.resolve(),
      renderDeviceIdentityStatus: () => {}, scheduleCloudSync: () => {},
      renderCloudSyncStatus: () => {}, setCloudBadge: () => {}, showToast: () => {},
      console: { error: () => {} }, JSON, Date, Number, Promise
    };
    assert.equal(vm.runInNewContext('(' + saveFunction + ')()', saveContext), true);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(saveWrites.length, 1, actor + ' ordinary save must write one journal operation');
    assert.equal(saveWrites[0].operation.actor, actor);
    assert.equal(saveWrites[0].operation.payload.activeRole, actor,
      actor + ' ordinary save payload must preserve the assigned device operator');
  }

  console.log('PASS: production startup recovery runtime — Ehsan actor, delta, sequence, commit-abort safety, invalid timestamps and no-outbox behavior');
})().catch(error => { console.error(error); process.exitCode = 1; });
