const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}
const start = html.indexOf('function buildSubsidiaryInvoiceAuditSummary()');
const end = html.indexOf('function ', start + 10);
assert.ok(start >= 0 && end > start, 'subsidiary invoice audit summary must exist');
const source = html.slice(start, end);
function run(state) {
  const sandbox = {
    state,
    isSupplierParty: party => String(party?.role || '').includes('تأمین'),
    jalaliDateOrdinal(value) {
      const match = String(value || '').match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      if (!match) return null;
      const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
      if (month < 1 || month > 12 || day < 1 || day > (month <= 6 ? 31 : month <= 11 ? 30 : 29)) return null;
      return year * 10000 + month * 100 + day;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source + '; this.audit = buildSubsidiaryInvoiceAuditSummary;', sandbox);
  return sandbox.audit();
}
const state = {
  accountCatalog: [], invoices: [],
  parties: [
    { id: 'DUP', name: 'مشتری تکراری اول', role: 'مشتری', ledgerAccountCode: '1103' },
    { id: 'DUP', name: 'تأمین‌کننده تکراری دوم', role: 'تأمین‌کننده', ledgerAccountCode: '2101' },
    { id: 'C1', name: 'مشتری معتبر', role: 'مشتری', ledgerAccountCode: '1103' }
  ],
  vouchers: [
    { id: 'V-DUP', date: '1405/01/01', lines: [{ code: '1103', partyId: 'DUP', debit: 100, credit: 0 }] },
    { id: 'V-VALID', date: '1405/01/02', lines: [{ code: '1103', partyId: 'C1', debit: 0, credit: 50 }] },
    { id: 'V-MISSING-DEBIT', date: '1405/01/03', lines: [{ code: '1103', partyId: 'C1', credit: 10 }] },
    { id: 'V-ZERO', date: '1405/01/04', lines: [{ code: '1103', partyId: 'C1', debit: 0, credit: 0 }] },
    { id: 'V-BAD-DATE', date: '1405/13/01', lines: [{ code: '1103', partyId: 'C1', debit: 500, credit: 0 }] }
  ]
};
const before = JSON.stringify(state);
const result = run(state);
assert.equal(result.duplicatePartyIds, 1);
assert.equal(result.unassignedControlLines, 1);
assert.equal(result.invalidInvoiceLinks, 1);
assert.equal(result.invalidControlLines, 2);
assert.equal(result.invalidControlDates, 1);
assert.equal(result.subledgerAccounts, 1);
assert.equal(result.partyBalanceDifference, 1);
assert.ok(result.issues.some(issue => issue.startsWith('شناسه تکراری طرف حساب: 1')));
assert.equal(JSON.stringify(state), before, 'audit must not mutate accounting records');
console.log('PASS: duplicate party IDs are ambiguous and never mapped arbitrarily');
console.log('PASS: missing and zero/zero control-line amounts are flagged');
console.log('PASS: invalid-dated control vouchers are excluded from subledger totals');
console.log('PASS: subsidiary audit remains read-only and exposes reconciliation differences');
