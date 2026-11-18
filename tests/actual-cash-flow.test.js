const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');

const jalaliStart = html.indexOf('    function jalaliDateOrdinal(');
const jalaliEnd = html.indexOf('    function currentJalaliOrdinal()', jalaliStart);
const normalizeStart = html.indexOf('    function normalizeLedgerDate(');
const normalizeEnd = html.indexOf('    function buildAccountLedger(', normalizeStart);
const reportStart = html.indexOf('    function buildActualCashFlowReport(');
const reportEnd = html.indexOf('    function renderActualCashFlowReport()', reportStart);
assert.ok(jalaliStart >= 0 && jalaliEnd > jalaliStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
assert.ok(reportStart >= 0 && reportEnd > reportStart);

const v = (id,date,desc,lines) => ({id,date,desc,lines});
const sandbox = {
  state: {
    accountCatalog: [{code:'2201',name:'وام بلندمدت'}, {code:'7999',name:'حساب نامشخص'}],
    vouchers: [
      v(1,'1404/12/29','مانده اول دوره',[
        {code:'1101',debit:1000,credit:0},{code:'3101',debit:0,credit:1000}
      ]),
      v(2,'1405/01/02','دریافت فروش',[
        {code:'1102',debit:500,credit:0},{code:'4101',debit:0,credit:500}
      ]),
      v(3,'1405/01/03','پرداخت هزینه',[
        {code:'6101',debit:100,credit:0},{code:'1101',debit:0,credit:100}
      ]),
      v(4,'1405/01/04','خرید دارایی ثابت',[
        {code:'1201',debit:200,credit:0},{code:'1102',debit:0,credit:200}
      ]),
      v(5,'1405/01/05','دریافت تسهیلات',[
        {code:'1102',debit:300,credit:0},{code:'2201',debit:0,credit:300}
      ]),
      v(6,'1405/01/06','دریافت مرتبط با تسعیر',[
        {code:'1102',debit:50,credit:0},{code:'4104',debit:0,credit:50}
      ]),
      v(7,'1405/01/07','انتقال بین صندوق و بانک',[
        {code:'1101',debit:100,credit:0},{code:'1102',debit:0,credit:100}
      ]),
      v(8,'1405/02/01','بعد از دوره',[
        {code:'1102',debit:100,credit:0},{code:'4101',debit:0,credit:100}
      ]),
      v(9,'1405/01/08','طرف حساب طبقه‌بندی‌نشده',[
        {code:'1102',debit:10,credit:0},{code:'7999',debit:0,credit:10}
      ]),
      v(10,'1405/01/09','سند نامتوازن',[
        {code:'1102',debit:10,credit:0},{code:'4101',debit:0,credit:9}
      ]),
      v(11,'1405/13/01','تاریخ نامعتبر',[
        {code:'1102',debit:25,credit:0},{code:'4101',debit:0,credit:25}
      ]),
      v(12,'1405/01/10','مبلغ نامعتبر',[
        {code:'1102',debit:-5,credit:0},{code:'4101',debit:0,credit:-5}
      ])
    ]
  },
  CHART_ACCOUNTS: [
    {code:'1101',name:'صندوق'}, {code:'1102',name:'بانک'}, {code:'1201',name:'دارایی ثابت'},
    {code:'2201',name:'وام بلندمدت'}, {code:'3101',name:'سرمایه'}, {code:'4101',name:'فروش'},
    {code:'4104',name:'سود تسعیر ارز'}, {code:'6101',name:'هزینه'}
  ]
};
vm.createContext(sandbox);
vm.runInContext(html.slice(jalaliStart,jalaliEnd),sandbox);
vm.runInContext(html.slice(normalizeStart,normalizeEnd),sandbox);
vm.runInContext(html.slice(reportStart,reportEnd)+'; this.buildActualCashFlowReport=buildActualCashFlowReport;',sandbox);

const r=sandbox.buildActualCashFlowReport('۱۴۰۵/۰۱/۰۱','۱۴۰۵/۰۱/۳۰');
assert.equal(r.openingCash,1000);
assert.equal(r.periodCashChange,570);
assert.equal(r.closingCash,1570);
assert.equal(r.totals.operating,410);
assert.equal(r.totals.investing,-200);
assert.equal(r.totals.financing,300);
assert.equal(r.totals.fx,50);
assert.equal(r.totals.unclassified,10);
assert.equal(r.classifiedNetChange,570);
assert.equal(r.reconciliationDifference,0);
assert.equal(r.invalidDateVouchers,1);
assert.equal(r.invalidAmountVouchers,1);
assert.equal(r.unbalancedVoucherCount,1);
assert.ok(!r.details.some(x=>x.voucherId===8),'post-period voucher excluded');
assert.ok(!r.details.some(x=>x.voucherId===7),'cash-to-cash transfer excluded');
assert.throws(()=>sandbox.buildActualCashFlowReport('1405/01/30','1405/01/01'),/بازه تاریخ/);
assert.throws(()=>sandbox.buildActualCashFlowReport('1405/13/01','1405/13/02'),/بازه تاریخ/);
console.log('PASS: opening/closing cash, Persian dates, operating/investing/financing/FX flows, unclassified cash, cash transfers, period boundaries, invalid dates/amounts, unbalanced voucher warning and reconciliation');
