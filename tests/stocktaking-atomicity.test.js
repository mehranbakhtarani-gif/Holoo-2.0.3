const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
function extractFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' must exist');
  const brace = html.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('Unbalanced function: ' + name);
}

let failOnVoucher = 0, voucherCalls = 0;
const sandbox = {
  state: null,
  addStockBatch(product, details) {
    product.batches ||= [];
    product.batches.push({ id: details.id, lot: details.lot, quantity: details.quantity, remainingQty: details.quantity, unitCost: details.unitCost });
  },
  consumeFifoStock(product, qty) {
    const batch = product.batches.find(item => item.remainingQty >= qty);
    if (!batch) throw new Error('insufficient FIFO');
    batch.remainingQty -= qty;
    return { totalCost: qty * batch.unitCost, unitCost: batch.unitCost, allocations: [{ batchId: batch.id, quantity: qty, unitCost: batch.unitCost }] };
  },
  postVoucher(desc, lines, date, source) {
    voucherCalls++;
    const debit = lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = lines.reduce((sum, line) => sum + line.credit, 0);
    assert.equal(debit, credit, 'voucher must balance');
    const id = 'V-' + voucherCalls;
    sandbox.state.vouchers.unshift({ id, desc, lines, date, sourceType: source.type, sourceId: source.id, sourceEvent: source.event });
    if (failOnVoucher && voucherCalls === failOnVoucher) throw new Error('simulated voucher failure');
    return id;
  },
  addAudit(action, meta) { sandbox.state.auditLogs.unshift({ action, meta }); }
};
vm.createContext(sandbox);
vm.runInContext(extractFunction('inspectProductBatchReconciliation'), sandbox);
vm.runInContext(extractFunction('parsePhysicalStocktakingCounts'), sandbox);
vm.runInContext(extractFunction('buildPhysicalStocktakingDraft'), sandbox);

function fixture() {
  return {
    costingMethod: 'FIFO',
    products: [
      { id: 'P1', name: 'کالای اول', stock: 10, buyPrice: 5, batches: [{ id: 'B1', quantity: 10, remainingQty: 10, unitCost: 5 }], kardex: [] },
      { id: 'P2', name: 'کالای دوم', stock: 5, buyPrice: 8, batches: [{ id: 'B2', quantity: 5, remainingQty: 5, unitCost: 8 }], kardex: [] }
    ],
    vouchers: [],
    auditLogs: []
  };
}
const entries = [
  { productId: 'P1', rawValue: '8' },
  { productId: 'P2', rawValue: '7', rawUnitCost: '8' }
];

const original = fixture();
sandbox.state = original;
assert.throws(() => sandbox.parsePhysicalStocktakingCounts(original.products, [
  { productId: 'P1', rawValue: '' }, { productId: 'P2', rawValue: '5' }
]), /الزامی/);
assert.throws(() => sandbox.parsePhysicalStocktakingCounts(original.products, [
  { productId: 'P1', rawValue: '-1' }, { productId: 'P2', rawValue: '5' }
]), /صفر یا بیشتر/);
assert.throws(() => sandbox.parsePhysicalStocktakingCounts(original.products, [
  { productId: 'P1', rawValue: 'NaN' }, { productId: 'P2', rawValue: '5' }
]), /عدد/);

sandbox.state = original;
failOnVoucher = 2;
voucherCalls = 0;
assert.throws(() => sandbox.buildPhysicalStocktakingDraft(original, entries, 'STK-FAIL', '1405/08/28'), /simulated voucher failure/);
assert.equal(sandbox.state, original, 'global state reference must be restored after failure');
assert.equal(original.products[0].stock, 10, 'first product stock must remain unchanged after later voucher failure');
assert.equal(original.products[0].batches[0].remainingQty, 10, 'FIFO batch must remain unchanged after failure');
assert.equal(original.products[1].stock, 5, 'later product stock must remain unchanged after failure');
assert.equal(original.vouchers.length, 0, 'no voucher may leak into the original state');

failOnVoucher = 0;
voucherCalls = 0;
const prepared = sandbox.buildPhysicalStocktakingDraft(original, entries, 'STK-OK', '1405/08/28');
assert.notEqual(prepared.state, original, 'draft must be a separate state snapshot');
assert.equal(prepared.changes, 2);
assert.equal(prepared.state.products[0].stock, 8);
assert.equal(prepared.state.products[0].batches[0].remainingQty, 8);
assert.equal(prepared.state.products[1].stock, 7);
assert.equal(prepared.state.products[1].batches.length, 2);
assert.equal(prepared.state.vouchers.length, 2);
assert.equal(prepared.state.auditLogs.length, 1);
const stocktakeAudit = prepared.state.auditLogs[0];
assert.equal(stocktakeAudit.meta.operationId, 'STK-OK');
assert.equal(stocktakeAudit.meta.sourceId, 'STK-OK');
assert.deepEqual(Array.from(stocktakeAudit.meta.relatedVoucherIds), ['V-1', 'V-2']);
assert.equal(stocktakeAudit.meta.previous.length, 2, 'audit record must preserve before-state for each changed product');
assert.equal(stocktakeAudit.meta.previous[0].stock, 10);
assert.equal(stocktakeAudit.meta.previous[0].batches[0].remainingQty, 10);
assert.equal(stocktakeAudit.meta.details[0].countedStock, 8);
assert.equal(stocktakeAudit.meta.details[0].difference, -2);
assert.equal(stocktakeAudit.meta.details[0].voucherId, 'V-1');
assert.equal(prepared.auditItems.length, 2);
assert.deepEqual(Array.from(prepared.relatedVoucherIds), ['V-1', 'V-2']);
assert.equal(prepared.state.products[0].kardex.at(-1).operationId, 'STK-OK');
assert.equal(prepared.state.products[0].kardex.at(-1).sourceType, 'stocktake');
assert.equal(prepared.state.vouchers.find(v => v.sourceEvent === 'P1').lines[0].debit, 10, 'FIFO shortage must use actual consumed batch cost');
assert.equal(original.products[0].stock, 10, 'successful preparation must not mutate original state before commit');
assert.equal(original.products[1].stock, 5);
assert.equal(original.vouchers.length, 0);


const warehouseScoped = fixture();
sandbox.state = warehouseScoped;
warehouseScoped.warehouses = [{ id: 'WH-A', name: 'انبار الف' }, { id: 'WH-B', name: 'انبار ب' }];
warehouseScoped.products[0].warehouseId = 'WH-A';
warehouseScoped.products[1].warehouseId = 'WH-B';
const scopedCounts = sandbox.parsePhysicalStocktakingCounts(warehouseScoped.products, [
  { productId: 'P1', rawValue: '6' }
], 'WH-A');
assert.deepEqual(Array.from(scopedCounts, item => ({ productId: item.productId, real: item.real })), [{ productId: 'P1', real: 6 }], 'only products from the selected warehouse may be counted');
sandbox.state = warehouseScoped;
voucherCalls = 0;
const scopedDraft = sandbox.buildPhysicalStocktakingDraft(warehouseScoped, [
  { productId: 'P1', rawValue: '6' }
], 'STK-WH-A', '1405/08/28', 'WH-A');
assert.equal(scopedDraft.state.products[0].stock, 6, 'selected warehouse product must receive the count');
assert.equal(scopedDraft.state.products[1].stock, 5, 'product in another warehouse must remain untouched');
assert.equal(scopedDraft.auditItems[0].warehouseId, 'WH-A');
assert.equal(scopedDraft.state.auditLogs[0].meta.warehouseId, 'WH-A', 'audit operation must identify the selected warehouse');
assert.throws(() => sandbox.buildPhysicalStocktakingDraft(warehouseScoped, [
  { productId: 'P1', rawValue: '6' }, { productId: 'P2', rawValue: '5' }
], 'STK-CROSS', '1405/08/28', 'WH-A'), /ناقص|نامعتبر|خالی/);
assert.throws(() => sandbox.buildPhysicalStocktakingDraft(warehouseScoped, [
  { productId: 'P1', rawValue: '6' }
], 'STK-MISSING-WH', '1405/08/28', 'WH-MISSING'), /وجود ندارد/);

console.log('PASS: stocktaking validation, FIFO staging, voucher balancing, and all-or-nothing draft behavior');
