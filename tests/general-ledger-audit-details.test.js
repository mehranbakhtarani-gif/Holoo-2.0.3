const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}
const extract = (start, end) => {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Expected helper boundaries: ' + start);
  return html.slice(a, b);
};
const extractFunction = start => {
  const a = html.indexOf(start);
  const b = html.indexOf('function ', a + start.length);
  assert.ok(a >= 0 && b > a, 'Expected function: ' + start);
  return html.slice(a, b);
};

const state = {
  parties: [{ id: 'P1', name: 'طرف حساب معتبر' }],
  accountCatalog: [],
  vouchers: [
    { id: 'DUP', number: '10', sourceType: 'invoice', sourceId: 'INV-1', sourceEvent: 'posted', date: '1405/01/01', lines: [
      { code: '1101', debit: 100, credit: 0, partyId: 'P1' },
      { code: '3101', debit: 0, credit: 100 }
    ] },
    { id: 'DUP', number: '10', sourceType: 'invoice', sourceId: 'INV-1', sourceEvent: 'posted', date: '1405/01/02', lines: [
      { code: '1101', debit: 50, credit: 0, partyId: 'P1' },
      { code: '3101', debit: 0, credit: 50 }
    ] },
    { id: 'BAD-DATE', number: '11', date: '1405/13/01', lines: [
      { code: '1101', debit: 20, credit: 0 },
      { code: '3101', debit: 0, credit: 20 }
    ] },
    { id: 'BAD-LINE', number: '12', date: '1405/01/04', lines: [
      { code: '9999', partyId: 'MISSING-PARTY', debit: -5, credit: 0 },
      { code: '1101', debit: 10, credit: 0 }
    ] },
    { id: 'INCOMPLETE', number: '13', date: '1405/01/05', lines: [
      { code: '1101', debit: 5, credit: 0 }
    ] },
    { id: 'UNBALANCED', number: '14', date: '1405/01/06', lines: [
      { code: '1101', debit: 20, credit: 0 },
      { code: '3101', debit: 0, credit: 10 }
    ] }
  ]
};
const CHART_ACCOUNTS = [
  { code: '1101', name: 'حساب دریافتنی' },
  { code: '3101', name: 'سرمایه' }
];
const before = JSON.stringify(state);
const sandbox = { state, CHART_ACCOUNTS };
vm.createContext(sandbox);
vm.runInContext(extract('function jalaliDateOrdinal(', 'function currentJalaliOrdinal()'), sandbox);
vm.runInContext(extractFunction('function inspectTrialBalanceVoucher('), sandbox);
vm.runInContext(extract('function buildGeneralLedgerAuditSummary()', 'function buildFiscalOpeningClosingAuditSummary()') + '; this.audit = buildGeneralLedgerAuditSummary;', sandbox);

const report = sandbox.audit();
const categories = new Set(report.details.map(item => item.category));
assert.equal(report.total, 6);
assert.equal(report.duplicateIds, 1);
assert.equal(report.duplicateSources, 1);
assert.equal(report.duplicateNumbers, 1);
assert.equal(report.missingAccounts, 1);
assert.equal(report.missingParties, 1);
assert.equal(report.invalidDates, 1);
assert.equal(report.invalidAmounts, 1);
assert.equal(report.invalidStructure, 1);
assert.equal(report.unbalanced, 2, 'the one-sided incomplete voucher and the unequal two-line voucher are both unbalanced');
for (const category of ['duplicate-id','duplicate-source','duplicate-number','missing-account','missing-party','invalid-date','invalid-amount','invalid-structure','unbalanced']) {
  assert.ok(categories.has(category), 'Missing detail category: ' + category);
}
const missingParty = report.details.find(item => item.category === 'missing-party');
assert.equal(missingParty.voucherId, 'BAD-LINE');
assert.equal(missingParty.voucherNumber, '12');
assert.equal(missingParty.accountCode, '9999');
assert.equal(missingParty.partyId, 'MISSING-PARTY');
assert.equal(missingParty.lineNumber, 1);
assert.equal(missingParty.debit, -5);
const validPartyLine = report.details.find(item => item.category === 'duplicate-id');
assert.equal(validPartyLine.voucherId, 'DUP');
assert.equal(validPartyLine.sourceId, 'INV-1');
assert.equal(report.detailsTruncated, false);
assert.equal(report.detailsTotal, report.details.length);
assert.equal(JSON.stringify(state), before, 'General-ledger detail audit must not mutate source accounting data');

console.log('PASS: general-ledger audit exposes voucher-level and line-level discrepancy details');
console.log('PASS: detail records include voucher, account, party, source, date, and amount references');
console.log('PASS: duplicate identifiers and source events are traceable to their vouchers');
console.log('PASS: detail audit is read-only');
