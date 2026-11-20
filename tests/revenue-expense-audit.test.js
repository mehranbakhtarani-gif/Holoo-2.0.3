const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
for(const [i,m] of [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].entries())if(m[1].trim())new vm.Script(m[1],{filename:'index.html:inline-'+i});
const start=html.indexOf('function buildRevenueExpenseAuditSummary()');
const end=html.indexOf('function buildTreasurySettlementAuditSummary()',start);
assert.ok(start>=0&&end>start,'revenue/expense audit function exists');
const state={
 invoices:[{id:'S-1',type:'sale',status:'active'},{id:'S-2',type:'sale',status:'active'}],
 vouchers:[
  {id:'V-S1',sourceType:'invoice',sourceId:'S-1',date:'1405/09/01',lines:[{code:'4101',debit:0,credit:1000},{code:'5101',debit:400,credit:0}]},
  {id:'V-E1',sourceType:'treasury',sourceId:'T-1',date:'1405/09/02',lines:[{code:'6101',desc:'هزینه بانکی',debit:30,credit:0}]},
  {id:'V-E2',sourceType:'manual',sourceId:'M-1',date:'1405/09/02',lines:[{code:'6101',desc:'هزینه بانکی',debit:30,credit:0}]},
  {id:'V-E3',date:'1405/09/03',lines:[{code:'6102',debit:100,credit:0}]},
  {id:'V-OTHER',date:'1405/09/03',lines:[{code:'4199',debit:0,credit:50}]}
 ]
};
const before=JSON.stringify(state);
const sandbox={state};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end)+';this.audit=buildRevenueExpenseAuditSummary;',sandbox);
const r=sandbox.audit();
assert.equal(r.invoiceRevenueVoucherMissing,1);
assert.equal(r.revenueCredit,1050);
assert.equal(r.expenseDebit,160);
assert.equal(r.cogsDebit,400);
assert.equal(r.unlinkedRevenueLines,1);
assert.equal(r.unlinkedExpenseLines,1);
assert.equal(r.expenseLinesMissingDescription,1);
assert.ok(r.duplicateExpenseEntries>=1);
assert.ok(r.issueCount>=5);
assert.equal(JSON.stringify(state),before,'audit must not mutate source records');
console.log('PASS: sales invoice source coverage and revenue/expense ledger totals');
console.log('PASS: unlinked income/expense, missing descriptions and potential duplicate expenses');
console.log('PASS: cost of goods is reported separately from operating expenses');
console.log('PASS: source accounting records remain unchanged');
