const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function getBankReconciliationReviewCandidates(item)');
const end = html.indexOf('    function confirmBankReconcileMatch(itemId, voucherId)', start);
assert.ok(start >= 0 && end > start, 'manual review candidate helper must exist');

const state = {
  bankAccounts: [{ id: 'BANK-A', type: 'bank' }, { id: 'BANK-B', type: 'bank' }],
  bankReconcileItems: [{ id: 'other', matched: true, linkedVoucherId: 99 }],
  vouchers: [
    { id: 1, date: '1405/08/15', desc: 'واریز ساتنا', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 2500000000, credit: 0 }] },
    { id: 2, date: '1405/08/15', desc: 'واریز بانکی با مبلغ متفاوت', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 2400000000, credit: 0 }] },
    { id: 3, date: '1405/08/16', desc: 'واریز با مبلغ برابر در روز دیگر', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 2500000000, credit: 0 }] },
    { id: 4, date: '1405/08/15', desc: 'جهت مخالف', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 0, credit: 2500000000 }] },
    { id: 5, date: '1405/08/15', desc: 'افتتاحیه بانک الف', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 2500000000, credit: 0 }] },
    { id: 6, date: '1405/08/15', desc: 'حساب بانکی دیگر', lines: [{ code: 'BANK-A', bankAccountId: 'BANK-B', debit: 2500000000, credit: 0 }] },
    { id: 99, date: '1405/08/15', desc: 'قبلاً به تراکنش دیگری وصل شده', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 2500000000, credit: 0 }] }
  ]
};
const sandbox = { state, CHART_ACCOUNTS: [{ code: '1103', name: 'حساب دریافتنی' }, { code: '2101', name: 'حساب پرداختنی' }], bankTxDateKey: value => String(value || '') };
vm.createContext(sandbox);
const helperStart = html.indexOf('    function isBankOpeningVoucher(voucher)');
const helperEnd = html.indexOf('    function getBankAccountBookBalances()', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'bank opening voucher classifier must exist');
vm.runInContext(html.slice(helperStart, helperEnd) + html.slice(start, end) + '; this.getBankReconciliationReviewCandidates = getBankReconciliationReviewCandidates;', sandbox);

const item = { id: 'SAT-9910', date: '1405/08/15', amount: 2500000000, bankAccountId: 'BANK-A' };
const result = Array.from(sandbox.getBankReconciliationReviewCandidates(item));
assert.deepEqual(result.map(x => x.id), [1, 3, 2]);
assert.deepEqual(result.map(x => [x.amountMatch, x.dateMatch]), [
  [true, true], [true, false], [false, true]
]);
assert.ok(result.every(x => x.id !== 4 && x.id !== 5 && x.id !== 6 && x.id !== 99));
console.log('PASS: exact matches rank first; amount-only and date-only matches remain review suggestions');
console.log('PASS: opposite direction, opening balances, other bank accounts and already-linked vouchers are excluded');
