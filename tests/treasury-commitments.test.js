const fs = require('fs');
const assert = require('assert');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202611180003_guarantees_payable_commitments.sql', 'utf8');
for (const token of ['guarantees: []','payableCommitments: []',"'guarantees', 'payableCommitments'",'function saveGuaranteeRecord()','function changeGuaranteeStatus(','function savePayableCommitment()','function changePayableCommitmentStatus(','renderGuaranteesAndCommitments()','ضمانت‌نامه‌ها و وثایق','تعهدات پرداختنی']) {
  assert(html.includes(token), 'missing contract: ' + token);
}
const guaranteeFn = html.slice(html.indexOf('function saveGuaranteeRecord()'), html.indexOf('function changeGuaranteeStatus('));
const commitmentFn = html.slice(html.indexOf('function savePayableCommitment()'), html.indexOf('function changePayableCommitmentStatus('));
assert(!guaranteeFn.includes('postVoucher('), 'guarantee register must remain memorandum-only');
assert(!commitmentFn.includes('postVoucher('), 'commitment register must remain memorandum-only');
assert(guaranteeFn.includes('amount <= 0') && guaranteeFn.includes('jalaliDateLooksValid'), 'guarantee validation missing');
assert(commitmentFn.includes('amount <= 0') && commitmentFn.includes('jalaliDateLooksValid'), 'commitment validation missing');
assert(migration.includes("'guarantees', 'payableCommitments'"), 'RPC allowlist missing collections');
assert(migration.includes('does not modify RLS policies'), 'RLS policy boundary missing');

const assignFnStart = html.indexOf('    function assignLegacyCheckBankAccount(checkId)');
const assignFnEnd = html.indexOf('    function updateCheckStatus(id, st)', assignFnStart);
assert(assignFnStart >= 0 && assignFnEnd > assignFnStart, 'legacy check bank assignment function missing');
const assignmentState = {
  activeRole: 'mehran',
  checks: [{ id: 'OLD-CHK', sayad: '123456789012', status: 'in_progress' }],
  bankAccounts: [{ id: 'CASH-1', type: 'cash' }, { id: 'BANK-1', type: 'bank', name: 'بانک الف' }]
};
let selectedBank = '';
let saved = 0, rendered = 0, audits = 0, errors = 0;
const assignmentSandbox = {
  state: assignmentState,
  document: { getElementById: () => ({ value: selectedBank }) },
  addAudit: () => { audits++; },
  saveState: () => { saved++; },
  renderAll: () => { rendered++; },
  showToast: (_message, kind) => { if (kind === 'error') errors++; },
  Date
};
vm.createContext(assignmentSandbox);
vm.runInContext(html.slice(assignFnStart, assignFnEnd) + '; this.assignLegacyCheckBankAccount = assignLegacyCheckBankAccount;', assignmentSandbox);
selectedBank = 'CASH-1';
assignmentSandbox.assignLegacyCheckBankAccount('OLD-CHK');
assert.equal(assignmentState.checks[0].bankAccountId, undefined, 'cash account must not be accepted for a cheque');
selectedBank = 'BANK-1';
assignmentSandbox.assignLegacyCheckBankAccount('OLD-CHK');
assert.equal(assignmentState.checks[0].bankAccountId, 'BANK-1', 'selected bank must be stored on the legacy cheque');
assert.equal(saved, 1);
assert.equal(rendered, 1);
assert.equal(audits, 1);
assignmentSandbox.assignLegacyCheckBankAccount('OLD-CHK');
assert.equal(saved, 1, 'an already assigned cheque must not be reassigned through the legacy path');
assert.equal(errors, 2);
console.log('PASS: legacy cheques require a valid bank account before clearing; assignment creates no voucher');

console.log('PASS: guarantee and payable commitment controls');
