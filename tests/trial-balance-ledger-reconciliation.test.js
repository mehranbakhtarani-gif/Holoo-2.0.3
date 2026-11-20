const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
function sliceBetween(startText, endText) {
  const start = html.indexOf(startText), end = html.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing source range: ${startText}`);
  return html.slice(start, end);
}
const state = {
  fiscalYear: '1405',
  parties: [],
  accountCatalog: [{ code: '300', name: 'حساب بدون گردش' }],
  vouchers: [
    { id: 'OPEN', date: '1404/12/29', lines: [
      { code: '100', accountName: 'نقد', debit: 100, credit: 0 },
      { code: '200', accountName: 'سرمایه', debit: 0, credit: 100 }
    ] },
    { id: 'PERIOD', date: '1405/01/02', lines: [
      { code: '100', accountName: 'نقد', debit: 50, credit: 0 },
      { code: '200', accountName: 'سرمایه', debit: 0, credit: 50 }
    ] }
  ]
};
const CHART_ACCOUNTS = [
  { code: '100', name: 'نقد' },
  { code: '200', name: 'سرمایه' },
  { code: '300', name: 'حساب بدون گردش' }
];
const sandbox = {
  state, CHART_ACCOUNTS,
  normalizeAccountingDate: value => String(value || '').trim().replace(/-/g, '/'),
  getPartyName: () => '—'
};
vm.createContext(sandbox);
vm.runInContext(sliceBetween('function jalaliDateOrdinal(', 'function setAccTab('), sandbox);
vm.runInContext(
  sliceBetween('let trialBalanceFromDate = null;', 'function renderAccountingModule()') +
  '; this.buildTrialBalanceLedgerReconciliation = buildTrialBalanceLedgerReconciliation;',
  sandbox
);

const before = JSON.stringify(state);
const report = sandbox.buildTrialBalanceLedgerReconciliation('1405/01/01', '1405/01/31');
assert.equal(report.checkedAccounts, 2, 'only accounts with a balance or movement are checked');
assert.equal(report.mismatches, 0, 'trial balance and account ledger must reconcile per account');
assert.equal(report.periodDebitDifference, 0);
assert.equal(report.periodCreditDifference, 0);
assert.equal(report.closingNetDifference, 0);
assert.equal(report.issueCount, 0);
assert.equal(JSON.stringify(state), before, 'reconciliation must not mutate accounting records');

sandbox.buildAccountLedger = () => ({
  periodDebit: 999, periodCredit: 0, closingNet: 999
});
const mismatch = sandbox.buildTrialBalanceLedgerReconciliation('1405/01/01', '1405/01/31');
assert.equal(mismatch.mismatches, 2, 'per-account differences must be surfaced');
assert.equal(mismatch.details.length, 2);
assert.ok(mismatch.details.every(item => item.periodDebitDifference !== 0 || item.periodCreditDifference !== 0 || item.closingNetDifference !== 0));
assert.equal(JSON.stringify(state), before, 'mismatch reporting must remain read-only');

assert.match(html, /تطبیق تراز آزمایشی با دفتر حساب هر کد/);
assert.match(html, /buildTrialBalanceLedgerReconciliation\\(from, to\\)/);
console.log('PASS: trial balance rows reconcile to each account ledger for period movement and closing net');
console.log('PASS: per-account mismatches are exposed with account code and debit/credit/net deltas');
console.log('PASS: reconciliation leaves source accounting records unchanged');
console.log('PASS: trial balance UI includes the read-only reconciliation panel');
