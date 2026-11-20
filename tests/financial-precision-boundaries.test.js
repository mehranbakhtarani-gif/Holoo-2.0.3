const assert = require('node:assert/strict');
const { auditInvoices } = require('../invoice-audit-domain.js');
const { buildInventoryCostAudit } = require('../inventory-cost-audit-domain.js');

const baseInvoice = {
  id: 'PREC-1', voucherId: 'V1', type: 'sale', date: '1405/08/29',
  partyId: 'C1', warehouseId: 'W1', payMethod: 'credit',
  subtotal: 100, netSubtotal: 100, discount: 0, vatRate: 10,
  vatAmount: 10, grandTotal: 110, commAmount: 0,
  items: [{ productId: 'P1', kg: 1, price: 100, disc: 0, total: 100, costOfGoodsSold: 40 }]
};
const baseVoucher = {
  id: 'V1', sourceType: 'invoice', sourceId: 'PREC-1', date: '1405/08/29',
  lines: [
    { code: '1103', partyId: 'C1', debit: 110, credit: 0 },
    { code: '4101', credit: 100, debit: 0 },
    { code: '2103', credit: 10, debit: 0 },
    { code: '5101', debit: 40, credit: 0 },
    { code: '1105', credit: 40, debit: 0 }
  ]
};
const baseState = {
  invoices: [baseInvoice], vouchers: [baseVoucher],
  parties: [{ id: 'C1' }], warehouses: [{ id: 'W1' }],
  products: [{ id: 'P1', warehouseId: 'W1', kardex: [{ doc: 'فاکتور فروش #PREC-1', outQty: 1, inQty: 0, date: '1405/08/29' }] }]
};
const dateOrdinal = () => 1;

{
  const result = auditInvoices(baseState, { dateOrdinal });
  assert.equal(result.summary.errors, 0, 'ordinary invoice should remain valid');
}
{
  const state = structuredClone(baseState);
  state.invoices[0].items[0].price = Number.MAX_SAFE_INTEGER + 1;
  state.invoices[0].items[0].total = Number.MAX_SAFE_INTEGER + 1;
  state.invoices[0].subtotal = Number.MAX_SAFE_INTEGER + 1;
  state.invoices[0].netSubtotal = Number.MAX_SAFE_INTEGER + 1;
  state.invoices[0].vatAmount = 0;
  state.invoices[0].grandTotal = 0;
  const result = auditInvoices(state, { dateOrdinal });
  assert.ok(result.findings.some(x => x.code === 'invoice-line-invalid'));
  assert.ok(result.findings.some(x => x.code === 'invoice-subtotal-mismatch'));
}
{
  const state = structuredClone(baseState);
  state.invoices[0].items = [
    { productId: 'P1', kg: 1, price: 5e15, disc: 0, total: 5e15, costOfGoodsSold: 1 },
    { productId: 'P2', kg: 1, price: 5e15, disc: 0, total: 5e15, costOfGoodsSold: 1 }
  ];
  state.invoices[0].subtotal = 1e16;
  state.invoices[0].netSubtotal = 1e16;
  state.invoices[0].vatRate = 0;
  state.invoices[0].vatAmount = 0;
  state.invoices[0].grandTotal = 1e16;
  const result = auditInvoices(state, { dateOrdinal });
  assert.ok(result.findings.some(x => x.code === 'invoice-total-unsafe'));
}
{
  const state = structuredClone(baseState);
  state.invoices[0].netSubtotal = Number.MAX_SAFE_INTEGER;
  state.invoices[0].vatRate = 100;
  state.invoices[0].vatAmount = 0;
  state.invoices[0].grandTotal = 0;
  const result = auditInvoices(state, { dateOrdinal });
  assert.ok(result.findings.some(x => x.code === 'invoice-vat-calculation-unsafe'));
}
{
  const result = buildInventoryCostAudit({
    invoices: [{ id: 'BIG-SALE', type: 'sale', items: [
      { productId: 'P1', kg: 1, costOfGoodsSold: 5e15 },
      { productId: 'P2', kg: 1, costOfGoodsSold: 5e15 }
    ] }],
    vouchers: [{ id: 'V-BIG', sourceType: 'invoice', sourceId: 'BIG-SALE', lines: [
      { code: '5101', debit: 1e16, credit: 0 }, { code: '1105', debit: 0, credit: 1e16 }
    ] }]
  });
  assert.ok(result.issues.some(x => x.type === 'cogs-total-unsafe'));
}
{
  const result = buildInventoryCostAudit({
    invoices: [{ id: 'UNSAFE', type: 'sale', items: [{ productId: 'P1', kg: 1, costOfGoodsSold: Number.MAX_SAFE_INTEGER + 1 }] }],
    vouchers: [{ id: 'V-U', sourceType: 'invoice', sourceId: 'UNSAFE', lines: [] }]
  });
  assert.ok(result.issues.some(x => x.type === 'cogs-line-invalid'));
}
{
  const state = {
    invoices: [{ id: 'VAT-PUR', type: 'purchase', sub: 100, items: [{ productId: 'P1', kg: 1, total: 100 }] }],
    products: [{ id: 'P1', batches: [{ sourceType: 'purchase', sourceRef: 'VAT-PUR', lot: 'PUR-VAT-PUR-P1', quantity: 1 }] }],
    vouchers: [{ id: 'V-P', sourceType: 'invoice', sourceId: 'VAT-PUR', lines: [
      { code: '1105', debit: 100, credit: 0 }, { code: '1106', debit: 10, credit: 0 }, { code: '2101', debit: 0, credit: 110 }
    ] }]
  };
  const result = buildInventoryCostAudit(state);
  assert.equal(result.inventoryCounterpartMismatches, 0, 'recoverable input VAT must remain outside inventory carrying value');
}
console.log('PASS: invoice and inventory audits reject unsafe monetary magnitudes and aggregation overflow');
console.log('PASS: recoverable input VAT remains separate from inventory control value');
