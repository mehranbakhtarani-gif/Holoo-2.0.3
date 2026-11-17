const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function jalaliDateOrdinal(');
const end = html.indexOf('    function renderCapitalPlanner()', start);
assert.notEqual(start, -1, 'aging helpers must exist');
assert.notEqual(end, -1, 'aging helpers must have a section end');
const sandbox = {
  state: { invoices: [] },
  getPartyName: id => 'Party ' + id,
  faNum: String,
  money: n => String(n),
  document: { getElementById: () => ({ innerHTML: '' }) }
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '; this.api = { jalaliDateOrdinal, agingBucket, buildAgingRows, renderAgingModule };', sandbox);
const { jalaliDateOrdinal, agingBucket, buildAgingRows } = sandbox.api;

assert.equal(jalaliDateOrdinal('1405/09/27') - jalaliDateOrdinal('1405/08/27'), 30);
assert.equal(jalaliDateOrdinal('1405/13/01'), null);
assert.equal(agingBucket(-1), 'سررسید نشده');
assert.equal(agingBucket(15), '۱ تا ۳۰ روز');
assert.equal(agingBucket(45), '۳۱ تا ۶۰ روز');
assert.equal(agingBucket(75), '۶۱ تا ۹۰ روز');
assert.equal(agingBucket(120), 'بیش از ۹۰ روز');

sandbox.state.invoices = [
  { id: 1, type: 'sale', status: 'active', partyId: 'C1', dueDate: '1405/01/01', grandTotal: 1000, paidAmount: 250 },
  { id: 2, type: 'purchase', status: 'active', partyId: 'S1', dueDate: '1405/01/01', grandTotal: 2000, paidAmount: 0 },
  { id: 3, type: 'sale', status: 'cancelled', partyId: 'C1', dueDate: '1405/01/01', grandTotal: 500, paidAmount: 0 },
  { id: 4, type: 'sale', status: 'active', partyId: 'C1', dueDate: '1405/01/01', grandTotal: 500, paidAmount: 500 }
];
const receivables = buildAgingRows('sale');
const payables = buildAgingRows('purchase');
assert.equal(receivables.length, 1);
assert.equal(receivables[0].outstanding, 750);
assert.equal(payables.length, 1);
assert.equal(payables[0].outstanding, 2000);
console.log('PASS: 7 receivables/payables aging tests');
