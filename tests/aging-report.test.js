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
vm.runInContext(html.slice(start, end) + '; this.api = { jalaliDateOrdinal, agingBucket, buildAgingRows, renderAgingTable, renderAgingSummary, getPartyCreditBalance, renderAgingModule };', sandbox);
const { jalaliDateOrdinal, agingBucket, buildAgingRows, renderAgingTable, renderAgingSummary } = sandbox.api;

assert.equal(jalaliDateOrdinal('1405/09/27') - jalaliDateOrdinal('1405/08/27'), 30);
assert.equal(jalaliDateOrdinal('۱۴۰۵/۰۲/۱۰'), jalaliDateOrdinal('1405/02/10'));
assert.equal(jalaliDateOrdinal('1405/13/01'), null);
assert.equal(jalaliDateOrdinal('1404/12/30'), null);
assert.equal(agingBucket(-1), 'سررسید نشده');
assert.equal(agingBucket(15), '۱ تا ۳۰ روز');
assert.equal(agingBucket(45), '۳۱ تا ۶۰ روز');
assert.equal(agingBucket(75), '۶۱ تا ۹۰ روز');
assert.equal(agingBucket(120), 'بیش از ۹۰ روز');

sandbox.state.treasuryTxs = [
  { kind: 'party_credit', creditDirection: 'sale', partyId: 'C1', amount: 100, remainingAmount: 60 },
  { kind: 'party_credit', creditDirection: 'purchase', partyId: 'S1', amount: 90, remainingAmount: 40 }
];
sandbox.state.invoices = [
  { id: 1, type: 'sale', status: 'active', partyId: 'C1', date: '1405/01/01', dueDate: '1405/01/01', grandTotal: 1000, paidAmount: 250, returnRefs: [{ amount: 100 }] },
  { id: 2, type: 'purchase', status: 'active', partyId: 'S1', dueDate: '1405/01/01', grandTotal: 2000, paidAmount: 0 },
  { id: 3, type: 'sale', status: 'cancelled', partyId: 'C1', dueDate: '1405/01/01', grandTotal: 500, paidAmount: 0 },
  { id: 4, type: 'sale', status: 'active', partyId: 'C1', dueDate: '1405/01/01', grandTotal: 500, paidAmount: 500 },
  { id: 5, type: 'sale', status: 'active', partyId: 'C1', dueDate: '۱۴۰۵/۰۲/۱۰', grandTotal: 200, paidAmount: 0 },
  { id: 6, type: 'sale', status: 'active', partyId: 'C1', dueDate: '', grandTotal: 300, paidAmount: 0 },
  { id: 7, type: 'sale', status: 'active', partyId: 'C1', dueDate: '1405/13/01', grandTotal: 400, paidAmount: 0 },
  { id: 8, type: 'sale', status: 'active', partyId: 'C1', dueDate: '1405/01/01', grandTotal: 'bad-number', paidAmount: 0 }
];
const asOf = jalaliDateOrdinal('1405/02/10');
const receivables = buildAgingRows('sale', asOf);
const payables = buildAgingRows('purchase', asOf);
assert.equal(receivables.length, 5);
assert.equal(receivables.find(r => r.invoiceId === 1).outstanding, 650);
assert.equal(receivables.find(r => r.invoiceId === 1).daysPastDue, 40);
assert.equal(receivables.find(r => r.invoiceId === 5).bucket, 'سررسید نشده');
assert.equal(receivables.find(r => r.invoiceId === 6).bucket, 'بدون سررسید');
assert.equal(receivables.find(r => r.invoiceId === 7).bucket, 'تاریخ نامعتبر');
assert.equal(receivables.find(r => r.invoiceId === 8).bucket, 'مبلغ نامعتبر');
assert.equal(payables.length, 1);
assert.equal(payables[0].outstanding, 2000);
assert.equal(sandbox.api.getPartyCreditBalance('C1', 'sale'), 60);
assert.equal(sandbox.api.getPartyCreditBalance('S1', 'purchase'), 40);
assert.match(renderAgingSummary(receivables), /جمع مانده فاکتورهای باز/);
const unsafeRows = [{ invoiceId: '<img src=x>', party: '<script>alert(1)</script>', invoiceDate: '—', dueDate: '—', bucket: 'بدون سررسید', daysPastDue: null, outstanding: 10 }];
const rendered = renderAgingTable(unsafeRows);
assert.ok(!rendered.includes('<script>') && rendered.includes('&lt;script&gt;'));
console.log('PASS: aging buckets, Persian dates, leap-date validation, returns, partial payments, cancelled/settled invoices, credits, missing/invalid dates, invalid amounts and HTML escaping');
