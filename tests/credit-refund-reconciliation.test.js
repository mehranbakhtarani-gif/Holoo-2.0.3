const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function buildSettlementIntegrityAudit()');
const end = html.indexOf('function buildInvoiceDocumentIntegrityAudit()', start);
assert.ok(start >= 0 && end > start, 'settlement integrity audit must exist');
const source = html.slice(start, end) + '; this.audit = buildSettlementIntegrityAudit;';

function runAudit({ creditDirection = 'sale', txOverrides = {}, refundOverrides = {}, accountType = 'cash' } = {}) {
  const accountId = accountType === 'cash' ? 'C1' : 'B1';
  const direction = creditDirection === 'sale' ? 'pay' : 'receive';
  const method = accountType === 'cash' ? 'صندوق نقدی' : 'حواله بانکی';
  const refund = {
    id: 'R1', amount: 30, bankAccountId: accountId, voucherId: 'V-REFUND',
    direction, createdAt: '2026-11-20T10:00:00.000Z', ...refundOverrides
  };
  const credit = {
    id: 'CR1', kind: 'party_credit', creditDirection, partyId: 'P1',
    amount: 100, remainingAmount: 70, refunds: [refund], applications: []
  };
  const refundTx = {
    id: 'R1', kind: 'party_credit_refund', dir: direction, partyId: 'P1',
    amount: 30, method, sourceCreditId: 'CR1',
    ...(accountType === 'cash' ? { cashAccountId: accountId } : { bankAccountId: accountId }),
    ...txOverrides
  };
  const lines = creditDirection === 'sale'
    ? [{ code: '2101', partyId: 'P1', debit: 30, credit: 0 }, { code: accountType === 'cash' ? '1101' : '1102', [accountType === 'cash' ? 'cashAccountId' : 'bankAccountId']: accountId, debit: 0, credit: 30 }]
    : [{ code: accountType === 'cash' ? '1101' : '1102', [accountType === 'cash' ? 'cashAccountId' : 'bankAccountId']: accountId, debit: 30, credit: 0 }, { code: '1107', partyId: 'P1', debit: 0, credit: 30 }];
  const state = {
    invoices: [], checks: [], parties: [{ id: 'P1' }],
    bankAccounts: [{ id: 'C1', type: 'cash' }, { id: 'B1', type: 'bank' }],
    treasuryTxs: [credit, refundTx],
    vouchers: [{
      id: 'V-REFUND', date: '1405/09/02', sourceType: 'party_credit_refund',
      sourceId: 'CR1', sourceEvent: 'R1', lines
    }]
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
  assert.equal(JSON.stringify(state), before, 'refund audit must remain read-only');
  return result;
}

for (const scenario of [
  { creditDirection: 'sale', accountType: 'cash' },
  { creditDirection: 'purchase', accountType: 'bank' }
]) {
  const valid = runAudit(scenario);
  assert.equal(valid.creditRefundTransactionMismatches, 0);
  assert.equal(valid.invalidCreditRefundTransactions, 0);
  assert.equal(valid.creditBalanceMismatches, 0);
  assert.equal(valid.missingCreditRefundVouchers, 0);
  assert.equal(valid.ledgerAmountMismatches, 0);
}

{
  const result = runAudit({ txOverrides: { amount: 40 } });
  assert.equal(result.creditRefundTransactionMismatches, 1,
    'refund transaction amount must match the credit refund history row');
}

{
  const result = runAudit({ txOverrides: { dir: 'receive' } });
  assert.equal(result.creditRefundTransactionMismatches, 1,
    'refund transaction direction must match the recorded refund direction');
}

{
  const result = runAudit({ txOverrides: { partyId: 'P2' } });
  assert.equal(result.creditRefundTransactionMismatches, 1,
    'refund transaction party must match the source credit party');
}

{
  const result = runAudit({ txOverrides: { cashAccountId: 'OTHER' } });
  assert.equal(result.creditRefundTransactionMismatches, 1,
    'refund transaction account must match the refund history account');
}

{
  const result = runAudit({ txOverrides: { amount: 0 } });
  assert.equal(result.invalidCreditRefundTransactions, 1,
    'zero-value refund transactions must be reported as invalid');
}

console.log('PASS: customer and supplier credit refunds reconcile to their ledger vouchers');
console.log('PASS: refund amount, direction, party and account mismatches are detected');
console.log('PASS: invalid refund transactions are detected');
console.log('PASS: credit refund reconciliation audit remains read-only');
