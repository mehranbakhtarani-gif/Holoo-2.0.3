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

function run(state, fromDate = '1405/01/01', toDate = '1405/12/29') {
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
      const lines = Array.isArray(voucher?.lines) ? voucher.lines : [];
      return lines.filter(line => {
        const rawDebit=line?.debit, rawCredit=line?.credit;
        const debitPresent=rawDebit !== null && rawDebit !== undefined && String(rawDebit).trim() !== '';
        const creditPresent=rawCredit !== null && rawCredit !== undefined && String(rawCredit).trim() !== '';
        const debit=Number(rawDebit), credit=Number(rawCredit);
        return !String(line?.code || '').trim() || !debitPresent || !creditPresent ||
          !Number.isFinite(debit) || !Number.isFinite(credit) ||
          debit<0 || credit<0 || (debit>0 && credit>0) || (debit===0 && credit===0);
      }).length;
    },
    inspectTrialBalanceVoucher(voucher) {
      const lines = Array.isArray(voucher?.lines) ? voucher.lines : [];
      let invalidLines=0, debitTotal=0, creditTotal=0;
      lines.forEach(line => {
        const rawDebit=line?.debit, rawCredit=line?.credit;
        const debitPresent=rawDebit !== null && rawDebit !== undefined && String(rawDebit).trim() !== '';
        const creditPresent=rawCredit !== null && rawCredit !== undefined && String(rawCredit).trim() !== '';
        const debit=Number(rawDebit), credit=Number(rawCredit);
        if (!String(line?.code || '').trim() || !debitPresent || !creditPresent ||
            !Number.isFinite(debit) || !Number.isFinite(credit) ||
            debit<0 || credit<0 || (debit>0 && credit>0) || (debit===0 && credit===0)) {
          invalidLines++; return;
        }
        debitTotal+=debit; creditTotal+=credit;
      });
      return {
        invalidStructure: lines.length < 2,
        unbalanced: invalidLines===0 && (!Number.isFinite(debitTotal) || !Number.isFinite(creditTotal) ||
          debitTotal<=0 || creditTotal<=0 || Math.round(debitTotal)!==Math.round(creditTotal))
      };
    },
    getPartyLedgerControlCodes(party) {
      const supplier = String(party.role || '').includes('تأمین');
      const codes = new Set([String(party.ledgerAccountCode || (supplier?'2101':'1103'))]);
      if (supplier) codes.add('1107');
      return codes;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source + '; this.audit = buildPartyControlReconciliation;', sandbox);
  return sandbox.audit(fromDate,toDate);
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
  const customerRow=result.rows.find(item=>item.code==='1103');
  const supplierRow=result.rows.find(item=>item.code==='2101');
  assert.ok(customerRow && supplierRow,'both control accounts must appear');
  assert.equal(customerRow.glPeriodDebit,100);
  assert.equal(customerRow.glPeriodCredit,0);
  assert.equal(customerRow.subPeriodDebit,100);
  assert.equal(customerRow.subPeriodCredit,0);
  assert.equal(supplierRow.glPeriodDebit,0);
  assert.equal(supplierRow.glPeriodCredit,100);
  assert.equal(supplierRow.subPeriodDebit,0);
  assert.equal(supplierRow.subPeriodCredit,100);
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
    parties:[
      {id:'C1',role:'مشتری',ledgerAccountCode:'1103'},
      {id:'S1',role:'تأمین‌کننده',ledgerAccountCode:'2101'}
    ],
    vouchers:[
      {id:'OPEN-C',date:'1404/12/29',lines:[
        {code:'1103',partyId:'C1',debit:300,credit:50},
        {code:'3101',debit:0,credit:250}
      ]},
      {id:'OPEN-S',date:'1404/12/29',lines:[
        {code:'2101',partyId:'S1',debit:0,credit:120},
        {code:'3101',debit:120,credit:0}
      ]},
      {id:'SALE-C',date:'1405/01/01',lines:[
        {code:'1103',partyId:'C1',debit:500,credit:0},
        {code:'4101',debit:0,credit:500}
      ]},
      {id:'RECEIPT-C',date:'1405/01/31',lines:[
        {code:'1103',partyId:'C1',debit:0,credit:200},
        {code:'1101',debit:200,credit:0}
      ]},
      {id:'PAYABLE-S',date:'1405/01/05',lines:[
        {code:'2101',partyId:'S1',debit:20,credit:0},
        {code:'1101',debit:0,credit:20}
      ]},
      {id:'BILL-S',date:'1405/01/20',lines:[
        {code:'2101',partyId:'S1',debit:0,credit:70},
        {code:'4101',debit:70,credit:0}
      ]},
      {id:'INCOMPLETE',date:'1405/01/10',lines:[
        {code:'1103',partyId:'C1',debit:10,credit:0}
      ]},
      {id:'FUTURE-INVALID',date:'1405/02/01',lines:[
        {code:'1103',partyId:'C1',debit:'',credit:0}
      ]}
    ]
  };
  const before=JSON.stringify(state);
  const result=run(state,'1405/01/01','1405/01/31');
  const customer=result.rows.find(item=>item.code==='1103');
  const supplier=result.rows.find(item=>item.code==='2101');
  assert.ok(customer && supplier,'customer and supplier control accounts must be reported');
  assert.equal(customer.glOpeningDebit,300);
  assert.equal(customer.glOpeningCredit,50);
  assert.equal(customer.subOpeningDebit,300);
  assert.equal(customer.subOpeningCredit,50);
  assert.equal(customer.glPeriodDebit,510,'period debit includes the visible incomplete voucher');
  assert.equal(customer.glPeriodCredit,200);
  assert.equal(customer.subPeriodDebit,510);
  assert.equal(customer.subPeriodCredit,200);
  assert.equal(customer.glClosing,560);
  assert.equal(customer.subClosing,560);
  assert.equal(supplier.glOpeningCredit,120);
  assert.equal(supplier.subOpeningCredit,120);
  assert.equal(supplier.glPeriodDebit,20);
  assert.equal(supplier.glPeriodCredit,70);
  assert.equal(supplier.subPeriodDebit,20);
  assert.equal(supplier.subPeriodCredit,70);
  assert.equal(supplier.glClosing,-170);
  assert.equal(supplier.subClosing,-170);
  assert.equal(result.invalidStructureVouchers,1,'incomplete vouchers must be explicitly counted');
  assert.equal(result.unbalancedVouchers,1,'unbalanced vouchers must be explicitly counted');
  assert.equal(result.invalidAmountVouchers,0,'future invalid vouchers are outside the selected period');
  assert.equal(result.includedVouchers,7);
  assert.equal(JSON.stringify(state),before,'opening/period reconciliation must remain strictly read-only');
}

console.log('PASS: gross debit and credit turnover reconciles between the control ledger and party subledger');
console.log('PASS: offsetting differences across control accounts remain visible');
console.log('PASS: matching customer and supplier subledgers reconcile to the general ledger');
console.log('PASS: supplier advances remain within the supplier subledger scope');
console.log('PASS: invalid-dated vouchers are excluded and the audit is read-only');
