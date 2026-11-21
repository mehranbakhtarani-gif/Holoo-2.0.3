const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
function extractFunction(name, nextName) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' must exist');
  const end = html.indexOf('function ' + nextName + '(', start + 1);
  assert.ok(end > start, name + ' must have a known boundary');
  return html.slice(start, end);
}

const context = {
  state: { fiscalYear: '1405', currency: 'IRR', costingMethod: 'AVG', vouchers: [] },
  CHART_ACCOUNTS: [
    { code: '1101', name: 'صندوق' },
    { code: '1102', name: 'بانک' },
    { code: '1105', name: 'موجودی کالا' },
    { code: '3101', name: 'سرمایه' },
    { code: '4101', name: 'فروش' },
    { code: '6101', name: 'هزینه' }
  ],
  faNum: value => String(value),
  inspectProductBatchReconciliation: () => ({ valid: true })
};
vm.createContext(context);
const source = [
  extractFunction('jalaliDateOrdinal', 'currentJalaliOrdinal'),
  extractFunction('money', 'safeMoneyInteger'),
  extractFunction('buildDashboardAccountBalances', 'getPartyNetBalance'),
  extractFunction('getInventoryBookValue', 'renderInventoryModule')
].join('\n');
vm.runInContext(source, context);

const tests = [];
function check(name, fn) {
  try { fn(); tests.push({ name, passed: true }); }
  catch (error) { tests.push({ name, passed: false, error: error.message }); }
}

check('accepts Persian digits and a valid Jalali date', () => {
  assert.notEqual(context.jalaliDateOrdinal('۱۴۰۵/۰۱/۰۱'), null);
});
check('rejects month 13 and month 0', () => {
  assert.equal(context.jalaliDateOrdinal('1405/13/01'), null);
  assert.equal(context.jalaliDateOrdinal('1405/00/01'), null);
});
check('rejects day 31 in a 30-day month', () => {
  assert.equal(context.jalaliDateOrdinal('1405/07/31'), null);
});
check('rejects day 30 in a non-leap Esfand', () => {
  assert.equal(context.jalaliDateOrdinal('1404/12/30'), null);
});
check('rejects zero year and trailing HTML', () => {
  assert.equal(context.jalaliDateOrdinal('0000/01/01'), null);
  assert.equal(context.jalaliDateOrdinal('1405/01/01<script>'), null);
});

check('money rejects null, empty, NaN and unsafe integer values', () => {
  assert.equal(context.money(null), 'نیازمند بررسی');
  assert.equal(context.money(''), 'نیازمند بررسی');
  assert.equal(context.money(NaN), 'نیازمند بررسی');
  assert.equal(context.money(Number.MAX_SAFE_INTEGER + 1), 'نیازمند بررسی');
});
check('money preserves zero and converts rial to toman', () => {
  context.state.currency = 'IRR';
  assert.equal(context.money(0), '0 ریال');
  context.state.currency = 'IRT';
  assert.equal(context.money(1250), '125 تومان');
});

check('inventory valuation refuses missing or invalid inputs', () => {
  assert.equal(context.getInventoryBookValue({ stock: 5 }), null);
  assert.equal(context.getInventoryBookValue({ buyPrice: 10 }), null);
  assert.equal(context.getInventoryBookValue({ stock: -1, buyPrice: 10 }), null);
  assert.equal(context.getInventoryBookValue({ stock: 5, buyPrice: 10 }), 50);
});
check('FIFO inventory valuation requires valid batch reconciliation', () => {
  context.state.costingMethod = 'FIFO';
  context.inspectProductBatchReconciliation = () => ({ valid: false });
  assert.equal(context.getInventoryBookValue({ stock: 2, buyPrice: 10, batches: [] }), null);
  context.inspectProductBatchReconciliation = () => ({ valid: true });
  assert.equal(context.getInventoryBookValue({
    stock: 2, buyPrice: 10, batches: [{ remainingQty: 2, unitCost: 15 }]
  }), 30);
});

check('dashboard carries balance-sheet opening balances and calculates selected-year turnover', () => {
  context.state = {
    fiscalYear: '1405',
    vouchers: [
      { date: '1404/12/29', lines: [
        { code: '1101', debit: 1000, credit: 0 },
        { code: '3101', debit: 0, credit: 1000 }
      ] },
      { date: '1405/01/02', lines: [
        { code: '1101', debit: 500, credit: 0 },
        { code: '4101', debit: 0, credit: 500 }
      ] },
      { date: '1405/01/03', lines: [
        { code: '6101', debit: 100, credit: 0 },
        { code: '1101', debit: 0, credit: 100 }
      ] }
    ]
  };
  const result = context.buildDashboardAccountBalances();
  assert.equal(result.balances['1101'].debBal, 1400);
  assert.equal(result.balances['4101'].periodCredTurn, 500);
  assert.equal(result.balances['6101'].periodDebTurn, 100);
  assert.equal(result.quality.unbalancedVouchers, 0);
});

check('dashboard excludes invalid fractional voucher amounts', () => {
  context.state = {
    fiscalYear: '1405',
    vouchers: [{ date: '1405/01/02', lines: [
      { code: '1101', debit: 10.5, credit: 0 },
      { code: '4101', debit: 0, credit: 10.5 }
    ] }]
  };
  const result = context.buildDashboardAccountBalances();
  assert.equal(result.quality.invalidAmountVouchers, 1);
  assert.equal(result.balances['1101'].debTurn, 0);
  assert.equal(result.balances['4101'].credTurn, 0);
});

check('dashboard rejects unsafe turnover atomically without partial posting', () => {
  context.state = {
    fiscalYear: '1405',
    vouchers: [
      { date: '1404/12/29', lines: [
        { code: '1101', debit: Number.MAX_SAFE_INTEGER, credit: 0 },
        { code: '3101', debit: 0, credit: Number.MAX_SAFE_INTEGER }
      ] },
      { date: '1405/01/02', lines: [
        { code: '1101', debit: 1, credit: 0 },
        { code: '4101', debit: 0, credit: 1 }
      ] }
    ]
  };
  const result = context.buildDashboardAccountBalances();
  assert.equal(result.quality.unsafeAmountVouchers, 1);
  assert.equal(result.balances['1101'].debTurn, Number.MAX_SAFE_INTEGER);
  assert.equal(result.balances['4101'].credTurn, 0);
});

check('dashboard reports custom account codes for mapping review', () => {
  context.state = {
    fiscalYear: '1405',
    vouchers: [{ date: '1405/01/02', lines: [
      { code: '1199', debit: 25, credit: 0 },
      { code: '3101', debit: 0, credit: 25 }
    ] }]
  };
  const result = context.buildDashboardAccountBalances();
  assert.deepEqual(Array.from(result.quality.unknownAccountCodes), ['1199']);
  assert.equal(result.balances['1199'].debTurn, 25);
});

const failed = tests.filter(test => !test.passed);
for (const test of tests) {
  console.log((test.passed ? 'PASS ' : 'FAIL ') + test.name + (test.error ? ': ' + test.error : ''));
}
console.log('Dashboard hardening: ' + (tests.length - failed.length) + '/' + tests.length + ' passed');
if (failed.length) process.exitCode = 1;
