const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}
const start = html.indexOf('function buildAccountHierarchyRollupReconciliation(');
const end = html.indexOf('function renderTrialBalanceReport(', start);
assert.ok(start >= 0 && end > start, 'hierarchy reconciliation helper must exist');
const helperSource = html.slice(start, end);

const catalog = [
  { id: 'G1', code: '1', name: 'دارایی‌ها', level: 'group', parentId: null, active: true },
  { id: 'GL11', code: '11', name: 'دارایی جاری', level: 'general', parentId: 'G1', active: true },
  { id: 'SUB1101', code: '1101', name: 'صندوق', level: 'subsidiary', parentId: 'GL11', active: true },
  { id: 'SUB1102', code: '1102', name: 'بانک', level: 'subsidiary', parentId: 'GL11', active: true }
];
const state = { accountCatalog: catalog, vouchers: [{ id: 'KEEP', lines: [{ code: '1101', debit: 10, credit: 0 }] }] };
const before = JSON.stringify(state);
let reportRows = [
  { code: '1', name: 'دارایی‌ها', periodDebit: 0, periodCredit: 0, closingBalanceDebit: 0, closingBalanceCredit: 0 },
  { code: '11', name: 'دارایی جاری', periodDebit: 0, periodCredit: 0, closingBalanceDebit: 0, closingBalanceCredit: 0 },
  { code: '1101', name: 'صندوق', periodDebit: 100, periodCredit: 0, closingBalanceDebit: 150, closingBalanceCredit: 0 },
  { code: '1102', name: 'بانک', periodDebit: 50, periodCredit: 20, closingBalanceDebit: 30, closingBalanceCredit: 0 }
];
const sandbox = {
  state,
  buildTrialBalanceReport: () => ({
    rows: reportRows,
    totals: { periodDebit: 150, periodCredit: 20, closingBalanceDebit: 180, closingBalanceCredit: 0 }
  })
};
vm.createContext(sandbox);
vm.runInContext(helperSource + '; this.reconcile = buildAccountHierarchyRollupReconciliation;', sandbox);

const matched = sandbox.reconcile('1405/01/01', '1405/01/31');
assert.equal(matched.groupCount, 1);
assert.equal(matched.generalCount, 1);
assert.equal(matched.subsidiaryCount, 2);
assert.equal(matched.groupResiduals, 0);
assert.equal(matched.generalResiduals, 0);
assert.equal(matched.issueCount, 0);
assert.equal(matched.periodDebit, 150);
assert.equal(matched.periodCredit, 20);
assert.equal(JSON.stringify(state), before, 'hierarchy reconciliation must not mutate accounting data');

reportRows = [...reportRows, {
  code: '1199', name: 'حساب ثبت‌نشده در درخت', periodDebit: 7, periodCredit: 0,
  closingBalanceDebit: 7, closingBalanceCredit: 0
}];
const mismatch = sandbox.reconcile('1405/01/01', '1405/01/31');
assert.equal(mismatch.generalResiduals, 1);
assert.equal(mismatch.groupResiduals, 0);
assert.ok(mismatch.unmappedPostingCodes.includes('1199'));
assert.ok(mismatch.details.some(item => item.level === 'general' && item.code === '11' &&
  item.periodDebitDifference === 7 && item.closingNetDifference === 7));
assert.equal(JSON.stringify(state), before, 'mismatch reporting must remain read-only');

const duplicateState = {
  accountCatalog: [
    ...catalog,
    { id: 'GL11', code: '12', name: 'شناسه مبهم', level: 'general', parentId: 'G1', active: true }
  ],
  vouchers: []
};
const duplicateSandbox = {
  state: duplicateState,
  buildTrialBalanceReport: () => ({ rows: [], totals: {} })
};
vm.createContext(duplicateSandbox);
vm.runInContext(helperSource + '; this.reconcile = buildAccountHierarchyRollupReconciliation;', duplicateSandbox);
assert.equal(duplicateSandbox.reconcile('1405/01/01', '1405/01/31').duplicateAccountIds, 1);

assert.match(html, /تطبیق سلسله‌مراتبی گروه، کل و معین/);
assert.ok(html.includes('buildAccountHierarchyRollupReconciliation(from, to)'), 'trial balance UI must run hierarchy reconciliation');
assert.ok(html.includes('گزارش فقط‌خواندنی است و هیچ سند یا مانده‌ای را تغییر نمی‌دهد'), 'UI must state that the audit is read-only');
console.log('PASS: group/general/subsidiary rollups reconcile when all child accounts are represented');
console.log('PASS: missing child postings are exposed as hierarchy residuals and unmapped codes');
console.log('PASS: duplicate catalog identifiers are reported as ambiguous');
console.log('PASS: hierarchy reconciliation does not mutate vouchers, balances, or catalog records');
console.log('PASS: the trial-balance screen exposes the read-only hierarchy audit');
