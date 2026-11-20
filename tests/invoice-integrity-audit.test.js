const assert = require('node:assert/strict');
const { auditInvoices } = require('../invoice-audit-domain.js');

const validSale = {
  id: 1001, voucherId: 1, type: 'sale', date: '1405/08/29', dueDate: '1405/09/01',
  partyId: 'C1', warehouseId: 'W1', payMethod: 'credit',
  subtotal: 200, netSubtotal: 180, discount: 20, vatRate: 10,
  vatAmount: 18, grandTotal: 198, commAmount: 0,
  items: [{ productId: 'P1', kg: 2, price: 100, disc: 20, total: 180, costOfGoodsSold: 80 }]
};
const validVoucher = {
  id: 1, sourceType: 'invoice', sourceId: '1001', date: '1405/08/29',
  lines: [
    { code: '1103', partyId: 'C1', debit: 198, credit: 0 },
    { code: '4101', partyId: 'C1', debit: 0, credit: 180 },
    { code: '2103', debit: 0, credit: 18 },
    { code: '5101', debit: 80, credit: 0 },
    { code: '1105', debit: 0, credit: 80 }
  ]
};
const baseState = {
  invoices: [validSale], vouchers: [validVoucher],
  parties: [{ id: 'C1', name: 'مشتری نمونه' }],
  warehouses: [{ id: 'W1', name: 'انبار اصلی' }],
  products: [{ id: 'P1', name: 'کالای نمونه', warehouseId: 'W1', kardex: [{ date: '1405/08/29', doc: 'فاکتور فروش #1001', outQty: 2, inQty: 0 }] }]
};
const ordinal = value => value === '1405/08/29' ? 1 : value === '1405/09/01' ? 2 : null;

{
  const result = auditInvoices(baseState, { dateOrdinal: ordinal });
  assert.deepEqual(result.summary, { invoicesChecked: 1, findings: 0, errors: 0, warnings: 0 });
}
{
  const broken = structuredClone(baseState);
  broken.invoices[0].grandTotal = 999;
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'invoice-grandTotal-mismatch'));
}
{
  const broken = structuredClone(baseState);
  broken.vouchers[0].lines[0].debit = 197;
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'journal-unbalanced'));
  assert.ok(result.findings.some(item => item.code === 'journal-account-mismatch-1103'));
}
{
  const broken = structuredClone(baseState);
  broken.vouchers = [];
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'journal-missing'));
}
{
  const broken = structuredClone(baseState);
  broken.products[0].kardex[0].outQty = 1;
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'inventory-movement-mismatch'));
}
{
  const broken = structuredClone(baseState);
  broken.products[0].kardex[0].inQty = 2;
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'inventory-movement-direction-mismatch'),
    'a sale must not be represented by an inbound stock movement');
}
{
  const broken = structuredClone(baseState);
  broken.products[0].kardex[0].date = '1405/08/30';
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'inventory-movement-date-mismatch'),
    'stock movement date must match the source invoice date');
}
{
  const broken = structuredClone(baseState);
  broken.products[0].warehouseId = 'W2';
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'inventory-warehouse-mismatch'),
    'invoice stock movement must resolve to the invoice warehouse');
}
{
  const broken = structuredClone(baseState);
  broken.products[0].kardex.push({ date: '1405/08/29', doc: 'فاکتور فروش #1001', outQty: 1, inQty: 0 });
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'inventory-movement-duplicate'),
    'extra kardex rows for one invoice line must be visible even when totals still reconcile');
}
{
  const broken = structuredClone(baseState);
  broken.parties = [];
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'party-missing'));
}
{
  const broken = structuredClone(baseState);
  broken.invoices.push(structuredClone(broken.invoices[0]));
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'invoice-id-duplicate'));
}
{
  const broken = structuredClone(baseState);
  broken.invoices[0].voucherId = 9999;
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'journal-backlink-mismatch'),
    'invoice voucherId must point to the same voucher linked by sourceType/sourceId');
}
{
  const legacy = structuredClone(baseState);
  delete legacy.invoices[0].voucherId;
  const result = auditInvoices(legacy, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'journal-backlink-missing'),
    'missing invoice-side voucher reference must be visible without mutating the record');
}

{
  const before = JSON.stringify(baseState);
  auditInvoices(baseState, { dateOrdinal: ordinal });
  assert.equal(JSON.stringify(baseState), before, 'audit must never mutate financial state');
}
console.log('PASS: valid invoice reconciles to journal, party and stock ledger');
console.log('PASS: invoice totals, journal balances/accounts, missing links, stock and duplicate IDs are detected');

{
  const broken = structuredClone(baseState);
  broken.invoices[0].vatRate = 0;
  broken.invoices[0].vatAmount = null;
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'invoice-vatAmount-mismatch'),
    'null must not be accepted as a real zero VAT amount');
}
{
  const broken = structuredClone(baseState);
  broken.invoices[0].items[0].price = null;
  broken.invoices[0].items[0].total = 0;
  broken.invoices[0].subtotal = 0;
  broken.invoices[0].netSubtotal = 0;
  broken.invoices[0].discount = 0;
  broken.invoices[0].vatRate = 0;
  broken.invoices[0].vatAmount = 0;
  broken.invoices[0].grandTotal = 0;
  const result = auditInvoices(broken, { dateOrdinal: ordinal });
  assert.ok(result.findings.some(item => item.code === 'invoice-line-invalid'),
    'null unit price must not be accepted as a genuine zero price');
}

console.log('PASS: invoice integrity audit is read-only');
