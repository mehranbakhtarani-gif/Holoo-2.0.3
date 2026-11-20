const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: `index.html:inline-${i}` });
}
function sliceBetween(startText, endText) {
  const start = html.indexOf(startText), end = html.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing source range: ${startText}`);
  return html.slice(start, end);
}
const state = {
  parties: [{ id: 'P1', name: 'مشتری اول' }, { id: 'P2', name: 'مشتری دوم' }],
  vouchers: [
    { id: 1, date: '1404/12/29', desc: 'افتتاحیه', lines: [
      { code: '1103', debit: 100, credit: 0, partyId: 'P1' },
      { code: '3101', debit: 0, credit: 100 }
    ]},
    { id: 2, date: '1405/01/02', desc: 'فروش نسیه', lines: [
      { code: '1103', debit: 500, credit: 0, partyId: 'P1' },
      { code: '1103', debit: 300, credit: 0, partyId: 'P2' },
      { code: '4101', debit: 0, credit: 800 }
    ]},
    { id: 3, date: '1405/01/05', desc: 'دریافت از مشتریان', lines: [
      { code: '1101', debit: 150, credit: 0 },
      { code: '1103', debit: 0, credit: 100, partyId: 'P1' },
      { code: '1103', debit: 0, credit: 50, partyId: 'P2' }
    ]},
    { id: 4, date: '1405/02/01', desc: 'خارج از بازه', lines: [
      { code: '1103', debit: 900, credit: 0, partyId: 'P1' },
      { code: '4101', debit: 0, credit: 900 }
    ]}
  ]
};
const sandbox = { state };
vm.createContext(sandbox);
const source =
  sliceBetween('    function jalaliDateOrdinal(', '    function currentJalaliOrdinal()') +
  sliceBetween('    function normalizeLedgerDate(', '    function buildAccountLedger(') +
  sliceBetween('    function countInvalidReportVoucherLines(', '    function buildAccountLedger(') +
  sliceBetween('    function isSupplierParty(party)', '    function normalizePartyIdentity(') +
  sliceBetween('    function buildPartyLedger(', '    function openPartyLedger(');
vm.runInContext(source + '; this.buildPartyLedger = buildPartyLedger;', sandbox);

const before = JSON.stringify(state);
const first = sandbox.buildPartyLedger('P1', '1405/01/01', '1405/01/31');
const second = sandbox.buildPartyLedger('P2', '1405/01/01', '1405/01/31');
assert.equal(first.openingNet, 100);
assert.equal(first.periodDebit, 500);
assert.equal(first.periodCredit, 100);
assert.equal(first.closingNet, 500);
assert.deepEqual(Array.from(first.rows, row => row.voucherId), [2, 3]);
assert.equal(second.openingNet, 0);
assert.equal(second.periodDebit, 300);
assert.equal(second.periodCredit, 50);
assert.equal(second.closingNet, 250);
assert.deepEqual(Array.from(second.rows, row => row.voucherId), [2, 3]);
assert.equal(JSON.stringify(state), before, 'party ledger must not mutate source vouchers');
assert.throws(() => sandbox.buildPartyLedger('P1', '1405/02/01', '1405/01/01'), /بازه تاریخ/);
console.log('PASS: party ledgers isolate two parties and calculate opening, period and closing balances');
console.log('PASS: party ledger respects date boundaries and does not mutate vouchers');
