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
    parties: [
      { id:'P1', name:'مشتری تکراری', role:'مشتری', ledgerAccountCode:'1103' },
      { id:'P1', name:'تأمین‌کننده تکراری', role:'تأمین‌کننده', ledgerAccountCode:'2101' }
    ],
    vouchers: [{
      id:'V-DUP', date:'1405/01/02',
      lines:[{ code:'1103', partyId:'P1', debit:100, credit:0 }]
    }]
  };
  const before=JSON.stringify(state);
  const result=run(state);
  assert.equal(result.duplicatePartyIds,1);
  assert.equal(result.unassignedLines,1,
    'voucher lines referencing a duplicated party ID must not be attributed to an arbitrary party');
  assert.match(result.unassignedDetails[0].reason,/تکراری/);
  assert.equal(result.totals.absoluteClosingDifference,100);
  assert.equal(JSON.stringify(state),before,'party reconciliation must remain read-only');
}

{
  const state = {
    parties:[{ id:'C1', name:'مشتری نمونه', role:'مشتری', ledgerAccountCode:'1103' }],
    vouchers:[{
      id:'V-MAP', date:'1405/01/03', desc:'سند با حساب نامنطبق',
      lines:[{ code:'2101', partyId:'C1', debit:75, credit:0 }]
    }]
  };
  const before=JSON.stringify(state);
  const result=run(state);
  assert.equal(result.mappingMismatchLines,1);
  assert.equal(result.mappingMismatchDetails.length,1);
  assert.equal(result.mappingMismatchDetails[0].voucherId,'V-MAP');
  assert.equal(result.mappingMismatchDetails[0].partyId,'C1');
  assert.equal(JSON.stringify(result.mappingMismatchDetails[0].expectedCodes),JSON.stringify(['1103']));
  assert.equal(JSON.stringify(state),before,'mapping diagnostics must not mutate accounting records');
}

console.log('PASS: duplicate party IDs are treated as ambiguous, not attributed arbitrarily');
console.log('PASS: control-account mapping mismatches include voucher and party details');
console.log('PASS: party control reconciliation remains read-only');

{
  const state = {
    parties:[{ id:'C1', name:'مشتری معتبر', role:'مشتری', ledgerAccountCode:'1103' }],
    vouchers:[{
      id:'V-IDENTITY-GAPS', date:'1405/01/04', desc:'ردیف‌های فاقد هویت معتبر',
      lines:[
        { code:'1103', debit:40, credit:0 },
        { code:'1103', partyId:'MISSING-PARTY', debit:60, credit:0 }
      ]
    }]
  };
  const before=JSON.stringify(state);
  const result=run(state);
  assert.equal(result.unassignedLines,2,
    'missing and unknown party identities must both remain unassigned instead of being silently aggregated');
  assert.equal(result.unassignedDetails.length,2,
    'each unassigned control-account line must retain an auditable diagnostic');
  assert.ok(result.unassignedDetails.every(item=>item.voucherId==='V-IDENTITY-GAPS'),
    'identity diagnostics must preserve the originating voucher reference');
  assert.equal(result.totals.absoluteClosingDifference,100,
    'unassigned subledger movement must remain visible as a control-account difference');
  assert.equal(JSON.stringify(state),before,
    'missing and unknown party identity diagnostics must not mutate accounting data');
}

console.log('PASS: missing and unknown party identities remain unassigned and auditable');
