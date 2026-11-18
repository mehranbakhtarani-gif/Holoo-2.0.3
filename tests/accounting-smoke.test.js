const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
for (const [i, source] of scripts.entries()) new vm.Script(source, { filename: `index.html:inline-script-${i}` });

function section(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing section: ${startMarker}`);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return html.slice(start, end).trim();
}
function loadFunction(source, name, context) {
  const sandbox = { ...context };
  vm.createContext(sandbox);
  vm.runInContext(source + `; this.__testFn = ${name};`, sandbox);
  return sandbox.__testFn;
}
const results = [];
function test(name, fn) {
  fn();
  results.push(name);
}

// 1. Double-entry posting, source idempotency and cross-document references.
test('balanced journals post; unbalanced journals are rejected', () => {
  const state = { fiscalYear: '1405', vouchers: [], checks: [{ id: 'C1' }], invoices: [{ id: 7 }] };
  let saves = 0;
  const post = loadFunction(section('function postVoucher(', '// =========================================================================\n    // 5. MODULE 1'), 'postVoucher', {
    state, getTodayJalaliDate() { return '1405/09/02'; }, addAudit() {}, saveState() { saves++; }
  });
  assert.equal(post('test', [{ code: '1103', debit: 100, credit: 0 }, { code: '4101', debit: 0, credit: 100 }]), 1);
  assert.throws(() => post('bad', [{ code: '1103', debit: 100, credit: 0 }, { code: '4101', debit: 0, credit: 99 }]));
  assert.equal(saves, 1);
});
test('same source event is idempotent; separate check events remain distinct', () => {
  const state = { fiscalYear: '1405', vouchers: [], checks: [{ id: 'C1' }], invoices: [] };
  const post = loadFunction(section('function postVoucher(', '// =========================================================================\n    // 5. MODULE 1'), 'postVoucher', { state, getTodayJalaliDate() { return '1405/09/02'; }, addAudit() {}, saveState() {} });
  const lines = [{ code: '1102', debit: 50, credit: 0 }, { code: '1104', debit: 0, credit: 50 }];
  const first = post('clear', lines, undefined, { type: 'check', id: 'C1', event: 'cleared' });
  const repeated = post('clear again', lines, undefined, { type: 'check', id: 'C1', event: 'cleared' });
  const bounced = post('bounce', lines, undefined, { type: 'check', id: 'C1', event: 'bounced' });
  assert.equal(first, repeated);
  assert.notEqual(first, bounced);
});
test('invoice journal stores its source voucher reference', () => {
  const invoice = { id: 7 };
  const state = { fiscalYear: '1405', vouchers: [], checks: [], invoices: [invoice] };
  const post = loadFunction(section('function postVoucher(', '// =========================================================================\n    // 5. MODULE 1'), 'postVoucher', { state, getTodayJalaliDate() { return '1405/09/02'; }, addAudit() {}, saveState() {} });
  post('invoice', [{ code: '1103', debit: 100, credit: 0 }, { code: '4101', debit: 0, credit: 100 }], undefined, { type: 'invoice', id: 7 });
  assert.equal(invoice.voucherId, 1);
});

// 2. Treasury allocation rejects overpayment and accepts an exact remaining balance.
function runTreasury(amount) {
  const values = { 'tr-dir': 'receive', 'tr-party': 'P1', 'tr-method': 'cash', 'tr-amount': String(amount), 'tr-alloc-inv': '1001', 'tr-desc': 'smoke test', 'tr-bank-acc': 'B1' };
  const document = { getElementById(id) { return { value: values[id] ?? '' }; } };
  const state = { fiscalYear: '1405', parties: [{ id: 'P1' }], invoices: [{ id: 1001, status: 'active', partyId: 'P1', grandTotal: 1000, paidAmount: 200 }], checks: [], bankAccounts: [{ id: 'B1', type: 'cash', name: 'Cash', balance: 500 }], treasuryTxs: [] };
  const posted = [];
  let saves = 0;
  const save = loadFunction(section('function saveTreasuryEntry()', 'function renderTreasuryModule()'), 'saveTreasuryEntry', {
    document, state, getTodayJalaliDate() { return '1405/09/02'; }, getInvoiceOutstanding(inv) { return Math.max(0, Number(inv.grandTotal || 0) - (inv.returnRefs || []).reduce((sum, ref) => sum + Number(ref.amount || 0), 0) - Number(inv.paidAmount || 0)); }, postVoucher(...args) { posted.push(args); return 1; }, saveState() { saves++; }, closeModal() {}, renderAll() {}, showToast() {}, faNum: String
  });
  save();
  return { state, posted, saves };
}
test('treasury rejects an allocation above the invoice balance without side effects', () => {
  const r = runTreasury(801);
  assert.equal(r.posted.length, 0);
  assert.equal(r.state.invoices[0].paidAmount, 200);
  assert.equal(r.state.treasuryTxs.length, 0);
  assert.equal(r.saves, 0);
});
test('treasury accepts exact remaining balance and links the journal', () => {
  const r = runTreasury(800);
  assert.equal(r.posted.length, 1);
  assert.equal(r.state.invoices[0].paidAmount, 1000);
  assert.equal(r.state.bankAccounts[0].balance, 1300);
  assert.equal(r.state.treasuryTxs.length, 1);
  assert.equal(r.posted[0][3].type, 'treasury');
});

// 3. Check settlement is single-post only.
test('a check can be cleared once; repeated clearing does not repost or change bank balance', () => {
  const state = { checks: [{ id: 'C1', sayad: '123456789', status: 'in_progress', dir: 'receive', amount: 500, partyId: 'P1' }], bankAccounts: [{ id: 'B1', type: 'bank', balance: 1000 }] };
  const posted = [];
  const update = loadFunction(section('function updateCheckStatus(id, st)', 'function computeCheckRas()'), 'updateCheckStatus', {
    state, postVoucher(...args) { posted.push(args); }, showToast() {}, addAudit() {}, saveState() {}, renderAll() {}
  });
  update('C1', 'cleared');
  update('C1', 'cleared');
  assert.equal(posted.length, 1);
  assert.equal(state.bankAccounts[0].balance, 1500);
  assert.equal(state.checks[0].status, 'cleared');
});

// 4. Hierarchical chart and persistent custom subsidiary account.
test('chart catalog contains group/general/subsidiary levels and custom accounts validate', () => {
  const chart = [{ code: '1101', name: 'Cash' }, { code: '1102', name: 'Bank' }, { code: '4101', name: 'Sales' }];
  const build = loadFunction(section('function buildAccountCatalog()', 'function defaultState()'), 'buildAccountCatalog', { CHART_ACCOUNTS: chart });
  const catalog = build();
  assert.ok(catalog.some(a => a.level === 'group'));
  assert.ok(catalog.some(a => a.level === 'general'));
  assert.ok(catalog.some(a => a.level === 'subsidiary'));
  const parent = catalog.find(a => a.code === '11' && a.level === 'general');
  const state = { accountCatalog: catalog };
  const values = { 'new-acc-parent': parent.id, 'new-acc-code': '1109', 'new-acc-name': 'Test account' };
  const document = { getElementById(id) { return { value: values[id] }; } };
  let saves = 0;
  const save = loadFunction(section('function saveCustomAccount()', 'function renderAccountingModule()'), 'saveCustomAccount', {
    document, state, CHART_ACCOUNTS: chart, saveState() { saves++; }, renderAccountingModule() {}, showToast() {}
  });
  save();
  assert.ok(state.accountCatalog.some(a => a.code === '1109' && a.parentId === parent.id));
  assert.ok(chart.some(a => a.code === '1109'));
  assert.equal(saves, 1);
});

console.log(`PASS: ${results.length} accounting smoke tests`);
for (const name of results) console.log(`- ${name}`);
