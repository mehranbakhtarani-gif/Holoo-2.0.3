const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function submitInvoice()');
const end = html.indexOf('    function canCorrectInvoice', start);
assert.ok(start >= 0 && end > start, 'invoice submission function must exist');
const source = html.slice(start, end) + '; this.submitInvoice = submitInvoice;';

function makeHarness(saveResult) {
  const original = {
    fiscalYear: '1405', costingMethod: 'AVG',
    invoices: [], vouchers: [], auditLogs: [], orders: [], parties: [], bankAccounts: [],
    products: [{ id: 'P1', name: 'کالای آزمایشی', warehouseId: 'WH1', stock: 5, buyPrice: 10, batches: [], kardex: [] }]
  };
  const values = {
    'inv-party': 'SUP-1', 'inv-warehouse': 'WH1', 'inv-pay-method': 'credit',
    'inv-settlement-account': '', 'inv-vat-rate': '0', 'inv-commission-rate': '0',
    'inv-salesperson': '', 'inv-due-date': '1405/09/01'
  };
  const elements = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value }]));
  elements['invoice-form-card'] = { classList: { add() {} } };
  const calls = { save: 0, renders: 0, toasts: [] };
  const sandbox = {
    state: original,
    invDraft: { type: 'purchase', sourceOrderId: null, correctionOfInvoiceId: null, lines: [
      { productId: 'P1', name: 'کالای آزمایشی', kg: 2, price: 10, disc: 0, total: 20, lot: 'LOT-1', productionDate: '', expiryDate: '' }
    ] },
    document: { getElementById(id) { return elements[id] || null; } },
    getTodayJalaliDate() { return '1405/08/29'; },
    resolveInvoiceWarehouseProduct(productId, warehouseId, products) {
      return { product: products.find(product => String(product.id) === String(productId) && String(product.warehouseId) === String(warehouseId)), created: false };
    },
    addStockBatch(product, details) { product.batches.push({ ...details, remainingQty: details.quantity }); },
    postVoucher(desc, lines, date, source) {
      const id = sandbox.state.vouchers.length + 1;
      sandbox.state.vouchers.push({ id, desc, lines, date, sourceType: source.type, sourceId: String(source.id) });
      return id;
    },
    addAudit(action, meta) { sandbox.state.auditLogs.unshift({ action, meta }); },
    saveState() { calls.save++; return saveResult; },
    showToast(message, type) { calls.toasts.push({ message, type }); },
    renderAll() { calls.renders++; },
    faNum: String, money: String,
    JSON, Date, Math, Number, String, Map, Array
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { sandbox, original, calls };
}

{
  const { sandbox, calls } = makeHarness(false);
  sandbox.submitInvoice();
  assert.equal(sandbox.state.invoices.length, 0, 'failed save must not leave a posted invoice');
  assert.equal(sandbox.state.vouchers.length, 0, 'failed save must not leave a journal voucher');
  assert.equal(sandbox.state.products[0].stock, 5, 'failed save must restore inventory quantity');
  assert.equal(sandbox.state.products[0].batches.length, 0, 'failed save must restore inventory batches');
  assert.equal(sandbox.state.products[0].kardex.length, 0, 'failed save must restore stock ledger');
  assert.equal(calls.save, 1);
  assert.equal(calls.renders, 0, 'UI must not report success after failed persistence');
  assert.equal(calls.toasts.at(-1).type, 'error');
}

{
  const { sandbox, calls } = makeHarness(true);
  sandbox.submitInvoice();
  assert.equal(sandbox.state.invoices.length, 1);
  assert.equal(sandbox.state.vouchers.length, 1);
  assert.equal(sandbox.state.products[0].stock, 7);
  assert.equal(sandbox.state.products[0].batches.length, 1);
  assert.equal(sandbox.state.products[0].kardex.length, 1);
  assert.equal(calls.save, 1);
  assert.equal(calls.renders, 1);
  assert.equal(calls.toasts.at(-1).type, undefined);
}

console.log('PASS: invoice, journal, stock and batches roll back together when local persistence fails');
console.log('PASS: successful invoice posting commits the linked journal and inventory movement');
