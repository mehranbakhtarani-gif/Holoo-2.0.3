const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function buildPartyLedger(partyId, fromDate, toDate)');
const end = html.indexOf('    function openPartyLedger(partyId)', start);
assert.ok(start >= 0 && end > start, 'party ledger builder must exist');

const state = {
  parties: [{ id: 'C1', role: 'تأمین‌کننده', ledgerAccountCode: '1103' }],
  vouchers: [
    { id: 1, date: '1405/01/01', lines: [
      { code: '1103', partyId: 'C1', debit: 1000, credit: 0 },
      { code: '4101', partyId: 'C1', debit: 0, credit: 1000 }
    ] },
    { id: 2, date: '1405/01/05', lines: [
      { code: '1103', partyId: 'C1', debit: 500, credit: 0 },
      { code: '4101', partyId: 'C1', debit: 0, credit: 500 },
      { code: '6101', partyId: 'C1', debit: 99, credit: 0 }
    ] },
    { id: 3, date: '1405/01/07', lines: [
      { code: '1103', partyId: 'C1', debit: 0, credit: 200 },
      { code: '1107', partyId: 'C1', debit: 50, credit: 0 },
      { code: '2101', partyId: 'C1', debit: 0, credit: 50 }
    ] }
  ]
};
const sandbox = {
  state,
  normalizeLedgerDate: value => String(value || '').replace(/-/g, '/'),
  jalaliDateOrdinal: value => /^1405\/\d{2}\/\d{2}$/.test(String(value)) ? Number(String(value).replace(/\//g,'')) : null,
  countInvalidReportVoucherLines: () => 0
};
vm.createContext(sandbox);
const helperStart = html.indexOf('    function isSupplierParty(party)');
const helperEnd = html.indexOf('    function normalizePartyIdentity(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'party control-account helper must exist');
vm.runInContext(html.slice(helperStart, helperEnd) + html.slice(start, end) + '; this.buildPartyLedger = buildPartyLedger;', sandbox);
const ledger = sandbox.buildPartyLedger('C1', '1405/01/02', '1405/01/31');

assert.equal(ledger.openingDebit, 1000, 'opening balance must use control accounts only');
assert.equal(ledger.periodDebit, 550, 'period debit must include 1103 and 1107');
assert.equal(ledger.periodCredit, 200, 'supplier control-account credit must include 1103 but exclude unrelated 2101');
assert.equal(ledger.closingNet, 1350);
assert.deepEqual(Array.from(ledger.rows, row => row.code), ['1103', '1103', '1107']);
assert.ok(!ledger.rows.some(row => ['4101', '6101'].includes(row.code)),
  'revenue and expense lines tagged with partyId must not distort party balance');
console.log('PASS: party ledger uses the same control-account scope as party net balance');
console.log('PASS: revenue/expense lines with partyId are excluded from party balance');
