const assert = require('node:assert/strict');
const {
  normalizeItems,
  allocateImportExpenses,
  calculateLandedCost,
  calculateShipmentProfit
} = require('../import-domain.js');

const legacy = normalizeItems({
  id: 'IMP-OLD', productId: 'P1', weightKg: 100, cartons: 10,
  fxTotal: 500, lot: 'LEGACY-LOT'
});
assert.equal(legacy.length, 1);
assert.equal(legacy[0].productId, 'P1');
assert.equal(legacy[0].quantityKg, 100);
assert.equal(legacy[0].fxAmount, 500);

const items = [
  { id: 'I1', productId: 'P1', quantityKg: 60, cartons: 6, fxAmount: 300 },
  { id: 'I2', productId: 'P2', quantityKg: 40, cartons: 4, fxAmount: 200 }
];
const allocated = allocateImportExpenses(items, { freight: 1000, customs: 600, storage: 400 }, {
  freight: 'weight', customs: 'value', storage: 'cartons'
});
assert.deepEqual(allocated.items.map(x => x.allocatedExpenses.freight), [600, 400]);
assert.deepEqual(allocated.items.map(x => x.allocatedExpenses.customs), [360, 240]);
assert.deepEqual(allocated.items.map(x => x.allocatedExpenses.storage), [240, 160]);
assert.equal(allocated.items.reduce((sum, x) => sum + Object.values(x.allocatedExpenses).reduce((a,b)=>a+b,0), 0), 2000);

const manual = allocateImportExpenses(items, { insurance: 101 }, { insurance: 'manual' }, {
  insurance: { I1: 70, I2: 31 }
});
assert.deepEqual(manual.items.map(x => x.allocatedExpenses.insurance), [70, 31]);
assert.throws(() => allocateImportExpenses(items, { insurance: 100 }, { insurance: 'manual' }, {
  insurance: { I1: 70, I2: 20 }
}), /دقیقاً برابر/);

const costed = calculateLandedCost(items, 1000, { freight: 1000, customs: 600 }, {
  freight: 'weight', customs: 'value'
});
assert.equal(costed.fxTotal, 500);
assert.equal(costed.totalWeightKg, 100);
assert.equal(costed.totalPurchaseRial, 500000);
assert.equal(costed.totalExpenseRial, 1600);
assert.equal(costed.totalLandedRial, 501600);
assert.equal(costed.items.reduce((sum, x) => sum + x.landedCostRial, 0), costed.totalLandedRial);
assert.throws(() => calculateLandedCost(items, 0, {}, {}), /نرخ ارز/);
assert.throws(() => calculateLandedCost([
  { id:'X', productId:'P1', quantityKg:1, fxAmount:1 },
  { id:'X', productId:'P2', quantityKg:1, fxAmount:1 }
], 100, {}, {}), /تکراری/);

const shipment = {
  id: 'IMP-1', productId: 'P1', weightKg: 10, fxTotal: 100,
  fxPaid: 100, fxRate: 1000, currency: 'USD',
  items: [
    { id: 'IMP-1-A', productId: 'P1', quantityKg: 4, fxAmount: 40 },
    { id: 'IMP-1-B', productId: 'P2', quantityKg: 6, fxAmount: 60 }
  ],
  fxPayments: [{ amount: 100, realizedDiff: 2500 }]
};
const products = [
  { id: 'P1', batches: [{ id: 'B1', sourceRef: 'IMP-1', sourceItemId: 'IMP-1-A' }] },
  { id: 'P2', batches: [{ id: 'B2', sourceRef: 'IMP-1', sourceItemId: 'IMP-1-B' }] },
  { id: 'P3', batches: [{ id: 'B3', sourceRef: 'IMP-OTHER' }] }
];
const invoices = [{
  type: 'sale', status: 'active',
  items: [{
    productId: 'P1', kg: 10, price: 200, total: 2000, costOfGoodsSold: 1200, costingMethod: 'AVG',
    fifoAllocations: [
      { batchId: 'B1', quantity: 4, unitCost: 100 },
      { batchId: 'B3', quantity: 6, unitCost: 200 }
    ],
    returnedKg: 2,
    fifoReturnedAllocations: [{ batchId: 'B1', quantity: 2 }]
  }]
}];
const profit = calculateShipmentProfit(shipment, products, invoices, { USD: 1100 });
assert.equal(profit.revenue, 400);
assert.equal(profit.cogs, 240);
assert.equal(profit.grossProfit, 160);
assert.equal(profit.realizedFx, 2500);
assert.equal(profit.unrealizedFx, 0);
assert.equal(profit.profitAfterRealizedFx, 2660);
assert.equal(profit.items.find(x => x.itemId === 'IMP-1-A').returnedKg, 2);
assert.equal(profit.untraceableSalesKg, 0);
assert.equal(profit.items.find(x => x.itemId === 'IMP-1-B').revenue, 0);

console.log('PASS: import multi-item costing, allocation, legacy compatibility and shipment profit tests');

const legacyUntraceable = calculateShipmentProfit(
  { id: 'IMP-LEGACY', productId: 'P-OLD', weightKg: 10, fxTotal: 10, fxPaid: 0, fxRate: 100, currency: 'USD' },
  [{ id: 'P-OLD', batches: [] }],
  [{ type: 'sale', status: 'active', items: [{ productId: 'P-OLD', kg: 3, price: 50, total: 150, costOfGoodsSold: 90 }] }],
  { USD: 110 }
);
assert.equal(legacyUntraceable.untraceableSalesKg, 3);
console.log('PASS: legacy non-FIFO sales are explicitly flagged as untraceable');

const fifoProfit = calculateShipmentProfit(
  { id: 'IMP-FIFO', productId: 'P-FIFO', weightKg: 4, fxTotal: 40, fxPaid: 40, fxRate: 100, currency: 'USD',
    items: [{ id: 'IMP-FIFO-ITEM', productId: 'P-FIFO', quantityKg: 4, fxAmount: 40 }] },
  [{ id: 'P-FIFO', batches: [
    { id: 'BF1', sourceRef: 'IMP-FIFO', sourceItemId: 'IMP-FIFO-ITEM' },
    { id: 'BF2', sourceRef: 'IMP-OTHER' }
  ] }],
  [{ type: 'sale', status: 'active', items: [{
    productId: 'P-FIFO', kg: 10, total: 3000, costOfGoodsSold: 1600, costingMethod: 'FIFO',
    fifoAllocations: [{ batchId: 'BF1', quantity: 4, unitCost: 100 }, { batchId: 'BF2', quantity: 6, unitCost: 200 }],
    returnedKg: 2, fifoReturnedAllocations: [{ batchId: 'BF1', quantity: 2 }]
  }] }],
  { USD: 100 }
);
assert.equal(fifoProfit.revenue, 600);
assert.equal(fifoProfit.cogs, 200);
assert.equal(fifoProfit.grossProfit, 400);
console.log('PASS: FIFO shipment profit uses the exact source-batch cost after returns');
