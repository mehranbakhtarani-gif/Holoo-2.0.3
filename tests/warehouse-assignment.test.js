const assert = require('node:assert/strict');
const { buildWarehouseAssignmentPlan } = require('../warehouse-assignment-domain.js');

const warehouses = [{ id: 'A', name: 'انبار A' }, { id: 'B', name: 'انبار B' }];
function state(product, extras = {}) {
  return { products: [product], warehouses, invoices: [], orders: [], imports: [], vouchers: [], ...extras };
}
function test(name, fn) { fn(); console.log('PASS: ' + name); }

test('allows a zero-stock product with no movement or document history', () => {
  const source = state({ id: 'P1', name: 'کالا', stock: 0, warehouseId: null, kardex: [], batches: [] });
  const before = JSON.stringify(source);
  const plan = buildWarehouseAssignmentPlan(source, 'P1', 'B');
  assert.equal(plan.ok, true);
  assert.equal(plan.targetWarehouseId, 'B');
  assert.equal(plan.accountingImpact, 'none');
  assert.equal(plan.inventoryMovement, false);
  assert.equal(JSON.stringify(source), before, 'preflight must not mutate the source state');
});

test('blocks products with non-zero or invalid stock', () => {
  for (const stock of [12, 'invalid', -1]) {
    const plan = buildWarehouseAssignmentPlan(state({ id: 'P1', name: 'کالا', stock, kardex: [], batches: [] }), 'P1', 'B');
    assert.equal(plan.ok, false);
  }
});

test('blocks products with Kardex or batch history', () => {
  for (const product of [
    { id: 'P1', name: 'کالا', stock: 0, kardex: [{ inQty: 1 }], batches: [] },
    { id: 'P1', name: 'کالا', stock: 0, kardex: [], batches: [{ id: 'L1' }] }
  ]) {
    assert.equal(buildWarehouseAssignmentPlan(state(product), 'P1', 'B').ok, false);
  }
});

test('blocks duplicate base-product records in the target warehouse', () => {
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

test('blocks unknown destination warehouses', () => {
  const plan = buildWarehouseAssignmentPlan(state({ id: 'P1', name: 'کالا', stock: 0, kardex: [], batches: [] }), 'P1', 'GONE');
  assert.equal(plan.ok, false);
  assert.ok(plan.reasons.some(reason => reason.includes('وجود ندارد')));
});

test('blocks references in invoices, orders, imports and vouchers', () => {
  for (const key of ['invoices', 'orders', 'imports', 'vouchers']) {
    const plan = buildWarehouseAssignmentPlan(
      state({ id: 'P1', name: 'کالا', stock: 0, kardex: [], batches: [] }, { [key]: [{ items: [{ productId: 'P1' }] }] }),
      'P1', 'B'
    );
    assert.equal(plan.ok, false, key);
    assert.ok(plan.reasons.some(reason => reason.includes('ارجاعی')));
  }
});

test('blocks duplicate product IDs and already valid warehouse assignments', () => {
  const duplicate = { warehouses, products: [
    { id: 'P1', name: 'کالا', stock: 0, warehouseId: null },
    { id: 'P1', name: 'کالای تکراری', stock: 0, warehouseId: null }
  ] };
  assert.equal(buildWarehouseAssignmentPlan(duplicate, 'P1', 'B').ok, false);
  assert.equal(buildWarehouseAssignmentPlan(state({ id: 'P1', name: 'کالا', stock: 0, warehouseId: 'A' }), 'P1', 'B').ok, false);
});

test('requires a valid destination and product name', () => {
  assert.equal(buildWarehouseAssignmentPlan(state({ id: 'P1', name: 'کالا', stock: 0 }), 'P1', '').ok, false);
  assert.equal(buildWarehouseAssignmentPlan(state({ id: 'P1', name: '', stock: 0 }), 'P1', 'B').ok, false);
});

console.log('PASS: 8 controlled warehouse assignment tests');
