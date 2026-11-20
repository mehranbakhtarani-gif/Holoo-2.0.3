const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  createReceiptSnapshot,
  getReceiptReversalBlockReason
} = require('../import-domain.js');

const shipment = {
  id: 'IMP-SNAPSHOT-1',
  items: [
    { id: 'ITEM-1', productId: 'P-1', quantityKg: 10, landedCostRial: 1200 },
    { id: 'ITEM-2', productId: 'P-1', quantityKg: 5, landedCostRial: 700 },
    { id: 'ITEM-3', productId: 'P-2', quantityKg: 8, landedCostRial: 900 }
  ]
};
const products = [
  {
    id: 'P-1', stock: 40, buyPrice: 100, lastMoveDays: 3,
    kardex: [{ doc: 'OPEN', inQty: 40, outQty: 0, bal: 40 }],
    batches: [{ id: 'B-1', quantity: 40, remainingQty: 30, unitCost: 100 }]
  },
  { id: 'P-2', stock: 12, buyPrice: 90, kardex: [], batches: [] }
];
const snapshot = createReceiptSnapshot(shipment, products, {
  schemaVersion: 1,
  snapshotId: 'receipt_snapshot_test',
  capturedAt: '2026-11-19T08:00:00.000Z',
  receivedDate: '1405/08/28',
  actor: 'mehran',
  deviceId: 'device-test',
  costingMethod: 'FIFO',
  previousStatus: 'cleared'
});

assert.equal(snapshot.schemaVersion, 1);
assert.equal(snapshot.snapshotId, 'receipt_snapshot_test');
assert.equal(snapshot.shipmentId, 'IMP-SNAPSHOT-1');
assert.equal(snapshot.actor, 'mehran');
assert.equal(snapshot.deviceId, 'device-test');
assert.equal(snapshot.costingMethod, 'FIFO');
assert.equal(snapshot.previousStatus, 'cleared');
assert.equal(snapshot.items.length, 3);
assert.equal(snapshot.products.length, 2, 'one pre-receipt product state per unique product');
assert.equal(snapshot.products.find(x => x.productId === 'P-1').state.stock, 40);
assert.equal(snapshot.products.find(x => x.productId === 'P-1').state.buyPrice, 100);
assert.equal(snapshot.products.find(x => x.productId === 'P-1').state.batches[0].remainingQty, 30);

// Snapshot data must not be a live reference to product state or shipment lines.
products[0].stock = 55;
products[0].batches[0].remainingQty = 2;
products[0].kardex[0].bal = 55;
shipment.items[0].quantityKg = 999;
assert.equal(snapshot.products.find(x => x.productId === 'P-1').state.stock, 40);
assert.equal(snapshot.products.find(x => x.productId === 'P-1').state.batches[0].remainingQty, 30);
assert.equal(snapshot.products.find(x => x.productId === 'P-1').state.kardex[0].bal, 40);
assert.equal(snapshot.items[0].quantityKg, 10);

assert.throws(() => createReceiptSnapshot(shipment, [products[1]], {}), /پیدا نشد/);
assert.throws(() => createReceiptSnapshot({ id: 'IMP-EMPTY', items: [] }, products, {}), /اقلام/);
assert.throws(() => createReceiptSnapshot(shipment, products, { schemaVersion: 2 }), /نسخه/);

const html = fs.readFileSync('index.html', 'utf8');
const receiptStart = html.indexOf('function receiveImportShipment(shipment, receiptContext');
const receiptEnd = html.indexOf('function getImportReceiptCorrectionBlockReason(shipment)', receiptStart);
assert.ok(receiptStart >= 0 && receiptEnd > receiptStart, 'receipt handler is present');
const receiptHandler = html.slice(receiptStart, receiptEnd);
const snapshotAssignment = receiptHandler.indexOf('shipment.receiptSnapshot = receiptSnapshot');
const batchMutation = receiptHandler.indexOf('addStockBatch(product');
const stockMutation = receiptHandler.indexOf('product.stock = oldStock + qty');
assert.ok(snapshotAssignment >= 0 && snapshotAssignment < batchMutation, 'snapshot is attached before batch mutation');
assert.ok(snapshotAssignment < stockMutation, 'snapshot is attached before stock mutation');
assert.ok(receiptHandler.includes('delete shipment.receiptSnapshot'), 'failed receipt clears its uncommitted snapshot');
assert.ok(receiptHandler.includes('if (shipment.receiptSnapshot) throw'), 'existing snapshots prevent duplicate receipt posting');
assert.ok(html.includes('createReceiptSnapshot(shipment, state.products'), 'receipt handler uses the versioned snapshot builder');
assert.ok(html.includes('function saveState()'), 'snapshot persists through the existing state journal');
assert.ok(html.includes('writeLocalMirror(JSON.parse(snapshot), operation)'), 'state and snapshot enter the same local operation journal');

console.log('PASS: versioned import receipt snapshots capture immutable pre-receipt product state before stock mutations');

const reversalShipment = {
  id: 'IMP-REV-1',
  postedToWh: true,
  items: [{ id: 'REV-ITEM-1', productId: 'REV-P1', quantityKg: 10, landedCostRial: 1200 }]
};
const beforeProduct = {
  id: 'REV-P1',
  stock: 20,
  buyPrice: 100,
  lastMoveDays: 5,
  kardex: [{ doc: 'OPENING', inQty: 20, outQty: 0, bal: 20 }],
  batches: [{ id: 'BASE-BATCH', quantity: 20, remainingQty: 20, unitCost: 100 }]
};
const receiptSnapshot = createReceiptSnapshot(reversalShipment, [beforeProduct], {
  schemaVersion: 1,
  snapshotId: 'REV-SNAPSHOT-1',
  capturedAt: '2026-11-19T08:10:00.000Z',
  receivedDate: '1405/08/28',
  previousStatus: 'cleared',
  actor: 'mehran',
  deviceId: 'device-reversal-test',
  costingMethod: 'AVG'
});
reversalShipment.receiptSnapshot = receiptSnapshot;
const postedProduct = {
  ...JSON.parse(JSON.stringify(beforeProduct)),
  stock: 30,
  buyPrice: 107,
  lastMoveDays: 0,
  kardex: [
    ...JSON.parse(JSON.stringify(beforeProduct.kardex)),
    { date: '1405/08/28', doc: 'تحویل محموله IMP-REV-1 به انبار', inQty: 10, outQty: 0, bal: 30, price: 120, batchRef: 'IMP-REV-1', sourceItemId: 'REV-ITEM-1' }
  ],
  batches: [
    ...JSON.parse(JSON.stringify(beforeProduct.batches)),
    { id: 'REV-BATCH-1', quantity: 10, remainingQty: 10, unitCost: 120, sourceType: 'import', sourceRef: 'IMP-REV-1', sourceItemId: 'REV-ITEM-1' }
  ]
};
const registrationVoucher = {
  id: 'V-IMP-REV-1', sourceType: 'import', sourceId: 'IMP-REV-1', sourceEvent: 'registration'
};
assert.equal(getReceiptReversalBlockReason(
  reversalShipment, [postedProduct], [], [registrationVoucher]
), null, 'a pristine, snapshot-backed receipt is eligible for physical reversal');

const legacyBefore = {
  id: 'REV-LEGACY-P', stock: 20, buyPrice: 100, lastMoveDays: 4,
  kardex: [{ doc: 'LEGACY-OPEN', inQty: 20, outQty: 0, bal: 20 }],
  batches: []
};
const legacyShipment = {
  id: 'IMP-LEGACY-REV',
  postedToWh: true,
  items: [{ id: 'LEGACY-ITEM', productId: 'REV-LEGACY-P', quantityKg: 10, landedCostRial: 1200 }]
};
legacyShipment.receiptSnapshot = createReceiptSnapshot(legacyShipment, [legacyBefore], {
  schemaVersion: 1, snapshotId: 'LEGACY-REV-SNAPSHOT', capturedAt: '2026-11-19T08:20:00.000Z',
  receivedDate: '1405/08/28', previousStatus: 'cleared', actor: 'mehran',
  deviceId: 'device-reversal-test', costingMethod: 'AVG'
});
const legacyPostedProduct = {
  ...JSON.parse(JSON.stringify(legacyBefore)),
  stock: 30, buyPrice: 107, lastMoveDays: 0,
  kardex: [
    ...JSON.parse(JSON.stringify(legacyBefore.kardex)),
    { date: '1405/08/28', doc: 'تحویل محموله IMP-LEGACY-REV به انبار', inQty: 10, outQty: 0, bal: 30, price: 120, batchRef: 'IMP-LEGACY-REV', sourceItemId: 'LEGACY-ITEM' }
  ],
  batches: [
    { id: 'LEGACY-REV-LEGACY-P', lot: 'LEGACY', receivedDate: '0000/00/00', productionDate: '', expiryDate: '', quantity: 20, remainingQty: 20, unitCost: 100, sourceType: 'legacy_opening', sourceRef: 'legacy-stock' },
    { id: 'LEGACY-REV-BATCH', quantity: 10, remainingQty: 10, unitCost: 120, sourceType: 'import', sourceRef: 'IMP-LEGACY-REV', sourceItemId: 'LEGACY-ITEM' }
  ]
};
assert.equal(getReceiptReversalBlockReason(
  legacyShipment, [legacyPostedProduct], [],
  [{ id: 'V-LEGACY-REV', sourceType: 'import', sourceId: 'IMP-LEGACY-REV', sourceEvent: 'registration' }]
), null, 'the one-time legacy opening batch created during receipt is accounted for safely');

const changedStock = JSON.parse(JSON.stringify(postedProduct));
changedStock.stock += 1;
assert.match(getReceiptReversalBlockReason(
  reversalShipment, [changedStock], [], [registrationVoucher]
), /موجودی یا بهای کالا/);

const laterMovement = JSON.parse(JSON.stringify(postedProduct));
laterMovement.stock += 1;
laterMovement.kardex.push({ doc: 'LATER-MOVE', inQty: 1, outQty: 0, bal: 31 });
assert.match(getReceiptReversalBlockReason(
  reversalShipment, [laterMovement], [], [registrationVoucher]
), /پس از رسید/);

const transferredProduct = JSON.parse(JSON.stringify(postedProduct));
const transferDestination = {
  id: 'REV-P2', stock: 10, buyPrice: 0, lastMoveDays: 0, kardex: [],
  batches: [{ id: 'REV-TRANSFER-BATCH', quantity: 2, remainingQty: 2, sourceBatchId: 'REV-BATCH-1' }]
};
assert.match(getReceiptReversalBlockReason(
  reversalShipment, [transferredProduct, transferDestination], [], [registrationVoucher]
), /بچ انتقالی/);

const invoice = { id: 'INV-REV-1', items: [{ fifoAllocations: [{ batchId: 'REV-BATCH-1', quantity: 1 }] }] };
assert.match(getReceiptReversalBlockReason(
  reversalShipment, [postedProduct], [invoice], [registrationVoucher]
), /فاکتور/);

assert.match(getReceiptReversalBlockReason(
  reversalShipment, [postedProduct], [], []
), /سند ثبت مالی/);

const extraSnapshotProduct = JSON.parse(JSON.stringify(reversalShipment));
extraSnapshotProduct.receiptSnapshot.products.push({ productId: 'UNRELATED', state: { id: 'UNRELATED' } });
assert.match(getReceiptReversalBlockReason(
  extraSnapshotProduct, [postedProduct], [], [registrationVoucher]
), /فهرست کالاهای snapshot/);

const legacyReceipt = { id: 'IMP-LEGACY', postedToWh: true, items: reversalShipment.items };
assert.match(getReceiptReversalBlockReason(
  legacyReceipt, [postedProduct], [], [registrationVoucher]
), /snapshot معتبر/);

assert.ok(html.includes('function getImportReceiptReversalBlockReason(shipment)'), 'UI uses the domain preflight guard');
assert.ok(html.includes('function requestImportReceiptReversal(importId)'), 'UI exposes the guarded reversal action');
assert.ok(html.includes('برگشت امن رسید'), 'snapshot-backed receipts expose a distinct reversal action');
assert.ok(html.includes('delete shipment.receiptSnapshot'), 'successful reversal archives then clears the active snapshot');
assert.ok(html.includes('preservedRegistrationVoucherId'), 'reversal audit records the preserved financial voucher');
assert.ok(html.includes('سند مالی ثبت محموله') && html.includes('بدون تغییر حفظ شد'), 'the financial registration voucher is explicitly preserved');

console.log('PASS: import receipt reversal only allows pristine snapshot-backed receipts and blocks downstream dependencies');
