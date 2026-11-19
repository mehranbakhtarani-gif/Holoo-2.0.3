const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  getWarehouseMovementAuditView,
  escapeAuditText
} = require('../warehouse-audit-domain.js');

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
}

const products = freezeDeep([
  {
    id: 'P-SRC', name: 'رزین', warehouseId: 'WH-A', stock: 18,
    kardex: [{ date: '1405/08/28', doc: 'حواله خروج انتقال TR-123-abcd به انبار ب', outQty: 7, inQty: 0, bal: 18 }],
    batches: [{ id: 'B-SRC', lot: 'LOT-1', remainingQty: 18 }]
  },
  {
    id: 'P-DST', name: 'رزین', warehouseId: 'WH-B', stock: 27,
    kardex: [{ date: '1405/08/28', doc: 'حواله ورود انتقال TR-123-abcd از انبار الف', inQty: 7, outQty: 0, bal: 27 }],
    batches: [{
      id: 'B-SRC::TR-123-abcd::1', lot: 'LOT-1', sourceType: 'warehouse_transfer',
      sourceRef: 'TR-123-abcd', sourceBatchId: 'B-SRC', quantity: 7, remainingQty: 5, unitCost: 250
    }]
  }
]);
const warehouses = freezeDeep([{ id: 'WH-A', name: 'انبار الف' }, { id: 'WH-B', name: 'انبار ب' }]);
const vouchers = freezeDeep([]);

const view = getWarehouseMovementAuditView(products, warehouses, products[0], products[0].kardex[0], vouchers);
assert.equal(view.kind, 'transfer');
assert.equal(view.verified, true);
assert.equal(view.transferId, 'TR-123-abcd');
assert.equal(view.source.warehouseName, 'انبار الف');
assert.equal(view.destination.warehouseName, 'انبار ب');
assert.equal(view.source.quantity, 7);
assert.equal(view.destination.quantity, 7);
assert.equal(view.batchLinks.length, 1);
assert.equal(view.batchLinks[0].parentFound, true);
assert.equal(view.batchLinks[0].remainingQty, 5);
assert.equal(view.beforeSnapshotAvailable, false);
assert.equal(view.actorAvailable, false);
assert.equal(products[0].stock, 18, 'audit projection must not mutate source stock');
assert.equal(products[1].batches[0].remainingQty, 5, 'audit projection must not mutate destination batch');

const brokenProducts = freezeDeep([
  { id: 'P1', name: 'کالا', warehouseId: 'WH-A', kardex: [{ date: '1405/08/28', doc: 'TR-123-abcd خروج', outQty: 7, bal: 1 }], batches: [] },
  { id: 'P2', name: 'کالا', warehouseId: 'WH-B', kardex: [{ date: '1405/08/29', doc: 'TR-123-abcd ورود', inQty: 6, bal: 6 }], batches: [] }
]);
const broken = getWarehouseMovementAuditView(brokenProducts, warehouses, brokenProducts[0], brokenProducts[0].kardex[0], []);
assert.equal(broken.verified, false);
assert.equal(broken.quantityMatches, false);
assert.equal(broken.dateMatches, false);

const stocktakeProduct = freezeDeep({
  id: 'P-ST', name: 'پودر', warehouseId: 'WH-A',
  kardex: [{ date: '1405/08/28', doc: 'اصلاحیه انبارگردانی', inQty: 2, outQty: 0, bal: 12 }]
});
const stocktakeVoucher = freezeDeep({ id: 'V-10', date: '1405/08/28', desc: 'سند مغایرت انبارگردانی: پودر' });
const stocktake = getWarehouseMovementAuditView([stocktakeProduct], warehouses, stocktakeProduct, stocktakeProduct.kardex[0], [stocktakeVoucher]);
assert.equal(stocktake.kind, 'stocktake');
assert.equal(stocktake.verified, false, 'description/date match is never treated as a definitive link');
assert.equal(stocktake.voucherCandidates.length, 1);
assert.match(stocktake.reason, /شناسه یکتای عملیات ندارد/);

assert.equal(
  escapeAuditText('<svg onload="alert(1)"> & \'audit\''),
  '&lt;svg onload=&quot;alert(1)&quot;&gt; &amp; &#39;audit&#39;'
);

const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('<script src="./warehouse-audit-domain.js"></script>'));
assert.ok(html.includes('function renderWarehouseMovementAuditPanel(product, movement)'));
assert.ok(html.includes('renderWarehouseMovementAuditPanel(p, k)'));
assert.ok(html.split('\\n').some(line => line.includes('renderWarehouseMovementAuditPanel(p, k)') && line.includes('TR-\\\\d+')), 'audit panel condition must use the transfer ID matcher');
assert.ok(html.includes('اصلاح یا برگشت مستقیم تا پیاده‌سازی معکوس‌سازی اتمیک'));
console.log('PASS: warehouse transfer and stocktake audit projections are read-only, escaped, and conservative');
