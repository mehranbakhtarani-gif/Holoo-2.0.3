const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');

function extract(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'missing function ' + startMarker);
  assert.notEqual(end, -1, 'missing end marker ' + endMarker);
  return html.slice(start, end);
}
function load(source, name, context) {
  const sandbox = { ...context };
  vm.createContext(sandbox);
  vm.runInContext(source + '; this.fn = ' + name + ';', sandbox);
  return sandbox.fn;
}
function fakeDocument(values) {
  return { getElementById(id) { return { value: values[id] ?? '' }; } };
}

const revalueSource = extract('function postFxRevaluation()', 'function updateFxRates()');
function runRevaluation(state, postVoucher) {
  const posted = [];
  const messages = [];
  const fn = load(revalueSource, 'postFxRevaluation', {
    state,
    DEVICE_ID: 'DEVICE-FX',
    createStableId: (() => { let n = 0; return prefix => prefix + '-' + (++n); })(),
    getTodayJalaliDate: () => '1405/09/02',
    postVoucher(...args) { posted.push(args); if (postVoucher) return postVoucher(...args); },
    addAudit() {},
    saveState() {},
    renderFxModule() {},
    renderImportsModule() {},
    showToast(message, type) { messages.push({ message, type }); }
  });
  return { fn, posted, messages };
}

const state = {
  activeRole: 'mehran',
  fxRates: { USD: 1100, EUR: 800 },
  imports: [{
    id: 'IMP-1', fxTotal: 100, fxPaid: 20, fxRate: 1000, carryingRate: 1000,
    currency: 'USD', supplierPartyId: 'SUP-1', revaluationHistory: []
  }],
  fxCommitments: [{
    id: 'FXC-1', amount: 50, paidAmount: 0, initialRate: 900, carryingRate: 900,
    currency: 'EUR', supplierPartyId: 'SUP-2', ledgerPosted: true, revaluationHistory: []
  }]
};
const r = runRevaluation(state);
assert.equal(r.fn(), true);
assert.equal(r.posted.length, 1);
assert.equal(r.posted[0][0], 'ثبت تسعیر پایان دوره 1405/09/02');
assert.equal(r.posted[0][3].type, 'fx_revaluation');
const lines = r.posted[0][1];
assert.equal(lines.reduce((sum, line) => sum + line.debit, 0), 13000);
assert.equal(lines.reduce((sum, line) => sum + line.credit, 0), 13000);
assert.equal(lines.find(line => line.code === '6106').debit, 8000);
assert.equal(lines.find(line => line.code === '4104').credit, 5000);
assert.equal(state.imports[0].carryingRate, 1100);
assert.equal(state.fxCommitments[0].carryingRate, 800);
assert.equal(state.imports[0].revaluationHistory[0].difference, -8000);
assert.equal(state.fxCommitments[0].revaluationHistory[0].difference, 5000);
assert.equal(r.fn(), false);
assert.equal(r.posted.length, 1);
console.log('PASS: period-end revaluation posts balanced gain/loss and prevents same-day duplicates');

const failedState = {
  activeRole: 'mehran', fxRates: { USD: 1200 },
  imports: [{ id: 'IMP-FAIL', fxTotal: 10, fxPaid: 0, fxRate: 1000, carryingRate: 1000, currency: 'USD', revaluationHistory: [] }],
  fxCommitments: []
};
const failed = runRevaluation(failedState, () => { throw new Error('simulated voucher failure'); });
assert.equal(failed.fn(), false);
assert.equal(failedState.imports[0].carryingRate, 1000);
assert.equal(failedState.imports[0].lastRevaluationAt, undefined);
assert.equal(failedState.imports[0].revaluationHistory.length, 0);
assert.equal(failed.messages[0].type, 'error');
console.log('PASS: failed revaluation restores carrying rates and history');

const legacyState = {
  activeRole: 'mehran', fxRates: { USD: 1200 }, imports: [],
  fxCommitments: [{ id: 'LEGACY-FXC', amount: 10, paidAmount: 0, initialRate: 1000, carryingRate: 1000, currency: 'USD', ledgerPosted: false }]
};
const legacy = runRevaluation(legacyState);
assert.equal(legacy.fn(), false);
assert.equal(legacy.posted.length, 0);
assert.equal(legacyState.fxCommitments[0].carryingRate, 1000);
console.log('PASS: legacy memorandum-only commitments are excluded from ledger revaluation');

const paySource = extract('function payFxCommitmentStage(commitmentId)', 'function postFxRevaluation()');
const payState = {
  activeRole: 'ehsan',
  fxRates: { USD: 1300 },
  bankAccounts: [{ id: 'BANK-1', balance: 100000 }],
  fxCommitments: [{
    id: 'FXC-PAY', amount: 10, paidAmount: 0, initialRate: 1000, carryingRate: 1200,
    currency: 'USD', ledgerPosted: true, status: 'open', payments: []
  }]
};
const payVouchers = [];
const pay = load(paySource, 'payFxCommitmentStage', {
  state: payState, DEVICE_ID: 'DEVICE-PAY',
  document: fakeDocument({ 'fx-pay-amount-FXC-PAY': '5', 'fx-pay-bank-FXC-PAY': 'BANK-1' }),
  createStableId: () => 'PAY-1',
  postVoucher(...args) { payVouchers.push(args); },
  addAudit() {}, saveState() {}, renderFxModule() {}, showToast() {}
});
pay('FXC-PAY');
assert.equal(payVouchers.length, 1);
assert.equal(payVouchers[0][1].find(line => line.code === '2105').debit, 6000);
assert.equal(payVouchers[0][1].find(line => line.code === '1102').credit, 6500);
assert.equal(payVouchers[0][1].find(line => line.code === '6106').debit, 500);
assert.equal(payState.fxCommitments[0].payments[0].bookRate, 1200);
assert.equal(payState.bankAccounts[0].balance, 93500);
console.log('PASS: staged settlement uses the revalued carrying rate, not the original rate');

const saveSource = extract('function saveFxCommitment()', 'function payFxCommitmentStage(commitmentId)');
const saveState = { activeRole: 'mehran', fxCommitments: [] };
const openingVouchers = [];
const save = load(saveSource, 'saveFxCommitment', {
  state: saveState, DEVICE_ID: 'DEVICE-NEW-FX',
  document: fakeDocument({
    'fxc-party': 'SUP-9', 'fxc-counterparty': 'تأمین‌کننده آزمایشی', 'fxc-currency': 'USD',
    'fxc-amount': '20', 'fxc-rate': '1000', 'fxc-offset-account': '1105',
    'fxc-reference': 'CON-1', 'fxc-due-date': '1405/09/30',
    'fxc-purpose': 'خرید مواد اولیه', 'fxc-notes': 'تست افتتاحیه'
  }),
  getPartyName: () => 'تأمین‌کننده آزمایشی',
  getTodayJalaliDate: () => '1405/09/02',
  createStableId: () => 'FXC-NEW',
  postVoucher(...args) { openingVouchers.push(args); },
  addAudit() {}, saveState() {}, closeModal() {}, renderFxModule() {}, showToast() {}
});
save();
assert.equal(saveState.fxCommitments.length, 1);
assert.equal(saveState.fxCommitments[0].ledgerPosted, true);
assert.equal(openingVouchers.length, 1);
assert.equal(openingVouchers[0][1][0].code, '1105');
assert.equal(openingVouchers[0][1][0].debit, 20000);
assert.equal(openingVouchers[0][1][1].code, '2105');
assert.equal(openingVouchers[0][1][1].credit, 20000);
assert.equal(openingVouchers[0][1][1].partyId, 'SUP-9');
console.log('PASS: new independent FX commitments post a balanced opening liability voucher');
