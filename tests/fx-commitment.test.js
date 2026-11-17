const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function payFxCommitmentStage(');
const end = html.indexOf('    function updateFxRates()', start);
assert.notEqual(start, -1, 'FX staged payment function must exist');
const amountInput = { value: '40' };
const bankInput = { value: 'BANK1' };
const state = {
  activeRole: 'mehran',
  fxRates: { USD: 1100 },
  fxCommitments: [{ id: 'FX1', amount: 100, paidAmount: 0, initialRate: 1000, currency: 'USD', status: 'open', payments: [] }],
  bankAccounts: [{ id: 'BANK1', balance: 500000 }]
};
const vouchers = [];
const sandbox = {
  state, DEVICE_ID: 'DEVICE-1',
  document: { getElementById(id) { return id.startsWith('fx-pay-amount-') ? amountInput : bankInput; } },
  createStableId: (() => { let n = 0; return p => p + '-' + (++n); })(),
  postVoucher(...args) { vouchers.push(args); },
  addAudit() {}, saveState() {}, renderFxModule() {}, showToast() {}
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '; this.pay = payFxCommitmentStage;', sandbox);

sandbox.pay('FX1');
assert.equal(state.fxCommitments[0].paidAmount, 40);
assert.equal(state.fxCommitments[0].status, 'partial');
assert.equal(state.fxCommitments[0].payments.length, 1);
assert.equal(state.bankAccounts[0].balance, 456000);
assert.equal(vouchers.length, 1);
const lines = vouchers[0][1];
assert.equal(lines.reduce((n, x) => n + x.debit, 0), lines.reduce((n, x) => n + x.credit, 0));
assert.equal(lines.find(x => x.code === '6104').debit, 4000);

amountInput.value = '70';
sandbox.pay('FX1');
assert.equal(state.fxCommitments[0].paidAmount, 40);
assert.equal(vouchers.length, 1);

amountInput.value = '60';
sandbox.pay('FX1');
assert.equal(state.fxCommitments[0].paidAmount, 100);
assert.equal(state.fxCommitments[0].status, 'paid');
assert.equal(state.fxCommitments[0].payments.length, 2);
console.log('PASS: 8 FX commitment settlement tests');

const importStart = html.indexOf('    function payFxStage(');
const importEnd = html.indexOf('    function ', importStart + 20);
const importShipment = { id: 'IMP-FX', fxTotal: 80, fxPaid: 0, fxRate: 1000, currency: 'USD', fxPayments: [] };
const importState = { imports: [importShipment], fxRates: { USD: 1100 }, bankAccounts: [{ id: 'BANK-2', balance: 200000 }], activeRole: 'ehsan' };
const importAmount = { value: '30' };
const importBank = { value: 'BANK-2' };
const importVouchers = [];
const importSandbox = {
  state: importState, DEVICE_ID: 'DEVICE-FX',
  document: { getElementById(id) { return id.startsWith('fx-import-pay-') ? importAmount : importBank; } },
  createStableId: (() => { let n = 0; return p => p + '-' + (++n); })(),
  getTodayJalaliDate: () => '1405/09/01',
  postVoucher(...args) { importVouchers.push(args); },
  addAudit() {}, saveState() {}, renderAll() {}, showToast() {}
};
vm.createContext(importSandbox);
vm.runInContext(html.slice(importStart, importEnd) + '; this.payImport = payFxStage;', importSandbox);
importSandbox.payImport('IMP-FX');
assert.equal(importShipment.fxPaid, 30);
assert.equal(importShipment.fxPayments.length, 1);
assert.equal(importState.bankAccounts[0].balance, 167000);
assert.equal(importVouchers.length, 1);
assert.equal(importVouchers[0][1].reduce((n, x) => n + x.debit, 0), importVouchers[0][1].reduce((n, x) => n + x.credit, 0));
importAmount.value = '60';
importSandbox.payImport('IMP-FX');
assert.equal(importShipment.fxPaid, 30);
assert.equal(importVouchers.length, 1);
assert.match(html, /id="fx-import-pay-\$\{m\.id\}"/);
console.log('PASS: import FX variable installment and audit history tests');

