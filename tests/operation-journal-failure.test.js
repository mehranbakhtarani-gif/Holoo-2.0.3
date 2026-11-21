const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /let operationJournalBlocked = false/,
  'the app must track operation-journal write failures');
assert.match(html, /journalWrite\.then\(\(\) => \{\s*operationJournalBlocked = false;/,
  'a later successful journal transaction must clear the blocked state');
assert.match(html, /journalWrite\.catch\(e => \{\s*operationJournalBlocked = true;/,
  'the journal barrier must set the blocked state before it resolves');
assert.match(html, /\.catch\(e => \{\s*operationJournalBlocked = true;/,
  'a failed journal transaction must block cloud sync');

const pushStart = html.indexOf('async function pushToSupabase');
assert.notEqual(pushStart, -1, 'pushToSupabase must exist');
const pushBody = html.slice(pushStart);
const waitForJournal = pushBody.indexOf('await operationJournalBarrier;');
const blockedGuard = pushBody.indexOf('if (operationJournalBlocked)');
const atomicJournalPush = pushBody.indexOf('pushOperationJournalToSupabase()');
const legacySnapshotFallback = pushBody.indexOf('// پیش از ارسال نسخه قدیمی');
assert.ok(waitForJournal >= 0 && blockedGuard > waitForJournal,
  'the journal barrier must settle before checking the blocked state');
assert.ok(atomicJournalPush > blockedGuard,
  'the blocked state must be checked before attempting atomic journal sync');
assert.ok(legacySnapshotFallback > blockedGuard,
  'the blocked state must be checked before the legacy snapshot fallback');
assert.match(pushBody.slice(blockedGuard, atomicJournalPush),
  /return false;/,
  'a blocked journal must exit without sending a cloud snapshot');


const mirrorStart = html.indexOf('async function writeLocalMirror');
const pendingStart = html.indexOf('async function listPendingOperations', mirrorStart);
assert.ok(mirrorStart >= 0 && pendingStart > mirrorStart,
  'the durable mirror writer must be defined before the pending-operation reader');
const mirrorBody = html.slice(mirrorStart, pendingStart);
assert.match(mirrorBody, /db\.transaction\(\[LOCAL_DB_STORE, OPERATION_DB_STORE\], 'readwrite'\)/,
  'the state mirror and operation record must share one atomic IndexedDB transaction');
assert.match(mirrorBody, /tx\.oncomplete = resolve/);
assert.match(mirrorBody, /tx\.onerror = \(\) => reject/);
assert.match(mirrorBody, /tx\.onabort = \(\) => reject/,
  'an aborted mirror/journal transaction must be treated as a failed durable save');

const saveStart = html.indexOf('function saveState()');
const saveEnd = html.indexOf('// =========================================================================', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'saveState must be present');
const saveBody = html.slice(saveStart, saveEnd);
const durableSuccess = saveBody.indexOf('journalWrite.then(() =>');
const durableFailure = saveBody.indexOf('}).catch(e =>', durableSuccess);
assert.ok(durableSuccess >= 0 && durableFailure > durableSuccess,
  'durable journal success and failure must have separate continuations');
assert.ok(saveBody.indexOf('lastSavedState = JSON.parse(snapshot);') > durableSuccess
  && saveBody.indexOf('lastSavedState = JSON.parse(snapshot);') < durableFailure,
  'the comparison baseline may advance only after the IndexedDB transaction commits');
assert.match(saveBody.slice(durableSuccess, durableFailure), /operationJournalBlocked = false/);
assert.match(saveBody.slice(durableFailure), /operationJournalBlocked = true/);
assert.ok(!/lastSavedState\s*=/.test(saveBody.slice(durableFailure)),
  'a failed IndexedDB write must not be recorded as the last durable state');
assert.ok(saveBody.slice(durableSuccess, durableFailure).indexOf('scheduleCloudSync()') > 0,
  'cloud sync is scheduled after the journal transaction commits');
assert.ok(saveBody.slice(durableFailure).indexOf('scheduleCloudSync()') > 0,
  'a failed journal write may trigger the sync guard, but must not advance the durable baseline');



const ackStart = html.indexOf('async function acknowledgeOperations');
const rpcStart = html.indexOf('async function pushOperationJournalToSupabase', ackStart);
assert.ok(ackStart >= 0 && rpcStart > ackStart, 'operation acknowledgement function must exist');
const ackBody = html.slice(ackStart, rpcStart);
assert.match(ackBody, /tx\.oncomplete = resolve/);
assert.match(ackBody, /tx\.onerror = \(\) => reject/);
assert.match(ackBody, /tx\.onabort = \(\) => reject/,
  'an aborted local acknowledgement transaction must reject and leave the operation pending');

const rpcBody = html.slice(rpcStart, html.indexOf('async function readLocalMirror', rpcStart));
const rpcCall = rpcBody.indexOf('fetchWithTimeout(rpcUrl');
const responseParse = rpcBody.indexOf('const resultBody = await response.json()');
const ackCall = rpcBody.indexOf('await acknowledgeOperations([operation.operationId]');
assert.ok(rpcCall >= 0 && responseParse > rpcCall && ackCall > responseParse,
  'the server response must be interpreted before acknowledging the local operation');
assert.match(rpcBody.slice(responseParse, ackCall), /already_applied/,
  'a retry after an uncertain network response must accept the server idempotency response');
assert.match(rpcBody.slice(ackCall), /await acknowledgeOperations\(\[operation\.operationId\]/,
  'each operation must be acknowledged only after the server confirms applied/already_applied');

const migration = fs.readFileSync('supabase/migrations/202611180004_same_device_sequential_merge.sql', 'utf8');
const idempotency = migration.indexOf('-- Idempotency: a retry of an already-applied operation never reapplies it.');
const existingLookup = migration.indexOf('where operation_id = p_operation_id', idempotency);
const baselineWrite = migration.indexOf('perform set_config', idempotency);
assert.ok(idempotency >= 0 && existingLookup > idempotency && baselineWrite > existingLookup,
  'server-side duplicate detection must run before applying a snapshot or comparing its baseline');
assert.match(migration.slice(idempotency, baselineWrite), /'status',\s*'already_applied'/,
  'server must return already_applied for a duplicate operation ID');

const recoveryStart = html.indexOf('async function prepareLocalStorageMirror');
const recoveryEnd = html.indexOf('function isValidBackupData', recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'local mirror recovery must be defined before backup validation');
const recoveryBody = html.slice(recoveryStart, recoveryEnd);
assert.ok(recoveryBody.includes('try { localData = JSON.parse(localRaw); } catch'), 'corrupt localStorage JSON must be detected');
assert.ok(recoveryBody.includes('const localValid = isValidBackupData(localData)'), 'local data must be structurally validated');
assert.ok(recoveryBody.includes('const mirrorValid = isValidBackupData(mirror?.payload)'), 'IndexedDB mirror must be structurally validated');
assert.ok(recoveryBody.includes('if (!localValid && mirrorValid)'), 'a valid IndexedDB mirror must be selected when localStorage is invalid');
assert.ok(recoveryBody.includes('if (!localValid) {') && recoveryBody.includes('return await restoreLocalStateFromSupabase()'), 'invalid local copies must trigger guarded cloud recovery');
assert.ok(recoveryBody.includes('await writeLocalMirror(localData)'), 'a validated local snapshot may refresh the IndexedDB mirror');
assert.ok(html.includes('prepareLocalStorageMirror().then(ready => ready === true)'), 'failed recovery readiness must stop automatic cloud sync');

const cloudHistoryStart = html.indexOf('async function fetchRemoteOperationHistory');
const recoveredStoreStart = html.indexOf('async function storeRecoveredOperationHistory', cloudHistoryStart);
const cloudRestoreStart = html.indexOf('async function restoreLocalStateFromSupabase', recoveredStoreStart);
const prepareStart = html.indexOf('async function prepareLocalStorageMirror', cloudRestoreStart);
assert.ok(cloudHistoryStart >= 0 && recoveredStoreStart > cloudHistoryStart && cloudRestoreStart > recoveredStoreStart && prepareStart > cloudRestoreStart, 'cloud history read and restore must precede startup preparation');
const historyBody = html.slice(cloudHistoryStart, recoveredStoreStart);
assert.ok(historyBody.includes('holoo_operation_log') && historyBody.includes('company_record_id=eq.') && historyBody.includes('server_updated_at.asc'), 'history fetch must be scoped to the company and ordered');
assert.ok(historyBody.includes('operation_id.asc') && historyBody.includes("Prefer: 'count=exact'") && historyBody.includes("response.headers.get('content-range')"), 'history pagination must be deterministic and prove the complete row count');
assert.ok(historyBody.includes('offset=') && historyBody.includes('20000'), 'history fetch must paginate and enforce a completeness cap');
assert.ok(historyBody.includes("contentRange.lastIndexOf('/')") && historyBody.includes("pageCountText"), 'exact row count must be parsed from the PostgREST Content-Range header');
assert.ok(historyBody.includes('expectedCount !== pageCount'), 'recovery must stop if the reported total changes between pages');
assert.ok(historyBody.includes('allRows.length === expectedCount'), 'recovery must finish only after every reported row is fetched');
assert.ok(historyBody.includes('page.length !== pageSize'), 'short pages before the reported total must be treated as truncation');
const recoveredStoreBody = html.slice(recoveredStoreStart, cloudRestoreStart);
assert.ok(recoveredStoreBody.includes('recoveredFromServer: true') && recoveredStoreBody.includes('acknowledgedAt: row.server_updated_at'), 'restored history entries must be marked as server-acknowledged');
assert.ok(recoveredStoreBody.includes('store.put(operation)'), 'recovered operations must be stored idempotently by operationId');
assert.ok(recoveredStoreBody.includes("db.transaction([LOCAL_DB_STORE, OPERATION_DB_STORE], 'readwrite')") && recoveredStoreBody.includes("objectStore(LOCAL_DB_STORE).put({ payload: snapshot"), 'recovered history and state mirror must commit atomically in IndexedDB');
assert.ok(recoveredStoreBody.includes("'mehran', 'ehsan', 'unknown'"), 'migration checkpoint rows with actor unknown must also be recoverable');
const cloudRestoreBody = html.slice(cloudRestoreStart, prepareStart);
assert.ok(cloudRestoreBody.includes('listPendingOperations(1)'), 'cloud recovery must refuse to overwrite unsent local operations');
assert.ok(cloudRestoreBody.includes('CLOUD_OUTBOX_KEY') && cloudRestoreBody.includes('CLOUD_CONFLICT_DB_KEY'), 'cloud recovery must respect local outbox and conflict state');
assert.ok(cloudRestoreBody.includes('const history = await fetchRemoteOperationHistory()') && cloudRestoreBody.includes('await storeRecoveredOperationHistory(history, state, remote.updated_at)'), 'complete history must be fetched before atomically persisting it with the snapshot mirror');
assert.ok(cloudRestoreBody.includes('history.some(row => row.server_updated_at === remote.updated_at)'), 'the recovered snapshot timestamp must match a checkpoint in the operation history');
assert.ok(cloudRestoreBody.includes('await writeLocalMirror(state, null, remote.updated_at)'), 'restored mirror must retain the server timestamp after audit ID repair');
assert.ok(cloudRestoreBody.indexOf('ensureAuditLogIds(state)') < cloudRestoreBody.indexOf('await writeLocalMirror(state, null, remote.updated_at)'), 'the normalized recovered state must be mirrored after audit ID repair');
assert.ok(cloudRestoreBody.includes('CLOUD_BASELINE_KEY, remote.updated_at'), 'restored cloud baseline must be recorded');

console.log('Operation journal durability, local/cloud recovery, and idempotent audit restoration checks passed.');
