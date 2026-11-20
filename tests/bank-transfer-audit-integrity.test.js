const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const inspectStart = html.indexOf('    function inspectTrialBalanceVoucher(voucher)');
const auditStart = html.indexOf('    function buildBankTransferAuditSummary()');
const auditEnd = html.indexOf('\n    function renderTreasuryModule()', auditStart);
assert.ok(inspectStart >= 0 && auditStart >= 0 && auditEnd > auditStart, 'bank transfer audit functions must exist');
const inspectEnd = html.indexOf('\n    function ', inspectStart + 20);
assert.ok(inspectEnd > inspectStart, 'trial balance voucher inspector must be bounded');
const source = html.slice(inspectStart, inspectEnd) + '\n' +
  html.slice(auditStart, auditEnd) + '\nthis.audit = buildBankTransferAuditSummary;';

function fixture({ voucherId = 77, lines, txOverrides = {} } = {}) {
  const voucher = {
    id: voucherId, date: '1405/09/02', sourceType: 'bank_transfer', sourceEvent: 'posted',
    sourceId: 'TR-1', lines: lines || [
      { code: '1102', bankAccountId: 'BANK-B', debit: 1000, credit: 0 },
      { code: '6101', debit: 10, credit: 0 },
      { code: '1102', bankAccountId: 'BANK-A', debit: 0, credit: 1010 }
    ]
  };
  const state = {
    bankAccounts: [
      { id: 'BANK-A', type: 'bank' },
      { id: 'BANK-B', type: 'bank' }
    ],
    treasuryTxs: [
      { id: 'TR-1-OUT', transferId: 'TR-1', kind: 'bank_transfer', dir: 'pay', method: 'حواله بانکی', amount: 1010, date: '1405/09/02', bankAccountId: 'BANK-A', voucherId: voucherId, ...txOverrides.out },
      { id: 'TR-1-IN', transferId: 'TR-1', kind: 'bank_transfer', dir: 'receive', method: 'حواله بانکی', amount: 1000, date: '1405/09/02', bankAccountId: 'BANK-B', voucherId: voucherId, ...txOverrides.in }
    ],
    vouchers: [voucher]
  };
  const before = JSON.stringify(state);
  const sandbox = {
    state,
    jalaliDateOrdinal(value) {
      return /^1405\/\d{2}\/\d{2}$/.test(String(value || '')) ? 100 : null;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const result = sandbox.audit();
  assert.equal(JSON.stringify(state), before, 'bank transfer audit must not mutate source records');
  return result;
}

{
  const result = fixture();
  assert.equal(result.issueCount, 0);
  assert.equal(result.invalidLineAmounts, 0);
  console.log('PASS: balanced transfer with a separate fee remains valid');
}

{
  const result = fixture({ lines: [
    { code: '1102', bankAccountId: 'BANK-B', debit: 1000, credit: 0 },
    { code: '6101', debit: 10, credit: 0 },
    { code: '1102', bankAccountId: 'BANK-A', debit: 0, credit: 1010 },
    { code: '9999', debit: '', credit: 0 }
  ] });
  assert.equal(result.invalidLineAmounts, 1);
  assert.equal(result.invalidVoucher, 1);
  assert.ok(result.issues.some(issue => issue.includes('مبلغ خالی')));
  console.log('PASS: blank extra journal line is rejected rather than treated as zero');
}

{
  const result = fixture({ voucherId: '' });
  assert.equal(result.missingVoucherId, 1);
  assert.ok(result.issueCount > 0);
  console.log('PASS: missing bank transfer voucher identifier is reported');
}

{
  const result = fixture({ txOverrides: { out: { amount: 1011 } } });
  assert.ok(result.amountMismatch > 0);
  console.log('PASS: treasury-side transfer amount mismatch remains detectable');
}


{
  const result = fixture({ txOverrides: { out: { id: 'TX-OUT', transferId: '' } } });
  assert.equal(result.missingTransferId, 1);
  assert.ok(result.issues.some(issue => issue.includes('شناسه انتقال')));
  console.log('PASS: transaction without a transfer correlation key is reported');
}

console.log('PASS: bank transfer voucher integrity audit tests');
