const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function buildSettlementIntegrityAudit()');
const end = html.indexOf('\n    function buildInvoiceDocumentIntegrityAudit()', start);
assert.ok(start >= 0 && end > start, 'settlement audit function must exist');
const source = html.slice(start, end) + '; this.audit = buildSettlementIntegrityAudit;';

function harness({ txs = [], checks = [], vouchers = [] } = {}) {
  const state = {
    invoices: [], treasuryTxs: txs, checks, vouchers,
    parties: [{ id: 'P1' }],
    bankAccounts: [
      { id: 'C1', type: 'cash' },
      { id: 'B1', type: 'bank' }
    ],
    products: []
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
  assert.equal(JSON.stringify(state), before, 'audit must not mutate accounting state');
  return result;
}

function cashVoucher(lines) {
  return { id: 'V-CASH', date: '1405/09/02', sourceType: 'treasury', sourceEvent: 'posted', sourceId: 'T1', lines };
}
function cashTx() {
  return { id: 'T1', dir: 'receive', method: 'صندوق نقدی', amount: 100, date: '1405/09/02', partyId: 'P1', cashAccountId: 'C1' };
}
function cashLines(extra = []) {
  return [
    { code: '1101', cashAccountId: 'C1', debit: 100, credit: 0 },
    { code: '1103', partyId: 'P1', debit: 0, credit: 100 },
    ...extra
  ];
}
function chequeFixture(checks, lines) {
  return harness({
    txs: [{ id: 'T1', dir: 'receive', method: 'چک صیادی', amount: 100, date: '1405/09/02', partyId: 'P1' }],
    checks,
    vouchers: [{ id: 'V-CHK', date: '1405/09/02', sourceType: 'check', sourceEvent: 'issued', sourceId: 'CHK1', lines }]
  });
}

{
  const result = harness({ txs: [cashTx()], vouchers: [cashVoucher(cashLines())] });
  assert.equal(result.invalidLedgerLines, 0);
  assert.equal(result.ledgerAmountMismatches, 0);
  assert.equal(result.missingTreasuryVouchers, 0);
  console.log('PASS: valid cash receipt voucher remains reconciled');
}

{
  const result = harness({
    txs: [cashTx()],
    vouchers: [cashVoucher(cashLines([{ code: '9999', debit: '', credit: 0 }]))]
  });
  assert.equal(result.invalidLedgerLines, 1);
  assert.ok(result.issues.some(issue => issue.type === 'transaction-ledger-line-invalid'));
  assert.ok(result.issues.some(issue => issue.type === 'transaction-ledger-mismatch'));
  console.log('PASS: blank extra ledger line is not silently accepted as zero');
}

{
  const checks = [
    { id: 'CHK1', sourceTxId: 'T1', dir: 'receive', partyId: 'P1', amount: 100, dueDate: '1405/09/20', issueDate: '1405/09/02', bankAccountId: 'B1', allocations: [] },
    { id: 'CHK2', sourceTxId: 'T1', dir: 'receive', partyId: 'P1', amount: 100, dueDate: '1405/09/20', issueDate: '1405/09/02', bankAccountId: 'B1', allocations: [] }
  ];
  const result = chequeFixture(checks, [
    { code: '1104', partyId: 'P1', debit: 100, credit: 0 },
    { code: '1103', partyId: 'P1', debit: 0, credit: 100 }
  ]);
  assert.equal(result.duplicateCheckTransactionLinks, 1);
  assert.ok(result.issues.some(issue => issue.type === 'check-transaction-duplicate'));
  console.log('PASS: multiple cheque records linked to one treasury transaction are flagged');
}

{
  const checks = [
    { id: 'CHK1', sourceTxId: 'T1', dir: 'receive', partyId: 'P1', amount: 100, dueDate: '1405/09/20', issueDate: '1405/09/02', bankAccountId: 'B1', allocations: [] }
  ];
  const result = chequeFixture(checks, [
    { code: '1104', partyId: 'P1', debit: 100, credit: 0 },
    { code: '1103', partyId: 'P1', debit: 0, credit: 100 },
    { code: '9999', debit: '', credit: 0 }
  ]);
  assert.equal(result.invalidLedgerLines, 1);
  assert.ok(result.issues.some(issue => issue.type === 'check-ledger-line-invalid'));
  console.log('PASS: blank extra cheque voucher line is flagged');
}

console.log('PASS: settlement and treasury ledger-line integrity tests');
