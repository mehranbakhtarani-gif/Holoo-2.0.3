const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, m] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (m[1].trim()) new vm.Script(m[1], { filename: `index.html:inline-${i}` });
}
function section(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing: ${startMarker}`);
  assert.notEqual(end, -1, `missing end: ${endMarker}`);
  return html.slice(start, end).trim();
}
function load(source, name, context) {
  const sandbox = { ...context };
  vm.createContext(sandbox);
  vm.runInContext(source + `; this.__fn = ${name};`, sandbox);
  return sandbox.__fn;
}
function fixture({ amount, selectedIds = [], invoices, dir = 'receive', legacyValue = '' }) {
  const values = {
    'tr-dir': dir, 'tr-party': 'P1', 'tr-method': 'cash', 'tr-amount': String(amount),
    'tr-bank-acc': 'B1', 'tr-desc': 'آزمون تخصیص', 'tr-alloc-inv': legacyValue
  };
  const selectedOptions = selectedIds.map(value => ({ value: String(value) }));
  const document = {
    getElementById(id) {
      if (id === 'tr-alloc-inv') return { value: legacyValue, selectedOptions };
      return { value: values[id] ?? '', classList: { add() {}, remove() {}, toggle() {} } };
    }
  };
  const state = {
    fiscalYear: '1405', parties: [{ id: 'P1' }],
    invoices: structuredClone(invoices),
    checks: [], bankAccounts: [{ id: 'B1', type: 'cash', name: 'صندوق', balance: 1000 }],
    treasuryTxs: []
  };
  const posted = [];
  let saves = 0;
  const save = load(section('function saveTreasuryEntry()', 'function renderTreasuryModule()'), 'saveTreasuryEntry', {
    state, document, postVoucher(...args) { posted.push(args); }, saveState() { saves++; },
    closeModal() {}, renderAll() {}, showToast() {}, faNum: String
  });
  return { state, posted, get saves() { return saves; }, run: save };
}
const passed = [];
function test(name, fn) { fn(); passed.push(name); }

test('one receipt allocates across multiple selected sales invoices in order', () => {
  const r = fixture({ amount: 700, selectedIds: [101, 102], invoices: [
    { id: 101, type: 'sale', status: 'active', partyId: 'P1', grandTotal: 300, paidAmount: 0 },
    { id: 102, type: 'sale', status: 'active', partyId: 'P1', grandTotal: 600, paidAmount: 100 }
  ]});
  r.run();
  assert.equal(r.state.invoices[0].paidAmount, 300);
  assert.equal(r.state.invoices[1].paidAmount, 500);
  assert.equal(JSON.stringify(r.state.treasuryTxs[0].allocations.map(x => [x.invoiceId, x.amount])), JSON.stringify([[101, 300], [102, 400]]));
  assert.equal(r.state.treasuryTxs[0].allocInvId, null);
  assert.equal(r.posted.length, 1);
  assert.equal(r.posted[0][1].reduce((s, x) => s + x.debit, 0), 700);
  assert.equal(r.posted[0][1].reduce((s, x) => s + x.credit, 0), 700);
  assert.equal(r.saves, 1);
});

test('separate receipts accumulate against the same invoice balance', () => {
  const invoices = [{ id: 201, type: 'sale', status: 'active', partyId: 'P1', grandTotal: 1000, paidAmount: 100 }];
  const first = fixture({ amount: 300, selectedIds: [201], invoices });
  first.run();
  const second = fixture({ amount: 250, selectedIds: [201], invoices: first.state.invoices });
  second.run();
  assert.equal(second.state.invoices[0].paidAmount, 650);
  assert.equal(second.state.treasuryTxs[0].allocations[0].amount, 250);
});

test('over-allocation against combined invoice balances is rejected with no side effects', () => {
  const r = fixture({ amount: 801, selectedIds: [301, 302], invoices: [
    { id: 301, type: 'sale', status: 'active', partyId: 'P1', grandTotal: 500, paidAmount: 200 },
    { id: 302, type: 'sale', status: 'active', partyId: 'P1', grandTotal: 400, paidAmount: 0 }
  ]});
  r.run();
  assert.equal(r.posted.length, 0);
  assert.equal(r.state.invoices[0].paidAmount, 200);
  assert.equal(r.state.invoices[1].paidAmount, 0);
  assert.equal(r.state.treasuryTxs.length, 0);
  assert.equal(r.state.bankAccounts[0].balance, 1000);
  assert.equal(r.saves, 0);
});

test('allocation to another party or wrong invoice type is rejected atomically', () => {
  for (const invoice of [
    { id: 401, type: 'sale', status: 'active', partyId: 'P2', grandTotal: 500, paidAmount: 0 },
    { id: 402, type: 'purchase', status: 'active', partyId: 'P1', grandTotal: 500, paidAmount: 0 }
  ]) {
    const r = fixture({ amount: 100, selectedIds: [invoice.id], invoices: [invoice] });
    r.run();
    assert.equal(r.posted.length, 0);
    assert.equal(r.state.treasuryTxs.length, 0);
    assert.equal(r.state.invoices[0].paidAmount, 0);
    assert.equal(r.saves, 0);
  }
});

test('legacy single-select callers remain supported', () => {
  const r = fixture({ amount: 200, legacyValue: '501', invoices: [
    { id: 501, status: 'active', partyId: 'P1', grandTotal: 500, paidAmount: 100 }
  ]});
  r.run();
  assert.equal(r.state.invoices[0].paidAmount, 300);
  assert.equal(r.state.treasuryTxs[0].allocInvId, 501);
});

test('payments allocate only to supplier purchase invoices', () => {
  const r = fixture({ amount: 150, selectedIds: [601], dir: 'pay', invoices: [
    { id: 601, type: 'purchase', status: 'active', partyId: 'P1', grandTotal: 500, paidAmount: 0 }
  ]});
  r.run();
  assert.equal(r.state.invoices[0].paidAmount, 150);
  assert.equal(r.posted.length, 1);
});

console.log(`PASS: ${passed.length} treasury allocation tests`);
for (const name of passed) console.log(`- ${name}`);
