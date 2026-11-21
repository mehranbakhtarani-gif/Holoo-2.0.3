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
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart,
  'local mirror recovery must be defined before backup validation');
const recoveryBody = html.slice(recoveryStart, recoveryEnd);
assert.match(recoveryBody, /try \\{ localData = JSON\\.parse\\(localRaw\\); \\} catch/,
  'corrupt localStorage JSON must be detected without aborting recovery');
assert.match(recoveryBody, /const localValid = isValidBackupData\\(localData\\)/);
assert.match(recoveryBody, /const mirrorValid = isValidBackupData\\(mirror\\?\\.payload\\)/);
assert.match(recoveryBody, /if \\(!localValid && mirrorValid\\)/,
  'a valid IndexedDB mirror must be selected when localStorage is invalid');
assert.match(recoveryBody, /if \\(!localValid\\) \\{[\\s\\S]*?return false;/,
  'when both local copies are invalid, startup must stop rather than write defaults');
assert.match(recoveryBody, /await writeLocalMirror\\(localData\\)/,
  'a validated local snapshot may refresh the IndexedDB mirror');

assert.match(html, /prepareLocalStorageMirror\(\)\.then\(ready => ready === true\)/,
  'a rejected local recovery readiness result must stop automatic cloud sync at startup');

const cloudHistoryStart = html.indexOf('async function fetchRemoteOperationHistory');
const recoveredStoreStart = html.indexOf('async function storeRecoveredOperationHistory', cloudHistoryStart);
const cloudRestoreStart = html.indexOf('async function restoreLocalStateFromSupabase', recoveredStoreStart);
const prepareStart = html.indexOf('async function prepareLocalStorageMirror', cloudRestoreStart);
assert.ok(cloudHistoryStart >= 0 && recoveredStoreStart > cloudHistoryStart && cloudRestoreStart > recoveredStoreStart && prepareStart > cloudRestoreStart,
  'cloud history read, durable history restore, and cloud snapshot recovery must be defined before local startup preparation');
const historyBody = html.slice(cloudHistoryStart, recoveredStoreStart);
assert.match(historyBody, /holoo_operation_log/);
assert.match(historyBody, /company_record_id=eq\\./);
assert.match(historyBody, /server_updated_at\\.asc/);
assert.match(historyBody, /offset=\\' \\+ offset/);
assert.match(historyBody, /20000/);
const recoveredStoreBody = html.slice(recoveredStoreStart, cloudRestoreStart);
assert.match(recoveredStoreBody, /recoveredFromServer: true/);
assert.match(recoveredStoreBody, /acknowledgedAt: row\\.server_updated_at/);
assert.match(recoveredStoreBody, /store\\.put\\(operation\\)/,
  'recovered server operations must be stored by operationId without becoming pending uploads');
const cloudRestoreBody = html.slice(cloudRestoreStart, prepareStart);
assert.match(cloudRestoreBody, /listPendingOperations\\(1\\)/,
  'cloud recovery must refuse to overwrite unsent local operations');
assert.match(cloudRestoreBody, /CLOUD_OUTBOX_KEY/);
assert.match(cloudRestoreBody, /CLOUD_CONFLICT_DB_KEY/);
assert.match(cloudRestoreBody, /Promise\\.all\\(/,
  'the cloud snapshot and operation history must both be fetched before recovery');
assert.match(cloudRestoreBody, /await storeRecoveredOperationHistory\\(history\\)/,
  'the server audit history must be persisted before replacing the local state');
assert.match(cloudRestoreBody, /await writeLocalMirror\\(remote\\.data, null, remote\\.updated_at\\)/,
  'the restored mirror must retain the server snapshot timestamp');
assert.match(cloudRestoreBody, /CLOUD_BASELINE_KEY, remote\\.updated_at/);
assert.match(html, /if \\(!localValid\\) \\{\\s*try \\{\\s*return await restoreLocalStateFromSupabase\\(\\)/,
  'when local state and mirror are invalid, startup must attempt guarded cloud recovery');

console.log('Operation journal durability, local/cloud recovery, and idempotent audit restoration checks passed.');
