const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
function slice(startText, endText) {
  const start = html.indexOf(startText);
  const end = html.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, 'missing source range: ' + startText);
  return html.slice(start, end);
}

const sandbox = {
  state: { costingMethod: 'AVG', products: [], vouchers: [] }
};
vm.createContext(sandbox);
vm.runInContext(
  slice('    function jalaliDateOrdinal(', '    function currentJalaliOrdinal()') +
  slice('    function inspectTrialBalanceVoucher(', '    function buildTrialBalanceReport(') +
  slice('    function getInventoryBookValue(', '    function renderInventoryModule()') +
  slice('    function buildInventoryControlAccountReconciliation()', '    function buildInventoryValueDiscrepancySources()') +
  '; this.api = { buildInventoryControlAccountReconciliation };',
  sandbox
);

function setState(products, vouchers) {
  sandbox.state = { costingMethod: 'AVG', products, vouchers };
}
function voucher(id, lines) {
  return { id, date: '1405/08/29', lines };
}
function test(name, fn) { fn(); console.log('PASS: ' + name); }

test('matches average-cost inventory value against net control-account balance', () => {
  setState(
    [{ id: 'P1', name: 'کالای نمونه', stock: 10, buyPrice: 100 }],
    [
      voucher(1, [{ code: '1105', debit: 1200, credit: 0 }, { code: '3101', debit: 0, credit: 1200 }]),
      voucher(2, [{ code: '6105', debit: 200, credit: 0 }, { code: '1105', debit: 0, credit: 200 }])
    ]
  );
  const result = sandbox.api.buildInventoryControlAccountReconciliation();
  assert.equal(result.status, 'matched');
  assert.equal(result.inventoryValue, 1000);
  assert.equal(result.controlBalance, 1000);
  assert.equal(result.difference, 0);
});

test('reports a verified valuation difference instead of netting it away', () => {
  setState(
    [{ id: 'P1', name: 'کالای نمونه', stock: 9, buyPrice: 100 }],
    [voucher(1, [{ code: '1105', debit: 1000, credit: 0 }, { code: '3101', debit: 0, credit: 1000 }])]
  );
  const result = sandbox.api.buildInventoryControlAccountReconciliation();
  assert.equal(result.status, 'mismatch');
  assert.equal(result.inventoryValue, 900);
  assert.equal(result.controlBalance, 1000);
  assert.equal(result.difference, -100);
});

test('marks a control-account line with a missing numeric amount as unverified', () => {
  setState(
    [{ id: 'P1', name: 'کالای نمونه', stock: 10, buyPrice: 100 }],
    [voucher(1, [
      { code: '1105', debit: null, credit: 0 },
      { code: '6101', debit: 100, credit: 0 },
      { code: '3101', debit: 0, credit: 100 }
    ])]
  );
  const result = sandbox.api.buildInventoryControlAccountReconciliation();
  assert.equal(result.status, 'unverified');
  assert.equal(result.invalidControlVouchers, 1);
  assert.equal(result.difference, null);
});

test('does not mutate product, batch or voucher source records', () => {
  const products = [{ id: 'P1', name: 'کالا', stock: 10, buyPrice: 100 }];
  const vouchers = [voucher(1, [{ code: '1105', debit: 1000, credit: 0 }, { code: '3101', debit: 0, credit: 1000 }])];
  setState(products, vouchers);
  const before = JSON.stringify({ products, vouchers });
  sandbox.api.buildInventoryControlAccountReconciliation();
  assert.equal(JSON.stringify({ products, vouchers }), before);
});

console.log('PASS: inventory control-account reconciliation is read-only and rejects missing 1105 amounts');
