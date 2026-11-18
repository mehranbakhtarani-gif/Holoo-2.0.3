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
  invoices:[
    {id:1,type:'sale',status:'active',partyId:'C1',grandTotal:500,paidAmount:200,dueDate:'1405/01/10',returnRefs:[{amount:50}]},
    {id:2,type:'purchase',status:'active',partyId:'S1',grandTotal:300,paidAmount:100}
  ],
  bankReconcileItems:[{id:'BANK-TX-1',date:'1405/01/02',amount:500,desc:'واریز مشتری',ref:'R-1',matched:false}],
  vouchers:[
    voucher(1,'1404/12/29','مانده افتتاحیه',[
      {code:'1101',debit:1000,credit:0},{code:'1102',debit:500,credit:0},{code:'3101',debit:0,credit:1500}
    ]),
    voucher(2,'1405/01/02','دریافت فروش',[
      {code:'1102',debit:500,credit:0},{code:'4101',debit:0,credit:500}
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
  getInvoiceReturnedAmount: inv => (inv.returnRefs || []).reduce((s,r)=>s+Number(r.amount||0),0),
  getPartyName: id => state.parties.find(p=>String(p.id)===String(id))?.name || '—',
  agingBucket: days => days <= 0 ? 'سررسید نشده' : days <= 30 ? '۱ تا ۳۰ روز' : days <= 60 ? '۳۱ تا ۶۰ روز' : days <= 90 ? '۶۱ تا ۹۰ روز' : 'بیش از ۹۰ روز',
  saveState(){}, renderAll(){}, showToast(){}
};
vm.createContext(sandbox);
vm.runInContext(sliceBetween('    function jalaliDateOrdinal(', '    function currentJalaliOrdinal()'), sandbox);
vm.runInContext(sliceBetween('    function buildAgingRows(', '    function renderAgingSummary('), sandbox);
vm.runInContext(sliceBetween('    function escapeBankReconcileText(', '    function renderReconcileModule('), sandbox);
vm.runInContext(sliceBetween('    let actualCashFlowFromDate = null;', '    function saveCustomAccount()') +
  '; this.api={buildAccountLedger,buildBalanceSheetReport,buildProfitLossReport,buildActualCashFlowReport,buildAgingRows,getBankReconciliationCandidates,confirmBankReconcileMatch};', sandbox);
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

const candidates = api.getBankReconciliationCandidates(state.bankReconcileItems[0]);
assert.deepEqual(Array.from(candidates, c=>c.id),[2]);
api.confirmBankReconcileMatch('BANK-TX-1',2);
state.bankReconcileItems.push({id:'BANK-TX-2',date:'1405/01/02',amount:500,desc:'تراکنش تکراری',ref:'R-2',matched:false});
assert.equal(api.getBankReconciliationCandidates(state.bankReconcileItems[1]).length,0,
  'one voucher cannot be linked to two bank statement rows');

assert.equal(cashLedger.closingNet + bankLedger.closingNet,cf.closingCash,
  'cash and bank account ledgers must reconcile to cash flow closing cash');
assert.equal(bs.assets,bs.liabilities+bs.equity+pnl.netProfit,
  'balance sheet equity plus P&L result must reconcile');
console.log('PASS: six-report synthetic cross-validation — ledger, P&L, balance sheet, cash flow, aging and bank reconciliation');
console.log('PASS: invalid voucher is excluded consistently from ledger, P&L, balance sheet and cash flow');
console.log('PASS: bank transaction matching is exact and one voucher cannot be matched twice');
