const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function getBankReconciliationCandidates(item)');
const end = html.indexOf('    function confirmBankReconcileMatch(itemId, voucherId)', start);
assert.ok(start >= 0 && end > start, 'bank reconciliation candidate function must exist');

const state = {
  bankReconcileItems: [],
  vouchers: [
    { id: 1, date: '1405/09/02', desc: 'سند بانکی یکتا', lines: [{ code: '1102', debit: 100, credit: 0 }] },
    { id: 2, date: '1405/09/02', desc: 'سند چندردیفی', lines: [{ code: '1102', debit: 60, credit: 0 }, { code: '1102', debit: 40, credit: 0 }] },
    { id: 3, date: '1405/09/02', desc: 'برداشت بانکی', lines: [{ code: '1102', debit: 0, credit: 100 }] },
    { id: 4, date: '1405/09/03', desc: 'تاریخ متفاوت', lines: [{ code: '1102', debit: 100, credit: 0 }] },
    { id: 5, date: '1405/09/02', desc: 'مبلغ متفاوت', lines: [{ code: '1102', debit: 99, credit: 0 }] }
  ]
};
const sandbox = { state, bankTxDateKey: value => /^1405\/\d{2}\/\d{2}$/.test(value) ? value : null };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '; this.getBankReconciliationCandidates = getBankReconciliationCandidates;', sandbox);

const deposit = { id: 'D1', date: '1405/09/02', amount: 100 };
assert.deepEqual(Array.from(sandbox.getBankReconciliationCandidates(deposit), x => x.id), [1]);
const withdrawal = { id: 'W1', date: '1405/09/02', amount: -100 };
assert.deepEqual(Array.from(sandbox.getBankReconciliationCandidates(withdrawal), x => x.id), [3]);

state.bankReconcileItems.push({ id: 'OTHER', matched: true, linkedVoucherId: 1 });
assert.deepEqual(Array.from(sandbox.getBankReconciliationCandidates(deposit), x => x.id), []);

assert.deepEqual(sandbox.getBankReconciliationCandidates({ id: 'BAD', date: '1405/09/02', amount: 0 }), []);
assert.deepEqual(sandbox.getBankReconciliationCandidates({ id: 'BAD2', date: 'invalid', amount: 100 }), []);

console.log('PASS: only one exact, same-direction, same-date bank ledger line is proposed');
console.log('PASS: split/multi-line bank vouchers are not falsely matched by aggregate amount');
console.log('PASS: a voucher already linked to another bank transaction cannot be reused');
