const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function resolveInvoiceWarehouseProduct(');
const end = html.indexOf('    function renderInvoiceProductOptions(', start);
assert.notEqual(start, -1, 'warehouse resolver must exist');
assert.notEqual(end, -1, 'warehouse resolver section must end before product options');
const source = html.slice(start, end);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source + '; this.resolve = resolveInvoiceWarehouseProduct;', sandbox);
const resolve = sandbox.resolve;

const products = [
  { id: 'P-1', name: 'کالا', warehouseId: 'WH-A', stock: 12, buyPrice: 100, batches: [{ id: 'A1', remainingQty: 12 }], kardex: [] },
  { id: 'P-1::WH-B', baseProductId: 'P-1', name: 'کالا', warehouseId: 'WH-B', stock: 4, buyPrice: 100, batches: [{ id: 'B1', remainingQty: 4 }], kardex: [] }
];

const sale = resolve('P-1', 'WH-B', products, false);
assert.equal(sale.product.id, 'P-1::WH-B');
assert.equal(sale.product.warehouseId, 'WH-B');
assert.equal(sale.created, false);

const missingSale = resolve('P-1', 'WH-C', products, false);
assert.equal(missingSale.product, null, 'sales must not fall back to stock in another warehouse');

const purchase = resolve('P-1', 'WH-C', products, true);
assert.equal(purchase.created, true);
assert.equal(purchase.product.id, 'P-1::WH-C');
assert.equal(purchase.product.baseProductId, 'P-1');
assert.equal(purchase.product.warehouseId, 'WH-C');
assert.equal(purchase.product.stock, 0);
assert.deepEqual(JSON.parse(JSON.stringify(purchase.product.batches)), []);
assert.equal(products[0].stock, 12, 'preparing a purchase warehouse record must not mutate source stock');
assert.equal(products.length, 2, 'preparing a purchase warehouse record must not mutate the live product list');

const existingPurchase = resolve('P-1', 'WH-B', products, true);
assert.equal(existingPurchase.product, products[1]);
assert.equal(existingPurchase.created, false);

console.log('PASS: invoice warehouse product resolution');
