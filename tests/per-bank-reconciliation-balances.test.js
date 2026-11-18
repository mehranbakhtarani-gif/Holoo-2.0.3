const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function getBankAccountBookBalances()');
const end = html.indexOf('    function renderReconcileModule()', start);
assert.ok(start >= 0 && end > start, 'per-bank balance helper must exist');

const state = {
  bankAccounts: [
    { id: 'BANK-A', type: 'bank', name: 'بانک الف' },
    { id: 'BANK-B', type: 'bank', name: 'بانک ب' },
    { id: 'CASH-1', type: 'cash', name: 'صندوق' }
  ],
  vouchers: [
    { id: 1, lines: [
      { code: '1102', bankAccountId: 'BANK-A', debit: 1000, credit: 100 },
      { code: '1102', bankAccountId: 'BANK-B', debit: 500, credit: 250 },
      { code: '1102', debit: 80, credit: 20 },
      { code: '1102', bankAccountId: 'DELETED-BANK', debit: 40, credit: 10 },
      { code: '1101', bankAccountId: 'BANK-A', debit: 9999, credit: 0 }
    ] }
  ]
};
const sandbox = { state };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '; this.getBankAccountBookBalances = getBankAccountBookBalances;', sandbox);
const result = sandbox.getBankAccountBookBalances();

assert.deepEqual(Array.from(result.accounts, row => [row.account.id, row.debit, row.credit, row.net]), [
  ['BANK-A', 1000, 100, 900],
  ['BANK-B', 500, 250, 250]
]);
assert.equal(result.unassignedNet, 60);
assert.equal(result.unknownNet, 30);
assert.equal(result.unassignedDebit, 80);
assert.equal(result.unknownCredit, 10);
assert.equal(result.unassignedLines.length, 1);
assert.deepEqual(
  [result.unassignedLines[0].voucherId, result.unassignedLines[0].lineIndex, result.unassignedLines[0].debit, result.unassignedLines[0].credit],
  [1, 3, 80, 20]
);
assert.equal(result.unknownLines.length, 1);
assert.deepEqual(
  [result.unknownLines[0].voucherId, result.unknownLines[0].lineIndex, result.unknownLines[0].bankAccountId, result.unknownLines[0].debit, result.unknownLines[0].credit],
  [1, 4, 'DELETED-BANK', 40, 10]
);
console.log('PASS: each bank account has its own ledger balance');
console.log('PASS: legacy unassigned and unknown bank IDs remain visible separately');
console.log('PASS: cash-account lines are excluded from bank balances');
