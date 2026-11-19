const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  getWarehouseMovementAuditView,
  buildWarehouseTransferReversalPlan,
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
    id: 'P-DST', baseProductId: 'P-SRC', name: 'رزین', warehouseId: 'WH-B', stock: 27,
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
assert.equal(view.productMatches, true);
assert.equal(view.warehouseDiffers, true);
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


const reversalState = freezeDeep({
  costingMethod: 'AVG',
  products: [
    { id: 'SRC', baseProductId: 'ROOT', warehouseId: 'A', stock: 13,
      kardex: [{ date: '1405/08/28', doc: 'حواله خروج انتقال TR-200-abcd به ب', inQty: 0, outQty: 5, bal: 13 }], batches: [] },
    { id: 'DST', baseProductId: 'ROOT', warehouseId: 'B', stock: 15,
      kardex: [{ date: '1405/08/28', doc: 'حواله ورود انتقال TR-200-abcd از الف', inQty: 5, outQty: 0, bal: 15 }], batches: [] }
  ],
  warehouses: [{ id: 'A' }, { id: 'B' }],
  vouchers: []
});
const reversalPlan = buildWarehouseTransferReversalPlan(reversalState, 'TR-200-abcd');
assert.equal(reversalPlan.ok, true);
assert.equal(reversalPlan.quantity, 5);
assert.equal(reversalPlan.sourceProductId, 'SRC');
assert.equal(reversalPlan.destinationProductId, 'DST');
assert.equal(reversalPlan.fifo, false);
assert.equal(reversalState.products[0].stock, 13, 'preflight must not mutate source stock');

const laterMovementState = freezeDeep({
  ...JSON.parse(JSON.stringify(reversalState)),
  products: [
    { ...JSON.parse(JSON.stringify(reversalState.products[0])), kardex: [
      ...JSON.parse(JSON.stringify(reversalState.products[0].kardex)),
      { date: '1405/08/29', doc: 'فروش بعدی', inQty: 0, outQty: 1, bal: 12 }
    ], stock: 12 },
    JSON.parse(JSON.stringify(reversalState.products[1]))
  ]
});
const laterPlan = buildWarehouseTransferReversalPlan(laterMovementState, 'TR-200-abcd');
assert.equal(laterPlan.ok, false);
assert.match(laterPlan.reason, /گردش دیگری ثبت شده است/);


const correctedHistoryProducts = freezeDeep([
  {
    ...JSON.parse(JSON.stringify(reversalState.products[0])),
    kardex: [
      ...JSON.parse(JSON.stringify(reversalState.products[0].kardex)),
      { date: '1405/08/29', doc: 'برگشت حواله انتقال TR-200-abcd به درخواست اصلاح', inQty: 5, outQty: 0, bal: 18, reversalOf: 'TR-200-abcd' },
      { date: '1405/08/29', doc: 'حواله خروج انتقال TR-201-efgh (جایگزین TR-200-abcd)', inQty: 0, outQty: 4, bal: 14, correctionOf: 'TR-200-abcd' }
    ]
  },
  {
    ...JSON.parse(JSON.stringify(reversalState.products[1])),
    kardex: [
      ...JSON.parse(JSON.stringify(reversalState.products[1].kardex)),
      { date: '1405/08/29', doc: 'برگشت حواله انتقال TR-200-abcd از درخواست اصلاح', inQty: 0, outQty: 5, bal: 10, reversalOf: 'TR-200-abcd' }
    ]
  }
]);
const historicalView = getWarehouseMovementAuditView(
  correctedHistoryProducts, warehouses, correctedHistoryProducts[0],
  correctedHistoryProducts[0].kardex[0], []
);
assert.equal(historicalView.pairCount, 2, 'audit projection should preserve the original transfer pair and ignore appended correction rows');
assert.equal(historicalView.source.quantity, 5);
assert.equal(historicalView.destination.quantity, 5);

const voucherState = freezeDeep({
  ...JSON.parse(JSON.stringify(reversalState)),
  vouchers: [{ id: 99, desc: 'سند انتقال TR-200-abcd', lines: [] }]
});
const voucherPlan = buildWarehouseTransferReversalPlan(voucherState, 'TR-200-abcd');
assert.equal(voucherPlan.ok, false);
assert.match(voucherPlan.reason, /سند حسابداری وابسته/);

const fifoState = freezeDeep({
  costingMethod: 'FIFO',
  products: [
    { id: 'FS', baseProductId: 'FR', warehouseId: 'A', stock: 5,
      kardex: [{ date: '1405/08/28', doc: 'TR-300-abcd خروج', inQty: 0, outQty: 5, bal: 5 }],
      batches: [{ id: 'FB-1', quantity: 10, remainingQty: 5 }] },
    { id: 'FD', baseProductId: 'FR', warehouseId: 'B', stock: 5,
      kardex: [{ date: '1405/08/28', doc: 'TR-300-abcd ورود', inQty: 5, outQty: 0, bal: 5 }],
      batches: [{ id: 'FB-1::TR-300-abcd::1', sourceType: 'warehouse_transfer', sourceRef: 'TR-300-abcd',
        sourceBatchId: 'FB-1', quantity: 5, remainingQty: 5 }] }
  ],
  vouchers: []
});
const fifoPlan = buildWarehouseTransferReversalPlan(fifoState, 'TR-300-abcd');
assert.equal(fifoPlan.ok, true);
assert.equal(fifoPlan.fifo, true);
assert.equal(fifoPlan.fifoRestores.length, 1);
assert.equal(fifoPlan.fifoRestores[0].sourceBatchId, 'FB-1');

const consumedFifoState = freezeDeep({
  ...JSON.parse(JSON.stringify(fifoState)),
  products: [
    JSON.parse(JSON.stringify(fifoState.products[0])),
    { ...JSON.parse(JSON.stringify(fifoState.products[1])),
      batches: [{ ...JSON.parse(JSON.stringify(fifoState.products[1].batches[0])), remainingQty: 4 }] }
  ]
});
const consumedPlan = buildWarehouseTransferReversalPlan(consumedFifoState, 'TR-300-abcd');
assert.equal(consumedPlan.ok, false);
assert.match(consumedPlan.reason, /مصرف یا دست‌کاری شده/);

assert.equal(
  escapeAuditText('<svg onload="alert(1)"> & \'audit\''),
  '&lt;svg onload=&quot;alert(1)&quot;&gt; &amp; &#39;audit&#39;'
);

const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('<script src="./warehouse-audit-domain.js"></script>'));
assert.ok(html.includes('function renderWarehouseMovementAuditPanel(product, movement)'));
assert.ok(html.includes('renderWarehouseMovementAuditPanel(p, k)'));
assert.ok(html.includes("/TR-\\d+-[a-z0-9]+/i.test(String(k.doc || ''))"), 'audit panel condition must use the transfer ID matcher');
assert.ok(html.includes('function applyWarehouseTransferCorrection('));
assert.ok(html.includes('warehouseTransferCorrection = {'));
assert.ok(html.includes('state.auditLogs[0].warehouseTransferCorrection'));
assert.ok(html.includes('const correctionEvents = audit.kind === \'transfer\''));
assert.ok(html.includes('تاریخچه اصلاحات:'));
assert.ok(!html.includes('draft.warehouseTransferCorrections'));
assert.ok(html.includes('reversalOf: plan.transferId'));
assert.ok(html.includes('correctionOf: plan.transferId'));
assert.ok(html.includes('actor: draft.activeRole || \'mehran\', deviceId: DEVICE_ID, createdAt: now.toISOString()'));
assert.ok(html.includes('let committed = false;'));
assert.ok(html.includes('if (!committed) state = originalState;'));
assert.ok(html.includes('سند حسابداری حواله قبلی دست‌نخورده می‌ماند.'));
assert.ok(html.includes('id="modal-warehouse-transfer-correction"'));
assert.ok(html.includes('function submitWarehouseTransferCorrection()'));
assert.ok(html.includes('wh-correction-reason'));
assert.ok(html.includes('wh-correction-destination'));
assert.ok(html.includes('wh-correction-quantity'));
assert.ok(html.includes('wh-correction-confirm'));
assert.ok(!html.includes('window.prompt(\'علت اصلاح حواله'));
assert.ok(!html.includes('window.confirm(confirmation)'));
assert.ok(html.includes('if (!saveState())'));
console.log('PASS: warehouse transfer and stocktake audit projections are read-only, escaped, and conservative');
