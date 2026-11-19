const assert = require('node:assert/strict');
const { buildWarehouseAssignmentPlan } = require('../warehouse-assignment-domain.js');

const warehouses = [{ id: 'A', name: 'انبار A' }, { id: 'B', name: 'انبار B' }];
function state(product, extras = {}) {
  return { products: [product], warehouses, invoices: [], orders: [], imports: [], vouchers: [], ...extras };
}
function testCase(name, fn) { fn(); console.log('PASS: ' + name); }

testCase('allows a zero-stock product with no movement or document history', () => {
  const source = state({ id: 'P1', name: 'کالا', stock: 0, warehouseId: null, kardex: [], batches: [] });
  const plan = buildWarehouseAssignmentPlan(source, 'P1', 'B');
  assert.equal(plan.ok, true);
  assert.equal(plan.targetWarehouseId, 'B');
  assert.equal(plan.accountingImpact, 'none');
  assert.equal(plan.inventoryMovement, false);
  assert.equal(source.products[0].warehouseId, null);
});

testCase('blocks products with non-zero stock', () => {
  const plan = buildWarehouseAssignmentPlan(state({ id: 'P1', name: 'کالا', stock: 12, kardex: [], batches: [] }), 'P1', 'B');
  assert.equal(plan.ok, false);
  assert.ok(plan.reasons.some(reason => reason.includes('موجودی غیرصفر')));
});

testCase('blocks products with Kardex or batch history', () => {
  for (const product of [
    { id: 'P1', name: 'کالا', stock: 0, kardex: [{ inQty: 1 }], batches: [] },
    { id: 'P1', name: 'کالا', stock: 0, kardex: [], batches: [{ id: 'L1' }] }
  ]) {
    const plan = buildWarehouseAssignmentPlan(state(product), 'P1', 'B');
    assert.equal(plan.ok, false);
  }
});

testCase('blocks duplicate base-product records in the target warehouse', () => {
  const source = {
    warehouses,
    products: [
      { id: 'P1', baseProductId: 'BASE', name: 'کالا', stock: 0, warehouseId: null, kardex: [], batches: [] },
      { id: 'P2', baseProductId: 'BASE', name: 'کالا', stock: 4, warehouseId: 'B', kardex: [], batches: [] }
    ]
  };
  const plan = buildWarehouseAssignmentPlan(source, 'P1', 'B');
  assert.equal(plan.ok, false);
  assert.ok(plan.reasons.some(reason => reason.includes('رکورد دیگری')));
});

testCase('blocks unknown destination warehouses', () => {
  const plan = buildWarehouseAssignmentPlan(state({ id: 'P1', name: 'کالا', stock: 0, kardex: [], batches: [] }), 'P1', 'GONE');
  assert.equal(plan.ok, false);
  assert.ok(plan.reasons.some(reason => reason.includes('وجود ندارد')));
});

testCase('blocks product references found in invoices, orders, imports, or vouchers', () => {
  for (const key of ['invoices', 'orders', 'imports', 'vouchers']) {
    const plan = buildWarehouseAssignmentPlan(
      state({ id: 'P1', name: 'کالا', stock: 0, kardex: [], batches: [] }, { [key]: [{ items: [{ productId: 'P1' }] }] }),
      'P1', 'B'
    );
    assert.equal(plan.ok, false, key);
    assert.ok(plan.reasons.some(reason => reason.includes('ارجاعی')));
  }
});

testCase('blocks duplicate product IDs and already valid assignments', () => {
  const duplicate = { warehouses, products: [
    { id: 'P1', name: 'کالا', stock: 0, warehouseId: null },
    { id: 'P1', name: 'کالا دوم', stock: 0, warehouseId: null }
  ] };
  assert.equal(buildWarehouseAssignmentPlan(duplicate, 'P1', 'B').ok, false);
  assert.equal(buildWarehouseAssignmentPlan(state({ id: 'P1', name: 'کالا', stock: 0, warehouseId: 'A' }), 'P1', 'B').ok, false);
});

testCase('requires an explicit destination and rejects invalid stock', () => {
  assert.equal(buildWarehouseAssignmentPlan(state({ id: 'P1', name: 'کالا', stock: 0 }), 'P1', '').ok, false);
  assert.equal(buildWarehouseAssignmentPlan(state({ id: 'P1', name: 'کالا', stock: 'bad' }), 'P1', 'B').ok, false);
});


const { inspectWarehouseAssignmentHistory } = require('../warehouse-assignment-domain.js');

testCase('reports a history-free zero-stock product as eligible for the existing controlled path', () => {
  const source = state({ id: 'P1', name: 'کالا', stock: 0, warehouseId: null, kardex: [], batches: [] });
  const before = JSON.stringify(source);
  const report = inspectWarehouseAssignmentHistory(source, 'P1');
  assert.equal(report.ok, true);
  assert.equal(report.classification, 'no-history-found');
  assert.equal(report.canAutoReassign, true);
  assert.equal(report.movementCount, 0);
  assert.equal(JSON.stringify(source), before);
});

testCase('traces Kardex rows and explicit historical warehouse IDs without mutation', () => {
  const source = state({
    id: 'P1', name: 'کالا', stock: 2, warehouseId: 'GONE', batches: [],
    kardex: [{ date: '1405/02/01', doc: 'فاکتور خرید', inQty: 2, outQty: 0, bal: 2, warehouseId: 'A' }]
  });
  const report = inspectWarehouseAssignmentHistory(source, 'P1');
  assert.equal(report.classification, 'historical-evidence');
  assert.equal(report.movementCount, 1);
  assert.deepEqual(report.warehouseIds, ['A']);
  assert.equal(report.canAutoReassign, false);
  assert.equal(source.products[0].warehouseId, 'GONE');
});

testCase('traces batch lineage and identifies missing warehouse provenance', () => {
  const source = state({
    id: 'P1', name: 'کالا', stock: 0, warehouseId: 'GONE', kardex: [],
    batches: [{ id: 'LOT-1', lot: 'L-1', sourceType: 'warehouse_transfer', sourceRef: 'TR-1-ab', sourceBatchId: 'LOT-0', quantity: 5, remainingQty: 0 }]
  });
  const report = inspectWarehouseAssignmentHistory(source, 'P1');
  assert.equal(report.batchCount, 1);
  assert.equal(report.batches[0].sourceBatchId, 'LOT-0');
  assert.equal(report.unresolvedWarehouseEvidenceCount, 1);
  assert.equal(report.canAutoReassign, false);
});

testCase('finds document references across invoice, voucher and order records', () => {
  const source = state({ id: 'P1', name: 'کالا', stock: 0, kardex: [], batches: [] }, {
    invoices: [{ id: 'INV-1', date: '1405/01/01', items: [{ productId: 'P1' }] }],
    vouchers: [{ id: 'V-1', lines: [{ product_id: 'P1' }] }],
    orders: [{ id: 'O-1', items: [{ stockProductId: 'P1' }] }]
  });
  const report = inspectWarehouseAssignmentHistory(source, 'P1');
  assert.equal(report.documentReferenceCount, 3);
  assert.equal(report.canAutoReassign, false);
});

testCase('includes append-only audit references in the historical evidence report', () => {
  const source = state({ id: 'P1', name: 'کالا', stock: 0, kardex: [], batches: [] }, {
    auditLogs: [{ sourceId: 'P1', operationId: 'op-1', sourceType: 'warehouse_assignment', action: 'انتساب کالا' }]
  });
  const report = inspectWarehouseAssignmentHistory(source, 'P1');
  assert.equal(report.auditReferenceCount, 1);
  assert.equal(report.auditReferences[0].operationId, 'op-1');
  assert.equal(report.canAutoReassign, false);
});

testCase('rejects ambiguous product IDs instead of selecting one history', () => {
  const source = { warehouses, products: [
    { id: 'P1', name: 'کالا', stock: 0 },
    { id: 'P1', name: 'کالای دوم', stock: 0 }
  ] };
  const report = inspectWarehouseAssignmentHistory(source, 'P1');
  assert.equal(report.ok, false);
  assert.equal(report.classification, 'unresolved');
});

console.log('PASS: 6 historical warehouse assignment inspection tests');
console.log('PASS: 8 controlled warehouse assignment tests');
