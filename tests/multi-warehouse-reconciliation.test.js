const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function inspectWarehouseProductTopology(');
const end = html.indexOf('    function inspectInventoryReconciliation(', start);
assert.notEqual(start, -1, 'warehouse topology helper must exist');
assert.notEqual(end, -1, 'warehouse topology helper must have an end');
const source = html.slice(start, end);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source + '\nthis.inspect = inspectWarehouseProductTopology;', sandbox);
const inspect = sandbox.inspect;
const warehouses = [{ id: 'A', name: 'انبار A' }, { id: 'B', name: 'انبار B' }];

function test(name, fn) { fn(); console.log('PASS: ' + name); }

test('aggregates one base product once across two distinct warehouses', () => {
  const result = inspect([
    { id: 'P1', baseProductId: 'P', warehouseId: 'A', name: 'کالا', stock: 12 },
    { id: 'P::B', baseProductId: 'P', warehouseId: 'B', name: 'کالا', stock: 8 }
  ], warehouses);
  assert.equal(result.issueCount, 0);
  assert.equal(result.checkedBaseProducts, 1);
  assert.equal(result.summaries[0].totalStock, 20);
  assert.equal(result.companyTotalStock, 20);
});

test('flags duplicate base product records within one warehouse and refuses to total them', () => {
  const result = inspect([
    { id: 'P1', baseProductId: 'P', warehouseId: 'A', name: 'کالا', stock: 12 },
    { id: 'P2', baseProductId: 'P', warehouseId: 'A', name: 'کالا', stock: 8 }
  ], warehouses);
  assert.ok(result.issues.some(issue => issue.type === 'warehouse-product-duplicate'));
  assert.equal(result.summaries[0].totalStock, null);
  assert.equal(result.companyTotalStock, null);
});

test('flags references to warehouses that do not exist', () => {
  const result = inspect([{ id: 'P', warehouseId: 'MISSING', name: 'کالا', stock: 5 }], warehouses);
  assert.ok(result.issues.some(issue => issue.type === 'warehouse-product-reference'));
  assert.equal(result.companyTotalStock, null);
});

test('flags missing warehouse identity', () => {
  const result = inspect([{ id: 'P', name: 'کالا', stock: 5 }], warehouses);
  assert.ok(result.issues.some(issue => issue.type === 'warehouse-product-reference'));
});

test('flags invalid negative and non-finite stock', () => {
  const result = inspect([
    { id: 'P1', warehouseId: 'A', name: 'منفی', stock: -2 },
    { id: 'P2', warehouseId: 'B', name: 'نامعتبر', stock: 'x' }
  ], warehouses);
  assert.equal(result.issues.filter(issue => issue.type === 'warehouse-product-stock').length, 2);
  assert.equal(result.companyTotalStock, null);
});

test('flags duplicated record IDs even if the warehouse differs', () => {
  const result = inspect([
    { id: 'P', baseProductId: 'P', warehouseId: 'A', name: 'کالا', stock: 5 },
    { id: 'P', baseProductId: 'P', warehouseId: 'B', name: 'کالا', stock: 7 }
  ], warehouses);
  assert.ok(result.issues.some(issue => issue.type === 'warehouse-product-id-duplicate'));
});

test('keeps separate base products as separate company totals', () => {
  const result = inspect([
    { id: 'P1', warehouseId: 'A', name: 'کالای یک', stock: 5 },
    { id: 'P2', warehouseId: 'B', name: 'کالای دو', stock: 7 }
  ], warehouses);
  assert.equal(result.checkedBaseProducts, 2);
  assert.equal(result.companyTotalStock, 12);
});

console.log('PASS: 7 multi-warehouse reconciliation tests');
