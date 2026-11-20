const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}
const start = html.indexOf('function buildPartyControlReconciliation(');
const end = html.indexOf('function openPartyControlReconciliation(', start);
assert.ok(start >= 0 && end > start, 'party control reconciliation must exist');
const source = html.slice(start, end);

function run(state) {
  const sandbox = {
    state,
    normalizeLedgerDate(value) {
      return String(value || '').replace(/-/g, '/').replace(/[۰-۹٠-٩]/g, ch => {
        const fa='۰۱۲۳۴۵۶۷۸۹', ar='٠١٢٣٤٥٦٧٨٩';
        const fi=fa.indexOf(ch); return String(fi >= 0 ? fi : ar.indexOf(ch));
      }).replace(/\//g, '');
    },
    jalaliDateOrdinal(value) {
      const m=String(value || '').match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      if (!m) return null;
      const y=Number(m[1]), mo=Number(m[2]), d=Number(m[3]);
      return mo>=1 && mo<=12 && d>=1 && d<=(mo<=6?31:mo<=11?30:29) ? y*10000+mo*100+d : null;
    },
    countInvalidReportVoucherLines(voucher) {
      return (voucher.lines || []).filter(line => {
        const debit=Number(line.debit ?? 0), credit=Number(line.credit ?? 0);
        return !String(line.code || '').trim() || !Number.isFinite(debit) || !Number.isFinite(credit) ||
          debit<0 || credit<0 || (debit>0 && credit>0);
      }).length;
    },
    inspectTrialBalanceVoucher() { return { invalidStructure:false, unbalanced:false }; },
    getPartyLedgerControlCodes(party) {
      const supplier = String(party.role || '').includes('تأمین');
      const codes = new Set([String(party.ledgerAccountCode || (supplier?'2101':'1103'))]);
      if (supplier) codes.add('1107');
      return codes;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source + '; this.audit = buildPartyControlReconciliation;', sandbox);
  return sandbox.audit('1405/01/01','1405/12/29');
}

{
  const state = {
    parties: [],
    vouchers: [
      {id:1,date:'1405/01/01',lines:[{code:'1103',debit:100,credit:0}]},
      {id:2,date:'1405/01/01',lines:[{code:'2101',debit:0,credit:100}]}
    ]
  };
  const before=JSON.stringify(state);
  const result=run(state);
  assert.equal(result.totals.closingDifference,0,'signed differences can offset');
  assert.equal(result.totals.absoluteClosingDifference,200,'absolute differences must not offset');
  assert.equal(result.totals.mismatchedAccounts,2);
  assert.equal(result.unassignedLines,2);
  assert.equal(JSON.stringify(state),before,'reconciliation must not mutate vouchers');
}
{
  const state = {
    parties:[{id:'C1',role:'مشتری',ledgerAccountCode:'1103'},{id:'S1',role:'تأمین‌کننده',ledgerAccountCode:'2101'}],
    vouchers:[
      {id:1,date:'1405/01/01',lines:[{code:'1103',partyId:'C1',debit:100,credit:0}]},
      {id:2,date:'1405/01/01',lines:[{code:'2101',partyId:'S1',debit:0,credit:100}]}
    ]
  };
  const result=run(state);
  assert.equal(result.totals.absoluteClosingDifference,0);
  assert.equal(result.totals.mismatchedAccounts,0);
  assert.equal(result.unassignedLines,0);
}
{
  const state = {
    parties:[{id:'S1',role:'تأمین‌کننده',ledgerAccountCode:'2101'}],
    vouchers:[{id:1,date:'1405/01/01',lines:[
      {code:'1107',partyId:'S1',debit:50,credit:0},
      {code:'2101',partyId:'S1',debit:0,credit:50}
    ]}]
  };
  const result=run(state);
  assert.equal(result.totals.absoluteClosingDifference,0,'supplier advances must reconcile to supplier subledger');
}
{
  const state = { parties:[], vouchers:[{id:1,date:'1405/13/01',lines:[{code:'1103',debit:10,credit:0}]}] };
  const result=run(state);
  assert.equal(result.invalidDateVouchers,1);
  assert.equal(result.includedVouchers,0);
}

{
  const state = {
    parties:[{id:'C1',role:'مشتری',ledgerAccountCode:'1103'}],
    vouchers:[
      {id:'OPEN',date:'1404/12/29',lines:[{code:'1103',partyId:'C1',debit:120,credit:20}]},
      {id:'MOVE',date:'1405/02/01',lines:[{code:'1103',partyId:'C1',debit:80,credit:30}]}
    ]
  };
  const result=run(state);
  const row=result.rows.find(item=>item.code==='1103');
  assert.equal(row.glOpeningDebit,120);
  assert.equal(row.glOpeningCredit,20);
  assert.equal(row.subOpeningDebit,120);
  assert.equal(row.subOpeningCredit,20);
  assert.equal(row.glPeriodDebit,80);
  assert.equal(row.glPeriodCredit,30);
  assert.equal(row.subPeriodDebit,80);
  assert.equal(row.subPeriodCredit,30);
  assert.equal(row.glClosing,150);
  assert.equal(row.subClosing,150);
  assert.equal(row.openingDifference,0);
  assert.equal(row.periodDifference,0);
  assert.equal(row.closingDifference,0);
  assert.equal(JSON.stringify(state.vouchers),JSON.stringify([
    {id:'OPEN',date:'1404/12/29',lines:[{code:'1103',partyId:'C1',debit:120,credit:20}]},
    {id:'MOVE',date:'1405/02/01',lines:[{code:'1103',partyId:'C1',debit:80,credit:30}]}
  ]),'gross movement reconciliation must be read-only');
}

console.log('PASS: opening debit/credit, period turnover and closing balance reconcile gross and net');
console.log('PASS: offsetting differences across control accounts remain visible');
console.log('PASS: matching customer and supplier subledgers reconcile to the general ledger');
console.log('PASS: supplier advances remain within the supplier subledger scope');
console.log('PASS: invalid-dated vouchers are excluded and the audit is read-only');
