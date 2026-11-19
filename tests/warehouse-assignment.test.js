const assert = require('node:assert/strict');
const { buildWarehouseAssignmentPlan } = require('../warehouse-audit-domain.js');

const warehouses = [{ id: 'A', name: 'انبار A' }, { id: 'B', name: 'انبار B' }];
const baseState = () => ({
  warehouses,
  products: [{ id: 'P1', baseProductId: 'P', name: 'کالا', warehouseId: 'GONE', stock: 0, kardex: [], batches: [] }],
  invoices: [], imports: [], orders: [], warehouseTransfers: []
});
function test(name, fn) { fn(); console.log('PASS: ' + name); }

test('allows zero-stock history-free product assignment without mutating source state', () => {
  const state = baseState();
  const before = JSON.stringify(state);
  const plan = buildWarehouseAssignmentPlan(state, 'P1', 'A');
  assert.equal(plan.ok, true);
  assert.equal(plan.targetWarehouseId, 'A');
  assert.equal(plan.stock, 0);
  assert.equal(JSON.stringify(state), before);
});

test('requires an explicit destination before finalizing the plan', () => {
  const plan = buildWarehouseAssignmentPlan(baseState(), 'P1', null);
  assert.equal(plan.ok, true);
  assert.equal(plan.requiresTarget, true);
});

test('blocks non-zero and non-finite stock', () => {
  for (const stock of [3, 'bad', -1]) {
    const state = baseState();
    state.products[0].stock = stock;
    assert.equal(buildWarehouseAssignmentPlan(state, 'P1', 'A').ok, false);
  }
});

test('blocks any Kardex or batch history', () => {
  const stateWithKardex = baseState();
  stateWithKardex.products[0].kardex = [{ date: '1405/01/01', inQty: 1, bal: 1 }];
  assert.equal(buildWarehouseAssignmentPlan(stateWithKardex, 'P1', 'A').ok, false);
  const stateWithBatch = baseState();
  stateWithBatch.products[0].batches = [{ id: 'LOT-1', quantity: 0, remainingQty: 0 }];
  assert.equal(buildWarehouseAssignmentPlan(stateWithBatch, 'P1', 'A').ok, false);
});

test('blocks references in invoices, imports, orders and warehouse transfers', () => {
  for (const collection of ['invoices', 'imports', 'orders', 'warehouseTransfers']) {
    const state = baseState();
    state[collection] = [{ lines: [{ productId: 'P1' }] }];
    assert.equal(buildWarehouseAssignmentPlan(state, 'P1', 'A').ok, false, collection);
  }
});

test('blocks a duplicate base product in the destination warehouse', () => {
  const state = baseState();
  state.products.push({ id: 'P2', baseProductId: 'P', warehouseId: 'A', stock: 4 });
  assert.equal(buildWarehouseAssignmentPlan(state, 'P1', 'A').ok, false);
});

test('blocks missing destination warehouses and duplicate product IDs', () => {
  assert.equal(buildWarehouseAssignmentPlan(baseState(), 'P1', 'MISSING').ok, false);
  const duplicate = baseState();
  duplicate.products.push({ id: 'P1', warehouseId: null, stock: 0 });
  assert.equal(buildWarehouseAssignmentPlan(duplicate, 'P1', 'A').ok, false);
});

test('blocks products already assigned to a valid warehouse', () => {
  const state = baseState();
  state.products[0].warehouseId = 'B';
  assert.equal(buildWarehouseAssignmentPlan(state, 'P1', 'A').ok, false);
});

console.log('PASS: 8 controlled warehouse assignment tests');
