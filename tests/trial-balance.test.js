const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: `index.html:inline-${i}` });
}
function sliceBetween(startText, endText) {
  const start = html.indexOf(startText), end = html.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing source range: ${startText}`);
  return html.slice(start, end);
}

const state = {
  fiscalYear: '1405',
  accountCatalog: [{ code: '300', name: 'حساب آزمایشی سوم' }],
  vouchers: [
    { id: 1, date: '1404/12/29', desc: 'افتتاحیه', lines: [
      { code: '100', accountName: 'نقد', debit: 100, credit: 0 },
      { code: '200', accountName: 'سرمایه', debit: 0, credit: 100 }
    ]},
    { id: 2, date: '1405/01/02', desc: 'گردش دوره', lines: [
      { code: '100', accountName: 'نقد', debit: 50, credit: 0 },
      { code: '200', accountName: 'سرمایه', debit: 0, credit: 50 }
    ]},
    { id: 3, date: '1405/01/05', desc: 'سند نامتوازن', lines: [
      { code: '100', debit: 25, credit: 0 },
      { code: '200', debit: 0, credit: 20 }
    ]},
    { id: 4, date: '1405/01/06', desc: 'مبلغ منفی', lines: [
      { code: '100', debit: -1, credit: 0 },
      { code: '200', debit: 0, credit: -1 }
    ]},
    { id: 5, date: '1405/01/07', desc: 'سند تک ردیفی', lines: [
      { code: '100', debit: 10, credit: 0 }
    ]},
    { id: 6, date: '1405/02/01', desc: 'بعد از بازه', lines: [
      { code: '100', debit: 500, credit: 0 },
      { code: '200', debit: 0, credit: 500 }
    ]},
    { id: 7, date: 'تاریخ نامعتبر', desc: 'تاریخ خراب', lines: [
      { code: '100', debit: 1, credit: 0 },
      { code: '200', debit: 0, credit: 1 }
    ]}
  ]
};
const CHART_ACCOUNTS = [
  { code: '100', name: 'نقد' },
  { code: '200', name: 'سرمایه' },
  { code: '300', name: 'حساب آزمایشی سوم' },
  { code: '400', name: 'بدون گردش' }
];
const sandbox = { state, CHART_ACCOUNTS };
vm.createContext(sandbox);
const source =
  sliceBetween('    function jalaliDateOrdinal(', '    function currentJalaliOrdinal()') +
  sliceBetween('    function normalizeLedgerDate(', '    function buildAccountLedger(') +
  sliceBetween('    function inspectTrialBalanceVoucher(', '    function exportTrialBalanceCSV()');
vm.runInContext(source + '; this.buildTrialBalanceReport = buildTrialBalanceReport;', sandbox);

const before = JSON.stringify(state);
const report = sandbox.buildTrialBalanceReport('1405/01/02', '1405/01/31');
assert.equal(report.includedVouchers, 2, 'only balanced, structurally valid vouchers through the end date are included');
assert.equal(report.invalidAmountLines, 2, 'both negative amount lines are counted');
assert.equal(report.invalidStructureVouchers, 1, 'single-line voucher is rejected');
assert.equal(report.unbalancedVouchers, 1, 'debit/credit mismatch is rejected');
assert.equal(report.invalidDateVouchers, 1, 'invalid voucher date is reported');
assert.equal(report.totals.periodDebit, 50);
assert.equal(report.totals.periodCredit, 50);
assert.equal(report.totals.closingBalanceDebit, 150);
assert.equal(report.totals.closingBalanceCredit, 150);
assert.equal(report.movementDifference, 0);
assert.equal(report.closingDifference, 0);
assert.deepEqual(Array.from(report.rows, row => row.code), ['100', '200']);
assert.equal(JSON.stringify(state), before, 'report must not mutate accounting data');
assert.throws(() => sandbox.buildTrialBalanceReport('1405/02/01', '1405/01/31'), /بازه تاریخ/);
assert.throws(() => sandbox.buildTrialBalanceReport('1405/13/01', '1405/13/30'), /بازه تاریخ/);
assert.match(html, /activeAccTab === 'trial'[\s\S]{0,100}renderTrialBalanceReport\(\)/);
assert.match(html, /function exportTrialBalanceCSV\(\)/);
console.log('PASS: four-column trial balance turnover, closing balances and inclusive date range');
console.log('PASS: rejects unbalanced, malformed and structurally incomplete vouchers');
console.log('PASS: reports invalid dates and leaves source accounting data unchanged');
