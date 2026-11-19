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
const balanced = (id, date, lines) => ({ id, date, lines });
const state = {
  fiscalYear: '1405', currency: 'IRR', checks: [], products: [], invoices: [], imports: [],
  vouchers: [
    balanced(1, '1404/12/29', [{code:'1101',debit:1000,credit:0},{code:'3101',debit:0,credit:1000}]),
    balanced(2, '1405/01/02', [{code:'1102',debit:500,credit:0},{code:'4101',debit:0,credit:500}]),
    balanced(3, '1405/01/03', [{code:'1105',debit:300,credit:0},{code:'2101',debit:0,credit:300}]),
    balanced(4, '1405/01/04', [{code:'5101',debit:200,credit:0},{code:'1105',debit:0,credit:200}]),
    balanced(5, '1405/01/05', [{code:'6101',debit:50,credit:0},{code:'1101',debit:0,credit:50}]),
    balanced(6, '1405/01/06', [{code:'4102',debit:100,credit:0},{code:'1102',debit:0,credit:100}]),
    balanced(7, '1405/01/07', [{code:'4103',debit:50,credit:0},{code:'1102',debit:0,credit:50}]),
    balanced(8, '1405/01/08', [{code:'1102',debit:50,credit:0},{code:'4104',debit:0,credit:50}]),
    balanced(9, '1405/01/09', [{code:'6104',debit:20,credit:0},{code:'1102',debit:0,credit:20}]),
    balanced(10,'1405/02/02', [{code:'1102',debit:500,credit:0},{code:'4101',debit:0,credit:500}]),
    balanced(11,'1405/02/03', [{code:'5101',debit:400,credit:0},{code:'1105',debit:0,credit:400}]),
    balanced(12,'1405/02/04', [{code:'6105',debit:70,credit:0},{code:'1101',debit:0,credit:70}]),
    balanced(13,'1405/02/05', [{code:'2106',debit:0,credit:80},{code:'1102',debit:80,credit:0}]),
    balanced(14,'1405/02/06', [{code:'2103',debit:0,credit:30},{code:'1102',debit:30,credit:0}]),
    balanced(15,'1405/02/07', [{code:'2104',debit:0,credit:40},{code:'1102',debit:40,credit:0}]),
    balanced(16,'1405/02/08', [{code:'1104',debit:60,credit:0},{code:'4101',debit:0,credit:60}]),
    balanced(17,'1405/02/09', [{code:'2102',debit:0,credit:25},{code:'1102',debit:25,credit:0}]),
    {id:18,date:'1405/02/10',lines:[{code:'4101',debit:0,credit:10}]},
    {id:19,date:'1405/02/11',lines:[{code:'6101',debit:-5,credit:0},{code:'1101',debit:0,credit:-5}]}
  ],
  accountCatalog: [{code:'6105',name:'هزینه اختصاصی'}]
};
const CHART_ACCOUNTS = [
  ...['1101','1102','1103','1104','1105','2101','2102','2103','2104','2105','2106','3101','4101','4102','4103','4104','5101','6101','6104']
    .map(code=>({code,name:code}))
];
const sandbox = {
  state, CHART_ACCOUNTS,
  jalaliDateOrdinal(value) {
    const n = String(value||'').replace(/[۰-۹٠-٩]/g,ch => '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)>=0 ? String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)) : String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
    const m = /^(14\d{2})\/(\d{1,2})\/(\d{1,2})$/.exec(n);
    if(!m) return null; const month=+m[2],day=+m[3]; return month>=1&&month<=12&&day>=1&&day<=31 ? +m[1]*10000+month*100+day : null;
  },
  getTodayJalaliDate:()=> '1405/02/29',
  money:n=>String(n), faNum:n=>String(n), getProductDaysSinceLastMovement:()=>null,
  document:{getElementById:()=>({innerHTML:''})}
};
vm.createContext(sandbox);
vm.runInContext(sliceBetween('    function normalizeLedgerDate(', '    function buildAccountLedger('),sandbox);
vm.runInContext(sliceBetween('    function buildDashboardAccountBalances()', '    // Backward-compatible single-ledger balance helper'),sandbox);
vm.runInContext(sliceBetween('    function countInvalidReportVoucherLines(', '    function buildAccountLedger('),sandbox);
vm.runInContext(sliceBetween('    let pnlFromDate = null;', '    function renderProfitLossReport()'),sandbox);
vm.runInContext(sliceBetween('    let dashChartInst = null;', '    async function runSystemDiagnostics()')+'; this.api={buildDashboardAccountBalances,dashboardAccountNetBalance,buildDashboardMonthlySeries,renderDashboard};',sandbox);
const api=sandbox.api;
const quality=api.buildDashboardAccountBalances();
assert.equal(api.dashboardAccountNetBalance(quality.balances,'1101'),880);
assert.equal(api.dashboardAccountNetBalance(quality.balances,'1102'),1055);
assert.equal(api.dashboardAccountNetBalance(quality.balances,'1105'),-300);
assert.equal(api.dashboardAccountNetBalance(quality.balances,'2106'),-80);
const monthly=api.buildDashboardMonthlySeries('1405/01/01','1405/02/29');
assert.deepEqual(Array.from(monthly,m=>[m.label,m.revenue,m.cogs,m.expenses,m.netProfit]),[
  ['1405/01',400,200,70,130],
  ['1405/02',570,400,70,100]
]);
const pnl= sandbox.buildProfitLossReport('1405/01/01','1405/02/29');
assert.equal(pnl.revenue,970);
assert.equal(pnl.cogs,600);
assert.equal(pnl.expenses,140);
assert.equal(pnl.netProfit,230);
assert.equal(monthly.reduce((s,m)=>s+m.netProfit,0),pnl.netProfit);
assert.equal(quality.quality.unbalancedVouchers,1);
assert.equal(quality.quality.invalidAmountVouchers,1);
assert.match(html,/buildProfitLossReport\(period\.from, period\.to\)/);
assert.match(html,/2101', '2102', '2103', '2104', '2105', '2106/);
assert.match(html,/type: 'line'/);
assert.doesNotMatch(html,/Math\.max\(0, netProfit\)/);
assert.match(html,/dash-period-from/);
assert.match(html,/invoice\.status !== 'cancelled'[\s\S]{0,160}getInvoiceReturnedAmount\(invoice\)/);
assert.match(html,/shipment\.status !== 'cancelled'/);
console.log('PASS: dashboard balances use net debit/credit for cash, inventory, receivables and all six current-liability accounts');
console.log('PASS: dashboard period sales and net profit use the canonical P&L engine, including FX and custom 61xx expenses');
console.log('PASS: monthly revenue, COGS, expenses and profit reconcile to the selected-period P&L');
console.log('PASS: negative profit is retained in the chart and unbalanced/invalid vouchers remain visible as quality alerts');
