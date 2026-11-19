const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: `index.html:inline-${i}` });
}
function sliceBetween(startText, endText) {
  const start = html.indexOf(startText), end = html.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing source range: ${startText}`);
  return html.slice(start, end);
}
const voucher = (id,date,desc,lines) => ({id,date,desc,lines});
const state = {
  fiscalYear:'1405',
  parties:[{id:'C1',name:'مشتری آزمایشی'},{id:'S1',name:'تأمین‌کننده آزمایشی'}],
  accountCatalog:[{code:'1201',name:'دارایی ثابت'}],
  bankAccounts:[{id:'BANK-A',type:'bank',name:'بانک الف'},{id:'BANK-B',type:'bank',name:'بانک ب'}],
  invoices:[
    {id:1,type:'sale',status:'active',partyId:'C1',grandTotal:500,paidAmount:200,dueDate:'1405/01/10',returnRefs:[{amount:50}]},
    {id:2,type:'purchase',status:'active',partyId:'S1',grandTotal:300,paidAmount:100}
  ],
  bankReconcileItems:[{id:'BANK-TX-1',date:'1405/01/02',amount:500,desc:'واریز مشتری',ref:'R-1',bankAccountId:'BANK-A',matched:false}],
  vouchers:[
    voucher(1,'1404/12/29','مانده افتتاحیه',[
      {code:'1101',debit:1000,credit:0},{code:'1102',debit:500,credit:0},{code:'3101',debit:0,credit:1500}
    ]),
    voucher(2,'1405/01/02','دریافت فروش',[
      {code:'1102',bankAccountId:'BANK-A',debit:500,credit:0},{code:'4101',debit:0,credit:500}
    ]),
    voucher(3,'1405/01/03','پرداخت هزینه',[
      {code:'6101',debit:100,credit:0},{code:'1101',debit:0,credit:100}
    ]),
    voucher(4,'1405/01/04','خرید دارایی ثابت',[
      {code:'1201',debit:200,credit:0},{code:'1102',debit:0,credit:200}
    ]),
    voucher(5,'1405/01/05','دریافت تسهیلات',[
      {code:'1101',debit:300,credit:0},{code:'2201',debit:0,credit:300}
    ]),
    voucher(6,'1405/01/06','سند دارای مبلغ نامعتبر',[
      {code:'1102',debit:999,credit:0},{code:'4101',debit:0,credit:999},{code:'6101',debit:-1,credit:0}
    ])
  ]
};
const CHART_ACCOUNTS = [
  {code:'1101',name:'صندوق'},{code:'1102',name:'بانک'},{code:'1201',name:'دارایی ثابت'},
  {code:'2201',name:'تسهیلات'},{code:'3101',name:'سرمایه'},{code:'4101',name:'فروش'},
  {code:'6101',name:'هزینه اداری'}
];
const sandbox = {
  state, CHART_ACCOUNTS,
  normalizeAccountingDate(value) { return String(value || '').trim().replace(/-/g, '/'); },
  getInvoiceReturnedAmount: inv => (inv.returnRefs || []).reduce((s,r)=>s+Number(r.amount||0),0),
  getPartyName: id => state.parties.find(p=>String(p.id)===String(id))?.name || '—',
  agingBucket: days => days <= 0 ? 'سررسید نشده' : days <= 30 ? '۱ تا ۳۰ روز' : days <= 60 ? '۳۱ تا ۶۰ روز' : days <= 90 ? '۶۱ تا ۹۰ روز' : 'بیش از ۹۰ روز',
  saveState(){}, renderAll(){}, showToast(){}
};
vm.createContext(sandbox);
vm.runInContext(sliceBetween('    function jalaliDateOrdinal(', '    function currentJalaliOrdinal()'), sandbox);
vm.runInContext(sliceBetween('    function buildAgingRows(', '    function renderAgingSummary('), sandbox);
vm.runInContext(sliceBetween('    function escapeBankReconciliationText(', '    function renderReconcileModule('), sandbox);
vm.runInContext(sliceBetween('    let actualCashFlowFromDate = null;', '    function saveCustomAccount()') +
  '; this.api={buildAccountLedger,buildBalanceSheetReport,buildProfitLossReport,buildActualCashFlowReport,buildAgingRows,getBankReconciliationCandidates,confirmBankReconcileMatch};', sandbox);
vm.runInContext("function normalizeAccountingDate(value) { return String(value || '').trim().replace(/-/g, '/'); }\n" + sliceBetween('    let trialBalanceFromDate = null;', '    function renderAccountingModule()') +
  '; this.api.buildTrialBalanceReport=buildTrialBalanceReport;', sandbox);
const api = sandbox.api;

const cashLedger = api.buildAccountLedger('1101','1405/01/01','1405/01/30');
const bankLedger = api.buildAccountLedger('1102','1405/01/01','1405/01/30');
assert.equal(cashLedger.openingNet,1000);
assert.equal(cashLedger.closingNet,1200);
assert.equal(bankLedger.openingNet,500);
assert.equal(bankLedger.periodDebit,500);
assert.equal(bankLedger.periodCredit,200);
assert.equal(bankLedger.closingNet,800);
assert.equal(cashLedger.invalidAmountLines,1);
assert.equal(bankLedger.invalidAmountLines,1);

const pnl = api.buildProfitLossReport('1405/01/01','1405/01/30');
assert.equal(pnl.revenue,500);
assert.equal(pnl.expenses,100);
assert.equal(pnl.netProfit,400);
assert.equal(pnl.invalidAmountLines,1);
assert.equal(pnl.trialBalanceDifference,0);

const trial = api.buildTrialBalanceReport('1405/01/01','1405/01/30');
assert.equal(trial.includedVouchers,5);
assert.equal(trial.invalidAmountLines,1);
assert.equal(trial.invalidStructureVouchers,0);
assert.equal(trial.unbalancedVouchers,0);
assert.equal(trial.totals.periodDebit,1100);
assert.equal(trial.totals.periodCredit,1100);
assert.equal(trial.totals.closingBalanceDebit,2300);
assert.equal(trial.totals.closingBalanceCredit,2300);
assert.equal(trial.movementDifference,0);
assert.equal(trial.closingDifference,0);
for (const [code, expected] of Object.entries({
  '1101':{debit:300,credit:100,closing:1200},
  '1102':{debit:500,credit:200,closing:800},
  '1201':{debit:200,credit:0,closing:200},
  '2201':{debit:0,credit:300,closing:-300},
  '3101':{debit:0,credit:0,closing:-1500},
  '4101':{debit:0,credit:500,closing:-500},
  '6101':{debit:100,credit:0,closing:100}
})) {
  const row = trial.rows.find(r => r.code === code);
  assert.ok(row, `trial balance must include account ${code}`);
  assert.equal(row.periodDebit, expected.debit, `period debit for ${code}`);
  assert.equal(row.periodCredit, expected.credit, `period credit for ${code}`);
  assert.equal(row.closingBalanceDebit - row.closingBalanceCredit, expected.closing,
    `closing net for ${code}`);
  const ledger = api.buildAccountLedger(code,'1405/01/01','1405/01/30');
  assert.equal(ledger.periodDebit, expected.debit, `ledger/trial period debit for ${code}`);
  assert.equal(ledger.periodCredit, expected.credit, `ledger/trial period credit for ${code}`);
  assert.equal(ledger.closingNet, expected.closing, `ledger/trial closing net for ${code}`);
}

const bs = api.buildBalanceSheetReport('1405/01/30');
assert.equal(bs.assets,2200);
assert.equal(bs.liabilities,300);
assert.equal(bs.equity,1500);
assert.equal(bs.currentYearProfit,400);
assert.equal(bs.difference,0);
assert.equal(bs.trialBalanceDifference,0);
assert.equal(bs.invalidAmountLines,1);

const cf = api.buildActualCashFlowReport('1405/01/01','1405/01/30');
assert.equal(cf.openingCash,1500);
assert.equal(cf.periodCashChange,500);
assert.equal(cf.closingCash,2000);
assert.equal(cf.totals.operating,400);
assert.equal(cf.totals.investing,-200);
assert.equal(cf.totals.financing,300);
assert.equal(cf.classifiedNetChange,500);
assert.equal(cf.reconciliationDifference,0);
assert.equal(cf.invalidAmountVouchers,1);

const receivables = api.buildAgingRows('sale', sandbox.jalaliDateOrdinal('1405/02/10'));
const payables = api.buildAgingRows('purchase', sandbox.jalaliDateOrdinal('1405/02/10'));
assert.equal(receivables[0].outstanding,250,'sale aging must net payments and returns');
assert.equal(receivables[0].bucket,'۳۱ تا ۶۰ روز');
assert.equal(payables[0].outstanding,200);
assert.equal(payables[0].bucket,'بدون سررسید');

state.vouchers.push(voucher(7,'1405/01/02','دریافت آزمایشی بانک ب',[
  {code:'1102',bankAccountId:'BANK-B',debit:500,credit:0},{code:'4101',debit:0,credit:500}
]));
const candidates = api.getBankReconciliationCandidates(state.bankReconcileItems[0]);
assert.deepEqual(Array.from(candidates, c=>c.id),[2]);
assert.deepEqual(Array.from(api.getBankReconciliationCandidates({id:'BANK-B-TX',date:'1405/01/02',amount:500,bankAccountId:'BANK-B'}), c=>c.id),[7],
  'transactions from bank B must not match bank A vouchers');
const legacyLine = state.vouchers.find(v=>v.id===2).lines.find(line=>line.code==='1102');
delete legacyLine.bankAccountId;
state.bankAccounts = [{id:'BANK-A',type:'bank',name:'بانک الف'}];
assert.deepEqual(Array.from(api.getBankReconciliationCandidates({id:'LEGACY-TX',date:'1405/01/02',amount:500,bankAccountId:'BANK-A'}), c=>c.id),[2],
  'untagged legacy vouchers are allowed only with a single bank account');
legacyLine.bankAccountId = 'BANK-A';
state.bankAccounts.push({id:'BANK-B',type:'bank',name:'بانک ب'});
api.confirmBankReconcileMatch('BANK-TX-1',2);
state.vouchers = state.vouchers.filter(v=>v.id!==7);
state.bankReconcileItems.push({id:'BANK-TX-2',date:'1405/01/02',amount:500,desc:'تراکنش تکراری',ref:'R-2',matched:false});
assert.equal(api.getBankReconciliationCandidates(state.bankReconcileItems[1]).length,0,
  'one voucher cannot be linked to two bank statement rows');

assert.equal(cashLedger.closingNet + bankLedger.closingNet,cf.closingCash,
  'cash and bank account ledgers must reconcile to cash flow closing cash');
assert.equal(bs.assets,bs.liabilities+bs.equity+pnl.netProfit,
  'balance sheet equity plus P&L result must reconcile');
assert.equal(trial.totals.periodDebit,trial.totals.periodCredit,
  'trial balance period turnover must balance');
assert.equal(trial.totals.closingBalanceDebit,trial.totals.closingBalanceCredit,
  'trial balance closing debit and credit balances must reconcile');
assert.equal(trial.rows.find(r=>r.code==='4101').closingBalanceCredit -
  trial.rows.find(r=>r.code==='6101').closingBalanceDebit,pnl.netProfit,
  'trial balance revenue less expenses must equal P&L net profit');
assert.equal(trial.rows.find(r=>r.code==='1101').closingBalanceDebit +
  trial.rows.find(r=>r.code==='1102').closingBalanceDebit,cf.closingCash,
  'trial balance cash and bank accounts must equal cash flow closing cash');

// A posted but unbalanced voucher and a one-sided voucher must remain visible
// in every report; the reports should expose the same 15-unit difference.
state.vouchers.push(
  voucher(7,'1405/01/07','سند نامتوازن اما ثبت‌شده',[
    {code:'1101',debit:40,credit:0},{code:'4101',debit:0,credit:30}
  ]),
  voucher(8,'1405/01/08','سند تک‌ردیفی ثبت‌شده',[
    {code:'1102',debit:5,credit:0}
  ])
);
const imbalanceTrial = api.buildTrialBalanceReport('1405/01/01','1405/01/30');
const imbalancePnl = api.buildProfitLossReport('1405/01/01','1405/01/30');
const imbalanceBs = api.buildBalanceSheetReport('1405/01/30');
const imbalanceCf = api.buildActualCashFlowReport('1405/01/01','1405/01/30');
assert.equal(imbalanceTrial.includedVouchers,7);
assert.equal(imbalanceTrial.unbalancedVouchers,2);
assert.equal(imbalanceTrial.invalidStructureVouchers,1);
assert.equal(imbalanceTrial.totals.periodDebit,1145);
assert.equal(imbalanceTrial.totals.periodCredit,1130);
assert.equal(imbalanceTrial.movementDifference,15);
assert.equal(imbalanceTrial.totals.closingBalanceDebit,2345);
assert.equal(imbalanceTrial.totals.closingBalanceCredit,2330);
assert.equal(imbalanceTrial.closingDifference,15);
assert.equal(imbalancePnl.netProfit,430);
assert.equal(imbalanceBs.assets,2245);
assert.equal(imbalanceBs.difference,15);
assert.equal(imbalanceBs.trialBalanceDifference,15);
assert.equal(imbalanceCf.closingCash,2045);
assert.equal(imbalanceCf.unbalancedVoucherCount,2);
assert.equal(imbalanceCf.voucherDebitCreditDifference,15);
assert.equal(api.buildAccountLedger('1101','1405/01/01','1405/01/30').closingNet,1240);
assert.equal(api.buildAccountLedger('1102','1405/01/01','1405/01/30').closingNet,805);


const closeState = {
  fiscalYear:'1404', activeRole:'mehran', checks:[], invoices:[],
  vouchers:[
    voucher(1,'1404/01/05','فروش سال مالی',[
      {code:'1103',debit:1000,credit:0},{code:'4101',debit:0,credit:1000}
    ]),
    voucher(2,'1404/02/05','هزینه سال مالی',[
      {code:'6101',debit:600,credit:0},{code:'1101',debit:0,credit:600}
    ])
  ]
};
const closeSandbox = {
  state:closeState, CHART_ACCOUNTS,
  normalizeAccountingDate(value) { return String(value || '').trim().replace(/-/g, '/'); },
  addAudit(){}, saveState(){return true;}, renderAccountingModule(){}, showToast(){},
  getTodayJalaliDate:()=>closeSandbox.testToday,
  testToday:'1404/12/29'
};
vm.createContext(closeSandbox);
vm.runInContext(sliceBetween('    function jalaliDateOrdinal(', '    function currentJalaliOrdinal()'), closeSandbox);
vm.runInContext(sliceBetween('    function normalizeLedgerDate(', '    function countInvalidReportVoucherLines('), closeSandbox);
vm.runInContext(sliceBetween('    function inspectTrialBalanceVoucher(', '    function buildTrialBalanceReport('), closeSandbox);
vm.runInContext(sliceBetween('    function getFiscalYearEndDate(', '    function renderFiscalYearCloseModule('), closeSandbox);
vm.runInContext(sliceBetween('    function postVoucher(', '    // ========================================================================='), closeSandbox);
closeSandbox.testToday = closeSandbox.getFiscalYearEndDate('1404');
const closePreview = closeSandbox.buildFiscalYearClosePreview('1404');
assert.equal(closePreview.blocked,false);
assert.equal(closePreview.profit,400);
assert.equal(closePreview.rows.find(row=>row.code==='4101').net,-1000);
assert.equal(closePreview.rows.find(row=>row.code==='6101').net,600);
closeSandbox.closeFiscalYear();
const closingVoucher = closeState.vouchers.find(v=>v.sourceType==='fiscal_year_close');
assert.ok(closingVoucher,'closing voucher must be posted');
assert.equal(closingVoucher.sourceId,'1404');
assert.equal(closingVoucher.locked,true,'closing voucher must be locked');
assert.equal(closingVoucher.lines.reduce((sum,line)=>sum+line.debit,0),1000);
assert.equal(closingVoucher.lines.reduce((sum,line)=>sum+line.credit,0),1000);
assert.equal(closingVoucher.lines.find(line=>line.code==='3102').credit,400);
assert.equal(closeSandbox.buildFiscalYearClosePreview('1404').alreadyClosed,true);
assert.throws(()=>closeSandbox.postVoucher('ثبت با تاریخ سال بسته',[
  {code:'1101',debit:10,credit:0},{code:'4101',debit:0,credit:10}
],'1404/06/01'),/سال مالی 1404 بسته شده است/);
assert.doesNotThrow(()=>closeSandbox.postVoucher('ثبت در سال قبل',[
  {code:'1101',debit:10,credit:0},{code:'4101',debit:0,credit:10}
],'1403/06/01'),'closing one fiscal year must not block earlier historical years');

console.log('PASS: seven-report synthetic cross-validation — ledger, P&L, balance sheet, cash flow, aging and bank reconciliation');
console.log('PASS: invalid voucher is excluded consistently from ledger, trial balance, P&L, balance sheet and cash flow');
console.log('PASS: trial balance reconciles account-by-account with ledgers, P&L, balance sheet and cash flow');
console.log('PASS: unbalanced and one-sided postings remain visible and expose the same difference in every report');
console.log('PASS: bank transaction matching is exact and one voucher cannot be matched twice');
