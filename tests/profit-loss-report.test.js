const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function normalizeLedgerDate(');
const end = html.indexOf('    function saveCustomAccount()', start);
assert.notEqual(start, -1, 'accounting helpers must exist');
assert.notEqual(end, -1, 'accounting helper section must have an end');

const chart = [
  { code: '4101', name: 'فروش' }, { code: '4102', name: 'تخفیفات فروش' },
  { code: '4103', name: 'برگشت فروش' }, { code: '4104', name: 'سود تسعیر' },
  { code: '5101', name: 'بهای تمام‌شده' }, { code: '6101', name: 'هزینه اداری' },
  { code: '6102', name: 'تعدیل هزینه' }
];
const balanced = (id, date, desc, debitCode, creditCode, amount) => ({
  id, date, desc, lines: [
    { code: debitCode, debit: amount, credit: 0 },
    { code: creditCode, debit: 0, credit: amount }
  ]
});
const sandbox = {
  state: {
    fiscalYear: '1405',
    accountCatalog: [{ code: '6105', name: 'هزینه سفارشی' }],
    vouchers: [
      balanced(1, '1404/12/29', 'افتتاحیه خارج دوره', '1102', '4101', 999),
      balanced(2, '1405/01/02', 'فروش', '1102', '4101', 1000),
      balanced(3, '1405/01/03', 'تخفیف فروش', '4102', '1102', 100),
      balanced(4, '1405/01/04', 'برگشت فروش', '4103', '1102', 50),
      balanced(5, '1405/01/05', 'سود تسعیر', '1102', '4104', 20),
      balanced(6, '1405/01/06', 'بهای تمام‌شده', '5101', '1105', 400),
      balanced(7, '1405/01/07', 'هزینه اداری', '6101', '1102', 100),
      balanced(8, '1405/01/08', 'تعدیل بستانکار هزینه', '1102', '6102', 10),
      balanced(9, '۱۴۰۵/۰۱/۰۹', 'هزینه معین سفارشی', '6105', '1102', 30),
      balanced(10, '1405/02/01', 'فروش خارج بازه', '1102', '4101', 500),
      { id: 11, date: '1405/13/01', desc: 'تاریخ نامعتبر', lines: [{ code: '4101', debit: 0, credit: 200 }] }
    ]
  },
  CHART_ACCOUNTS: chart,
  money: n => String(n),
  faNum: String,
  getTodayJalaliDate: () => '1405/01/30',
  document: { getElementById: () => ({ innerHTML: '' }) }
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '; this.api = { normalizeLedgerDate, jalaliDateOrdinal, buildProfitLossReport };', sandbox);
const { buildProfitLossReport } = sandbox.api;

const report = buildProfitLossReport('1405/01/01', '1405/01/30');
assert.equal(report.revenue, 870, 'revenue must net discounts, returns and FX income');
assert.equal(report.cogs, 400);
assert.equal(report.expenses, 120, 'expense credit adjustment and custom 61xx account must be included');
assert.equal(report.grossProfit, 470);
assert.equal(report.netProfit, 350);
assert.equal(report.periodDebit, report.periodCredit, 'all journal entries in the period must balance');
assert.equal(report.trialBalanceDifference, 0);
assert.equal(report.invalidDateVouchers, 1);
assert.equal(report.rows.find(r => r.code === '6105').amount, 30);
assert.ok(!report.rows.some(r => r.code === '4101' && r.amount === 999), 'opening/previous period must not affect selected period');
assert.ok(!report.rows.some(r => r.code === '4101' && r.amount === 500), 'transactions after end date must not affect report');
assert.equal(buildProfitLossReport('۱۴۰۵/۰۱/۰۱', '۱۴۰۵/۰۱/۳۰').netProfit, 350);
assert.throws(() => buildProfitLossReport('1405/13/01', '1405/01/30'), /بازه تاریخ/);
assert.throws(() => buildProfitLossReport('1405/01/30', '1405/01/01'), /بازه تاریخ/);

sandbox.state.vouchers.push({
  id: 12, date: '1405/01/10', desc: 'سند نامتوازن', lines: [
    { code: '6101', debit: 5, credit: 0 },
    { code: '1102', debit: 0, credit: 4 }
  ]
});
const unbalanced = buildProfitLossReport('1405/01/01', '1405/01/30');
assert.equal(unbalanced.trialBalanceDifference, 1, 'unbalanced vouchers must be surfaced by the period control');
console.log('PASS: period boundaries, Persian dates, invalid dates, revenue contra accounts, FX income, COGS, debit/credit expense adjustments, custom 61xx accounts, opening exclusion, and trial-balance control');
