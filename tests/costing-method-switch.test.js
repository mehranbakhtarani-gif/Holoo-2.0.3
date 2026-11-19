const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function buildCostingMethodSwitchPlan(');
const end = html.indexOf('    function isOpeningKardexDocument(', start);
assert.notEqual(start, -1, 'costing switch planner must exist');
assert.notEqual(end, -1, 'costing switch planner section must have an end');
const source = html.slice(start, end);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source + '; this.api = { buildCostingMethodSwitchPlan };', sandbox);
const { buildCostingMethodSwitchPlan } = sandbox.api;

function test(name, fn) { fn(); console.log('PASS: ' + name); }

test('AVG to FIFO preserves existing batches and reports valuation impact', () => {
  const products = [{ id: 'P1', name: 'کالا', stock: 10, buyPrice: 120, batches: [
    { id: 'B1', remainingQty: 4, quantity: 4, unitCost: 100 },
    { id: 'B2', remainingQty: 6, quantity: 6, unitCost: 150 }
  ] }];
  const before = JSON.stringify(products);
  const plan = buildCostingMethodSwitchPlan(products, 'AVG', 'FIFO');
  assert.equal(plan.ok, true);
  assert.equal(plan.beforeValue, 1200);
  assert.equal(plan.afterValue, 1300);
  assert.equal(plan.delta, 100);
  assert.equal(JSON.stringify(products), before, 'planning must not mutate live products');
});

test('FIFO to AVG derives buyPrice from remaining FIFO layers', () => {
  const plan = buildCostingMethodSwitchPlan([{ id: 'P2', stock: 10, buyPrice: 999, batches: [
    { id: 'B1', remainingQty: 4, quantity: 4, unitCost: 100 },
    { id: 'B2', remainingQty: 6, quantity: 6, unitCost: 150 }
  ] }], 'FIFO', 'AVG');
  assert.equal(plan.ok, true);
  assert.equal(plan.updates[0].buyPrice, 130);
  assert.equal(plan.beforeValue, 1300);
  assert.equal(plan.afterValue, 1300);
});

test('legacy stock without batches receives a planned opening layer', () => {
  const plan = buildCostingMethodSwitchPlan([{ id: 'LEG-1', stock: 5, buyPrice: 80, batches: [] }], 'AVG', 'FIFO');
  assert.equal(plan.ok, true);
  assert.equal(plan.updates[0].batches.length, 1);
  assert.equal(plan.updates[0].batches[0].remainingQty, 5);
  assert.equal(plan.updates[0].batches[0].unitCost, 80);
});

test('batch mismatch blocks the switch without mutating source data', () => {
  const products = [{ id: 'BAD-1', name: 'مغایر', stock: 5, buyPrice: 80, batches: [
    { id: 'B1', remainingQty: 4, quantity: 4, unitCost: 80 }
  ] }];
  const before = JSON.stringify(products);
  const plan = buildCostingMethodSwitchPlan(products, 'AVG', 'FIFO');
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /مغایرت‌گیری/);
  assert.equal(JSON.stringify(products), before);
});

test('invalid and duplicate batch layers block the switch', () => {
  const duplicate = buildCostingMethodSwitchPlan([{ id: 'DUP', stock: 2, buyPrice: 10, batches: [
    { id: 'B', remainingQty: 1, quantity: 1, unitCost: 10 },
    { id: 'B', remainingQty: 1, quantity: 1, unitCost: 10 }
  ] }], 'AVG', 'FIFO');
  assert.equal(duplicate.ok, false);
  const invalid = buildCostingMethodSwitchPlan([{ id: 'BAD', stock: 1, buyPrice: 10, batches: [
    { id: 'B', remainingQty: 1, quantity: 1, unitCost: -1 }
  ] }], 'AVG', 'FIFO');
  assert.equal(invalid.ok, false);
});

test('zero-stock products switch without manufacturing a batch', () => {
  const plan = buildCostingMethodSwitchPlan([{ id: 'ZERO', stock: 0, buyPrice: 25, batches: [] }], 'AVG', 'FIFO');
  assert.equal(plan.ok, true);
  assert.equal(plan.updates[0].batches.length, 0);
});

console.log('PASS: 6 costing-method switch tests');
