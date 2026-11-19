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
  sandbox.__testFn = vm.runInContext(`(function () {\n${source}\n; return ${name};\n})()`, sandbox);
  return sandbox.__testFn;
}
const results = [];
function test(name, fn) {
  fn();
  results.push(name);
}

// Dashboard and cashflow balances must ignore malformed postings without hiding imbalances.
test('dashboard balances exclude invalid-date and invalid-amount vouchers and report quality', () => {
  const source = section('function buildDashboardAccountBalances()', 'function getPartyNetBalance(');
  const build = loadFunction(source, 'buildDashboardAccountBalances', {
    CHART_ACCOUNTS: [{ code: '1101', name: 'Cash' }, { code: '4101', name: 'Sales' }],
    state: { vouchers: [
      { date: '1405/01/01', lines: [{ code: '1101', debit: 100, credit: 0 }, { code: '4101', debit: 0, credit: 100 }] },
      { date: 'invalid', lines: [{ code: '1101', debit: 900, credit: 0 }, { code: '4101', debit: 0, credit: 900 }] },
      { date: '1405/01/02', lines: [{ code: '1101', debit: 'bad', credit: 0 }, { code: '4101', debit: 0, credit: 50 }] },
      { date: '1405/01/03', lines: [{ code: '1101', debit: 30, credit: 0 }] },
      { date: '1405/01/04', lines: [{ code: '1101', debit: 40, credit: 0 }, { code: '4101', debit: 0, credit: 25 }] }
    ] },
    jalaliDateOrdinal(value) {
      return /^1405\/01\/0[1-4]$/.test(String(value)) ? Number(String(value).slice(-2)) : null;
    }
  });
  const result = build();
  assert.equal(result.balances['1101'].debTurn, 170);
  assert.equal(result.balances['4101'].credTurn, 125);
  assert.equal(result.quality.invalidDateVouchers, 1);
  assert.equal(result.quality.invalidAmountVouchers, 1);
  assert.equal(result.quality.invalidStructureVouchers, 1);
  assert.equal(result.quality.unbalancedVouchers, 2);
});

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
    state, postVoucher(...args) { posted.push(args); return 1; }, showToast() {}, addAudit() {}, saveState() {}, renderAll() {}
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

// 6. Kardex opening-document labels are recognized narrowly and normalized safely.
test('opening balance labels include first-period inventory but exclude ordinary receipts', () => {
  const helperSource = section('function isOpeningKardexDocument(value)', 'function inspectWarehouseProductTopology(products, warehouses)');
  const isOpening = loadFunction(helperSource, 'isOpeningKardexDocument', {});
  assert.equal(isOpening('موجودی اول دوره'), true);
  assert.equal(isOpening('موجودی اول‌دوره'), true);
  assert.equal(isOpening('موجودی اولیه'), true);
  assert.equal(isOpening('افتتاحیه'), true);
  assert.equal(isOpening('ورود محموله هند'), false);
  assert.equal(isOpening('رسید خرید اول دوره'), false);
});

// 7. Inventory reconciliation evaluates kardex in chronological date order without mutating stored rows.
test('kardex reconciliation sorts dated movements and preserves an earlier opening balance', () => {
  const source = section('function inspectWarehouseProductTopology(products, warehouses)', 'function ensureProductBatches(product)');
  const inspect = loadFunction(source, 'inspectInventoryReconciliation', {
    inspectProductBatchReconciliation() { return { valid: true, stock: 15, tracked: 15, difference: 0 }; },
    jalaliDateOrdinal(value) {
      const match = String(value || '').match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]) : null;
    },
    isOpeningKardexDocument(value) { return /موجودی اول دوره|موجودی اولیه|افتتاحیه/.test(String(value || '')); }
  });
  const kardex = [
    { date: '1405/02/01', doc: 'فاکتور فروش #2', inQty: 0, outQty: 5, bal: 15 },
    { date: '1405/01/01', doc: 'موجودی اول دوره', inQty: 20, outQty: 0, bal: 20 }
  ];
  const result = inspect([{ id: 'TX-103', name: 'Test yarn', stock: 15, batches: [], kardex }]);
  assert.equal(result.unverifiedCount, 0);
  assert.equal(result.issueCount, 0);
  assert.equal(kardex[0].doc, 'فاکتور فروش #2');
  assert.equal(kardex[1].doc, 'موجودی اول دوره');
});

test('kardex baseline remains unverified when the earliest dated movement is an ordinary receipt', () => {
  const source = section('function inspectWarehouseProductTopology(products, warehouses)', 'function ensureProductBatches(product)');
  const inspect = loadFunction(source, 'inspectInventoryReconciliation', {
    inspectProductBatchReconciliation() { return { valid: true, stock: 4200, tracked: 4200, difference: 0 }; },
    jalaliDateOrdinal(value) {
      const match = String(value || '').match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]) : null;
    },
    isOpeningKardexDocument(value) { return /موجودی اول دوره|موجودی اولیه|افتتاحیه/.test(String(value || '')); }
  });
  const result = inspect([{ id: 'TX-103', name: 'Test yarn', stock: 4200, batches: [], kardex: [
    { date: '1405/01/05', doc: 'ورود محموله هند', inQty: 4200, outQty: 0, bal: 4200 }
  ] }]);
  assert.equal(result.unverifiedCount, 1);
  assert.match(result.unverified[0].detail, /ورود محموله هند/);
});


test('party control reconciliation lists legacy rows with missing or unknown party IDs without mutating vouchers', () => {
  const source = section('function buildPartyControlReconciliation(fromDate, toDate)', 'function openPartyControlReconciliation()');
  const vouchers = [
    { id: 17, date: '1405/01/01', desc: 'سند قدیمی بدون تفصیلی', lines: [
      { code: '1103', debit: 250, credit: 0, desc: 'مانده مشتری' },
      { code: '4101', debit: 0, credit: 250, desc: 'فروش' }
    ] },
    { id: 18, date: '1405/01/02', desc: 'شناسه نامعتبر', lines: [
      { code: '2101', debit: 0, credit: 90, partyId: 'MISSING', desc: 'بدهی تأمین‌کننده' },
      { code: '4101', debit: 90, credit: 0, desc: 'تعدیل' }
    ] },
    { id: 19, date: '1405/01/03', desc: 'دارای تفصیلی', lines: [
      { code: '1103', debit: 40, credit: 0, partyId: 'P1' },
      { code: '4101', debit: 0, credit: 40 }
    ] }
  ];
  const before = JSON.stringify(vouchers);
  const build = loadFunction(source, 'buildPartyControlReconciliation', {
    state: { parties: [{ id: 'P1', name: 'مشتری' }], vouchers },
    normalizeLedgerDate(value) { return String(value || '').replace(/-/g, '/'); },
    jalaliDateOrdinal(value) { return /^1405\/01\/\d{2}$/.test(String(value || '')) ? Number(String(value).slice(-2)) : null; },
    countInvalidReportVoucherLines() { return 0; }
  });
  const result = build('1405/01/01', '1405/01/31');
  assert.equal(result.unassignedLines, 2);
  assert.equal(result.unassignedDetails.length, 2);
  assert.equal(result.unassignedDetails[0].voucherId, '17');
  assert.equal(result.unassignedDetails[0].lineIndex, 1);
  assert.equal(result.unassignedDetails[0].reason, 'شناسه طرف حساب ثبت نشده است');
  assert.equal(result.unassignedDetails[1].voucherId, '18');
  assert.equal(result.unassignedDetails[1].reason, 'شناسه طرف حساب در فهرست اشخاص وجود ندارد');
  assert.equal(result.totals.glClosing, 200);
  assert.equal(result.totals.subClosing, 40);
  assert.equal(JSON.stringify(vouchers), before);
});

console.log(`PASS: ${results.length} accounting smoke tests`);
for (const name of results) console.log(`- ${name}`);
