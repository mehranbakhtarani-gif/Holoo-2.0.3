const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function inspectProductBatchReconciliation(');
const end = html.indexOf('    // =========================================================================\n    // 7. MODULE 3:', start);
assert.notEqual(start, -1, 'batch helpers must exist');
assert.notEqual(end, -1, 'batch helper section must have an end');
const source = html.slice(start, end);
const sandbox = { createStableId: (() => { let n = 0; return prefix => prefix + '-' + (++n); })(), getTodayJalaliDate: () => '1405/09/02', currentJalaliOrdinal: () => 100, jalaliDateOrdinal: value => value === 'EXPIRED' ? 90 : 110 };
vm.createContext(sandbox);
vm.runInContext(source + '; this.api = { inspectProductBatchReconciliation, inspectInventoryReconciliation, ensureProductBatches, addStockBatch, consumeFifoStock, restoreFifoAllocations };', sandbox);
const { inspectProductBatchReconciliation, inspectInventoryReconciliation, ensureProductBatches, addStockBatch, consumeFifoStock, restoreFifoAllocations } = sandbox.api;

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

test('new batches default to the Jalali operation date, not the ISO/Gregorian date', () => {
  const p = { id: 'P-DATE', stock: 0, buyPrice: 75, batches: [] };
  const batch = addStockBatch(p, { quantity: 2, unitCost: 75 });
  assert.equal(batch.receivedDate, '1405/09/02');
  assert.equal(batch.receivedDate.split('/').length, 3);
});

test('legacy AVG stock with over-counted historical lots is preserved and reported without mutation', () => {
  const p = { id: 'P-AVG', stock: 5, buyPrice: 120, batches: [
    { id: 'OLD-1', sourceType: 'import', sourceRef: 'IMP-OLD', remainingQty: 6, quantity: 6, unitCost: 100 },
    { id: 'OLD-2', sourceType: 'purchase', sourceRef: 'PUR-OLD', remainingQty: 4, quantity: 4, unitCost: 150 }
  ] };
  const before = JSON.stringify(p.batches);
  const batches = ensureProductBatches(p);
  assert.equal(JSON.stringify(batches), before);
  assert.equal(batches.reduce((sum, batch) => sum + Number(batch.remainingQty || 0), 0), 10);
  const report = inspectProductBatchReconciliation(p);
  assert.equal(report.valid, false);
  assert.equal(report.stock, 5);
  assert.equal(report.tracked, 10);
  assert.equal(report.difference, -5);
  assert.match(report.issue, /مغایرت/);
  assert.throws(() => consumeFifoStock(p, 1), /مغایرت‌گیری/);
  assert.equal(JSON.stringify(p.batches), before);
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

test('FIFO skips expired lots and uses only non-expired stock', () => {
  const p = { id: 'P-EXP', stock: 10, batches: [
    { id: 'B-OLD', lot: 'OLD', receivedDate: '1405/01/01', expiryDate: 'EXPIRED', remainingQty: 4, quantity: 4, unitCost: 100 },
    { id: 'B-NEW', lot: 'NEW', receivedDate: '1405/02/01', expiryDate: 'VALID', remainingQty: 6, quantity: 6, unitCost: 150 }
  ] };
  const result = consumeFifoStock(p, 6);
  assert.equal(result.totalCost, 900);
  assert.equal(p.batches[0].remainingQty, 4);
  assert.equal(p.batches[1].remainingQty, 0);
  p.stock -= 6;
  assert.throws(() => consumeFifoStock(p, 1), /غیرمنقضی/);
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
  assert.match(html, /id="imp-items-container"/);
  assert.match(html, /class="imp-item-lot/);
  assert.match(html, /class="imp-item-production/);
  assert.match(html, /class="imp-item-expiry/);
  assert.match(html, /function addImportItemRow\(/);
});

test('FIFO sales costing is wired to invoice lines and cost-of-goods-sold voucher', () => {
  assert.match(html, /const fifo = consumeFifoStock\(simulated, line\.kg\)/);
  assert.match(html, /line\.costOfGoodsSold = lineCost/);
  assert.match(html, /product\.batches = simulated\.batches/);
  assert.match(html, /deferSave: true/);
  assert.match(html, /cogs \+= lineCost/);
});


test('inventory reconciliation reports stock-to-batch mismatch without mutating source data', () => {
  const products = [{ id: 'R1', name: 'کالای آزمایشی', stock: 8, batches: [
    { id: 'B-1', remainingQty: 5, unitCost: 20 }
  ], kardex: [{ bal: 8, inQty: 8, outQty: 0, doc: 'رسید افتتاحیه' }] }];
  const before = JSON.stringify(products);
  const report = inspectInventoryReconciliation(products);
  assert.equal(report.issueCount, 1);
  assert.match(report.issues[0].message, /مغایرت/);
  assert.equal(JSON.stringify(products), before);
});

test('inventory reconciliation detects missing and duplicate batch identifiers', () => {
  const report = inspectInventoryReconciliation([{ id: 'R2', name: 'کالا', stock: 3, batches: [
    { id: 'DUP', remainingQty: 1, unitCost: 1 },
    { id: 'DUP', remainingQty: 1, unitCost: 1 },
    { remainingQty: 1, unitCost: 1 }
  ], kardex: [] }]);
  assert.equal(report.issues.filter(x => x.type === 'batch-id').length, 2);
});

test('inventory reconciliation detects kardex balance mismatch', () => {
  const report = inspectInventoryReconciliation([{ id: 'R3', name: 'کالا', stock: 7, batches: [], kardex: [
    { bal: 5, inQty: 5, outQty: 0, doc: 'رسید' }
  ] }]);
  assert.ok(report.issues.some(x => x.type === 'kardex-balance'));
});

test('inventory reconciliation detects an incorrect intermediate kardex balance even when the final balance matches stock', () => {
  const products = [{ id: 'R-MID', name: 'کالای میانی', stock: 9, batches: [], kardex: [
    { bal: 10, inQty: 10, outQty: 0, doc: 'افتتاحیه' },
    { bal: 4, inQty: 0, outQty: 3, doc: 'فروش اول' },
    { bal: 9, inQty: 5, outQty: 0, doc: 'خرید بعدی' }
  ] }];
  const report = inspectInventoryReconciliation(products);
  assert.ok(report.issues.some(x => x.type === 'kardex-sequence'));
  assert.equal(report.issues.some(x => x.type === 'kardex-balance'), false);
});

test('inventory reconciliation detects a positive-stock product with no kardex history', () => {
  const report = inspectInventoryReconciliation([{ id: 'R-NO-KARDEX', name: 'بدون کاردکس', stock: 4, batches: [], kardex: [] }]);
  assert.ok(report.issues.some(x => x.type === 'kardex-missing'));
});

test('inventory reconciliation validates paired warehouse transfer references and quantities', () => {
  const products = [
    { id: 'SRC', name: 'مبدأ', stock: 4, batches: [], kardex: [{ bal: 4, outQty: 3, inQty: 0, doc: 'حواله خروج انتقال TR-123-abcd به مقصد' }] },
    { id: 'DST', name: 'مقصد', stock: 3, batches: [], kardex: [{ bal: 3, inQty: 3, outQty: 0, doc: 'حواله ورود انتقال TR-123-abcd از مبدأ' }] }
  ];
  const report = inspectInventoryReconciliation(products);
  assert.equal(report.checkedTransfers, 1);
  assert.equal(report.issues.filter(x => x.type === 'transfer').length, 0);
  products[1].kardex[0].inQty = 2;
  const mismatch = inspectInventoryReconciliation(products);
  assert.ok(mismatch.issues.some(x => x.type === 'transfer'));
});

console.log('PASS: 15 FIFO and inventory reconciliation tests');
