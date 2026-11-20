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
    // Older records may retain allocInvId while a migration has added an empty allocations array.
    allocInvId: 101, allocations: []
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

assert.equal(result.paidAmountMismatches, 0,
  'legacy allocInvId must be used when allocations exists but is empty');
assert.equal(result.overAllocatedInvoices, 0);
assert.equal(JSON.stringify(state), before, 'settlement audit must remain read-only');
console.log('PASS: legacy single-invoice allocation fallback is honored with an empty allocations array');
console.log('PASS: settlement allocation audit does not mutate financial state');
