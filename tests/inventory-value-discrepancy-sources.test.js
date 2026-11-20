const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function buildInventoryValueDiscrepancySources() {');
const end = html.indexOf('\n    function buildWarehouseTransferValueReconciliation()', start);
assert.ok(start >= 0 && end > start, 'source audit function must exist');
const sandbox = { state: { invoices: [], products: [], vouchers: [] } };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '; this.audit = buildInventoryValueDiscrepancySources;', sandbox);
function run(vouchers, invoices = [], products = []) {
  sandbox.state = { vouchers, invoices, products };
  return sandbox.audit();
}
function v(id, extra = {}) {
  return { id, date: '1405/08/29', sourceType: 'manual', sourceId: 'M-' + id,
    lines: [{ code: '1105', debit: 100, credit: 0 }], ...extra };
}
function test(name, fn) { fn(); console.log('PASS: ' + name); }

test('keeps distinct unlinked vouchers separate and flags unknown origin', () => {
  const rows = run([v(1, { sourceType: '', sourceId: '' }), v(2, { sourceType: '', sourceId: '' })]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.status === 'review' && row.issues.includes('missing-source-type') && row.issues.includes('missing-source-id')));
  assert.ok(rows.every(row => row.label === 'منشأ نامشخص'));
});

test('does not classify unsupported system source as manual', () => {
  const [row] = run([v(3, { sourceType: 'automated_adjustment', sourceId: 'A-3' })]);
  assert.equal(row.label, 'منشأ دیگر: automated_adjustment');
  assert.ok(row.issues.includes('unsupported-source-type'));
});

test('flags missing invoice source link', () => {
  const [row] = run([v(4, { sourceType: 'invoice', sourceId: 'missing' })]);
  assert.ok(row.issues.includes('invoice-source-missing'));
  assert.equal(row.status, 'review');
});

test('rejects blank control amounts instead of silently treating them as zero', () => {
  const [row] = run([v(5, { lines: [{ code: '1105', debit: '', credit: 0 }] })]);
  assert.ok(row.issues.includes('invalid-control-amount'));
  assert.equal(row.net, null);
});

test('flags invalid dates and missing voucher identifiers', () => {
  const [row] = run([v('', { date: 'not-a-date' })]);
  assert.ok(row.issues.includes('invalid-or-missing-date'));
  assert.ok(row.issues.includes('missing-voucher-id'));
});

test('does not mutate vouchers, invoices or products', () => {
  const vouchers = [v(6)];
  const invoices = [{ id: 'I1', type: 'sale', items: [] }];
  const products = [{ id: 'P1', name: 'sample' }];
  const before = JSON.stringify({ vouchers, invoices, products });
  run(vouchers, invoices, products);
  assert.equal(JSON.stringify({ vouchers, invoices, products }), before);
});

console.log('PASS: inventory value source audit classifies missing links and preserves source records');
