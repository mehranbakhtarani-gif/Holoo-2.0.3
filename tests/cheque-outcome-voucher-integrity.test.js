const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function buildSettlementIntegrityAudit()');
const end = html.indexOf('function buildInvoiceDocumentIntegrityAudit()', start);
assert.ok(start >= 0 && end > start, 'settlement integrity audit must exist');
const source = html.slice(start, end) + '; this.audit = buildSettlementIntegrityAudit;';

function runAudit({ check, outcomeVouchers = [] }) {
  const state = {
    invoices: [],
    treasuryTxs: [{
      id: 'T1', dir: check.dir, method: 'چک صیادی', amount: 100,
      date: '1405/09/02', partyId: 'P1'
    }],
    checks: [check],
    vouchers: [
      {
        id: 'V-ISSUED', date: '1405/09/02', sourceType: 'check',
        sourceEvent: 'issued', sourceId: check.id,
        lines: check.dir === 'receive'
          ? [{ code: '1104', partyId: 'P1', debit: 100, credit: 0 }, { code: '1103', partyId: 'P1', debit: 0, credit: 100 }]
          : [{ code: '2101', partyId: 'P1', debit: 100, credit: 0 }, { code: '2102', partyId: 'P1', debit: 0, credit: 100 }]
      },
      ...outcomeVouchers
    ],
    parties: [{ id: 'P1' }],
    bankAccounts: [{ id: 'B1', type: 'bank' }]
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
  assert.equal(JSON.stringify(state), before, 'cheque outcome audit must be read-only');
  return result;
}

function check(status, dir = 'receive') {
  return {
    id: 'CHK1', sourceTxId: 'T1', dir, partyId: 'P1', amount: 100,
    dueDate: '1405/09/20', issueDate: '1405/09/02', bankAccountId: 'B1',
    status, allocations: [], statusUpdatedAt: '2026-11-20T10:00:00.000Z'
  };
}
function outcome(status, lines, id = 'V-OUTCOME', sourceId = 'CHK1') {
  return { id, date: '1405/09/02', sourceType: 'check', sourceEvent: status, sourceId, lines };
}

{
  const c = check('cleared');
  const result = runAudit({ check: c, outcomeVouchers: [outcome('cleared', [
    { code: '1102', bankAccountId: 'B1', debit: 100, credit: 0 },
    { code: '1104', partyId: 'P1', debit: 0, credit: 100 }
  ])] });
  assert.equal(result.missingCheckOutcomeVouchers, 0);
  assert.equal(result.duplicateCheckOutcomeVouchers, 0);
  assert.ok(!result.issues.some(item => item.type === 'check-outcome-ledger-mismatch'));
  console.log('PASS: valid cleared cheque has one balanced outcome voucher');
}

{
  const result = runAudit({ check: check('bounced') });
  assert.equal(result.missingCheckOutcomeVouchers, 1);
  assert.ok(result.issues.some(item => item.type === 'check-outcome-voucher-missing'));
  console.log('PASS: bounced cheque without a reversal voucher is detected');
}

{
  const c = check('bounced', 'pay');
  const voucher = outcome('bounced', [
    { code: '2102', partyId: 'P1', debit: 100, credit: 0 },
    { code: '2101', partyId: 'P1', debit: 0, credit: 100 }
  ]);
  const result = runAudit({ check: c, outcomeVouchers: [voucher] });
  assert.equal(result.missingCheckOutcomeVouchers, 0);
  assert.ok(!result.issues.some(item => item.type === 'check-outcome-ledger-mismatch'));
  console.log('PASS: valid bounced payable cheque validates the expected debit/credit sides');
}

{
  const c = check('voided');
  const voucher = outcome('voided', [
    { code: '1103', partyId: 'P1', debit: 100, credit: 0 },
    { code: '1104', partyId: 'P1', debit: 0, credit: 100 }
  ]);
  const result = runAudit({ check: c, outcomeVouchers: [voucher, { ...voucher, id: 'V-OUTCOME-2' }] });
  assert.equal(result.duplicateCheckOutcomeVouchers, 1);
  assert.ok(result.issues.some(item => item.type === 'check-outcome-voucher-duplicate'));
  console.log('PASS: duplicate cheque outcome vouchers are detected');
}

{
  const c = check('cleared');
  const result = runAudit({ check: c, outcomeVouchers: [outcome('cleared', [
    { code: '1102', bankAccountId: 'B1', debit: 90, credit: 0 },
    { code: '1104', partyId: 'P1', debit: 0, credit: 90 }
  ])] });
  assert.ok(result.issues.some(item => item.type === 'check-outcome-ledger-mismatch'));
  console.log('PASS: outcome voucher amount mismatch is detected');
}

{
  const c = check('cleared');
  const result = runAudit({ check: c, outcomeVouchers: [outcome('cleared', [
    { code: '1102', bankAccountId: 'B1', debit: 100, credit: 0 },
    { code: '1104', partyId: 'P1', debit: 0, credit: 100 }
  ], 'V-ORPHAN', 'OTHER-CHECK')] });
  assert.equal(result.orphanCheckOutcomeVouchers, 1);
  assert.ok(result.issues.some(item => item.type === 'check-outcome-voucher-orphan'));
  console.log('PASS: terminal cheque voucher without a matching check/status is detected');
}

console.log('PASS: cheque outcome voucher integrity audit remains read-only');
