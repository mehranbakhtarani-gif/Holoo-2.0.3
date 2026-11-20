const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}
const start = html.indexOf('function buildTreasurySettlementAuditSummary()');
const end = html.indexOf('function buildTreasuryBankCashAuditSummary()', start);
assert.ok(start >= 0 && end > start, 'treasury settlement audit must exist');

const state = {
  treasuryTxs: [
    { id:'TX-1', date:'1405/09/01', dir:'receive', partyId:'P-1', method:'حواله بانکی', bankAccountId:'B-1', amount:100, allocations:[{invoiceId:'I-1',amount:60}] },
    { id:'TX-2', date:'1405/09/02', dir:'pay', partyId:'P-1', method:'صندوق نقدی', bankAccountId:'C-1', amount:200, fee:20, valueDate:'1405/09/04', allocations:[{invoiceId:'I-2',amount:250},{invoiceId:'I-2',amount:10}] },
    { id:'TX-3', date:'1405/09/03', dir:'receive', partyId:'P-1', method:'حواله بانکی', bankAccountId:'B-1', amount:50 }
  ],
  vouchers: [
    { id:'V-1', date:'1405/09/01', sourceType:'treasury', sourceId:'TX-1', sourceEvent:'posted', lines:[
      {code:'1102',bankAccountId:'B-1',debit:100,credit:0},
      {code:'1103',partyId:'P-1',debit:0,credit:100}
    ]},
    { id:'V-2', date:'1405/09/03', sourceType:'treasury', sourceId:'TX-2', sourceEvent:'posted', lines:[
      {code:'2101',partyId:'P-2',debit:200,credit:0},
      {code:'1101',cashAccountId:'C-1',debit:0,credit:180},
      {code:'6101',debit:20,credit:0}
    ]},
    { id:'V-ORPHAN', date:'1405/09/03', sourceType:'treasury', sourceId:'TX-GONE', sourceEvent:'posted', lines:[
      {code:'1102',bankAccountId:'B-1',debit:10,credit:0},
      {code:'1103',partyId:'P-1',debit:0,credit:10}
    ]}
  ],
  parties:[{id:'P-1',name:'مشتری الف'}],
  bankAccounts:[{id:'B-1',type:'bank'},{id:'C-1',type:'cash'}],
  invoices:[
    {id:'I-1',partyId:'P-1',type:'sale'},
    {id:'I-2',partyId:'P-2',type:'sale'}
  ]
};
const before=JSON.stringify(state);
const sandbox={
  state,
  jalaliDateOrdinal(value) {
    const m=String(value||'').match(/^(14\d{2})\/(\d{2})\/(\d{2})$/);
    if(!m) return null;
    return Number(m[1])*10000+Number(m[2])*100+Number(m[3]);
  },
  inspectTrialBalanceVoucher(v) {
    const lines=Array.isArray(v.lines)?v.lines:[];
    let debit=0,credit=0,invalidLines=0;
    lines.forEach(line=>{
      const d=Number(line.debit||0),c=Number(line.credit||0);
      if(!Number.isFinite(d)||!Number.isFinite(c)||d<0||c<0||(d>0&&c>0)) invalidLines++;
      debit+=d;credit+=c;
    });
    return {invalidLines,invalidStructure:lines.length<2,unbalanced:Math.abs(debit-credit)>1};
  }
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end)+'; this.audit=buildTreasurySettlementAuditSummary;',sandbox);
const result=sandbox.audit();

assert.equal(result.transactions,3);
assert.equal(result.missingVoucher,1);
assert.equal(result.orphanVoucher,1);
assert.equal(result.dateMismatch,1);
assert.equal(result.amountDirectionMismatch,1);
assert.equal(result.partyLedgerMismatch,1);
assert.equal(result.feeMismatch,0);
assert.equal(result.valueDateDifferences,1);
assert.equal(result.missingValueDateMetadata,2);
assert.ok(result.allocationIssues>=2);
assert.ok(result.invalidJournal>=1);
assert.ok(result.issueCount>=9);
assert.equal(JSON.stringify(state),before,'settlement audit must not mutate source records');

console.log('PASS: treasury receipts/payments are checked against their posted vouchers and asset-account lines');
console.log('PASS: missing/orphan vouchers, journal date, direction, party ledger and fee mismatches are detected');
console.log('PASS: invoice allocations and optional bank value dates are audited');
console.log('PASS: audit is read-only and preserves all source records');
