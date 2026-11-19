const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /let operationJournalBlocked = false/,
  'the app must track operation-journal write failures');
assert.match(html, /journalWrite\.then\(\(\) => \{\s*operationJournalBlocked = false;/,
  'a later successful journal transaction must clear the blocked state');
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

console.log('Operation journal failure guard checks passed.');
