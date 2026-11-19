const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  createReceiptSnapshot
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
  costingMethod: 'FIFO'
});

assert.equal(snapshot.schemaVersion, 1);
assert.equal(snapshot.snapshotId, 'receipt_snapshot_test');
assert.equal(snapshot.shipmentId, 'IMP-SNAPSHOT-1');
assert.equal(snapshot.actor, 'mehran');
assert.equal(snapshot.deviceId, 'device-test');
assert.equal(snapshot.costingMethod, 'FIFO');
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
const receiptStart = html.indexOf('function receiveImportShipment(shipment)');
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
