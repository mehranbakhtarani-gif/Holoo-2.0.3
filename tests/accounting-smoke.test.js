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
    state: { fiscalYear: '1405', vouchers: [
      { date: '1405/01/01', lines: [{ code: '1101', debit: 100, credit: 0 }, { code: '4101', debit: 0, credit: 100 }] },
      { date: 'invalid', lines: [{ code: '1101', debit: 900, credit: 0 }, { code: '4101', debit: 0, credit: 900 }] },
      { date: '1405/01/02', lines: [{ code: '1101', debit: 'bad', credit: 0 }, { code: '4101', debit: 0, credit: 50 }] },
      { date: '1405/01/03', lines: [{ code: '1101', debit: 30, credit: 0 }] },
      { date: '1405/01/04', lines: [{ code: '1101', debit: 40, credit: 0 }, { code: '4101', debit: 0, credit: 25 }] }
    ] },
    jalaliDateOrdinal(value) {
      const [year, month, day] = String(value || '').split('/');
      const digits = value => value.length > 0 && [...value].every(ch => ch >= '0' && ch <= '9');
      return year.length === 4 && month === '01' && day.length === 2 && digits(year) && digits(day)
        ? Number(year) * 10000 + Number(month) * 100 + Number(day)
        : null;
    }
  });
  const result = build();
  assert.equal(result.balances['1101'].debTurn, 100);
  assert.equal(result.balances['4101'].credTurn, 100);
  assert.equal(result.quality.invalidDateVouchers, 1);
  assert.equal(result.quality.invalidAmountVouchers, 1);
  assert.equal(result.quality.invalidStructureVouchers, 1);
  assert.equal(result.quality.unbalancedVouchers, 1);
});

// 1. Double-entry posting, source idempotency and cross-document references.
test('balanced journals post; unbalanced journals are rejected', () => {
  const state = { fiscalYear: '1405', vouchers: [], checks: [{ id: 'C1' }], invoices: [{ id: 7 }] };
  let saves = 0;
  const post = loadFunction(section('function postVoucher(', '// =========================================================================\n    // 5. MODULE 1'), 'postVoucher', {
    state, getTodayJalaliDate() { return '1405/09/02'; }, jalaliDateOrdinal(value) { return /^\d{4}\/\d{2}\/\d{2}$/.test(String(value || '')) ? 1 : null; }, getAccountingPeriodLockForDate() { return null; }, getFiscalYearCloseRecord() { return null; }, addAudit() {}, saveState() { saves++; }
  });
  assert.equal(post('test', [{ code: '1103', debit: 100, credit: 0 }, { code: '4101', debit: 0, credit: 100 }]), 1);
  assert.throws(() => post('bad', [{ code: '1103', debit: 100, credit: 0 }, { code: '4101', debit: 0, credit: 99 }]));
  assert.equal(saves, 1);
});
test('same source event is idempotent; separate check events remain distinct', () => {
  const state = { fiscalYear: '1405', vouchers: [], checks: [{ id: 'C1' }], invoices: [] };
  const post = loadFunction(section('function postVoucher(', '// =========================================================================\n    // 5. MODULE 1'), 'postVoucher', { state, getTodayJalaliDate() { return '1405/09/02'; }, jalaliDateOrdinal(value) { return /^\d{4}\/\d{2}\/\d{2}$/.test(String(value || '')) ? 1 : null; }, getAccountingPeriodLockForDate() { return null; }, getFiscalYearCloseRecord() { return null; }, addAudit() {}, saveState() {} });
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
  const post = loadFunction(section('function postVoucher(', '// =========================================================================\n    // 5. MODULE 1'), 'postVoucher', { state, getTodayJalaliDate() { return '1405/09/02'; }, jalaliDateOrdinal(value) { return /^\d{4}\/\d{2}\/\d{2}$/.test(String(value || '')) ? 1 : null; }, getAccountingPeriodLockForDate() { return null; }, getFiscalYearCloseRecord() { return null; }, addAudit() {}, saveState() {} });
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
    document, state, getTodayJalaliDate() { return '1405/09/02'; }, jalaliDateOrdinal(value) { return /^\d{4}\/\d{2}\/\d{2}$/.test(String(value || '')) ? 1 : null; }, getAccountingPeriodLockForDate() { return null; }, getFiscalYearCloseRecord() { return null; }, getInvoiceOutstanding(inv) { return Math.max(0, Number(inv.grandTotal || 0) - (inv.returnRefs || []).reduce((sum, ref) => sum + Number(ref.amount || 0), 0) - Number(inv.paidAmount || 0)); }, postVoucher(...args) { posted.push(args); return 1; }, saveState() { saves++; }, closeModal() {}, renderAll() {}, showToast() {}, faNum: String
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
    state, postVoucher(...args) { posted.push(args); return 1; }, showToast() {}, addAudit() {}, saveState() { return true; }, renderAll() {}
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
  const source = section('function inspectInventoryReconciliation(products, warehouses, appState', 'function ensureProductBatches(product)');
  const inspect = loadFunction(source, 'inspectInventoryReconciliation', {
    inspectProductBatchReconciliation() { return { valid: true, stock: 15, tracked: 15, difference: 0 }; },
    inspectWarehouseProductTopology() { return { issues: [], checkedBaseProducts: 0, companyTotalStock: 0, summaries: [] }; },
    inspectStocktakingAuditTrail() { return { issues: [], checkedOperations: 0, checkedItems: 0 }; },
    inspectWarehouseTransferBatchLinks() { return { issues: [], checkedTransferBatchGroups: 0 }; },
    inspectInventoryOperationAudit() { return { issues: [], checkedOperations: 0 }; },
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
  const source = section('function inspectInventoryReconciliation(products, warehouses, appState', 'function ensureProductBatches(product)');
  const inspect = loadFunction(source, 'inspectInventoryReconciliation', {
    inspectProductBatchReconciliation() { return { valid: true, stock: 4200, tracked: 4200, difference: 0 }; },
    inspectWarehouseProductTopology() { return { issues: [], checkedBaseProducts: 0, companyTotalStock: 0, summaries: [] }; },
    inspectStocktakingAuditTrail() { return { issues: [], checkedOperations: 0, checkedItems: 0 }; },
    inspectWarehouseTransferBatchLinks() { return { issues: [], checkedTransferBatchGroups: 0 }; },
    inspectInventoryOperationAudit() { return { issues: [], checkedOperations: 0 }; },
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
    state: { parties: [{ id: 'P1', name: 'مشتری', ledgerAccountCode: '1103' }], vouchers },
    getPartyLedgerControlCodes(party) { return new Set([party.ledgerAccountCode || '1103']); },
    normalizeLedgerDate(value) { return String(value || '').replace(/-/g, '/'); },
    jalaliDateOrdinal(value) { return /^1405\/01\/\d{2}$/.test(String(value || '')) ? Number(String(value).slice(-2)) : null; },
    countInvalidReportVoucherLines() { return 0; },
    inspectTrialBalanceVoucher() { return { invalidLines: 0, invalidStructure: false, unbalanced: false }; }
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



// Bank reconciliation must require amount AND date, and opening vouchers need explicit identity.
test('bank opening classification uses structured source metadata or a narrow legacy title', () => {
  const source = section('function isBankOpeningVoucher(voucher)', 'function getBankAccountBookBalances()');
  const isOpening = loadFunction(source, 'isBankOpeningVoucher', {});
  assert.equal(isOpening({ sourceType: 'bank_account_opening', desc: 'هر عنوانی' }), true);
  assert.equal(isOpening({ desc: 'موجودی افتتاحیه بانک ملت' }), true);
  assert.equal(isOpening({ desc: 'پرداخت بابت خرید از بانک' }), false);
  assert.equal(isOpening({ desc: 'سند عادی بانک و افتتاحیه قرارداد' }), false);
});

test('bank statement review prioritizes exact matches and exposes single-dimension near matches', () => {
  const source = section('function getBankReconciliationReviewCandidates(item)', 'function confirmBankReconcileTreasuryMatch(');
  const find = loadFunction(source, 'getBankReconciliationReviewCandidates', {
    state: {
      bankAccounts: [{ id: 'B1', type: 'bank' }],
      bankReconcileItems: [],
      accountCatalog: [],
      vouchers: [{ id: 10, date: '1405/01/01', desc: 'سند بانکی', lines: [
        { code: '1102', bankAccountId: 'B1', debit: 100, credit: 0 },
        { code: '4101', debit: 0, credit: 100 }
      ] }]
    },
    bankTxDateKey(value) { return /^1405\/01\/\d{2}$/.test(String(value || '')) ? String(value) : null; },
    isBankOpeningVoucher(voucher) { return voucher?.sourceType === 'bank_account_opening' || /^موجودی افتتاحیه بانک/.test(String(voucher?.desc || '')); },
    CHART_ACCOUNTS: [{ code: '1102', name: 'بانک' }, { code: '4101', name: 'فروش' }]
  });
  const amountOnly = find({ id: 'R1', bankAccountId: 'B1', amount: 101, date: '1405/01/01' });
  const dateOnly = find({ id: 'R1', bankAccountId: 'B1', amount: 100, date: '1405/01/02' });
  const exact = find({ id: 'R1', bankAccountId: 'B1', amount: 100, date: '1405/01/01' });
  assert.equal(amountOnly.length, 1);
  assert.equal(amountOnly[0].amountMatch, false);
  assert.equal(amountOnly[0].dateMatch, true);
  assert.equal(dateOnly.length, 1);
  assert.equal(dateOnly[0].amountMatch, true);
  assert.equal(dateOnly[0].dateMatch, false);
  assert.equal(exact.length, 1);
  assert.equal(exact[0].amountMatch, true);
  assert.equal(exact[0].dateMatch, true);
  assert.equal(find({ id: 'R1', bankAccountId: 'B1', amount: 101, date: '1405/01/02' }).length, 0);
});

test('inventory valuation reconciles to GL control account 1105 and withholds unverified totals', () => {
  const source = section('function buildInventoryControlAccountReconciliation()', 'function renderTrialBalanceReport()');
  const build = loadFunction(source, 'buildInventoryControlAccountReconciliation', {
    state: { costingMethod: 'FIFO', products: [
      { id: 'P1', name: 'کالای اول', warehouseId: 'W1', stock: 5, bookValue: 250 },
      { id: 'P2', name: 'کالای دوم', warehouseId: 'W2', stock: 3, bookValue: 150 }
    ], vouchers: [
      { id: 1, date: '1405/01/01', lines: [{ code: '1105', debit: 500, credit: 0 }, { code: '3101', debit: 0, credit: 500 }] },
      { id: 2, date: '1405/01/02', lines: [{ code: '6101', debit: 100, credit: 0 }, { code: '1105', debit: 0, credit: 100 }] }
    ] },
    getInventoryBookValue(product) { return product.bookValue; },
    jalaliDateOrdinal(value) { return String(value || '').startsWith('1405/01/') ? 1 : null; },
    inspectTrialBalanceVoucher(voucher) { return voucher.validation || { invalidLines: 0, invalidStructure: false, unbalanced: false }; }
  });
  const matched = build();
  assert.equal(matched.status, 'matched');
  assert.equal(matched.inventoryValue, 400);
  assert.equal(matched.controlBalance, 400);
  assert.equal(matched.difference, 0);
  assert.equal(matched.details[0].productId, 'P1');

  const mismatchBuild = loadFunction(source, 'buildInventoryControlAccountReconciliation', {
    state: { costingMethod: 'AVG', products: [{ id: 'P1', name: 'کالا', stock: 5, bookValue: 500 }], vouchers: [
      { id: 3, date: '1405/01/01', lines: [{ code: '1105', debit: 400, credit: 0 }, { code: '3101', debit: 0, credit: 400 }] }
    ] },
    getInventoryBookValue(product) { return product.bookValue; },
    jalaliDateOrdinal() { return 1; },
    inspectTrialBalanceVoucher() { return { invalidLines: 0, invalidStructure: false, unbalanced: false }; }
  });
  const mismatch = mismatchBuild();
  assert.equal(mismatch.status, 'mismatch');
  assert.equal(mismatch.difference, 100);

  const unverifiedBuild = loadFunction(source, 'buildInventoryControlAccountReconciliation', {
    state: { costingMethod: 'FIFO', products: [{ id: 'P2', name: 'سری ساخت نامعتبر', stock: 5, bookValue: null }], vouchers: [
      { id: 4, date: '1405/01/01', lines: [{ code: '1105', debit: 300, credit: 0 }, { code: '3101', debit: 0, credit: 300 }] }
    ] },
    getInventoryBookValue(product) { return product.bookValue; },
    jalaliDateOrdinal() { return 1; },
    inspectTrialBalanceVoucher() { return { invalidLines: 0, invalidStructure: false, unbalanced: false }; }
  });
  assert.equal(unverifiedBuild().status, 'unverified');
});
 
test('inventory control ledger drilldown groups 1105 movements by source and links invoice product lines', () => {
  const source = section('function buildInventoryValueDiscrepancySources()', 'function renderTrialBalanceReport()');
  const build = loadFunction(source, 'buildInventoryValueDiscrepancySources', {
    state: {
      products: [{ id: 'P1', name: 'کالای نمونه', warehouseId: 'W1', kardex: [{ operationId: 'STK-1', sourceType: 'stocktake', sourceId: 'P1', inQty: 1, outQty: 0, bal: 9, price: 50, inventoryCost: 50, valuationBasis: 'moving-average-cost', date: '1405/01/03' }] }],
      warehouses: [{ id: 'W1', name: 'انبار اصلی' }],
      invoices: [{ id: 42, type: 'purchase', items: [{ productId: 'P1', kg: 8, costOfGoodsSold: 0, lot: 'LOT-42' }], returnRefs: [{ id: 'RET-1', items: [{ productId: 'P1', qty: 2, inventoryCost: 180, batchAllocations: [{ batchId: 'B1', quantity: 2 }] }] }] }],
      vouchers: [
        { id: 100, sourceType: 'invoice', sourceId: '42', date: '1405/01/01', lines: [{ code: '1105', debit: 800, credit: 0, desc: 'خرید کالا' }] },
        { id: 101, sourceType: 'invoice_return', sourceId: 'RET-1', sourceEvent: '42', date: '1405/01/02', lines: [{ code: '1105', debit: 0, credit: 100, desc: 'برگشت خرید' }] },
        { id: 102, sourceType: 'stocktake', sourceId: 'STK-1', sourceEvent: 'P1', date: '1405/01/03', lines: [{ code: '1105', debit: 50, credit: 0, desc: 'اضافه انبار' }] },
        { id: 103, date: '1405/01/04', lines: [{ code: '1105', debit: 20, credit: 0, desc: 'سند دستی' }] }
      ]
    }
  });
  const rows = build();
  assert.equal(rows.length, 4);
  const invoice = rows.find(row => row.sourceType === 'invoice');
  assert.equal(invoice.invoiceId, '42');
  assert.equal(invoice.productLines[0].productId, 'P1');
  assert.equal(invoice.productLines[0].productName, 'کالای نمونه');
  assert.equal(invoice.net, 800);
  const returned = rows.find(row => row.sourceType === 'invoice_return');
  assert.equal(returned.invoiceId, '42');
  assert.equal(returned.returnItems[0].productId, 'P1');
  assert.equal(returned.returnItems[0].quantity, 2);
  assert.equal(returned.returnItems[0].inventoryCost, 180);
  assert.equal(returned.returnItems[0].batchAllocations[0].batchId, 'B1');
  assert.equal(returned.net, -100);
  const stocktake = rows.find(row => row.sourceType === 'stocktake');
  assert.equal(stocktake.net, 50);
  assert.equal(stocktake.stocktake.productId, 'P1');
  assert.equal(stocktake.stocktake.productName, 'کالای نمونه');
  assert.equal(stocktake.stocktake.warehouseId, 'W1');
  assert.equal(stocktake.stocktake.quantityDifference, 1);
  assert.equal(stocktake.stocktake.inventoryCost, 50);
  assert.equal(rows.find(row => row.sourceType === 'manual').net, 20);
});

test('warehouse transfer reconciliation detects quantity and value differences without changing total inventory', () => {
  const source = section('function buildWarehouseTransferValueReconciliation()', 'function renderTrialBalanceReport()');
  const build = loadFunction(source, 'buildWarehouseTransferValueReconciliation', {
    state: {
      costingMethod: 'AVG',
      warehouses: [{ id: 'W1', name: 'انبار مبدأ' }, { id: 'W2', name: 'انبار مقصد' }],
      products: [
        { id: 'P1', name: 'کالای نمونه', warehouseId: 'W1', kardex: [{ doc: 'حواله خروج انتقال TR-123-abcd به انبار مقصد', outQty: 5, inQty: 0, price: 100 }] },
        { id: 'P2', baseProductId: 'P1', name: 'کالای نمونه', warehouseId: 'W2', kardex: [{ doc: 'حواله ورود انتقال TR-123-abcd از انبار مبدأ', inQty: 4, outQty: 0, price: 110 }] }
      ]
    }
  });
  const rows = build();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceWarehouse, 'انبار مبدأ');
  assert.equal(rows[0].destinationWarehouse, 'انبار مقصد');
  assert.equal(rows[0].quantityDifference, -1);
  assert.equal(rows[0].sourceValue, 500);
  assert.equal(rows[0].destinationValue, 440);
  assert.equal(rows[0].valueDifference, -60);
  assert.equal(rows[0].status, 'review');
});

test('FIFO warehouse transfer reconciliation values transferred layers from destination batches', () => {
  const source = section('function buildWarehouseTransferValueReconciliation()', 'function renderTrialBalanceReport()');
  const build = loadFunction(source, 'buildWarehouseTransferValueReconciliation', {
    state: {
      costingMethod: 'FIFO',
      warehouses: [{ id: 'W1', name: 'مبدأ' }, { id: 'W2', name: 'مقصد' }],
      products: [
        { id: 'P1', name: 'کالا', warehouseId: 'W1', kardex: [{ doc: 'حواله خروج انتقال TR-456-efgh', outQty: 3, inQty: 0, price: 90 }] },
        { id: 'P2', baseProductId: 'P1', name: 'کالا', warehouseId: 'W2', batches: [{ id: 'B-TR', sourceType: 'warehouse_transfer', sourceRef: 'TR-456-efgh', sourceBatchId: 'B1', quantity: 3, remainingQty: 2, unitCost: 75 }], kardex: [{ doc: 'حواله ورود انتقال TR-456-efgh', inQty: 3, outQty: 0, price: 75 }] }
      ]
    }
  });
  const row = build()[0];
  assert.equal(row.sourceValue, 225);
  assert.equal(row.destinationValue, 225);
  assert.equal(row.valueDifference, 0);
  assert.equal(row.status, 'matched');
});

test('inventory valuation integrity reports negative stock, historical negative balances and missing or negative average costs', () => {
  const source = section('function buildInventoryValuationIntegrityAudit()', 'function renderTrialBalanceReport()');
  const build = loadFunction(source, 'buildInventoryValuationIntegrityAudit', {
    state: {
      costingMethod: 'AVG',
      products: [
        { id: 'NEG', name: 'موجودی منفی', stock: -2, buyPrice: 10, kardex: [{ date: '1405/01/01', bal: -2, doc: 'فروش' }] },
        { id: 'MISS', name: 'بهای نامشخص', stock: 5, kardex: [] },
        { id: 'BAD', name: 'بهای منفی', stock: 3, buyPrice: -4, kardex: [] },
        { id: 'ZERO', name: 'بهای صفر معتبر', stock: 2, buyPrice: 0, kardex: [] },
        { id: 'INVALID', name: 'موجودی نامعتبر', stock: 'bad', buyPrice: 10, kardex: [] }
      ]
    }
  });
  const result = build();
  assert.equal(result.productsChecked, 5);
  assert.equal(result.negativeCurrentStock, 1);
  assert.equal(result.negativeKardexBalances, 1);
  assert.equal(result.invalidStockValues, 1);
  assert.equal(result.missingUnitCosts, 1);
  assert.equal(result.invalidUnitCosts, 1);
  assert.equal(result.issueCount, 5);
  assert.ok(result.issues.some(issue => issue.productId === 'NEG' && issue.type === 'negative-stock'));
  assert.ok(!result.issues.some(issue => issue.productId === 'ZERO'));
});

test('FIFO valuation integrity checks active batch costs and remaining quantities', () => {
  const source = section('function buildInventoryValuationIntegrityAudit()', 'function renderTrialBalanceReport()');
  const build = loadFunction(source, 'buildInventoryValuationIntegrityAudit', {
    state: {
      costingMethod: 'FIFO',
      products: [
        { id: 'FIFO1', name: 'سری بدون بها', stock: 4, batches: [{ id: 'B1', remainingQty: 4, unitCost: null }] },
        { id: 'FIFO2', name: 'سری با مقدار منفی', stock: 1, batches: [{ id: 'B2', remainingQty: -1, unitCost: 10 }] },
        { id: 'FIFO3', name: 'سری با بهای صفر', stock: 2, batches: [{ id: 'B3', remainingQty: 2, unitCost: 0 }] }
      ]
    }
  });
  const result = build();
  assert.equal(result.missingUnitCosts, 1);
  assert.equal(result.invalidBatchCosts, 1);
  assert.equal(result.invalidBatchQuantities, 1);
  assert.ok(!result.issues.some(issue => issue.productId === 'FIFO3'));
});

test('invoice return audit reconciles sale returns across source invoice, ledger, kardex and party credit', () => {
  const source = section('function buildInvoiceReturnIntegrityAudit()', 'function renderTrialBalanceReport()');
  const audit = loadFunction(source, 'buildInvoiceReturnIntegrityAudit', {
    state: {
      costingMethod: 'AVG',
      invoices: [{
        id: 100, type: 'sale', items: [{ productId: 'P1', kg: 10, returnedKg: 2 }],
        returnRefs: [{
          id: 'RET-100', amount: 220, costOfGoodsSold: 80, partyCreditAmount: 20,
          items: [{ productId: 'P1', lineIndex: 0, qty: 2, baseAmount: 200, vatAmount: 20, amount: 220, inventoryCost: 80, batchAllocations: [] }]
        }]
      }],
      products: [{ id: 'P1', kardex: [{ doc: 'برگشت جزئی فاکتور #100', inQty: 2, outQty: 0 }] }],
      vouchers: [{
        id: 500, sourceType: 'invoice_return', sourceId: 'RET-100', sourceEvent: '100',
        lines: [
          { code: '4103', debit: 200, credit: 0 },
          { code: '2103', debit: 20, credit: 0 },
          { code: '1103', debit: 0, credit: 200 },
          { code: '2101', debit: 0, credit: 20 },
          { code: '1105', debit: 80, credit: 0 },
          { code: '5101', debit: 0, credit: 80 }
        ]
      }],
      treasuryTxs: [{ sourceReturnId: 'RET-100', sourceInvoiceId: 100, amount: 20, remainingAmount: 20 }]
    }
  });
  const result = audit();
  assert.equal(result.invoicesChecked, 1);
  assert.equal(result.returnsChecked, 1);
  assert.equal(result.issueCount, 0);
});

test('invoice return audit reconciles purchase return inventory credit and detects missing or excessive return records', () => {
  const source = section('function buildInvoiceReturnIntegrityAudit()', 'function renderTrialBalanceReport()');
  const audit = loadFunction(source, 'buildInvoiceReturnIntegrityAudit', {
    state: {
      costingMethod: 'AVG',
      invoices: [{
        id: 200, type: 'purchase', items: [{ productId: 'P2', kg: 5, returnedKg: 1 }],
        returnRefs: [{
          id: 'RET-200', amount: 100, costOfGoodsSold: 0, partyCreditAmount: 0,
          items: [{ productId: 'P2', lineIndex: 0, qty: 1, baseAmount: 100, vatAmount: 0, amount: 100, inventoryCost: 80, batchAllocations: [] }]
        }]
      }],
      products: [{ id: 'P2', kardex: [{ doc: 'برگشت جزئی فاکتور #200', inQty: 0, outQty: 1 }] }],
      vouchers: [{
        id: 501, sourceType: 'invoice_return', sourceId: 'RET-200', sourceEvent: '200',
        lines: [{ code: '2101', debit: 100, credit: 0 }, { code: '1105', debit: 0, credit: 80 }, { code: '4198', debit: 0, credit: 20 }]
      }],
      treasuryTxs: []
    }
  });
  const result = audit();
  assert.equal(result.issueCount, 0);
});

test('invoice return audit flags duplicate IDs, excessive quantities and missing linked voucher or kardex', () => {
  const source = section('function buildInvoiceReturnIntegrityAudit()', 'function renderTrialBalanceReport()');
  const audit = loadFunction(source, 'buildInvoiceReturnIntegrityAudit', {
    state: {
      costingMethod: 'AVG',
      invoices: [{
        id: 300, type: 'sale', items: [{ productId: 'P3', kg: 3, returnedKg: 5 }],
        returnRefs: [
          { id: 'RET-DUP', amount: 40, costOfGoodsSold: 10, partyCreditAmount: 0, items: [{ productId: 'P3', lineIndex: 0, qty: 4, baseAmount: 40, vatAmount: 0, amount: 40, inventoryCost: 10 }] },
          { id: 'RET-DUP', amount: 10, costOfGoodsSold: 2, partyCreditAmount: 0, items: [{ productId: 'P3', lineIndex: 0, qty: 1, baseAmount: 10, vatAmount: 0, amount: 10, inventoryCost: 2 }] }
        ]
      }],
      products: [{ id: 'P3', kardex: [] }],
      vouchers: [],
      treasuryTxs: []
    }
  });
  const result = audit();
  assert.ok(result.duplicateReturnIds >= 1);
  assert.ok(result.quantityMismatches >= 1);
  assert.equal(result.missingVouchers, 2);
  assert.ok(result.missingKardex >= 1);
  assert.ok(result.issueCount >= 5);
});

// 10. Read-only invoice integrity audit covers purchase/sales journals and source links.
function invoiceAuditContext(state) {
  return {
    state,
    jalaliDateOrdinal(value) {
      const match = String(value || '').match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      if (!match) return null;
      const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
      if (month < 1 || month > 12 || day < 1 || day > (month <= 6 ? 31 : month <= 11 ? 30 : 29)) return null;
      return year * 10000 + month * 100 + day;
    }
  };
}
function runInvoiceDocumentAudit(state) {
  const source = section('function buildInvoiceDocumentIntegrityAudit()', 'function buildInvoiceReturnIntegrityAudit()');
  return loadFunction(source, 'buildInvoiceDocumentIntegrityAudit', invoiceAuditContext(state))();
}
test('invoice document audit accepts a matched sale and purchase invoice with balanced source journals', () => {
  const state = {
    parties: [{id:'P1'}], warehouses: [{id:'W1'}], products: [{id:'PR1'}],
    invoices: [
      {id:1001,type:'sale',date:'1405/01/05',dueDate:'1405/02/05',partyId:'P1',warehouseId:'W1',payMethod:'credit',subtotal:200,discount:20,netSubtotal:180,vatRate:10,vatAmount:18,grandTotal:198,items:[{productId:'PR1',kg:2,price:100,disc:20,total:180,costOfGoodsSold:80}]},
      {id:1002,type:'purchase',date:'1405/01/06',dueDate:'1405/02/06',partyId:'P1',warehouseId:'W1',payMethod:'credit',subtotal:300,discount:0,netSubtotal:300,vatRate:10,vatAmount:30,grandTotal:330,items:[{productId:'PR1',kg:3,price:100,disc:0,total:300}]}
    ],
    vouchers: [
      {id:1,sourceType:'invoice',sourceId:'1001',date:'1405/01/05',lines:[{code:'1103',debit:198,credit:0},{code:'4101',debit:0,credit:180},{code:'2103',debit:0,credit:18},{code:'5101',debit:80,credit:0},{code:'1105',debit:0,credit:80}]},
      {id:2,sourceType:'invoice',sourceId:'1002',date:'1405/01/06',lines:[{code:'1105',debit:300,credit:0},{code:'1106',debit:30,credit:0},{code:'2101',debit:0,credit:330}]}
    ]
  };
  const before = JSON.stringify(state);
  const result = runInvoiceDocumentAudit(state);
  assert.equal(result.issueCount, 0);
  assert.equal(result.saleInvoices, 1);
  assert.equal(result.purchaseInvoices, 1);
  assert.equal(JSON.stringify(state), before, 'audit must not mutate accounting data');
});
test('invoice document audit detects missing and duplicate journals and orphan invoice vouchers', () => {
  const state = {
    parties: [], warehouses: [], products: [],
    invoices: [
      {id:1,type:'sale',date:'1405/01/01',payMethod:'credit',subtotal:0,discount:0,netSubtotal:0,vatRate:0,vatAmount:0,grandTotal:0,items:[]},
      {id:2,type:'purchase',date:'1405/01/02',payMethod:'credit',subtotal:0,discount:0,netSubtotal:0,vatRate:0,vatAmount:0,grandTotal:0,items:[]}
    ],
    vouchers: [
      {id:10,sourceType:'invoice',sourceId:'2',date:'1405/01/02',lines:[]},
      {id:11,sourceType:'invoice',sourceId:'2',date:'1405/01/02',lines:[]},
      {id:12,sourceType:'invoice',sourceId:'999',date:'1405/01/02',lines:[]}
    ]
  };
  const result = runInvoiceDocumentAudit(state);
  assert.equal(result.missingVouchers, 1);
  assert.equal(result.duplicateVouchers, 1);
  assert.equal(result.orphanVouchers, 1);
});
test('invoice document audit detects invalid dates, incomplete rows, totals and ledger discrepancies', () => {
  const state = {
    parties: [{id:'P1'}], warehouses: [{id:'W1'}], products: [],
    invoices: [{
      id:77,type:'sale',date:'1405/13/40',dueDate:'1405/01/01',partyId:'MISSING',warehouseId:'W1',
      payMethod:'credit',subtotal:100,discount:0,netSubtotal:100,vatRate:9,vatAmount:9,grandTotal:109,
      items:[{productId:'MISSING-PRODUCT',kg:0,price:-5,disc:0,total:100}]
    }],
    vouchers: [{id:7,sourceType:'invoice',sourceId:'77',date:'invalid',lines:[{code:'1103',debit:1,credit:0},{code:'4101',debit:0,credit:2}]}]
  };
  const result = runInvoiceDocumentAudit(state);
  assert.ok(result.invalidInvoiceDates >= 1);
  assert.ok(result.invalidVoucherDates >= 1);
  assert.ok(result.incompleteLines >= 1);
  assert.ok(result.invalidInvoiceTotals >= 1);
  assert.ok(result.ledgerAmountMismatches >= 1);
  assert.ok(result.invalidPartyLinks >= 1);
  assert.ok(result.invalidProductLinks >= 1);
});
// 11. Read-only treasury, cheque and settlement allocation audit.
function settlementAuditContext(state) {
  return {
    state,
    jalaliDateOrdinal(value) {
      const match=String(value||'').match(/^(\\d{4})\\/(\\d{2})\\/(\\d{2})$/);
      if(!match)return null;
      const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);
      return m>=1&&m<=12&&d>=1&&d<=(m<=6?31:m<=11?30:29)?y*10000+m*100+d:null;
    }
  };
}
function runSettlementAudit(state) {
  const source=section('function buildSettlementIntegrityAudit()', 'function buildInvoiceDocumentIntegrityAudit()');
  return loadFunction(source,'buildSettlementIntegrityAudit',settlementAuditContext(state))();
}
test('settlement audit accepts a bank receipt allocated to a valid sales invoice',()=>{
  const state={
    parties:[{id:'P1'}],bankAccounts:[{id:'B1',type:'bank'}],invoices:[{id:1,type:'sale',status:'active',partyId:'P1',payMethod:'credit',grandTotal:100,paidAmount:50,returnRefs:[]}],
    treasuryTxs:[{id:'TR1',date:'1405/01/05',dir:'receive',partyId:'P1',method:'حواله بانکی',bankAccountId:'B1',amount:50,allocations:[{invoiceId:1,amount:50}]}],
    checks:[],vouchers:[{id:10,sourceType:'treasury',sourceId:'TR1',sourceEvent:'posted',date:'1405/01/05',lines:[{code:'1102',bankAccountId:'B1',debit:50,credit:0},{code:'1103',partyId:'P1',debit:0,credit:50}]}]
  };
  const before=JSON.stringify(state);
  const result=runSettlementAudit(state);
  assert.equal(result.issueCount,0);
  assert.equal(result.transactionsChecked,1);
  assert.equal(JSON.stringify(state),before,'audit must not mutate accounting data');
});
test('settlement audit detects missing, duplicate and orphan treasury journals',()=>{
  const state={
    parties:[{id:'P1'}],bankAccounts:[{id:'B1',type:'bank'}],invoices:[],checks:[],
    treasuryTxs:[
      {id:'TR-MISSING',date:'1405/01/01',dir:'receive',partyId:'P1',method:'حواله بانکی',bankAccountId:'B1',amount:10,allocations:[]},
      {id:'TR-DUP',date:'1405/01/02',dir:'pay',partyId:'P1',method:'حواله بانکی',bankAccountId:'B1',amount:20,allocations:[]}
    ],
    vouchers:[
      {id:1,sourceType:'treasury',sourceId:'TR-DUP',sourceEvent:'posted',date:'1405/01/02',lines:[{code:'2101',partyId:'P1',debit:20,credit:0},{code:'1102',bankAccountId:'B1',debit:0,credit:20}]},
      {id:2,sourceType:'treasury',sourceId:'TR-DUP',sourceEvent:'posted',date:'1405/01/02',lines:[{code:'2101',partyId:'P1',debit:20,credit:0},{code:'1102',bankAccountId:'B1',debit:0,credit:20}]},
      {id:3,sourceType:'treasury',sourceId:'ORPHAN',sourceEvent:'posted',date:'1405/01/02',lines:[]}
    ]
  };
  const result=runSettlementAudit(state);
  assert.equal(result.missingTreasuryVouchers,1);
  assert.equal(result.duplicateTreasuryVouchers,1);
  assert.equal(result.orphanTreasuryVouchers,1);
});
test('settlement audit reconciles cheque allocations and party credit applications without double counting',()=>{
  const state={
    parties:[{id:'P1'}],bankAccounts:[{id:'B1',type:'bank'}],
    invoices:[{id:7,type:'sale',status:'active',partyId:'P1',payMethod:'credit',grandTotal:100,paidAmount:50,returnRefs:[]}],
    treasuryTxs:[
      {id:'TR-CHECK',date:'1405/01/03',dir:'receive',partyId:'P1',method:'چک صیادی',amount:40,allocations:[{invoiceId:7,amount:40}]},
      {id:'CR1',kind:'party_credit',partyId:'P1',creditDirection:'sale',amount:10,remainingAmount:0,applications:[{id:'AP1',invoiceId:7,amount:10}]}
    ],
    checks:[{id:'CHK1',sourceTxId:'TR-CHECK',dir:'receive',partyId:'P1',amount:40,status:'in_progress',issueDate:'1405/01/03',dueDate:'1405/02/03',bankAccountId:'B1',allocations:[{invoiceId:7,amount:40}]}],
    vouchers:[
      {id:11,sourceType:'check',sourceId:'CHK1',sourceEvent:'issued',date:'1405/01/03',lines:[{code:'1104',partyId:'P1',debit:40,credit:0},{code:'1103',partyId:'P1',debit:0,credit:40}]},
      {id:12,sourceType:'party_credit_apply',sourceId:'CR1',sourceEvent:'AP1',date:'1405/01/03',lines:[{code:'2101',partyId:'P1',debit:10,credit:0},{code:'1103',partyId:'P1',debit:0,credit:10}]}
    ]
  };
  const result=runSettlementAudit(state);
  assert.equal(result.issueCount,0);
  assert.equal(result.checksChecked,1);
});
test('settlement audit detects invoice over-allocation and paid amount mismatch',()=>{
  const state={
    parties:[{id:'P1'}],bankAccounts:[{id:'B1',type:'bank'}],
    invoices:[{id:9,type:'purchase',status:'active',partyId:'P1',payMethod:'credit',grandTotal:100,paidAmount:120,returnRefs:[]}],
    treasuryTxs:[{id:'TR9',date:'1405/01/01',dir:'pay',partyId:'P1',method:'حواله بانکی',bankAccountId:'B1',amount:120,allocations:[{invoiceId:9,amount:120}]}],
    checks:[],vouchers:[{id:19,sourceType:'treasury',sourceId:'TR9',sourceEvent:'posted',date:'1405/01/01',lines:[{code:'2101',partyId:'P1',debit:120,credit:0},{code:'1102',bankAccountId:'B1',debit:0,credit:120}]}]
  };
  const result=runSettlementAudit(state);
  assert.ok(result.overAllocatedInvoices>=1);
  assert.ok(result.paidAmountMismatches>=1);
});
console.log(`PASS: ${results.length} accounting smoke tests`);
for (const name of results) console.log(`- ${name}`);
