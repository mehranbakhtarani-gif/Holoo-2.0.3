const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: `index.html:inline-${i}` });
}
function extract(name, endMarker) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing function ${name}`);
  assert.ok(end > start, `missing end marker for ${name}`);
  return html.slice(start, end);
}
function load(source, fnName, context) {
  const sandbox = { jalaliDateOrdinal: () => 1, ...context };
  vm.createContext(sandbox);
  vm.runInContext(source + `; this.__fn = ${fnName};`, sandbox);
  return sandbox.__fn;
}
const passed = [];
function test(name, fn) { fn(); passed.push(name); }

test('unsettled credit purchase invoice is eligible for audited correction', () => {
  const state = { treasuryTxs: [], checks: [] };
  const eligible = load(extract('canCorrectInvoice', 'function openInvoiceCorrection'), 'canCorrectInvoice', { state });
  assert.equal(eligible({ id: 51, type: 'purchase', status: 'active', payMethod: 'credit', paidAmount: 0, items: [{ kg: 4 }] }), true);
});

test('unsettled credit sales invoice remains eligible when commission subledger is valid', () => {
  const state = { treasuryTxs: [], checks: [] };
  const eligible = load(extract('canCorrectInvoice', 'function openInvoiceCorrection'), 'canCorrectInvoice', { state });
  assert.equal(eligible({ id: 52, type: 'sale', status: 'active', payMethod: 'credit', paidAmount: 0, commAmount: 10, salespersonPartyId: 'P-SALES', items: [{ kg: 4 }] }), true);
});

test('cash or bank settled purchase invoice is blocked', () => {
  const state = { treasuryTxs: [], checks: [] };
  const eligible = load(extract('canCorrectInvoice', 'function openInvoiceCorrection'), 'canCorrectInvoice', { state });
  for (const payMethod of ['cash', 'bank']) {
    assert.equal(eligible({ id: 53, type: 'purchase', status: 'active', payMethod, paidAmount: 100, items: [{ kg: 4 }] }), false);
  }
});

test('purchase invoice with partial settlement is blocked', () => {
  const state = { treasuryTxs: [], checks: [] };
  const eligible = load(extract('canCorrectInvoice', 'function openInvoiceCorrection'), 'canCorrectInvoice', { state });
  assert.equal(eligible({ id: 54, type: 'purchase', status: 'active', payMethod: 'credit', paidAmount: 1, items: [{ kg: 4 }] }), false);
});

test('purchase invoice with a return is blocked', () => {
  const state = { treasuryTxs: [], checks: [] };
  const eligible = load(extract('canCorrectInvoice', 'function openInvoiceCorrection'), 'canCorrectInvoice', { state });
  assert.equal(eligible({ id: 55, type: 'purchase', status: 'active', payMethod: 'credit', paidAmount: 0, returnRefs: [{ amount: 10 }], items: [{ kg: 4 }] }), false);
  assert.equal(eligible({ id: 56, type: 'purchase', status: 'active', payMethod: 'credit', paidAmount: 0, items: [{ kg: 4, returnedKg: 1 }] }), false);
});

test('purchase invoice with linked treasury allocation or active cheque is blocked', () => {
  const eligible = load(extract('canCorrectInvoice', 'function openInvoiceCorrection'), 'canCorrectInvoice', {
    state: { treasuryTxs: [{ allocations: [{ invoiceId: 57, amount: 10 }] }], checks: [] }
  });
  assert.equal(eligible({ id: 57, type: 'purchase', status: 'active', payMethod: 'credit', paidAmount: 0, items: [{ kg: 4 }] }), false);
  const withCheque = load(extract('canCorrectInvoice', 'function openInvoiceCorrection'), 'canCorrectInvoice', {
    state: { treasuryTxs: [], checks: [{ status: 'in_progress', allocations: [{ invoiceId: 58, amount: 10 }] }] }
  });
  assert.equal(withCheque({ id: 58, type: 'purchase', status: 'active', payMethod: 'credit', paidAmount: 0, items: [{ kg: 4 }] }), false);
});

test('cancelled invoice and invalid sales commission identity are blocked', () => {
  const state = { treasuryTxs: [], checks: [] };
  const eligible = load(extract('canCorrectInvoice', 'function openInvoiceCorrection'), 'canCorrectInvoice', { state });
  assert.equal(eligible({ id: 59, type: 'purchase', status: 'cancelled', payMethod: 'credit', paidAmount: 0, items: [{ kg: 4 }] }), false);
  assert.equal(eligible({ id: 60, type: 'sale', status: 'active', payMethod: 'credit', paidAmount: 0, commAmount: 10, items: [{ kg: 4 }] }), false);
});

test('correction form carries purchase type and original lines into draft', () => {
  const invoice = { id: 61, type: 'purchase', status: 'active', payMethod: 'credit', paidAmount: 0, partyId: 'SUP-1', warehouseId: 'WH-1', dueDate: '1405/09/01', items: [{ productId: 'X1', kg: 4, price: 20, total: 80 }] };
  const state = { invoices: [invoice], treasuryTxs: [], checks: [] };
  const values = {};
  const elements = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, { value: '', textContent: '', classList: { remove() {}, add() {} }, scrollIntoView() {} }); return elements.get(id); } };
  const testContext = {
    state, document, invDraft: null, canCorrectInvoice: inv => inv.type === 'purchase', openInvoiceForm(type) { values.type = type; },
    renderInvoiceSettlementAccounts() {}, renderInvoiceProductOptions() {}, getTodayJalaliDate() { return '1405/09/02'; },
    checkPartyCredit() {}, renderInvDraftLines() {}, showToast() {}, faNum: String
  };
  const open = load(extract('openInvoiceCorrection', 'function renderInvoicesModule'), 'openInvoiceCorrection', testContext);
  open(61);
  assert.equal(values.type, 'purchase');
  assert.equal(document.getElementById('inv-pay-method').value, 'credit');
  assert.equal(testContext.invDraft.type, 'purchase');
  assert.equal(testContext.invDraft.correctionOfInvoiceId, 61);
  assert.equal(testContext.invDraft.lines[0].productId, 'X1');
});

console.log('Passed ' + passed.length + ' invoice correction tests:');
for (const name of passed) console.log('✓ ' + name);
