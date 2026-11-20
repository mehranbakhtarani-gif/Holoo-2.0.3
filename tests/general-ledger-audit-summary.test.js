const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}

const jalaliStart = html.indexOf('function jalaliDateOrdinal(');
const jalaliEnd = html.indexOf('function currentJalaliOrdinal()', jalaliStart);
const voucherStart = html.indexOf('function inspectTrialBalanceVoucher(');
const voucherEnd = html.indexOf('function ', voucherStart + 10);
const auditStart = html.indexOf('function buildGeneralLedgerAuditSummary()');
const auditEnd = html.indexOf('function buildFiscalOpeningClosingAuditSummary()', auditStart);
assert.ok(jalaliStart >= 0 && jalaliEnd > jalaliStart, 'Jalali date validation helper must exist');
assert.ok(voucherStart >= 0 && voucherEnd > voucherStart, 'voucher integrity validator must exist');
assert.ok(auditStart >= 0 && auditEnd > auditStart, 'general-ledger audit summary must exist');

const state = {
  parties: [{ id: 'P1', name: 'طرف حساب معتبر' }],
  accountCatalog: [],
  vouchers: [
    { id: 'DUP', number: '10', sourceType: 'invoice', sourceId: 'INV-1', sourceEvent: 'posted', date: '1405/01/01', lines: [
      { code: '1101', debit: 100, credit: 0 },
      { code: '3101', debit: 0, credit: 100 }
    ] },
    { id: 'DUP', number: '10', sourceType: 'invoice', sourceId: 'INV-1', sourceEvent: 'posted', date: '1405/01/02', lines: [
      { code: '1103', partyId: 'MISSING-PARTY-1', debit: 50, credit: 0 },
      { code: '3101', debit: 0, credit: 50 }
    ] },
    { id: 'BAD-DATE', number: '11', date: '1405/13/01', lines: [
      { code: '1101', debit: 20, credit: 0 },
      { code: '3101', debit: 0, credit: 20 }
    ] },
    { id: 'BAD-LINE', number: '12', date: '1405/01/04', lines: [
      { code: '9999', partyId: 'MISSING-PARTY-2', debit: -5, credit: 0 },
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
  { code: '1101', name: 'صندوق' },
  { code: '1103', name: 'حساب دریافتنی' },
  { code: '3101', name: 'سرمایه' }
];
const before = JSON.stringify(state);
const sandbox = { state, CHART_ACCOUNTS };
vm.createContext(sandbox);
vm.runInContext(html.slice(jalaliStart, jalaliEnd), sandbox);
vm.runInContext(html.slice(voucherStart, voucherEnd), sandbox);
vm.runInContext(html.slice(auditStart, auditEnd) + '; this.audit = buildGeneralLedgerAuditSummary;', sandbox);

const report = sandbox.audit();
assert.equal(report.total, 6);
assert.equal(report.duplicateIds, 1, 'duplicate voucher identifiers must be counted once per extra occurrence');
assert.equal(report.duplicateSources, 1, 'duplicate source events must be detected');
assert.equal(report.duplicateNumbers, 1, 'duplicate voucher numbers must be detected');
assert.equal(report.missingAccounts, 1, 'unknown account codes must be reported');
assert.equal(report.missingParties, 2, 'unmapped party references must be reported');
assert.equal(report.invalidDates, 1, 'invalid Jalali dates must be reported');
assert.equal(report.invalidAmounts, 1, 'negative amount lines must be reported');
assert.equal(report.invalidStructure, 1, 'single-line vouchers must be reported');
assert.equal(report.unbalanced, 2, 'incomplete and unbalanced vouchers must remain visible to audit');
assert.equal(report.issueCount, 11, 'issue count must sum all reported issue categories');
assert.ok(report.issues.some(x => x.includes('شناسه تکراری: 1')));
assert.ok(report.issues.some(x => x.includes('رویداد منبع تکراری: 1')));
assert.ok(report.issues.some(x => x.includes('سند نامتوازن: 2')));
assert.equal(JSON.stringify(state), before, 'general-ledger audit must not mutate source accounting records');

console.log('PASS: general-ledger audit detects duplicate voucher IDs, source events and numbers');
console.log('PASS: general-ledger audit detects missing accounts and party references');
console.log('PASS: general-ledger audit detects invalid dates, amounts, structure and unbalanced vouchers');
console.log('PASS: general-ledger audit remains read-only');
