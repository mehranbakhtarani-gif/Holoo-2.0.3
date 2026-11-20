const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}
const start = html.indexOf('function buildTreasuryBankCashAuditSummary()');
const end = html.indexOf('function renderTreasuryModule()', start);
assert.ok(start >= 0 && end > start, 'integrated bank/cash/cheque audit must exist');

const state = {
  bankAccounts: [
    { id:'BANK-A', type:'bank', name:'بانک الف' },
    { id:'BANK-B', type:'bank', name:'بانک ب' },
    { id:'CASH-1', type:'cash', name:'صندوق اصلی' }
  ],
  bankReconcileItems: [
    { id:'R1', bankAccountId:'BANK-A', date:'1405/09/01', amount:100, ref:'REF-1', matched:true, linkedVoucherId:'V1' },
    { id:'R2', bankAccountId:'BANK-A', date:'1405/09/02', amount:-40, ref:'REF-2', matched:false },
    { id:'R3', bankAccountId:'BANK-A', date:'1405/09/02', amount:-40, ref:'REF-2', matched:false },
    { id:'R4', bankAccountId:'DELETED', date:'1405/09/02', amount:10, ref:'REF-4' },
    { id:'R5', date:'1405/09/02', amount:10, ref:'REF-5' },
    { id:'R6', bankAccountId:'BANK-B', date:'bad-date', amount:10, ref:'REF-6' }
  ],
  vouchers: [
    { id:'V1', date:'1405/09/01', lines:[{code:'1102',bankAccountId:'BANK-A',debit:100,credit:0},{code:'4101',debit:0,credit:100}] },
    { id:'V2', date:'1405/09/02', lines:[{code:'1102',bankAccountId:'BANK-A',debit:0,credit:50},{code:'4101',debit:50,credit:0}] }
  ],
  treasuryTxs: [],
  checks: [
    { id:'C1', dir:'receive', status:'in_progress', amount:300, dueDate:'1405/09/10', bankAccountId:'BANK-A' },
    { id:'C2', dir:'pay', status:'overdue', amount:200, dueDate:'1405/08/01' },
    { id:'C3', dir:'receive', status:'cleared', amount:50, dueDate:'1405/08/01', bankAccountId:'BANK-B' }
  ]
};
const before = JSON.stringify(state);
const sandbox = {
  state,
  bankTxDateKey(value) {
    const m=String(value||'').match(/^(14\\d{2})\\/(\\d{2})\\/(\\d{2})$/);
    return m ? m[1]+m[2]+m[3] : null;
  },
  isBankOpeningVoucher() { return false; },
  inspectTrialBalanceVoucher(v) {
    const lines=Array.isArray(v.lines)?v.lines:[];
    const debit=lines.reduce((s,l)=>s+Number(l.debit||0),0);
    const credit=lines.reduce((s,l)=>s+Number(l.credit||0),0);
    return {invalidLines:0,invalidStructure:lines.length<2,unbalanced:Math.abs(debit-credit)>0.001};
  },
  getBankAccountBookBalances() {
    return {accounts:[],invalidBankLines:0,invalidBankVoucherDates:0,invalidBankVoucherStructures:0,unbalancedBankVouchers:0};
  },
  getCashAccountBookBalances() {
    return {accounts:[],unassignedLines:[],unknownLines:[],invalidLines:0,invalidVoucherDates:0};
  },
  jalaliDateOrdinal(value) { return /^14\\d{2}\\/\\d{2}\\/\\d{2}$/.test(String(value||'')) ? 1 : null; },
  buildCheckAuditSummary() { return {issueCount:2}; }
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end) + '; this.audit = buildTreasuryBankCashAuditSummary;', sandbox);
const result = sandbox.audit();

assert.equal(result.bankComparisons.length,1);
assert.equal(result.bankComparisons[0].bankId,'BANK-A');
assert.equal(result.bankComparisons[0].statementCount,3);
assert.equal(result.bankComparisons[0].linkedCount,1);
assert.equal(result.bankComparisons[0].statementNet,20);
assert.equal(result.bankComparisons[0].bookNet,50);
assert.equal(result.bankComparisons[0].difference,-30);
assert.equal(result.duplicateStatementRefs,1);
assert.equal(result.unknownStatementRows,1);
assert.equal(result.unassignedStatementRows,1);
assert.equal(result.invalidStatementRows,1);
assert.equal(result.outstanding.receiveCount,1);
assert.equal(result.outstanding.payCount,1);
assert.equal(result.outstanding.receiveAmount,300);
assert.equal(result.outstanding.payAmount,200);
assert.equal(result.outstanding.overdueCount,1);
assert.equal(result.outstanding.missingBankAccount,1);
assert.equal(result.outstanding.invalidDueDate,1);
assert.equal(result.checkAudit.issueCount,2);
assert.ok(result.issueCount >= 10);
assert.equal(JSON.stringify(state),before,'treasury audit must not mutate source records');

console.log('PASS: bank statement movement is compared per bank against tagged general-ledger lines for imported date range');
console.log('PASS: duplicate, invalid, unassigned and unknown bank statement rows are surfaced');
console.log('PASS: outstanding receive/pay cheques, overdue items, missing bank IDs and invalid due dates are summarized');
console.log('PASS: cash/bank ledger integrity and cheque lifecycle audit findings are included');
console.log('PASS: integrated treasury audit preserves all source records');
