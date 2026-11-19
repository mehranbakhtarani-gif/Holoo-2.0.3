const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const sql = fs.readFileSync('supabase/migrations/202611180004_same_device_sequential_merge.sql', 'utf8');

assert.ok(html.includes("const OPERATION_SOURCE_ID = DEVICE_ID + ':' + createStableId('writer').slice(7);"),
  'each page session must get a unique operation source while retaining the stable physical device id');
assert.ok(html.includes('deviceId: OPERATION_SOURCE_ID,'),
  'journal operations must identify their tab/session writer, not only the physical device');
assert.ok(html.includes("const OPERATION_SOURCE_SEQUENCE_KEY = OPERATION_SEQUENCE_KEY + ':' + OPERATION_SOURCE_ID;"),
  'sequence counters must be isolated per writer so concurrent tabs cannot allocate the same sequence');
assert.ok(html.includes('localStorage.getItem(OPERATION_SOURCE_SEQUENCE_KEY)'));
assert.ok(html.includes('localStorage.setItem(OPERATION_SOURCE_SEQUENCE_KEY, String(sequence))'));
assert.equal((html.match(/entityVersion: OPERATION_SOURCE_ID/g) || []).length, 3,
  'all entity change versions must carry the same unique writer identity');
assert.ok(html.includes("String(a.createdAt || '').localeCompare(String(b.createdAt || ''))"),
  'pending operations from different page sessions must be drained in creation-time order');
assert.ok(html.includes("String(a.operationId || '').localeCompare(String(b.operationId || ''))"),
  'pending operation ordering must have a deterministic final tie-breaker');
assert.ok(sql.includes('prior.device_id <> p_device_id'),
  'the server must treat a different tab/session writer as an independent source when checking overlaps');
assert.ok(html.includes("el.textContent = actorLabel + ' · ' + DEVICE_ID.slice(-8)"),
  'the UI must continue showing the stable physical device identity');

console.log('PASS: concurrent tabs receive isolated operation sources and deterministic journal ordering');
