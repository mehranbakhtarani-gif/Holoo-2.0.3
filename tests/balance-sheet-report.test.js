const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const jalaliStart = html.indexOf('    function jalaliDateOrdinal(');
const jalaliEnd = html.indexOf('    function currentJalaliOrdinal()', jalaliStart);
const normalizeStart = html.indexOf('    function normalizeLedgerDate(');
const normalizeEnd = html.indexOf('    function buildAccountLedger(', normalizeStart);
const reportStart = html.indexOf('    function buildBalanceSheetReport(');
const reportEnd = html.indexOf('    function renderBalanceSheetReport()', reportStart);
assert.ok(jalaliStart >= 0 && jalaliEnd > jalaliStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
assert.ok(reportStart >= 0 && reportEnd > reportStart);

const voucher = (id, date, desc, lines) => ({ id, date, desc, lines });
const sandbox = {
  state: {
    fiscalYear: '1405',
    accountCatalog: [{ code: '1301', name: 'سپرده بلندمدت' }],
    vouchers: [
      voucher(1, '1404/12/29', 'مانده افتتاحیه', [
        { code: '1102', debit: 1000, credit: 0 },
        { code: '3101', debit: 0, credit: 900 },
        { code: '3102', debit: 0, credit: 100 }
      ]),
      voucher(2, '1404/12/20', 'فروش سال قبل', [
        { code: '1102', debit: 200, credit: 0 },
        { code: '4101', debit: 0, credit: 200 }
      ]),
      voucher(3, '1404/12/21', 'هزینه سال قبل', [
        { code: '6101', debit: 100, credit: 0 },
        { code: '1102', debit: 0, credit: 100 }
      ]),
      voucher(4, '1404/12/29', 'بستن سود سال قبل', [
        { code: '4101', debit: 200, credit: 0 },
        { code: '6101', debit: 0, credit: 100 },
        { code: '3102', debit: 0, credit: 100 }
      ]),
      voucher(5, '1405/01/02', 'فروش سال جاری', [
        { code: '1102', debit: 500, credit: 0 },
        { code: '4101', debit: 0, credit: 500 }
      ]),
      voucher(6, '1405/01/03', 'هزینه سال جاری', [
        { code: '6101', debit: 200, credit: 0 },
        { code: '1102', debit: 0, credit: 200 }
      ]),
      voucher(7, '1405/01/04', 'سپرده جدید', [
        { code: '1301', debit: 50, credit: 0 },
        { code: '2106', debit: 0, credit: 50 }
      ]),
      voucher(8, '1405/02/01', 'بعد از تاریخ ترازنامه', [
        { code: '1102', debit: 100, credit: 0 },
        { code: '4101', debit: 0, credit: 100 }
      ]),
      voucher(9, '1405/13/01', 'تاریخ نامعتبر', [
        { code: '1102', debit: 25, credit: 0 },
        { code: '3101', debit: 0, credit: 25 }
      ])
    ]
  },
  CHART_ACCOUNTS: [
    { code: '1102', name: 'بانک' }, { code: '1301', name: 'سپرده' },
    { code: '2106', name: 'بستانکاران هزینه واردات' },
    { code: '3101', name: 'سرمایه' }, { code: '3102', name: 'سود انباشته' },
    { code: '4101', name: 'فروش' }, { code: '6101', name: 'هزینه' }
  ]
};
vm.createContext(sandbox);
const voucherValidationStart = html.indexOf('    function inspectTrialBalanceVoucher(');
const voucherValidationEnd = html.indexOf('    function ', voucherValidationStart + 10);
assert.ok(voucherValidationStart >= 0 && voucherValidationEnd > voucherValidationStart, 'trial balance validator must exist');
vm.runInContext(html.slice(voucherValidationStart, voucherValidationEnd) + '; this.inspectTrialBalanceVoucher = inspectTrialBalanceVoucher;', sandbox);
vm.runInContext(html.slice(jalaliStart, jalaliEnd), sandbox);
vm.runInContext(html.slice(normalizeStart, normalizeEnd), sandbox);
vm.runInContext(html.slice(reportStart, reportEnd) + '; this.buildBalanceSheetReport = buildBalanceSheetReport;', sandbox);

const report = sandbox.buildBalanceSheetReport('1405/01/30');
assert.equal(report.assets, 1450, 'cash plus custom non-current asset and prior-year activity');
assert.equal(report.liabilities, 50);
assert.equal(report.equity, 1100, 'capital plus opening and prior-year retained earnings');
assert.equal(report.currentYearProfit, 300, 'only active fiscal year profit, not prior year results');
assert.equal(report.liabilitiesAndEquity, 1450);
assert.equal(report.difference, 0);
assert.equal(report.trialBalanceDifference, 0);
assert.equal(report.invalidDateVouchers, 1);
assert.ok(!report.rows.some(r => r.code === '4101' && r.debit === 0 && r.credit === 100), 'after-date voucher must be excluded');
assert.equal(sandbox.buildBalanceSheetReport('۱۴۰۵/۰۱/۳۰').difference, 0);
assert.throws(() => sandbox.buildBalanceSheetReport('1404/12/29'), /تاریخ ترازنامه/);
assert.throws(() => sandbox.buildBalanceSheetReport('1405/13/01'), /تاریخ ترازنامه/);

sandbox.state.vouchers.push(voucher(8, '1405/01/05', 'نامتوازن', [
  { code: '1102', debit: 10, credit: 0 },
  { code: '2101', debit: 0, credit: 9 }
]));
const unbalanced = sandbox.buildBalanceSheetReport('1405/01/30');
assert.equal(unbalanced.trialBalanceDifference, 1);
console.log('PASS: as-of date, Persian dates, opening balances, prior-year retained earnings, current-year profit once, custom asset accounts, import liabilities, post-date exclusion, invalid dates and trial-balance controls');
