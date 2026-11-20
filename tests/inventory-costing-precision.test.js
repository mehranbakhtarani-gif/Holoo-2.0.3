const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function safeInventoryDecimalUnits(value, maxDecimals = 6, roundExcess = false) {');
const end = html.indexOf('    // =========================================================================\n    // 7. MODULE 3:', start);
assert.ok(start >= 0 && end > start, 'inventory precision helpers and FIFO functions must exist');
const source = html.slice(start, end);
const sandbox = {
  getTodayJalaliDate: () => '1405/09/02',
  currentJalaliOrdinal: () => 100,
  jalaliDateOrdinal: value => value === 'EXPIRED' ? 90 : 110
};
vm.createContext(sandbox);
vm.runInContext(source + '; this.api = { safeInventoryDecimalUnits, safeInventoryMoneySum, safeInventoryCostFromAllocations, safeInventoryExtendedCost, safeInventoryAverageCost, consumeFifoStock, consumePurchaseReturnBatches };', sandbox);
const api = sandbox.api;
function test(name, fn) { fn(); console.log('PASS: ' + name); }

test('fractional quantity and fractional unit costs are multiplied exactly then rounded once', () => {
  assert.equal(api.safeInventoryExtendedCost(0.5, 100.5), 50);
  assert.equal(api.safeInventoryExtendedCost(1, 100.5), 101);
  assert.equal(api.safeInventoryExtendedCost(3, 33.333333333), 100);
  assert.equal(api.safeInventoryCostFromAllocations([
    { quantity: 0.5, unitCost: 100.5 },
    { quantity: 0.5, unitCost: 100.5 }
  ]), 101, 'two half-rial components must round after aggregation, not individually');
});

test('FIFO calculates aggregate cost from exact decimal allocations', () => {
  const product = { id: 'P-FIFO-PREC', stock: 1, batches: [
    { id: 'B1', receivedDate: '1405/01/01', remainingQty: 0.5, quantity: 0.5, unitCost: 100.5 },
    { id: 'B2', receivedDate: '1405/02/01', remainingQty: 0.5, quantity: 0.5, unitCost: 100.5 }
  ] };
  const result = api.consumeFifoStock(product, 1);
  assert.equal(result.totalCost, 101);
  assert.deepEqual(Array.from(result.allocations, x => x.quantity), [0.5, 0.5]);
  assert.equal(product.batches[0].remainingQty, 0);
  assert.equal(product.batches[1].remainingQty, 0);
});

test('FIFO overflow is rejected before any batch quantity is mutated', () => {
  const product = { id: 'P-FIFO-OVERFLOW', stock: 2, batches: [
    { id: 'B1', receivedDate: '1405/01/01', remainingQty: 2, quantity: 2, unitCost: Number.MAX_SAFE_INTEGER }
  ] };
  const before = JSON.stringify(product);
  assert.throws(() => api.consumeFifoStock(product, 2), /محدوده دقت امن/);
  assert.equal(JSON.stringify(product), before);
});

test('purchase return uses exact fractional layer costing and does not partially mutate on overflow', () => {
  const product = { id: 'P-PUR-RET', stock: 1, batches: [
    { id: 'B-PUR', sourceType: 'purchase', sourceRef: 'PUR-1', lot: 'LOT-1',
      remainingQty: 1, quantity: 1, unitCost: 100.5, receivedDate: '1405/01/01' }
  ] };
  const result = api.consumePurchaseReturnBatches(product, 'PUR-1', { lot: 'LOT-1', productId: 'P-PUR-RET' }, 0.5);
  assert.equal(result.totalCost, 50);
  assert.equal(product.batches[0].remainingQty, 0.5);
  const overflow = { id: 'P-PUR-OVERFLOW', stock: 2, batches: [
    { id: 'B-OVER', sourceType: 'purchase', sourceRef: 'PUR-2', lot: 'LOT-2',
      remainingQty: 2, quantity: 2, unitCost: Number.MAX_SAFE_INTEGER }
  ] };
  const before = JSON.stringify(overflow);
  assert.throws(() => api.consumePurchaseReturnBatches(overflow, 'PUR-2', { lot: 'LOT-2' }, 2), /محدوده دقت امن/);
  assert.equal(JSON.stringify(overflow), before);
});

test('weighted average uses exact quantity-value arithmetic and whole-rial rounding', () => {
  assert.equal(api.safeInventoryAverageCost(0.5, 100, 0.25, 75), 167);
  assert.equal(api.safeInventoryAverageCost(1, 100, 1, 200), 150);
  assert.equal(api.safeInventoryAverageCost(1, 100, 1, Number.MAX_SAFE_INTEGER + 1), null);
});

test('money aggregation rejects overflow and quantity precision beyond six decimals', () => {
  assert.equal(api.safeInventoryMoneySum([100, 200, 300]), 600);
  assert.equal(api.safeInventoryMoneySum([Number.MAX_SAFE_INTEGER, 1]), null);
  assert.equal(api.safeInventoryDecimalUnits(0.123456), 123456n);
  assert.equal(api.safeInventoryDecimalUnits(0.1234567), null);
});

console.log('PASS: FIFO, purchase returns and weighted-average costing use bounded integer arithmetic');
