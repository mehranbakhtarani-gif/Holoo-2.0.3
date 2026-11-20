const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function buildPartyLedger(partyId, fromDate, toDate)');
const end = html.indexOf('function openPartyLedger(partyId)', start);
assert.ok(start >= 0 && end > start, 'party ledger builder must exist');

function makeBuilder(state) {
  const sandbox = {
    state,
    normalizeLedgerDate(value) { return String(value || '').replace(/-/g, '/'); },
    jalaliDateOrdinal(value) {
      const match = String(value || '').match(/^(\\d{4})\\/(\\d{2})\\/(\\d{2})$/);
      if (!match) return null;
      const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
      if (month < 1 || month > 12 || day < 1 || day > (month <= 6 ? 31 : month <= 11 ? 30 : 29)) return null;
      return year * 10000 + month * 100 + day;
    },
    getPartyLedgerControlCodes(party) {
      const supplier = String(party.role || '').includes('تأمین');
      return new Set([String(party.ledgerAccountCode || (supplier ? '2101' : '1103')), ...(supplier ? ['1107'] : [])]);
    },
    countInvalidReportVoucherLines(voucher) {
      return (voucher.lines || []).filter(line => {
        const debit = Number(line.debit ?? 0), credit = Number(line.credit ?? 0);
        return !Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0 && credit > 0);
      }).length;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(start, end) + '; this.buildPartyLedger = buildPartyLedger;', sandbox);
  return sandbox.buildPartyLedger;
}

{
  const state = {
    parties: [
      { id: 'DUP', name: 'مشتری اول', role: 'مشتری', ledgerAccountCode: '1103' },
      { id: 'DUP', name: 'تأمین‌کننده دوم', role: 'تأمین‌کننده', ledgerAccountCode: '2101' }
    ],
    vouchers: [
      { id: 1, date: '1405/01/01', lines: [{ code: '1103', partyId: 'DUP', debit: 100, credit: 0 }] },
      { id: 2, date: '1405/01/02', lines: [{ code: '2101', partyId: 'DUP', debit: 0, credit: 75 }] }
    ]
  };
  const before = JSON.stringify(state);
  const build = makeBuilder(state);
  assert.throws(
    () => build('DUP', '1405/01/01', '1405/01/31'),
    /شناسه این طرف حساب تکراری است/,
    'duplicate IDs must never resolve to the first party arbitrarily'
  );
  assert.equal(JSON.stringify(state), before, 'ambiguous identity handling must not mutate accounting records');
}

{
  const state = {
    parties: [{ id: 'P1', name: 'مشتری معتبر', role: 'مشتری', ledgerAccountCode: '1103' }],
    vouchers: [{ id: 1, date: '1405/01/01', lines: [{ code: '1103', partyId: 'P1', debit: 100, credit: 0 }] }]
  };
  const result = makeBuilder(state)('P1', '1405/01/01', '1405/01/31');
  assert.equal(result.closingNet, 100, 'a unique party ID must continue to produce its ledger');
}

console.log('PASS: duplicate party IDs block ambiguous subsidiary-ledger attribution');
console.log('PASS: unique party IDs retain normal ledger behavior');
