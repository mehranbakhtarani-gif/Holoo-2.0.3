const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, m] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (m[1].trim()) new vm.Script(m[1], { filename: `index.html:inline-${i}` });
}
const start = html.indexOf('function jalaliDateOrdinal(');
const end = html.indexOf('function setAccTab(', start);
assert.notEqual(start, -1, 'ledger helpers must exist');
assert.notEqual(end, -1, 'ledger helper section must terminate');
const source = html.slice(start, end);
const state = {
  parties: [{ id: 'P1', name: 'مشتری آزمایشی' }],
  vouchers: [
    { id: 1, date: '1405/01/01', lines: [{ code: '1101', debit: 1000, credit: 0, desc: 'افتتاحیه', partyId: 'P1' }] },
    { id: 2, date: '1405/02/01', desc: 'سند دریافت', lines: [{ code: '1101', debit: 500, credit: 0, desc: 'دریافت', partyId: 'P1' }] },
    { id: 3, date: '1405/02/05', desc: 'سند پرداخت', lines: [{ code: '1101', debit: 0, credit: 200, desc: 'پرداخت', partyId: 'P1' }] },
    { id: 4, date: '1405/03/01', lines: [{ code: '1101', debit: 900, credit: 0, desc: 'بعد از بازه' }] },
    { id: 5, date: '1405/02/03', lines: [{ code: '2101', debit: 999, credit: 0, desc: 'حساب دیگر' }] }
  ]
};
const sandbox = { state };
vm.createContext(sandbox);
vm.runInContext(source + '; this.buildAccountLedger = buildAccountLedger; this.normalizeLedgerDate = normalizeLedgerDate;', sandbox);

assert.equal(sandbox.normalizeLedgerDate('۱۴۰۵/۰۲/۰۱'), '14050201');
const ledger = sandbox.buildAccountLedger('1101', '1405/02/01', '1405/02/28');
assert.equal(ledger.openingDebit, 1000);
assert.equal(ledger.openingCredit, 0);
assert.equal(ledger.periodDebit, 500);
assert.equal(ledger.periodCredit, 200);
assert.equal(ledger.closingNet, 1300);
assert.equal(ledger.rows.length, 2);
assert.deepEqual(Array.from(ledger.rows, r => r.voucherId), [2, 3]);
assert.deepEqual(Array.from(ledger.rows, r => r.balance), [1500, 1300]);
assert.equal(ledger.rows[0].partyName, 'مشتری آزمایشی');
assert.equal(ledger.rows[0].voucherDesc, 'سند دریافت');
assert.throws(() => sandbox.buildAccountLedger('1101', '1405/03/01', '1405/02/01'), /بازه تاریخ/);
assert.throws(() => sandbox.buildAccountLedger('1101', '1405/13/01', '1405/13/20'), /بازه تاریخ/);
console.log('PASS: account ledger opening, period movement, running balance, closing balance and date validation');
