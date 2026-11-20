const assert = require('node:assert/strict');
const fs = require('node:fs');
const { auditInvoices } = require('../invoice-audit-domain.js');
const { buildInventoryCostAudit } = require('../inventory-cost-audit-domain.js');

const purchase = {
  id: 'PUR-VAT-1', voucherId: 'VP-1', type: 'purchase', date: '1405/08/29',
  dueDate: '1405/09/01', partyId: 'S1', warehouseId: 'W1', payMethod: 'credit',
  subtotal: 100, netSubtotal: 100, discount: 0, vatRate: 10, vatAmount: 10,
  grandTotal: 110, purchaseVatTreatment: 'non_recoverable',
  items: [{ productId: 'P1', kg: 1, price: 100, disc: 0, total: 100,
    nonRecoverableVatAmount: 10, inventoryCost: 110, lot: 'LOT-1' }]
};
const purchaseVoucher = {
  id: 'VP-1', sourceType: 'invoice', sourceId: 'PUR-VAT-1', date: '1405/08/29',
  lines: [
    { code: '1105', debit: 110, credit: 0 },
    { code: '2101', partyId: 'S1', debit: 0, credit: 110 }
  ]
};
const state = {
  invoices: [purchase], vouchers: [purchaseVoucher],
  parties: [{ id: 'S1' }], warehouses: [{ id: 'W1' }],
  products: [{ id: 'P1', warehouseId: 'W1', stock: 1,
    batches: [{ sourceType: 'purchase', sourceRef: 'PUR-VAT-1', lot: 'LOT-1', quantity: 1, remainingQty: 1 }],
    kardex: [{ date: '1405/08/29', doc: 'فاکتور خرید #PUR-VAT-1', inQty: 1, outQty: 0, bal: 1 }]
  }]
};
const dateOrdinal = () => 1;

{
  const result = auditInvoices(state, { dateOrdinal });
  assert.equal(result.summary.errors, 0, JSON.stringify(result.findings));
  assert.equal(result.findings.length, 0);
}
{
  const broken = structuredClone(state);
  broken.vouchers[0].lines.push({ code: '1106', debit: 10, credit: 0 });
  broken.vouchers[0].lines[0].debit = 100;
  const result = auditInvoices(broken, { dateOrdinal });
  assert.ok(result.findings.some(x => x.code === 'journal-account-mismatch-1106'),
    'non-recoverable VAT must not be posted to input VAT control 1106');
  assert.ok(result.findings.some(x => x.code === 'journal-account-mismatch-1105'),
    'inventory control 1105 must include non-recoverable VAT');
}
{
  const result = buildInventoryCostAudit(state);
  assert.equal(result.inventoryCounterpartMismatches, 0, JSON.stringify(result.issues));
}
{
  const returned = structuredClone(state);
  returned.invoices[0].returnRefs = [{
    id: 'RET-1', amount: 55, items: [{ productId: 'P1', qty: 0.5, baseAmount: 50,
      vatAmount: 5, amount: 55, inventoryCost: 55 }]
  }];
  returned.vouchers.push({
    id: 'VR-1', sourceType: 'invoice_return', sourceId: 'RET-1',
    sourceEvent: 'PUR-VAT-1',
    lines: [{ code: '2101', debit: 55, credit: 0 }, { code: '1105', debit: 0, credit: 55 }]
  });
  const result = buildInventoryCostAudit(returned);
  assert.equal(result.returnAmountMismatches, 0, JSON.stringify(result.issues));
}
{
  const legacy = structuredClone(state);
  delete legacy.invoices[0].purchaseVatTreatment;
  legacy.vouchers[0].lines = [
    { code: '1105', debit: 100, credit: 0 },
    { code: '1106', debit: 10, credit: 0 },
    { code: '2101', partyId: 'S1', debit: 0, credit: 110 }
  ];
  const invoiceResult = auditInvoices(legacy, { dateOrdinal });
  assert.equal(invoiceResult.summary.errors, 0, JSON.stringify(invoiceResult.findings));
  const inventoryResult = buildInventoryCostAudit(legacy);
  assert.equal(inventoryResult.inventoryCounterpartMismatches, 0,
    'legacy recoverable VAT invoices must retain the previous accounting treatment');
}
{
  const source = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.ok(source.includes("purchaseVatTreatment: 'non_recoverable'"),
    'new purchase invoices must persist the non-recoverable VAT policy');
  assert.ok(source.includes('line.nonRecoverableVatAmount = nextVat - allocatedVat;'),
    'VAT must be allocated across purchase lines cumulatively without losing rounding residue');
  assert.ok(source.includes('const purchaseInventoryCost = Number(line.inventoryCost ?? line.total ?? 0);'),
    'FIFO batch and weighted-average inventory cost must include non-recoverable VAT');
  assert.ok(source.includes('debit: grandTotal, credit: 0 },'),
    'purchase inventory journal must capitalize the invoice VAT');
  assert.ok(source.includes("inv.purchaseVatTreatment === 'non_recoverable' ? cancelAmount : cancelBaseAmount"),
    'purchase cancellation must reverse the gross inventory carrying amount for new invoices');
}
console.log('PASS: non-recoverable purchase VAT is capitalized to inventory and reconciled to account 1105');
console.log('PASS: partial purchase returns and cancellation reverse inventory cost without using account 1106');
console.log('PASS: legacy invoices preserve their original recoverable-VAT accounting treatment');
