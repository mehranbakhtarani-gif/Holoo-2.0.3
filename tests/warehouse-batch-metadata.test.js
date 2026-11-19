const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
function section(startName, endName) {
  const start = html.indexOf('    function ' + startName + '(');
  const end = html.indexOf('    function ' + endName + '(', start);
  assert.notEqual(start, -1, startName + ' must exist');
  assert.notEqual(end, -1, endName + ' section must have an end');
  return html.slice(start, end);
}
const source = [
  section('jalaliDateOrdinal', 'currentJalaliOrdinal'),
  section('inspectBatchMetadata', 'isBatchEligibleForFifo'),
  section('isBatchEligibleForFifo', 'inspectInventoryReconciliation')
].join('\n');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source + '\nthis.api = { inspectBatchMetadata, isBatchEligibleForFifo, jalaliDateOrdinal };', sandbox);
const { inspectBatchMetadata, isBatchEligibleForFifo, jalaliDateOrdinal } = sandbox.api;
const today = jalaliDateOrdinal('1405/08/28');

function test(name, fn) { fn(); console.log('PASS: ' + name); }

test('accepts consistent initial and remaining batch quantities', () => {
  const result = inspectBatchMetadata({ quantity: 20, remainingQty: 7, receivedDate: '1405/08/01', productionDate: '1405/07/20', expiryDate: '1406/08/01' });
  assert.equal(result.issues.length, 0);
});

test('detects remaining quantity greater than original quantity', () => {
  const result = inspectBatchMetadata({ quantity: 10, remainingQty: 12 });
  assert.ok(result.issues.some(issue => issue.includes('مقدار باقی‌مانده از مقدار اولیه')));
});

test('detects invalid Jalali expiry dates instead of treating them as missing', () => {
  const result = inspectBatchMetadata({ quantity: 10, remainingQty: 5, expiryDate: '1405/13/40' });
  assert.ok(result.issues.some(issue => issue.includes('تاریخ انقضا')));
});

test('detects production after receipt and expiry before receipt', () => {
  const result = inspectBatchMetadata({ quantity: 10, remainingQty: 5, receivedDate: '1405/08/10', productionDate: '1405/08/12', expiryDate: '1405/08/09' });
  assert.ok(result.issues.some(issue => issue.includes('تولید پس از تاریخ ورود')));
  assert.ok(result.issues.some(issue => issue.includes('انقضا پیش از تاریخ ورود')));
});

test('reports missing legacy dates as unverified, not fabricated errors', () => {
  const result = inspectBatchMetadata({ quantity: 10, remainingQty: 5, receivedDate: '0000/00/00' });
  assert.equal(result.issues.length, 0);
  assert.ok(result.unverified.some(issue => issue.includes('میراثی')));
});

test('reports absent initial quantity as unverified', () => {
  const result = inspectBatchMetadata({ remainingQty: 5 });
  assert.ok(result.unverified.some(issue => issue.includes('مقدار اولیه')));
});

test('excludes expired batches from FIFO', () => {
  assert.equal(isBatchEligibleForFifo({ remainingQty: 5, expiryDate: '1405/08/27' }, today), false);
});

test('includes unexpired and same-day expiry batches in FIFO', () => {
  assert.equal(isBatchEligibleForFifo({ remainingQty: 5, expiryDate: '1405/08/28' }, today), true);
  assert.equal(isBatchEligibleForFifo({ remainingQty: 5, expiryDate: '1405/09/01' }, today), true);
});

test('excludes batches with invalid or unverified non-empty expiry dates from FIFO', () => {
  assert.equal(isBatchEligibleForFifo({ remainingQty: 5, expiryDate: 'not-a-date' }, today), false);
  assert.equal(isBatchEligibleForFifo({ remainingQty: 5, expiryDate: '0000/00/00' }, today), false);
});

test('accepts Persian-digit Jalali expiry dates', () => {
  assert.equal(isBatchEligibleForFifo({ remainingQty: 5, expiryDate: '۱۴۰۵/۰۸/۲۹' }, today), true);
});

console.log('PASS: 10 warehouse batch metadata tests');
