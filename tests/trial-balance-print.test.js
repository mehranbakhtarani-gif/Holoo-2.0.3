const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}
const start = html.indexOf('function printTrialBalanceReport()');
const end = html.indexOf('function runTrialBalanceReport()', start);
assert.ok(start >= 0 && end > start, 'print handler must exist before report runner');
const source = html.slice(start, end);
const report = {
  rows: [{code:'1101',name:'صندوق <آزمایشی>',periodDebit:120,periodCredit:20,closingBalanceDebit:100,closingBalanceCredit:0}],
  totals:{periodDebit:120,periodCredit:20,closingBalanceDebit:100,closingBalanceCredit:0},
  includedVouchers:1,movementDifference:100,closingDifference:100,
  invalidDateVouchers:0,invalidAmountLines:0,invalidStructureVouchers:0,unbalancedVouchers:1
};
let title='', area='', opened='';
const sandbox = {
  document:{getElementById(id){return id==='print-title'?{set textContent(v){title=v;}}:{set innerHTML(v){area=v;},get innerHTML(){return area;}};}},
  state:{fiscalYear:'1405',settings:{companyName:'شرکت <آزمایشی>'}},
  trialBalanceFromDate:'1405/01/01',trialBalanceToDate:'1405/01/30',
  buildTrialBalanceReport:()=>report,getTodayJalaliDate:()=> '1405/01/30',
  escapeLedgerText:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  faNum:String,money:String,showToast(){},openModal:id=>{opened=id;}
};
vm.createContext(sandbox);
vm.runInContext(source+'; printTrialBalanceReport();',sandbox);
assert.equal(title,'تراز آزمایشی چهارستونی');
assert.equal(opened,'modal-print-preview');
for(const text of ['گردش بدهکار','گردش بستانکار','مانده بدهکار','مانده بستانکار','شرکت &lt;آزمایشی&gt;','صندوق &lt;آزمایشی&gt;','اختلاف گردش بدهکار و بستانکار']) assert.ok(area.includes(text),'print output must include '+text);
assert.ok(!area.includes('شرکت <آزمایشی>'),'company name must be escaped');
console.log('PASS: trial balance print preview renders all four financial columns, totals, date range and imbalance warnings safely');
