const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function buildSettlementIntegrityAudit()');
const end = html.indexOf('function buildInvoiceDocumentIntegrityAudit()', start);
assert.ok(start >= 0 && end > start, 'settlement integrity audit must exist');
const source = html.slice(start, end) + '; this.audit = buildSettlementIntegrityAudit;';

const state = {
  invoices: [{
    id: 101, type: 'sale', status: 'active', partyId: 'P1',
    payMethod: 'credit', grandTotal: 100, paidAmount: 100, returnRefs: []
  }],
  treasuryTxs: [{
    id: 'T1', dir: 'receive', method: 'صندوق نقدی', amount: 100,
    date: '1405/09/02', partyId: 'P1', cashAccountId: 'C1',
    allocations: [{ invoiceId: 101, amount: 50 }, { invoiceId: 101, amount: 50 }]
  }],
  checks: [],
  vouchers: [{
    id: 'V1', date: '1405/09/02', sourceType: 'treasury',
    sourceEvent: 'posted', sourceId: 'T1',
    lines: [
      { code: '1101', cashAccountId: 'C1', debit: 100, credit: 0 },
      { code: '1103', partyId: 'P1', debit: 0, credit: 100 }
    ]
  }],
  parties: [{ id: 'P1' }],
  bankAccounts: [{ id: 'C1', type: 'cash' }]
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

assert.equal(result.duplicateAllocationRows, 1,
  'the same invoice must not appear twice in one transaction allocation list');
assert.ok(result.issues.some(issue => issue.type === 'allocation-duplicate-invoice'));
assert.equal(result.paidAmountMismatches, 0,
  'duplicate-row detection is independent of the amount roll-forward');
assert.equal(JSON.stringify(state), before, 'settlement audit must remain read-only');
console.log('PASS: duplicate invoice rows in a single settlement allocation are reported');
console.log('PASS: duplicate-row detection preserves read-only accounting state');
