const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function ensureProductBatches(');
const end = html.indexOf('    // =========================================================================\n    // 7. MODULE 3:', start);
assert.notEqual(start, -1, 'batch helpers must exist');
assert.notEqual(end, -1, 'batch helper section must have an end');
const source = html.slice(start, end);
const sandbox = { createStableId: (() => { let n = 0; return prefix => prefix + '-' + (++n); })() };
vm.createContext(sandbox);
vm.runInContext(source + '; this.api = { ensureProductBatches, addStockBatch, consumeFifoStock, restoreFifoAllocations };', sandbox);
const { ensureProductBatches, addStockBatch, consumeFifoStock, restoreFifoAllocations } = sandbox.api;

function test(name, fn) { fn(); console.log('PASS: ' + name); }

test('legacy stock is migrated to exactly one opening batch', () => {
  const p = { id: 'P1', stock: 12, buyPrice: 50, lot: 'OLD-LOT', batches: [] };
  const batches = ensureProductBatches(p);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].remainingQty, 12);
  assert.equal(batches.reduce((n, b) => n + b.remainingQty, 0), p.stock);
});

test('new purchases add a distinct lot without changing stock quantity themselves', () => {
  const p = { id: 'P2', stock: 5, buyPrice: 40, batches: [] };
  addStockBatch(p, { lot: 'LOT-B', quantity: 3, unitCost: 70, receivedDate: '1405/02/01' });
  assert.equal(p.stock, 5);
  assert.equal(p.batches.length, 2);
  assert.equal(p.batches[1].lot, 'LOT-B');
});

test('FIFO consumes oldest available batches first and calculates exact cost', () => {
  const p = { id: 'P3', stock: 10, batches: [
    { id: 'B1', lot: 'L1', receivedDate: '1405/01/01', remainingQty: 4, quantity: 4, unitCost: 100 },
    { id: 'B2', lot: 'L2', receivedDate: '1405/02/01', remainingQty: 6, quantity: 6, unitCost: 150 }
  ] };
  const result = consumeFifoStock(p, 6);
  assert.equal(result.totalCost, 700);
  assert.deepEqual(Array.from(result.allocations, x => x.quantity), [4, 2]);
  assert.deepEqual(Array.from(result.allocations, x => x.lot), ['L1', 'L2']);
  assert.equal(p.batches[0].remainingQty, 0);
  assert.equal(p.batches[1].remainingQty, 4);
});

test('insufficient batch balance is rejected without partial consumption', () => {
  const p = { id: 'P4', stock: 2, batches: [
    { id: 'B1', lot: 'L1', receivedDate: '1405/01/01', remainingQty: 2, quantity: 2, unitCost: 100 }
  ] };
  assert.throws(() => consumeFifoStock(p, 3), /کافی نیست/);
  assert.equal(p.batches[0].remainingQty, 2);
});

test('sales return restores the original consumed batch quantities', () => {
  const p = { id: 'P5', stock: 4, batches: [
    { id: 'B1', lot: 'L1', receivedDate: '1405/01/01', remainingQty: 4, quantity: 10, unitCost: 100 }
  ] };
  restoreFifoAllocations(p, [{ batchId: 'B1', lot: 'L1', quantity: 2, unitCost: 100 }], 2, 100, 'RET-1');
  assert.equal(p.batches[0].remainingQty, 6);
});

test('multiple partial returns restore only quantities not yet returned', () => {
  const p = { id: 'P6', stock: 4, batches: [
    { id: 'B1', lot: 'L1', receivedDate: '1405/01/01', remainingQty: 0, quantity: 4, unitCost: 100 },
    { id: 'B2', lot: 'L2', receivedDate: '1405/02/01', remainingQty: 4, quantity: 6, unitCost: 150 }
  ] };
  const allocations = [
    { batchId: 'B1', lot: 'L1', quantity: 4, unitCost: 100 },
    { batchId: 'B2', lot: 'L2', quantity: 2, unitCost: 150 }
  ];
  const first = restoreFifoAllocations(p, allocations, 3, 0, 'RET-2');
  const second = restoreFifoAllocations(p, allocations, 3, 0, 'RET-3', first);
  assert.equal(p.batches[0].remainingQty, 4);
  assert.equal(p.batches[1].remainingQty, 6);
  assert.equal(first.reduce((n, x) => n + x.quantity, 0) + second.reduce((n, x) => n + x.quantity, 0), 6);
});

test('purchase and import forms retain batch, production and expiry metadata', () => {
  assert.match(html, /id="inv-line-lot"/);
  assert.match(html, /id="inv-line-prod-date"/);
  assert.match(html, /id="inv-line-expiry"/);
  assert.match(html, /id="imp-lot"/);
  assert.match(html, /id="imp-production-date"/);
  assert.match(html, /id="imp-expiry-date"/);
});

test('FIFO sales costing is wired to invoice lines and cost-of-goods-sold voucher', () => {
  assert.match(html, /const fifo = consumeFifoStock\(p, l\.kg\)/);
  assert.match(html, /l\.costOfGoodsSold = fifo\.totalCost/);
  assert.match(html, /cogs \+= lineCost/);
});

console.log('PASS: 8 FIFO batch tests');
