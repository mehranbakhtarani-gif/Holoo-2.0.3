const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function getBankReconciliationCandidates(item)');
const end = html.indexOf('    function confirmBankReconcileMatch(itemId, voucherId)', start);
assert.ok(start >= 0 && end > start, 'reconciliation candidate function must exist');

const state = {
  bankAccounts: [
    { id: 'BANK-A', type: 'bank', name: 'بانک الف' },
    { id: 'BANK-B', type: 'bank', name: 'بانک ب' }
  ],
  bankReconcileItems: [],
  vouchers: [
    { id: 1, date: '1405/09/02', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 100, credit: 0 }] },
    { id: 2, date: '1405/09/02', lines: [{ code: '1102', bankAccountId: 'BANK-B', debit: 100, credit: 0 }] },
    { id: 3, date: '1405/09/02', lines: [{ code: '1102', debit: 100, credit: 0 }] },
    { id: 4, date: '1405/09/02', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 60, credit: 0 }, { code: '1102', bankAccountId: 'BANK-A', debit: 40, credit: 0 }] },
    { id: 5, date: '1405/09/02', desc: 'موجودی افتتاحیه بانک الف', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 100, credit: 0 }] }
  ]
};
const sandbox = { state, bankTxDateKey: value => /^1405\/\d{2}\/\d{2}$/.test(value) ? value : null };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '; this.getBankReconciliationCandidates = getBankReconciliationCandidates;', sandbox);

const a = { id: 'A-TX', date: '1405/09/02', amount: 100, bankAccountId: 'BANK-A' };
const b = { id: 'B-TX', date: '1405/09/02', amount: 100, bankAccountId: 'BANK-B' };
assert.deepEqual(Array.from(sandbox.getBankReconciliationCandidates(a), x => x.id), [1]);
assert.deepEqual(Array.from(sandbox.getBankReconciliationCandidates(b), x => x.id), [2]);
assert.deepEqual(Array.from(sandbox.getBankReconciliationCandidates({ ...a, bankAccountId: 'UNKNOWN' }), x => x.id), []);

state.bankAccounts = [{ id: 'BANK-A', type: 'bank' }];
assert.deepEqual(Array.from(sandbox.getBankReconciliationCandidates(a), x => x.id), [1, 3]);

state.bankAccounts.push({ id: 'BANK-B', type: 'bank' });
assert.deepEqual(Array.from(sandbox.getBankReconciliationCandidates(a), x => x.id), [1]);

console.log('PASS: transactions only match vouchers tagged with the selected bank account');
console.log('PASS: unknown bank IDs and untagged legacy vouchers are blocked when multiple banks exist');
console.log('PASS: untagged legacy vouchers remain eligible only with a single bank account');
console.log('PASS: multiple bank ledger lines are still rejected');
