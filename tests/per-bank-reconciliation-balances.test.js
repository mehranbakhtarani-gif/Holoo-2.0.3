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
    { id: 1, date: '1405/08/01', lines: [
      { code: '1102', bankAccountId: 'BANK-A', debit: 1000, credit: 0 },
      { code: '1102', bankAccountId: 'BANK-A', debit: 0, credit: 100 },
      { code: '1102', bankAccountId: 'BANK-B', debit: 500, credit: 0 },
      { code: '1102', bankAccountId: 'BANK-B', debit: 0, credit: 250 },
      { code: '1102', debit: 80, credit: 0 },
      { code: '1102', debit: 0, credit: 20 },
      { code: '1102', bankAccountId: 'DELETED-BANK', debit: 40, credit: 0 },
      { code: '1102', bankAccountId: 'DELETED-BANK', debit: 0, credit: 10 },
      { code: '1101', bankAccountId: 'BANK-A', debit: 9999, credit: 0 }
    ] },
    { id: 2, date: '۱۴۰۵/۰۸/۰۱', desc: 'موجودی افتتاحیه بانک‌ها — سند افتتاحیه سال مالی ۱۴۰۵', lines: [
      { code: '1102', debit: 12650000000, credit: 0 }
    ] },
    { id: 3, date: '۱۴۰۵/۰۸/۰۱', description: 'موجودی افتتاحیه بانک‌ها — سند افتتاحیه سال مالی ۱۴۰۵', lines: [
      { code: '1102', debit: 250, credit: 0 }
    ] },
    { id: 4, date: '۱۴۰۵/۰۸/۰۱', sourceType: 'bank_account_opening', desc: 'سند افتتاحیه سال مالی ۱۴۰۵', lines: [
      { code: '1102', description: 'موجودی افتتاحیه بانک‌ها', debit: 350, credit: 0 }
    ] }
  ]
};
const sandbox = {
  state,
  inspectTrialBalanceVoucher(voucher) {
    const lines = Array.isArray(voucher.lines) ? voucher.lines : [];
    const debit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    return { invalidStructure: lines.length < 2, unbalanced: Math.abs(debit - credit) > 0.001 };
  }
};
vm.createContext(sandbox);
const dateStart = html.indexOf('    function normalizeLedgerDate(value)');
const dateEnd = html.indexOf('    function countInvalidReportVoucherLines(', dateStart);
const openingStart = html.indexOf('    function isBankOpeningVoucher(voucher)');
const openingEnd = html.indexOf('    function getBankAccountBookBalances()', openingStart);
assert.ok(dateStart >= 0 && dateEnd > dateStart && openingStart >= 0 && openingEnd > openingStart, 'bank ledger date/opening helpers must exist');
vm.runInContext(html.slice(dateStart, dateEnd) + 'function bankTxDateKey(value) { return normalizeLedgerDate(value); }\n' + html.slice(openingStart, openingEnd) + html.slice(start, end) + '; this.getBankAccountBookBalances = getBankAccountBookBalances;', sandbox);
const result = sandbox.getBankAccountBookBalances();

assert.deepEqual(Array.from(result.accounts, row => [row.account.id, row.debit, row.credit, row.net]), [
  ['BANK-A', 1000, 100, 900],
  ['BANK-B', 500, 250, 250]
]);
assert.equal(result.unassignedNet, 60);
assert.equal(result.openingNet, 12650000600);
assert.equal(result.openingBalanceLines.length, 3);
assert.equal(result.openingBalanceLines[0].voucherId, 2);
assert.equal(result.unknownNet, 30);
assert.equal(result.unassignedDebit, 80);
assert.equal(result.unknownCredit, 10);
assert.equal(result.unassignedLines.length, 2);
assert.deepEqual(
  Array.from(result.unassignedLines, row => [row.voucherId, row.lineIndex, row.debit, row.credit]),
  [[1, 5, 80, 0], [1, 6, 0, 20]]
);
assert.equal(result.unknownLines.length, 2);
assert.deepEqual(
  Array.from(result.unknownLines, row => [row.voucherId, row.lineIndex, row.bankAccountId, row.debit, row.credit]),
  [[1, 7, 'DELETED-BANK', 40, 0], [1, 8, 'DELETED-BANK', 0, 10]]
);
console.log('PASS: each bank account has its own ledger balance');
console.log('PASS: legacy unassigned and unknown bank IDs remain visible separately');
console.log('PASS: opening bank balances are separated from unidentified bank movements');
console.log('PASS: cash-account lines are excluded from bank balances');
