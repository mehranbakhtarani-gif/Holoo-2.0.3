const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  getReceiptAuditView,
  escapeReceiptAuditText
} = require('../import-domain.js');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

const snapshot = {
  schemaVersion: 1,
  snapshotId: 'SNAP-1',
  shipmentId: 'IMP-AUDIT-1',
  capturedAt: '2026-11-19T08:00:00.000Z',
  receivedDate: '1405/08/28',
  previousStatus: 'cleared',
  actor: 'mehran',
  deviceId: 'device-1',
  costingMethod: 'AVG',
  items: [{ id: 'ITEM-1', productId: 'P-1', quantityKg: 12 }],
  products: [{
    productId: 'P-1',
    state: { id: 'P-1', stock: 30, buyPrice: 120, batches: [{ id: 'B-1' }], kardex: [{ doc: 'OPEN' }] }
  }]
};
const voucher = {
  id: 'V-IMP-1',
  sourceType: 'import',
  sourceId: 'IMP-AUDIT-1',
  sourceEvent: 'registration'
};
const reversal = {
  id: 'REV-1',
  snapshotId: 'SNAP-1',
  reversedAt: '2026-11-19T09:00:00.000Z',
  actor: 'ehsan',
  deviceId: 'device-2',
  previousStatus: 'cleared',
  preservedRegistrationVoucherId: 'V-IMP-1',
  method: 'versioned_pre_receipt_snapshot'
};
const shipment = deepFreeze({
  id: 'IMP-AUDIT-1',
  postedToWh: false,
  receiptHistory: [{ snapshot, reversal }]
});
const frozenVoucher = deepFreeze(voucher);

const view = getReceiptAuditView(shipment, [frozenVoucher]);
assert.equal(view.isPosted, false);
assert.equal(view.activeSnapshot, null);
assert.equal(view.history.length, 1);
assert.equal(view.history[0].snapshot.snapshotId, 'SNAP-1');
assert.equal(view.history[0].reversal.actor, 'ehsan');
assert.equal(view.history[0].preservedVoucher.id, 'V-IMP-1');
assert.equal(view.history[0].snapshot.products[0].state.stock, 30);
assert.equal(shipment.receiptHistory[0].snapshot.products[0].state.stock, 30,
  'read-only projection must not mutate archived snapshot state');
assert.equal(voucher.id, 'V-IMP-1', 'voucher data remains unchanged');

const active = getReceiptAuditView(deepFreeze({
  id: 'IMP-ACTIVE',
  postedToWh: true,
  receiptSnapshot: snapshot,
  receiptHistory: []
}), [deepFreeze({ id: 'V-ACTIVE', sourceType: 'import', sourceId: 'IMP-ACTIVE', sourceEvent: 'registration' })]);
assert.equal(active.isPosted, true);
assert.equal(active.activeSnapshot.snapshotId, 'SNAP-1');
assert.equal(active.registrationVoucher.id, 'V-ACTIVE');

const legacy = getReceiptAuditView(deepFreeze({
  id: 'IMP-LEGACY',
  postedToWh: true
}), []);
assert.equal(legacy.isPosted, true);
assert.equal(legacy.activeSnapshot, null);
assert.equal(legacy.history.length, 0,
  'legacy receipts without snapshots remain clearly distinguishable');

const incomplete = getReceiptAuditView(deepFreeze({
  id: 'IMP-PARTIAL',
  postedToWh: false,
  receiptHistory: [{ snapshot: null, reversal: { actor: 'mehran' } }]
}), []);
assert.equal(incomplete.history.length, 1);
assert.equal(incomplete.history[0].snapshot, null);
assert.equal(incomplete.history[0].reversal.actor, 'mehran');

assert.equal(
  escapeReceiptAuditText('<img src=x onerror="alert(1)"> & \'test\''),
  '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;test&#39;',
  'user-controlled audit strings must be HTML escaped'
);
assert.equal(escapeReceiptAuditText(null), '');

const malformedNested = getReceiptAuditView(deepFreeze({
  id: 'IMP-MALFORMED',
  postedToWh: false,
  receiptHistory: [{ snapshot: { products: [null], items: [null] }, reversal: null }]
}), []);
assert.equal(malformedNested.history[0].snapshot.products[0], null,
  'malformed nested audit entries are passed through read-only for safe UI fallback');

const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('function renderImportReceiptAuditPanel(shipment)'));
assert.ok(html.includes('${renderImportReceiptAuditPanel(m)}'),
  'import cards render the read-only audit panel');
assert.ok(html.includes('این رسید قبل از ایجاد snapshot ثبت شده'),
  'legacy receipts explain why pre-receipt details are unavailable');
assert.ok(html.includes('در نسخه فعلی ثبت نشده'),
  'missing reversal reason is displayed honestly');
assert.ok(html.includes('حذف یا معکوس نشده است'),
  'the financial registration voucher is explicitly described as preserved');
assert.ok(html.includes('escapeReceiptAuditText'),
  'dynamic audit text is escaped before HTML rendering');

console.log('PASS: import receipt snapshot and reversal history are displayed through a read-only, escaped audit projection');
