const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
function between(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, 'missing source marker: ' + startMarker);
  assert.notEqual(end, -1, 'missing end marker: ' + endMarker);
  return html.slice(start, end);
}
const source = [
  between('function jalaliDateOrdinal(value) {', 'function currentJalaliOrdinal() {'),
  between('function normalizeLedgerDate(value) {', 'function buildAccountLedger(accountCode, fromDate, toDate) {'),
  between('function buildAccountLedger(accountCode, fromDate, toDate) {', 'function escapeLedgerText(value) {')
].join('\n');

const state = {
  parties: [{id:'P1', name:'مشتری آزمایشی'}],
  vouchers: [
    {id:1,date:'1404/12/29',desc:'مانده افتتاحیه',lines:[{code:'1103',debit:1000,credit:0,partyId:'P1'}]},
    {id:2,date:'1405/01/01',desc:'فاکتور اول',lines:[{code:'1103',debit:500,credit:0,partyId:'P1'}]},
    {id:3,date:'۱۴۰۵/۰۱/۰۵',desc:'دریافت وجه',lines:[{code:'1103',debit:0,credit:200,partyId:'P1'}]},
    {id:4,date:'1405/01/11',desc:'خارج از بازه',lines:[{code:'1103',debit:900,credit:0,partyId:'P1'}]},
    {id:5,date:'1405/01/03',desc:'حساب دیگر',lines:[{code:'1105',debit:700,credit:0}]}
  ]
};
const context = vm.createContext({state});
vm.runInContext(source, context);
const result = vm.runInContext("buildAccountLedger('1103','1405/01/01','1405/01/10')", context);
assert.equal(result.openingDebit, 1000);
assert.equal(result.openingCredit, 0);
assert.equal(result.openingNet, 1000);
assert.equal(result.periodDebit, 500);
assert.equal(result.periodCredit, 200);
assert.equal(result.closingNet, 1300);
assert.equal(result.rows.length, 2);
assert.equal(result.rows[0].balance, 1500);
assert.equal(result.rows[1].balance, 1300);
assert.equal(result.rows[0].partyName, 'مشتری آزمایشی');
assert.throws(() => vm.runInContext("buildAccountLedger('1103','1405/12/31','1406/01/10')", context));
assert.throws(() => vm.runInContext("buildAccountLedger('1103','1405/02/01','1405/01/01')", context));
const persian = vm.runInContext("normalizeLedgerDate('۱۴۰۵/۰۱/۰۵')", context);
assert.equal(persian, '14050105');
console.log('PASS: opening balance, period debit/credit, closing balance, running balance, party detail, account isolation, Persian digits, invalid dates, reversed range');
