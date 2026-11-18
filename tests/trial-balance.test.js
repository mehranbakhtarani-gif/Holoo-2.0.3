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
  { code: '100', name: '=HYPERLINK("https://example.com","Open")' },
  { code: '200', name: 'سرمایه' },
  { code: '300', name: 'حساب آزمایشی سوم' },
  { code: '400', name: 'بدون گردش' }
];
const exportCapture = { csv: '', download: '', clicked: false, revoked: false, toast: '' };
const sandbox = {
  state, CHART_ACCOUNTS,
  Blob: class { constructor(parts, options) { exportCapture.csv = String(parts[0]); this.options = options; } },
  URL: {
    createObjectURL: () => 'blob:trial-balance-test',
    revokeObjectURL: url => { exportCapture.revoked = url === 'blob:trial-balance-test'; }
  },
  document: {
    getElementById: id => ({ value: id === 'trial-from' ? '1405/01/02' : '1405/01/31' }),
    createElement: () => ({ set download(value) { exportCapture.download = value; }, click() { exportCapture.clicked = true; }, remove() {} }),
    body: { appendChild() {} }
  },
  setTimeout: callback => callback(),
  showToast: message => { exportCapture.toast = message; }
};
vm.createContext(sandbox);
const source =
  sliceBetween('    function jalaliDateOrdinal(', '    function currentJalaliOrdinal()') +
  sliceBetween('    function normalizeLedgerDate(', '    function buildAccountLedger(') +
  sliceBetween('    let trialBalanceFromDate = null;', '    function renderTrialBalanceReport()');
vm.runInContext(source + '; this.buildTrialBalanceReport = buildTrialBalanceReport; this.exportTrialBalanceCSV = exportTrialBalanceCSV;', sandbox);

const before = JSON.stringify(state);
const report = sandbox.buildTrialBalanceReport('1405/01/02', '1405/01/31');
assert.equal(report.includedVouchers, 4, 'valid postings remain visible even when a voucher is incomplete or unbalanced');
assert.equal(report.invalidAmountLines, 2, 'both negative amount lines are counted');
assert.equal(report.invalidStructureVouchers, 1, 'single-line voucher is rejected');
assert.equal(report.unbalancedVouchers, 2, 'unbalanced and one-sided vouchers are reported');
assert.equal(report.invalidDateVouchers, 1, 'invalid voucher date is reported');
assert.equal(report.totals.periodDebit, 85);
assert.equal(report.totals.periodCredit, 70);
assert.equal(report.totals.closingBalanceDebit, 185);
assert.equal(report.totals.closingBalanceCredit, 170);
assert.equal(report.rows.reduce((sum, row) => sum + row.periodDebit, 0), report.totals.periodDebit);
assert.equal(report.rows.reduce((sum, row) => sum + row.periodCredit, 0), report.totals.periodCredit);
assert.equal(report.rows.reduce((sum, row) => sum + row.closingBalanceDebit, 0), report.totals.closingBalanceDebit);
assert.equal(report.rows.reduce((sum, row) => sum + row.closingBalanceCredit, 0), report.totals.closingBalanceCredit);
assert.equal(report.movementDifference, 15);
assert.equal(report.closingDifference, 15);
assert.deepEqual(Array.from(report.rows, row => row.code), ['100', '200']);
assert.equal(report.rows.find(row => row.code === '100').periodDebit, 85);
assert.equal(report.rows.find(row => row.code === '200').periodCredit, 70);
assert.equal(JSON.stringify(state), before, 'report must not mutate accounting data');
assert.throws(() => sandbox.buildTrialBalanceReport('1405/02/01', '1405/01/31'), /بازه تاریخ/);
assert.throws(() => sandbox.buildTrialBalanceReport('1405/13/01', '1405/13/30'), /بازه تاریخ/);
vm.runInContext("trialBalanceFromDate = '1405/01/02'; trialBalanceToDate = '1405/01/31'; exportTrialBalanceCSV();", sandbox);
assert.equal(exportCapture.csv.charCodeAt(0), 0xFEFF, 'CSV must include an Excel-friendly UTF-8 BOM');
const formulaPosition = exportCapture.csv.indexOf('=HYPERLINK');
assert.ok(formulaPosition > 0 && exportCapture.csv[formulaPosition - 1] === "'",
  'text cells beginning with a formula character must be escaped before CSV export');
assert.match(exportCapture.download, /1405-01-02_1405-01-31/);
assert.equal(exportCapture.clicked, true);
assert.equal(exportCapture.revoked, true);
assert.match(exportCapture.toast, /دانلود شد/);
const renderCapture = { innerHTML: '' };
sandbox.document = { getElementById: id => renderCapture };
sandbox.faNum = value => String(value);
sandbox.money = value => String(value);
sandbox.escapeLedgerText = value => String(value == null ? '' : value);
sandbox.getTodayJalaliDate = () => '1405/01/31';
vm.runInContext(
  sliceBetween('    function renderTrialBalanceReport()', '    function renderAccountingModule()') +
  '; this.renderTrialBalanceReport = renderTrialBalanceReport;',
  sandbox
);
sandbox.renderTrialBalanceReport();
assert.match(renderCapture.innerHTML, /ردیف‌های معتبر این اسناد در تراز باقی مانده‌اند/);
assert.match(renderCapture.innerHTML, /ردیف‌های معتبر آن در گزارش باقی مانده‌اند/);
assert.doesNotMatch(renderCapture.innerHTML, /کل سند از تراز آزمایشی کنار گذاشته شد/);
assert.doesNotMatch(renderCapture.innerHTML, /سند ساختار ناقص[^<]*از محاسبه کنار گذاشته شد/);
assert.doesNotMatch(renderCapture.innerHTML, /سند نامتوازن[^<]*کل سند از تراز آزمایشی کنار گذاشته شد/);
assert.match(html, /activeAccTab === 'trial'[\s\S]{0,100}renderTrialBalanceReport\(\)/);
assert.match(html, /function exportTrialBalanceCSV\(\)/);
console.log('PASS: four-column trial balance turnover, closing balances and inclusive date range');
console.log('PASS: flags unbalanced and structurally incomplete vouchers without hiding their valid postings');
console.log('PASS: reports invalid dates and leaves source accounting data unchanged');
console.log('PASS: CSV export includes UTF-8 BOM, formula-safe text and date-based filename');
console.log('PASS: trial balance UI warnings accurately describe retained incomplete and unbalanced postings');
