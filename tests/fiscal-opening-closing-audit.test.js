const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}
const start = html.indexOf('function buildFiscalOpeningClosingAuditSummary()');
const end = html.indexOf('function buildSubsidiaryInvoiceAuditSummary()', start);
assert.ok(start >= 0 && end > start, 'fiscal opening/closing audit must exist');
const sandbox = {
  state: null,
  normalizeLedgerDate(value) {
    return String(value || '').replace(/-/g, '/').replace(/[۰-۹٠-٩]/g, ch => {
      const fa='۰۱۲۳۴۵۶۷۸۹', ar='٠١٢٣٤٥٦٧٨٩';
      const fi=fa.indexOf(ch); return String(fi >= 0 ? fi : ar.indexOf(ch));
    }).replace(/\//g, '');
  },
  normalizeAccountingDate(value) { return String(value || '').replace(/[۰-۹]/g, ch => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch))); },
  jalaliDateOrdinal(value) {
    const m=String(value || '').match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (!m) return null;
    const y=Number(m[1]), mo=Number(m[2]), d=Number(m[3]);
    return mo>=1 && mo<=12 && d>=1 && d<=(mo<=6?31:mo<=11?30:29) ? y*10000+mo*100+d : null;
  },
  getFiscalYearEndDate(year) { return year + '/12/29'; },
  inspectTrialBalanceVoucher(v) {
    const lines=Array.isArray(v.lines)?v.lines:[];
    const invalidLines=lines.filter(l=>!String(l.code||'').trim()||!Number.isFinite(Number(l.debit||0))||!Number.isFinite(Number(l.credit||0))||Number(l.debit||0)<0||Number(l.credit||0)<0||(Number(l.debit||0)>0&&Number(l.credit||0)>0)).length;
    const debit=lines.reduce((s,l)=>s+Number(l.debit||0),0), credit=lines.reduce((s,l)=>s+Number(l.credit||0),0);
    return {invalidLines,invalidStructure:lines.length<2,unbalanced:Math.abs(debit-credit)>0.000001};
  }
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end) + '; this.audit = buildFiscalOpeningClosingAuditSummary;', sandbox);

{
  const state = {
    vouchers: [
      {id:'prior',date:'1404/12/29',lines:[{code:'1101',debit:1500,credit:0},{code:'3101',debit:0,credit:1000},{code:'4101',debit:0,credit:500}]},
      {id:'closing',date:'1404/12/29',sourceType:'fiscal_year_close',sourceEvent:'closing',sourceId:'1404',lines:[{code:'4101',debit:500,credit:0},{code:'3102',debit:0,credit:500}]},
      {id:'opening',date:'1405/01/01',sourceType:'opening',lines:[{code:'1101',debit:1500,credit:0},{code:'3101',debit:0,credit:1000},{code:'3102',debit:0,credit:500}]}
    ],
    fiscalYearClosures:[{year:'1404',status:'closed',voucherId:'closing'}]
  };
  sandbox.state=state;
  const before=JSON.stringify(state);
  const result=sandbox.audit();
  assert.equal(result.openingYearsCompared,1);
  assert.equal(result.openingBalanceMismatches,0);
  assert.equal(result.openingBalanceDetails.length,0);
  assert.equal(result.closingNonResultAccounts,0,'retained earnings account 3102 is valid in a closing voucher');
  assert.equal(JSON.stringify(state),before,'fiscal audit must not mutate vouchers or closure records');
}

{
  const state = {
    vouchers: [
      {id:'prior',date:'1404/12/29',lines:[{code:'1101',debit:1500,credit:0},{code:'3101',debit:0,credit:1000},{code:'4101',debit:0,credit:500}]},
      {id:'closing',date:'1404/12/29',sourceType:'fiscal_year_close',sourceEvent:'closing',sourceId:'1404',lines:[{code:'4101',debit:500,credit:0},{code:'3102',debit:0,credit:500}]},
      {id:'opening',date:'1405/01/01',sourceType:'opening',lines:[{code:'1101',debit:1400,credit:0},{code:'3101',debit:0,credit:900},{code:'3102',debit:0,credit:500}]}
    ],
    fiscalYearClosures:[{year:'1404',status:'closed',voucherId:'closing'}]
  };
  sandbox.state=state;
  const result=sandbox.audit();
  assert.equal(result.openingBalanceMismatches,2);
  assert.deepEqual(Array.from(result.openingBalanceDetails, x=>x.code).sort(),['1101','3101']);
  assert.ok(result.issues.some(x=>x.includes('مغایرت انتقال مانده')));
}

{
  const state = {
    vouchers: [
      {id:'prior',date:'1404/12/29',lines:[{code:'1101',debit:1000,credit:0},{code:'3101',debit:0,credit:1000}]},
      {id:'closing',date:'1404/12/29',sourceType:'fiscal_year_close',sourceEvent:'closing',sourceId:'1404',lines:[{code:'4101',debit:500,credit:0},{code:'3102',debit:0,credit:500}]}
    ],
    fiscalYearClosures:[{year:'1404',status:'closed',voucherId:'closing'}]
  };
  sandbox.state=state;
  const result=sandbox.audit();
  assert.equal(result.openingYearsCompared,0);
  assert.equal(result.openingBalanceMismatches,0);
  assert.equal(result.implicitCarryForwardYears,1,'implicit ledger carry-forward is informational, not a discrepancy');
}

console.log('PASS: next-year opening balances reconcile to prior-year permanent-account closing balances');
console.log('PASS: account-level transfer differences are identified without netting across accounts');
console.log('PASS: implicit cumulative ledger carry-forward is not falsely flagged');
console.log('PASS: fiscal opening/closing audit preserves all source records');
