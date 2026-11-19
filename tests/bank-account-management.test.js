const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

function extract(startMarker, endMarker, sandbox, exportName) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source block: ${startMarker}`);
  vm.createContext(sandbox);
  vm.runInContext(html.slice(start, end) + `; this.${exportName} = ${exportName};`, sandbox);
  return sandbox[exportName];
}

const state = {
  bankAccounts: [
    { id: 'BANK-A', type: 'bank', name: 'بانک الف' },
    { id: 'BANK-B', type: 'bank', name: 'بانک ب' }
  ],
  vouchers: [
    { id: 1, date: '1405/09/01', desc: 'افتتاحیه بانک الف', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 500, credit: 0 }] },
    { id: 2, date: '1405/09/02', desc: 'دریافت از مشتری', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: 100, credit: 0 }] },
    { id: 3, date: '1405/09/02', desc: 'پرداخت از بانک ب', lines: [{ code: '1102', bankAccountId: 'BANK-B', debit: 0, credit: 40 }] },
    { id: 4, date: '1405/09/02', desc: 'گردش قدیمی بدون شناسه', lines: [{ code: '1102', debit: 30, credit: 0 }] },
    { id: 5, date: '1405/09/02', desc: 'شناسه ناشناخته', lines: [{ code: '1102', bankAccountId: 'DELETED-BANK', debit: 20, credit: 0 }] },
    { id: 6, date: '1405/09/02', desc: 'ردیف نامعتبر', lines: [{ code: '1102', bankAccountId: 'BANK-A', debit: -1, credit: 0 }] }
  ]
};
const balanceSandbox = { state };
const getBalances = extract('    function getBankAccountBookBalances()', '    function renderReconcileModule()', balanceSandbox, 'getBankAccountBookBalances');
const balances = getBalances();
assert.equal(balances.accounts.find(x => x.account.id === 'BANK-A').net, 600);
assert.equal(balances.accounts.find(x => x.account.id === 'BANK-B').net, -40);
assert.equal(balances.openingNet, 500);
assert.equal(balances.unassignedNet, 30);
assert.equal(balances.unknownNet, 20);
assert.equal(balances.invalidBankLines, 1);
console.log('PASS: bank book balances include account-tagged opening vouchers and exclude unassigned/unknown/invalid lines');

const treasuryState = {
  bankAccounts: state.bankAccounts,
  bankReconcileItems: [],
  treasuryTxs: [
    { id: 'TX-A', date: '1405/09/02', dir: 'receive', method: 'حواله بانکی', amount: 100, bankAccountId: 'BANK-A' },
    { id: 'TX-B', date: '1405/09/02', dir: 'receive', method: 'حواله بانکی', amount: 100, bankAccountId: 'BANK-B' },
    { id: 'TX-C', date: '1405/09/02', dir: 'receive', method: 'صندوق نقدی', amount: 100, bankAccountId: 'BANK-A' }
  ]
};
const treasurySandbox = {
  state: treasuryState,
  bankTxDateKey: value => value,
  getTreasuryTxAccount: tx => treasuryState.bankAccounts.find(x => x.id === tx.bankAccountId) || null
};
const getTreasuryCandidates = extract('    function getTreasuryReconciliationCandidates(item)', '    function getBankReconciliationReviewCandidates(item)', treasurySandbox, 'getTreasuryReconciliationCandidates');
assert.deepEqual(Array.from(getTreasuryCandidates({ id: 'STATEMENT-A', date: '1405/09/02', amount: 100, bankAccountId: 'BANK-A' }), x => x.id), ['TX-A']);
assert.deepEqual(Array.from(getTreasuryCandidates({ id: 'STATEMENT-B', date: '1405/09/02', amount: 100, bankAccountId: 'BANK-B' }), x => x.id), ['TX-B']);
console.log('PASS: bank reconciliation does not propose another bank account or cash transactions');

const accountState = { bankAccounts: [] };
const fields = {};
const audit = [];
const accountSandbox = {
  state: accountState,
  document: { getElementById: id => ({ value: fields[id] || '' }) },
  createStableId: () => 'BANK-NEW',
  addAudit: (...args) => audit.push(args),
  saveState: () => true,
  closeModal: () => {},
  renderAll: () => {},
  showToast: () => {},
  window: { escapeBankReconcileText: value => String(value ?? '').replace(/[&<>"']/g, '') }
};
const saveBankAccount = extract('    function saveBankAccount(accountId = \'\')', '    function renderTreasuryModule()', accountSandbox, 'saveBankAccount');
Object.assign(fields, {
  'bank-account-name': 'حساب جاری',
  'bank-account-bank': 'بانک الف',
  'bank-account-number': '123456',
  'bank-account-branch': 'شعبه مرکزی'
});
saveBankAccount();
assert.equal(accountState.bankAccounts.length, 1);
assert.equal(accountState.bankAccounts[0].type, 'bank');
assert.equal(accountState.bankAccounts[0].accNo, '123456');
assert.equal(audit.length, 1);
fields['bank-account-name'] = 'حساب تکراری';
saveBankAccount();
assert.equal(accountState.bankAccounts.length, 1);
fields['bank-account-name'] = 'حساب جاری اصلاح‌شده';
fields['bank-account-number'] = '123456';
saveBankAccount('BANK-NEW');
assert.equal(accountState.bankAccounts[0].name, 'حساب جاری اصلاح‌شده');
console.log('PASS: bank account creation, duplicate-number prevention, editing and audit logging');
