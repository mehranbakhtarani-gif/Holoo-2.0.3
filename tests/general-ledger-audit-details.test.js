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
vm.runInContext(extract('function inspectTrialBalanceVoucher(', 'function ' , ), sandbox);
