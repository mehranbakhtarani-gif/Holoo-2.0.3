const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, m] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (m[1].trim()) new vm.Script(m[1], { filename: `index.html:inline-${i}` });
}
function sourceOf(name) {
  let start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function: ${name}`);
  if (html.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const ends = [
    html.indexOf('\n    function ', start + 10),
    html.indexOf('\n    async function ', start + 10)
  ].filter(x => x > 0);
  return html.slice(start, ends.length ? Math.min(...ends) : html.length).trim();
}
function load(name, context) {
  const sandbox = { ...context };
  vm.createContext(sandbox);
  vm.runInContext(sourceOf(name) + `; this.__fn = ${name};`, sandbox);
  return sandbox.__fn;
}

const CHART_ACCOUNTS = [
  ['1101','صندوق'],['1102','بانک'],['1103','دریافتنی تجاری'],['1104','چک دریافتنی'],
  ['1105','موجودی کالا'],['2101','پرداختنی تجاری'],['2102','چک پرداختنی'],
  ['3101','سرمایه'],['4101','فروش'],['4102','تخفیف فروش'],['4103','برگشت فروش'],
  ['5101','بهای تمام‌شده'],['6101','هزینه عمومی']
].map(([code,name]) => ({code,name}));

const state = {
  fiscalYear:'1405', vouchers:[], checks:[], bankAccounts:[{id:'BANK-1',type:'bank',name:'بانک آزمایشی',balance:0}],
  parties:[
    {id:'C-001',name:'مشتری آزمایشی',ledgerAccountCode:'1103'},
    {id:'S-001',name:'تأمین‌کننده آزمایشی',ledgerAccountCode:'2101'}
  ],
  invoices:[
    {id:7001,type:'purchase',status:'active',partyId:'S-001',grandTotal:3000000,paidAmount:1200000,items:[{productId:'FAB-01',kg:100}]},
    {id:7002,type:'sale',status:'active',partyId:'C-001',grandTotal:5000000,paidAmount:3000000,items:[{productId:'FAB-01',kg:60}]}
  ],
  products:[{id:'FAB-01',name:'پارچه آزمایشی',stock:0}],
  treasuryTxs:[], auditLogs:[]
};
let saves=0;
const post=load('postVoucher',{
  state, getTodayJalaliDate(){return '1405/09/02';}, addAudit(message){state.auditLogs.push(message);}, saveState(){saves++;}
});
const balances=load('getAccountBalances',{state,CHART_ACCOUNTS});
const partyAccountBalance=load('getPartyAccountNetBalance',{state});
const partyBalance=load('getPartyNetBalance',{state,getPartyAccountNetBalance:partyAccountBalance});
const updateCheck=load('updateCheckStatus',{
  state, getTodayJalaliDate(){return '1405/09/02';}, postVoucher:post, addAudit(message){state.auditLogs.push(message);},
  saveState(){saves++;}, renderAll(){}, showToast(){}
});

function postEntry(desc, lines, source) {
  return post(desc, lines, '1405/12/29', source);
}
function assertMoney(actual, expected, label) {
  assert.equal(Math.round(actual), expected, label);
}

// Opening capital.
postEntry('سرمایه‌گذاری اولیه',[
  {code:'1101',desc:'صندوق',debit:10000000,credit:0},
  {code:'3101',desc:'سرمایه',debit:0,credit:10000000}
],{type:'opening',id:'OPEN-1405',event:'initial'});

// Purchase 100 kg of fabric on supplier credit.
const purchaseVoucher=postEntry('فاکتور خرید پارچه #7001',[
  {code:'1105',partyId:null,desc:'افزایش موجودی پارچه',debit:3000000,credit:0},
  {code:'2101',partyId:'S-001',desc:'بدهی تأمین‌کننده',debit:0,credit:3000000}
],{type:'invoice',id:7001,event:'posted'});
state.products[0].stock += 100;
state.invoices[0].voucherId=purchaseVoucher;

// Pay part of the supplier balance from cash.
postEntry('پرداخت نقدی به تأمین‌کننده',[
  {code:'2101',partyId:'S-001',desc:'کاهش بدهی تأمین‌کننده',debit:1200000,credit:0},
  {code:'1101',partyId:null,desc:'خروج وجه از صندوق',debit:0,credit:1200000}
],{type:'treasury',id:'PAY-001',event:'posted'});
state.treasuryTxs.push({id:'PAY-001',dir:'pay',partyId:'S-001',amount:1200000,method:'cash'});

// Sell 60 kg on customer credit; recognize the cost of goods sold.
const salesVoucher=postEntry('فاکتور فروش پارچه #7002',[
  {code:'1103',partyId:'C-001',desc:'مطالبات مشتری',debit:5000000,credit:0},
  {code:'4101',partyId:null,desc:'فروش پارچه',debit:0,credit:5000000}
],{type:'invoice',id:7002,event:'posted'});
state.products[0].stock -= 60;
state.invoices[1].voucherId=salesVoucher;
postEntry('ثبت بهای تمام‌شده فروش',[
  {code:'5101',desc:'بهای تمام‌شده 60 کیلو پارچه',debit:2000000,credit:0},
  {code:'1105',desc:'کاهش موجودی کالا',debit:0,credit:2000000}
],{type:'costing',id:7002,event:'cogs'});

// Receive 2m cash against the sales invoice.
postEntry('دریافت نقدی از مشتری',[
  {code:'1101',desc:'ورود وجه به صندوق',debit:2000000,credit:0},
  {code:'1103',partyId:'C-001',desc:'تسویه بخشی از مطالبات',debit:0,credit:2000000}
],{type:'treasury',id:'REC-001',event:'posted'});
state.treasuryTxs.push({id:'REC-001',dir:'receive',partyId:'C-001',amount:2000000,method:'cash'});

// Receive a 1m cheque, then clear it into the bank.
const check={id:'CHK-7001',sayad:'123456789012345678901234',dir:'receive',amount:1000000,partyId:'C-001',status:'in_progress',bankAccountId:'BANK-1'};
state.checks.push(check);
postEntry('ثبت چک دریافتی مشتری',[
  {code:'1104',partyId:'C-001',desc:'چک دریافتی',debit:1000000,credit:0},
  {code:'1103',partyId:'C-001',desc:'کاهش مطالبات مشتری',debit:0,credit:1000000}
],{type:'check',id:check.id,event:'issued'});
updateCheck('CHK-7001','cleared');
updateCheck('CHK-7001','cleared');

// Record operating expense.
postEntry('هزینه اداری دوره',[
  {code:'6101',desc:'هزینه عمومی',debit:300000,credit:0},
  {code:'1101',desc:'پرداخت از صندوق',debit:0,credit:300000}
],{type:'expense',id:'EXP-001',event:'posted'});

const bal=balances();
const debitBalances=Object.values(bal).reduce((sum,a)=>sum+a.debBal,0);
const creditBalances=Object.values(bal).reduce((sum,a)=>sum+a.credBal,0);
const assets=Object.values(bal).filter(a=>a.code.startsWith('1')).reduce((sum,a)=>sum+a.debBal-a.credBal,0);
const liabilities=Object.values(bal).filter(a=>a.code.startsWith('2')).reduce((sum,a)=>sum+a.credBal-a.debBal,0);
const equity=Object.values(bal).filter(a=>a.code.startsWith('3')).reduce((sum,a)=>sum+a.credBal-a.debBal,0);
const revenue=(bal['4101'].credBal||0)-(bal['4102'].debBal||0)-(bal['4103'].debBal||0);
const expenses=(bal['5101'].debBal||0)+(bal['6101'].debBal||0);
const netProfit=revenue-expenses;

assertMoney(debitBalances, creditBalances, 'trial balance must balance');
assertMoney(bal['1101'].debBal, 10500000, 'cash closing balance');
assertMoney(bal['1102'].debBal, 1000000, 'bank closing balance');
assertMoney(bal['1103'].debBal, 2000000, 'customer receivable closing balance');
assertMoney(bal['1104'].debBal, 0, 'cleared cheque receivable must be zero');
assertMoney(bal['1105'].debBal, 1000000, 'closing inventory');
assertMoney(bal['2101'].credBal, 1800000, 'supplier payable closing balance');
assertMoney(bal['4101'].credBal, 5000000, 'gross sales');
assertMoney(bal['5101'].debBal, 2000000, 'cost of goods sold');
assertMoney(bal['6101'].debBal, 300000, 'operating expenses');
assertMoney(netProfit, 2700000, 'net profit');
assertMoney(assets, 14500000, 'total assets');
assertMoney(liabilities+equity+netProfit, assets, 'balance sheet equation');
assertMoney(partyBalance('C-001'), 2000000, 'customer subledger');
assertMoney(partyBalance('S-001'), -1800000, 'supplier subledger');
assert.equal(state.invoices[0].voucherId,purchaseVoucher,'purchase invoice source link');
assert.equal(state.invoices[1].voucherId,salesVoucher,'sales invoice source link');
assert.equal(check.status,'cleared','cheque lifecycle status');
assert.equal(check.voucherRefs.issued, state.vouchers.find(v=>v.sourceId===check.id && v.sourceEvent==='issued').id,'cheque issue voucher reference');
assert.equal(state.vouchers.filter(v=>v.sourceId===check.id && v.sourceEvent==='cleared').length,1,'cheque clearance must post once');
assert.equal(state.bankAccounts[0].balance,1000000,'bank balance after cheque clearance');
assert.equal(state.treasuryTxs.length,2,'cash receipt and payment recorded');
assert.equal(state.products[0].stock,40,'synthetic closing inventory quantity');
assert.equal(state.vouchers.every(v=>Math.round(v.lines.reduce((x,l)=>x+Number(l.debit||0),0))===Math.round(v.lines.reduce((x,l)=>x+Number(l.credit||0),0))),true,'every voucher is balanced');

console.log('PASS: full synthetic fiscal-period integration');
console.log('Company: شرکت آزمایشی نساجی');
console.log('Transactions: opening capital, purchase, supplier payment, sale, COGS, cash receipt, cheque receipt/clearance, operating expense');
console.log(`Vouchers: ${state.vouchers.length}; trial balance: ${debitBalances} = ${creditBalances}`);
console.log(`P&L: revenue ${revenue}; expenses ${expenses}; net profit ${netProfit}`);
console.log(`Balance sheet: assets ${assets}; liabilities + equity + profit ${liabilities+equity+netProfit}`);
console.log('Customer subledger: 2000000; supplier subledger: -1800000');
