const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function buildTrialBalanceLedgerReconciliation(');
const end = html.indexOf('function renderTrialBalanceReport(', start);
assert.ok(start >= 0 && end > start, 'reconciliation helper must exist in index.html');
const helperSource = html.slice(start, end);

const state = {
  vouchers: [{ id: 'KEEP', date: '1405/01/02', lines: [
    { code: '100', debit: 50, credit: 0 },
    { code: '200', debit: 0, credit: 50 }
  ] }]
};
const before = JSON.stringify(state);
const trialBalance = {
  rows: [
    { code: '100', name: 'نقد', periodDebit: 50, periodCredit: 0, closingBalanceDebit: 150, closingBalanceCredit: 0 },
    { code: '200', name: 'سرمایه', periodDebit: 0, periodCredit: 50, closingBalanceDebit: 0, closingBalanceCredit: 150 }
  ]
};
const ledgerResults = {
  '100': { periodDebit: 50, periodCredit: 0, closingNet: 150 },
  '200': { periodDebit: 0, periodCredit: 50, closingNet: -150 }
};
const sandbox = {
  state,
  buildTrialBalanceReport: () => trialBalance,
  buildAccountLedger: code => ledgerResults[String(code)]
};
vm.createContext(sandbox);
vm.runInContext(helperSource + '; this.reconcile = buildTrialBalanceLedgerReconciliation;', sandbox);

const matched = sandbox.reconcile('1405/01/01', '1405/01/31');
assert.equal(matched.checkedAccounts, 2);
assert.equal(matched.mismatches, 0);
assert.equal(matched.issueCount, 0);
assert.equal(matched.periodDebitDifference, 0);
assert.equal(matched.periodCreditDifference, 0);
assert.equal(matched.closingNetDifference, 0);
assert.equal(JSON.stringify(state), before, 'matching reconciliation must not mutate source records');

ledgerResults['200'] = { periodDebit: 0, periodCredit: 45, closingNet: -140 };
const mismatch = sandbox.reconcile('1405/01/01', '1405/01/31');
assert.equal(mismatch.mismatches, 1);
assert.equal(mismatch.details.length, 1);
assert.equal(mismatch.details[0].code, '200');
assert.equal(mismatch.details[0].periodCreditDifference, 5);
assert.equal(mismatch.details[0].closingNetDifference, -10);
assert.equal(JSON.stringify(state), before, 'mismatch reporting must not mutate source records');

const unavailableSandbox = { buildTrialBalanceReport: () => trialBalance };
vm.createContext(unavailableSandbox);
vm.runInContext(helperSource + '; this.reconcile = buildTrialBalanceLedgerReconciliation;', unavailableSandbox);
assert.equal(unavailableSandbox.reconcile('1405/01/01', '1405/01/31').unavailable, true);

assert.match(html, /تطبیق تراز آزمایشی با دفتر حساب هر کد/);
assert.ok(html.includes('buildTrialBalanceLedgerReconciliation(from, to)'), 'UI must invoke the reconciliation helper');
assert.ok(html.includes('امکان اجرای تطبیق دفتر حساب در این محیط فراهم نیست'), 'UI must not report a false clean result when unavailable');
console.log('PASS: matching trial-balance and account-ledger totals are reconciled');
console.log('PASS: per-account debit, credit and closing-net mismatches are exposed');
console.log('PASS: unavailable ledger helper is reported as unavailable, not as a clean audit');
console.log('PASS: reconciliation is read-only and the UI exposes its status');


// Equal debit/credit overstatements must not disappear behind an unchanged net balance.
ledgerResults['200'] = { periodDebit: 5, periodCredit: 55, closingNet: -150 };
const grossMovementMismatch = sandbox.reconcile('1405/01/01', '1405/01/31');
assert.equal(grossMovementMismatch.mismatches, 1,
  'gross debit and credit movement differences must be detected even when their net effect is zero');
assert.equal(grossMovementMismatch.periodDebitDifference, -5);
assert.equal(grossMovementMismatch.periodCreditDifference, -5);
assert.equal(grossMovementMismatch.closingNetDifference, 0,
  'the fixture intentionally keeps the closing net balance unchanged');
assert.equal(grossMovementMismatch.details[0].periodDebitDifference, -5);
assert.equal(grossMovementMismatch.details[0].periodCreditDifference, -5);
assert.equal(grossMovementMismatch.details[0].closingNetDifference, 0);
assert.equal(JSON.stringify(state), before,
  'gross movement discrepancy reporting must remain read-only');

console.log('PASS: offsetting debit and credit differences remain visible despite a zero net-balance difference');
