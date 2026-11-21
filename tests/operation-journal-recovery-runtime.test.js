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
      CLOUD_OUTBOX_KEY: 'outbox', DEVICE_ACTOR_KEY: 'actor', CLOUD_BASELINE_KEY: 'baseline', OPERATION_SCHEMA_VERSION: 1,
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


  // Exercise the real production outbox drain: retry after an uncertain network result
  // must reuse the same operation id and accept the server's idempotent acknowledgement.
  const pushStart = html.indexOf('async function pushOperationJournalToSupabase()');
  const pushEnd = html.indexOf('async function readLocalMirror()', pushStart);
  assert.ok(pushStart >= 0 && pushEnd > pushStart, 'production operation uploader must exist');
  const pushFunction = html.slice(pushStart, pushEnd).trim();
  const pendingOperation = {
    operationId: 'same-operation-id',
    companyRecordId: 'main_company_state',
    actor: 'ehsan',
    deviceId: 'device-writer-123456',
    sequence: 19,
    operationType: 'state_snapshot',
    summary: 'runtime retry test',
    payload: { activeRole: 'ehsan', vouchers: [] },
    entityChanges: [],
    rootChanges: {},
    createdAt: '2026-11-21T10:10:00.000Z'
  };
  const pending = [pendingOperation];
  const acked = [];
  const requests = [];
  let failTransportOnce = true;
  const pushContext = {
    listPendingOperations: async limit => pending.slice(0, limit),
    acknowledgeOperations: async ids => {
      acked.push(...ids);
      for (const id of ids) {
        const index = pending.findIndex(op => op.operationId === id);
        if (index >= 0) pending.splice(index, 1);
      }
    },
    localStorage: {
      getItem: key => key === 'outbox' ? 'queued-marker' :
        key === 'local-updated' ? '2026-11-21T10:10:00.000Z' :
        key === 'baseline' ? '2026-11-21T10:00:00.000Z' : null,
      setItem: () => {}, removeItem: () => {}
    },
    CLOUD_OUTBOX_KEY: 'outbox', LOCAL_UPDATED_KEY: 'local-updated',
    CLOUD_BASELINE_KEY: 'baseline',
    cloudConfig: { url: 'https://example.invalid', recordId: 'main_company_state', table: 'holoo_sync' },
    fetchWithTimeout: async (url, options) => {
      requests.push({ url, options });
      if (failTransportOnce) {
        failTransportOnce = false;
        throw new Error('simulated connection loss after request dispatch');
      }
      return {
        status: 200, ok: true,
        json: async () => ({ status: 'already_applied', operation_id: 'same-operation-id',
          updated_at: '2026-11-21T10:11:00.000Z' })
      };
    },
    cloudAuthHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test' }),
    renderCloudSyncStatus: async () => {}, scheduleCloudSync: () => {},
    setCloudBadge: () => {}, showToast: () => {},
    state: {}, lastSavedState: {}, lastQueuedAuditId: null,
    JSON, Date, encodeURIComponent, Error, Promise
  };
  const push = vm.runInNewContext('(' + pushFunction + ')', pushContext);
  await assert.rejects(() => push(), /simulated connection loss/);
  assert.equal(acked.length, 0, 'a transport failure must never acknowledge the pending operation');
  assert.equal(pending.length, 1, 'the operation must remain queued after uncertain delivery');
  assert.equal(requests.length, 1);
  const retryResult = await push();
  assert.equal(retryResult.applied, 1, 'already_applied is a successful idempotent retry');
  assert.deepEqual(acked, ['same-operation-id']);
  assert.equal(pending.length, 0, 'the queue drains only after server acknowledgement');
  assert.equal(requests.length, 2);
  const firstBody = JSON.parse(requests[0].options.body);
  const retryBody = JSON.parse(requests[1].options.body);
  assert.equal(firstBody.p_operation_id, 'same-operation-id');
  assert.equal(retryBody.p_operation_id, firstBody.p_operation_id,
    'restart/retry must reuse the exact stable operation id');


  // A server conflict must stop the drain at that operation, preserve it and all
  // later operations, and surface the remote version for explicit reconciliation.
  const conflictOps = [
    { ...pendingOperation, operationId: 'conflict-op-1', createdAt: '2026-11-21T10:12:00.000Z' },
    { ...pendingOperation, operationId: 'must-wait-op-2', createdAt: '2026-11-21T10:13:00.000Z' }
  ];
  const conflictPending = conflictOps.slice();
  const conflictCalls = [];
  const savedConflicts = [];
  const conflictContext = {
    listPendingOperations: async limit => conflictPending.slice(0, limit),
    acknowledgeOperations: async ids => {
      for (const id of ids) {
        const index = conflictPending.findIndex(op => op.operationId === id);
        if (index >= 0) conflictPending.splice(index, 1);
      }
    },
    localStorage: {
      getItem: key => key === 'outbox' ? 'queued-marker' :
        key === 'local-updated' ? '2026-11-21T10:13:00.000Z' :
        key === 'baseline' ? '2026-11-21T10:00:00.000Z' : null,
      setItem: () => {}, removeItem: () => {}
    },
    CLOUD_OUTBOX_KEY: 'outbox', LOCAL_UPDATED_KEY: 'local-updated',
    CLOUD_BASELINE_KEY: 'baseline',
    cloudConfig: { url: 'https://example.invalid', recordId: 'main_company_state', table: 'holoo_sync' },
    fetchWithTimeout: async (url, options) => {
      conflictCalls.push({ url, options });
      if (conflictCalls.length === 1) return {
        status: 200, ok: true, json: async () => ({ status: 'conflict', updated_at: '2026-11-21T10:14:00.000Z' })
      };
      return {
        status: 200, ok: true,
        json: async () => ([{ data: { vouchers: [], products: [] }, updated_at: '2026-11-21T10:14:00.000Z' }])
      };
    },
    cloudAuthHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test' }),
    saveCloudConflict: async value => { savedConflicts.push(value); },
    setCloudBadge: () => {}, showToast: () => {}, scheduleCloudSync: () => {},
    renderCloudSyncStatus: async () => {},
    state: {}, lastSavedState: {}, lastQueuedAuditId: null,
    JSON, Date, encodeURIComponent, Error, Promise
  };
  const conflictPush = vm.runInNewContext('(' + pushFunction + ')', conflictContext);
  const conflictResult = await conflictPush();
  assert.equal(conflictResult.conflict, true, 'RPC conflict must stop the queue drain');
  assert.equal(conflictResult.applied, 0);
  assert.equal(conflictCalls.length, 2, 'only the conflict RPC and remote snapshot read may run');
  assert.equal(savedConflicts.length, 1, 'the remote state must be captured for explicit reconciliation');
  assert.deepEqual(conflictPending.map(op => op.operationId), ['conflict-op-1', 'must-wait-op-2'],
    'neither the conflicting operation nor later operations may be acknowledged or dropped');


  // If a later operation encounters a transport failure, only earlier server-
  // acknowledged work may leave the durable queue; the failed and later work stay pending.
  const orderedOps = [1, 2, 3].map(n => ({
    ...pendingOperation,
    operationId: 'ordered-op-' + n,
    sequence: n,
    createdAt: '2026-11-21T10:20:0' + n + '.000Z'
  }));
  const orderedPending = orderedOps.slice();
  const orderedAcknowledged = [];
  let orderedRequests = 0;
  const orderedContext = {
    listPendingOperations: async limit => orderedPending.slice(0, limit),
    acknowledgeOperations: async ids => {
      orderedAcknowledged.push(...ids);
      for (const id of ids) {
        const index = orderedPending.findIndex(op => op.operationId === id);
        if (index >= 0) orderedPending.splice(index, 1);
      }
    },
    localStorage: {
      getItem: key => key === 'outbox' ? 'queued-marker' :
        key === 'local-updated' ? '2026-11-21T10:20:03.000Z' :
        key === 'baseline' ? '2026-11-21T10:00:00.000Z' : null,
      setItem: () => {}, removeItem: () => {}
    },
    CLOUD_OUTBOX_KEY: 'outbox', LOCAL_UPDATED_KEY: 'local-updated',
    CLOUD_BASELINE_KEY: 'baseline',
    cloudConfig: { url: 'https://example.invalid', recordId: 'main_company_state', table: 'holoo_sync' },
    fetchWithTimeout: async () => {
      orderedRequests++;
      if (orderedRequests === 1) return {
        status: 200, ok: true,
        json: async () => ({ status: 'applied', updated_at: '2026-11-21T10:21:00.000Z' })
      };
      throw new Error('simulated network failure on second queued operation');
    },
    cloudAuthHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test' }),
    setCloudBadge: () => {}, showToast: () => {}, scheduleCloudSync: () => {},
    renderCloudSyncStatus: async () => {},
    state: {}, lastSavedState: {}, lastQueuedAuditId: null,
    JSON, Date, encodeURIComponent, Error, Promise
  };
  const orderedPush = vm.runInNewContext('(' + pushFunction + ')', orderedContext);
  await assert.rejects(() => orderedPush(), /simulated network failure on second queued operation/);
  assert.deepEqual(orderedAcknowledged, ['ordered-op-1'],
    'only the first operation, acknowledged by the server, may leave the queue');
  assert.deepEqual(orderedPending.map(op => op.operationId), ['ordered-op-2', 'ordered-op-3'],
    'failed and not-yet-sent operations must remain durable and ordered');
  assert.equal(orderedRequests, 2, 'the uploader must stop immediately at the first transport failure');

  console.log('PASS: production journal recovery and outbox runtime — Ehsan actor, delta, sequence, commit-abort safety, invalid timestamps, no-outbox behavior, transport retry and idempotent acknowledgement');
})().catch(error => { console.error(error); process.exitCode = 1; });
