const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
for (const [i, source] of scripts.entries()) new vm.Script(source, { filename: `index.html:inline-script-${i}` });

function extractFunction(name, endMarker) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing function: ${name}`);
  assert.notEqual(end, -1, `missing end marker for: ${name}`);
  return html.slice(start, end).trim();
}
function load(source, name, context) {
  const sandbox = { ...context };
  vm.createContext(sandbox);
  const helperStart = html.indexOf('function getReturnCostOfGoods(');
  const helperEnd = html.indexOf('function submitPartialReturn()', helperStart);
  if (helperStart >= 0 && helperEnd > helperStart) vm.runInContext(html.slice(helperStart, helperEnd), sandbox);
  vm.runInContext(source + `; this.__testFn = ${name};`, sandbox);
  return sandbox.__testFn;
}
function fakeDocument(values) {
  return {
    getElementById(id) {
      if (!(id in values)) return { value: '', classList: { add() {} } };
      return { value: values[id], classList: { add() {} } };
    }
  };
}
const passed = [];
function test(name, fn) { fn(); passed.push(name); }

// Synthetic parties: customer/supplier control accounts and duplicate protection.
test('new customer receives a stable subledger identity and customer control account', () => {
  const state = { parties: [] };
  let saves = 0;
  const values = { 'np-name': 'مشتری آزمایشی ۱', 'np-phone': '09120000001', 'np-role': 'مشتری', 'np-eco': '', 'np-credit': '1000000', 'np-terms': 'نقدی' };
  const save = load(extractFunction('saveParty', '// =========================================================================\n    // 9.'), 'saveParty', {
    state, document: fakeDocument(values), saveState() { saves++; }, closeModal() {}, renderAll() {}, showToast() {}
  });
  save();
  assert.equal(state.parties.length, 1);
  assert.equal(state.parties[0].ledgerAccountCode, '1103');
  assert.ok(state.parties[0].subledgerId);
  assert.equal(state.parties[0].accountingStatus, 'active');
  assert.equal(saves, 1);
});

test('duplicate party name or phone is rejected without a second record', () => {
  const state = { parties: [{ id: 'P1', name: 'آزمایشگاه الف', phone: '09121111111' }] };
  let saves = 0;
  const values = { 'np-name': 'آزمایشگاه الف', 'np-phone': '09122222222', 'np-role': 'مشتری', 'np-eco': '', 'np-credit': '', 'np-terms': '' };
  const save = load(extractFunction('saveParty', '// =========================================================================\n    // 9.'), 'saveParty', {
    state, document: fakeDocument(values), saveState() { saves++; }, closeModal() {}, renderAll() {}, showToast() {}
  });
  save();
  assert.equal(state.parties.length, 1);
  assert.equal(saves, 0);
});

// Synthetic stock item: opening stock must create a balanced opening voucher.
test('opening stock creates kardex entry and accounting voucher', () => {
  const state = { products: [], fiscalYear: '1405' };
  const values = { 'p-name': 'نخ تستی ۷۵۰', 'p-barcode': 'TEST-750', 'p-yarn-type': 'پلی‌استر', 'p-denier': '750', 'p-color': 'سفید', 'p-twist': 'استاندارد', 'p-custom-spec': '', 'p-wh': 'WH1', 'p-carton-kg': '25', 'p-stock': '100', 'p-buy-price': '20000', 'p-lot': '' };
  for (let i = 0; i < 10; i++) values[`p-lvl-${i}`] = String(25000 + i * 100);
  const vouchers = [];
  const save = load(extractFunction('saveProduct', 'function renderInventoryModule()'), 'saveProduct', {
    state, document: fakeDocument(values), getTodayJalaliDate() { return '1405/09/02'; }, postVoucher(...args) { vouchers.push(args); }, saveState() {}, closeModal() {}, renderAll() {}, showToast() {}
  });
  save();
  assert.equal(state.products.length, 1);
  assert.equal(state.products[0].stock, 100);
  assert.equal(state.products[0].kardex[0].inQty, 100);
  assert.equal(vouchers.length, 1);
  assert.equal(vouchers[0][1].reduce((n, line) => n + line.debit, 0), vouchers[0][1].reduce((n, line) => n + line.credit, 0));
});

// Invoice lifecycle with isolated in-memory state. No live database or user data is touched.
function runInvoice(type, payMethod = 'credit', bankAccounts = [], settlementAccountId = null) {
  const product = { id: 'TX-101', name: 'کالای آزمایشی', stock: 100, buyPrice: 10, kardex: [] };
  const state = {
    fiscalYear: '1405', invoices: [], products: [product],
    bankAccounts,
    costingMethod: 'AVG'
  };
  const values = { 'inv-party': 'P-TEST', 'inv-warehouse': 'WH1', 'inv-pay-method': payMethod, 'inv-settlement-account': settlementAccountId || bankAccounts[0]?.id || '', 'inv-vat-rate': '0', 'inv-commission-rate': '0', 'inv-due-date': '1405/09/01', 'inv-salesperson': 'آزمایشی' };
  const draft = { type, lines: [{ productId: 'TX-101', kg: 5, price: 20, total: 100, disc: 0 }] };
  const posted = [];
  let saves = 0;
  const submit = load(extractFunction('submitInvoice', 'function renderInvoicesModule()'), 'submitInvoice', {
    state, invDraft: draft, document: fakeDocument(values), getTodayJalaliDate() { return '1405/09/02'; },
    addStockBatch(product, details) { product.batches = product.batches || []; product.batches.push({ ...details, id: 'TEST-BATCH-' + product.batches.length, remainingQty: details.quantity }); },
    consumeFifoStock(product, quantity) {
      product.batches = product.batches || [];
      if (!product.batches.length) product.batches.push({ id: 'TEST-OPENING', lot: 'TEST', remainingQty: product.stock, unitCost: product.buyPrice });
      let remaining = quantity;
      const allocations = [];
      for (const batch of product.batches) {
        const take = Math.min(remaining, Number(batch.remainingQty || 0));
        if (take > 0) {
          batch.remainingQty -= take;
          allocations.push({ batchId: batch.id, lot: batch.lot, quantity: take, unitCost: batch.unitCost });
          remaining -= take;
        }
        if (remaining <= 0) break;
      }
      if (remaining > 0) throw new Error('insufficient test batch stock');
      return { totalCost: Math.round(allocations.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)), allocations };
    },
    postVoucher(...args) { posted.push(args); }, saveState() { saves++; }, renderAll() {}, showToast() {}, faNum: String
  });
  submit();
  return { state, product, posted, saves };
}

test('sales invoice decreases stock and posts a source-linked accounting voucher', () => {
  const r = runInvoice('sale');
  assert.equal(r.state.invoices.length, 1);
  assert.equal(r.state.invoices[0].id, 1001);
  assert.equal(r.product.stock, 95);
  assert.equal(r.product.kardex.at(-1).outQty, 5);
  assert.equal(r.posted.length, 1);
  assert.equal(r.posted[0][3].type, 'invoice');
  assert.equal(r.posted[0][3].id, 1001);
});

test('purchase invoice increases stock and posts a source-linked accounting voucher', () => {
  const r = runInvoice('purchase');
  assert.equal(r.state.invoices.length, 1);
  assert.equal(r.product.stock, 105);
  assert.equal(r.product.kardex.at(-1).inQty, 5);
  assert.equal(r.posted.length, 1);
  assert.equal(r.posted[0][3].type, 'invoice');
  assert.equal(r.posted[0][3].id, 1001);
});

test('cash purchase credits cash and decreases the selected cash balance', () => {
  const cash = { id: 'CASH-1', type: 'cash', name: 'صندوق آزمایشی', balance: 500 };
  const r = runInvoice('purchase', 'cash', [cash]);
  const lines = r.posted[0][1];
  assert.equal(r.state.invoices[0].paidAmount, 100);
  assert.equal(r.state.invoices[0].bankAccountId, 'CASH-1');
  assert.equal(lines.find(line => line.code === '1101').credit, 100);
  assert.equal(lines.some(line => line.code === '2101'), false);
  assert.equal(cash.balance, 400);
});

test('bank purchase credits bank and decreases the selected bank balance', () => {
  const bank = { id: 'BANK-1', type: 'bank', name: 'بانک آزمایشی', balance: 500 };
  const r = runInvoice('purchase', 'bank', [bank]);
  const lines = r.posted[0][1];
  assert.equal(r.state.invoices[0].bankAccountId, 'BANK-1');
  assert.equal(lines.find(line => line.code === '1102').credit, 100);
  assert.equal(lines.some(line => line.code === '2101'), false);
  assert.equal(bank.balance, 400);
});

test('purchase invoice uses the explicitly selected second cash account', () => {
  const first = { id: 'CASH-1', type: 'cash', name: 'صندوق اول', balance: 500 };
  const second = { id: 'CASH-2', type: 'cash', name: 'صندوق دوم', balance: 900 };
  const r = runInvoice('purchase', 'cash', [first, second], 'CASH-2');
  assert.equal(r.state.invoices[0].bankAccountId, 'CASH-2');
  assert.equal(first.balance, 500);
  assert.equal(second.balance, 800);
  assert.equal(r.posted[0][1].find(line => line.code === '1101').credit, 100);
});

test('sales invoice uses the explicitly selected second bank account', () => {
  const first = { id: 'BANK-1', type: 'bank', name: 'بانک اول', balance: 500 };
  const second = { id: 'BANK-2', type: 'bank', name: 'بانک دوم', balance: 900 };
  const r = runInvoice('sale', 'bank', [first, second], 'BANK-2');
  assert.equal(r.state.invoices[0].bankAccountId, 'BANK-2');
  assert.equal(first.balance, 500);
  assert.equal(second.balance, 1000);
  assert.equal(r.posted[0][1].find(line => line.code === '1102').debit, 100);
});

test('paid invoice rejects a missing or mismatched settlement account before mutation', () => {
  const first = { id: 'BANK-1', type: 'bank', name: 'بانک اول', balance: 500 };
  const r = runInvoice('purchase', 'bank', [first], 'CASH-NOT-FOUND');
  assert.equal(r.state.invoices.length, 0);
  assert.equal(r.product.stock, 100);
  assert.equal(first.balance, 500);
  assert.equal(r.posted.length, 0);
  assert.equal(r.saves, 0);
});

test('credit purchase remains payable to supplier without changing cash or bank', () => {
  const cash = { id: 'CASH-1', type: 'cash', name: 'صندوق آزمایشی', balance: 500 };
  const bank = { id: 'BANK-1', type: 'bank', name: 'بانک آزمایشی', balance: 700 };
  const r = runInvoice('purchase', 'credit', [cash, bank]);
  const lines = r.posted[0][1];
  assert.equal(lines.find(line => line.code === '2101').credit, 100);
  assert.equal(cash.balance, 500);
  assert.equal(bank.balance, 700);
});

test('paid invoice is rejected before mutation when matching settlement account is missing', () => {
  const r = runInvoice('purchase', 'bank', []);
  assert.equal(r.state.invoices.length, 0);
  assert.equal(r.product.stock, 100);
  assert.equal(r.posted.length, 0);
  assert.equal(r.saves, 0);
});

// Unpaid invoice cancellation must reverse stock exactly once and post a reversal.
test('unpaid sales invoice cancellation restores stock and marks invoice cancelled', () => {
  const state = {
    invoices: [{ id: 1001, type: 'sale', status: 'active', paidAmount: 0, partyId: 'P1', grandTotal: 100, items: [{ productId: 'TX-1', kg: 5, returnedKg: 0 }] }],
    products: [{ id: 'TX-1', stock: 5 }]
  };
  const posted = [];
  const cancel = load(extractFunction('cancelInvoice', 'function printOfficialInvoice('), 'cancelInvoice', {
    state, getInvoiceReturnedAmount(inv) { return (inv.returnRefs || []).reduce((sum, ref) => sum + Number(ref.amount || 0), 0); }, restoreFifoAllocations(product, allocations, qty, fallbackCost, sourceRef) { product.batches = product.batches || []; product.batches.push({ id: 'RETURN-' + sourceRef, quantity: qty, remainingQty: qty, unitCost: fallbackCost }); return [{ batchId: 'RETURN-' + sourceRef, quantity: qty }]; }, consumeFifoStock() {}, postVoucher(...args) { posted.push(args); }, saveState() {}, renderAll() {}, showToast() {}, faNum: String
  });
  cancel(1001);
  assert.equal(state.invoices[0].status, 'cancelled');
  assert.equal(state.products[0].stock, 10);
  assert.equal(posted.length, 1);
  assert.equal(posted[0][3].type, 'invoice_cancel');
});

console.log(`PASS: ${passed.length} extended synthetic workflow tests`);
for (const name of passed) console.log(`- ${name}`);
