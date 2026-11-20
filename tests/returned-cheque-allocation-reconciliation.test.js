const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function buildSettlementIntegrityAudit()');
const end = html.indexOf('function buildInvoiceDocumentIntegrityAudit()', start);
assert.ok(start >= 0 && end > start, 'settlement integrity audit must exist');
const source = html.slice(start, end) + '; this.audit = buildSettlementIntegrityAudit;';

function runAudit({ status = 'bounced', released = true, paidAmount = 20 }) {
  const check = {
    id: 'CHK-RETURNED', sourceTxId: 'T-CHECK', dir: 'receive', partyId: 'P1',
    amount: 40, issueDate: '1405/09/02', dueDate: '1405/09/20',
    bankAccountId: 'B1', status, allocations: [{ invoiceId: 101, amount: 40 }],
    ...(released ? { allocationsReleasedAt: '2026-11-20T10:00:00.000Z' } : {})
  };
  const state = {
    invoices: [{
      id: 101, type: 'sale', status: 'active', partyId: 'P1',
      payMethod: 'credit', grandTotal: 100, paidAmount, returnRefs: []
    }],
    treasuryTxs: [
      { id: 'T-CHECK', dir: 'receive', method: 'چک صیادی', amount: 40, date: '1405/09/02', partyId: 'P1' },
      { id: 'T-CASH', dir: 'receive', method: 'صندوق نقدی', amount: 20, date: '1405/09/02', partyId: 'P1', cashAccountId: 'C1', allocations: [{ invoiceId: 101, amount: 20 }] }
    ],
    checks: [check],
    parties: [{ id: 'P1' }],
    bankAccounts: [{ id: 'B1', type: 'bank' }, { id: 'C1', type: 'cash' }],
    vouchers: [
      {
        id: 'V-CHECK-ISSUED', date: '1405/09/02', sourceType: 'check',
        sourceEvent: 'issued', sourceId: check.id,
        lines: [
          { code: '1104', partyId: 'P1', debit: 40, credit: 0 },
          { code: '1103', partyId: 'P1', debit: 0, credit: 40 }
        ]
      },
      {
        id: 'V-CHECK-OUTCOME', date: '1405/09/02', sourceType: 'check',
        sourceEvent: status, sourceId: check.id,
        lines: [
          { code: '1103', partyId: 'P1', debit: 40, credit: 0 },
          { code: '1104', partyId: 'P1', debit: 0, credit: 40 }
        ]
      },
      {
        id: 'V-CASH', date: '1405/09/02', sourceType: 'treasury',
        sourceEvent: 'posted', sourceId: 'T-CASH',
        lines: [
          { code: '1101', cashAccountId: 'C1', debit: 20, credit: 0 },
          { code: '1103', partyId: 'P1', debit: 0, credit: 20 }
        ]
      }
    ]
  };
  const before = JSON.stringify(state);
  const sandbox = {
    state,
    jalaliDateOrdinal(value) {
      return /^1405\\/\\d{2}\\/\\d{2}$/.test(String(value || '')) ? 100 : null;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const result = sandbox.audit();
  assert.equal(JSON.stringify(state), before, 'settlement audit must remain read-only');
  return result;
}

for (const status of ['bounced', 'voided']) {
  const correct = runAudit({ status, released: true, paidAmount: 20 });
  assert.equal(correct.paidAmountMismatches, 0,
    status + ' cheque must be excluded after its exact allocation is released');
  assert.equal(correct.overAllocatedInvoices, 0);
  assert.equal(correct.ledgerAmountMismatches, 0);

  const notReleased = runAudit({ status, released: true, paidAmount: 60 });
  assert.equal(notReleased.paidAmountMismatches, 1,
    status + ' cheque allocation left in paidAmount must be detected');

  const overReleased = runAudit({ status, released: true, paidAmount: 0 });
  assert.equal(overReleased.paidAmountMismatches, 1,
    status + ' cheque release must not erase unrelated receipt allocations');
}

{
  const active = runAudit({ status: 'in_progress', released: false, paidAmount: 60 });
  assert.equal(active.paidAmountMismatches, 0,
    'active cheque allocation must continue contributing to invoice paidAmount');
}

console.log('PASS: bounced and voided cheque allocations are reconciled after release');
console.log('PASS: unrelated receipt allocations remain in invoice paidAmount');
console.log('PASS: active cheque allocations remain included');
console.log('PASS: returned-cheque allocation audit remains read-only');
