const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /id="imports-dashboard-summary"/);
assert.match(html, /function updateImportStatus\(/);
assert.match(html, /statusHistory: \[\{ status:/);
assert.match(html, /function renderImportsModule\(/);
assert.match(html, /function receiveImportShipment\(/);
assert.match(html, /postedToWh: false/);
assert.match(html, /nextStatus === 'received'\) receiveImportShipment\(shipment\)/);
assert.match(html, /warehouse_receipt/);
assert.match(html, /code: '2106'.*credit: costing\.totalExpenseRial/);
assert.match(html, /SUB-2106/);
assert.match(html, /بستانکاران هزینه‌های واردات/);

assert.match(html, /تأخیر در ETA/);
assert.match(html, /id="imp-eta"/);
assert.match(html, /id="imp-bl"/);
assert.match(html, /id="imp-port"/);
assert.match(html, /HolooImportDomain\.calculateLandedCost\(items, fxRate, expenses, expenseAllocationBasis\)/);
console.log('PASS: 13 import dashboard and shipment tracking checks');

const vm = require('node:vm');
const helperStart = html.indexOf('    function ensureProductBatches(');
const moduleMarker = html.indexOf('7. MODULE 3:', helperStart);
const helperEnd = html.lastIndexOf('    //', moduleMarker);
const receiptStart = html.indexOf('    function receiveImportShipment(');
const receiptEnd = html.indexOf('    function updateImportStatus(', receiptStart);
const product = { id: 'P-IMPORT', stock: 100, buyPrice: 5, batches: [], kardex: [], lastMoveDays: 8 };
const shipment = { id: 'IMP-TEST', productId: product.id, weightKg: 10, landedCostPerKg: 100, totalLandedRial: 1000, lot: 'LOT-TEST', status: 'received', postedToWh: false };
const vouchers = [];
const sandbox = {
  state: { products: [product], costingMethod: 'FIFO', activeRole: 'mehran', fiscalYear: '1405' },
  HolooImportDomain: require('../import-domain.js'),
  DEVICE_ID: 'DEVICE-IMPORT',
  createStableId: (() => { let n = 0; return p => p + '-' + (++n); })(),
  getTodayJalaliDate: () => '1405/09/01',
  addAudit() {},
  postVoucher(...args) { vouchers.push(args); },
};
vm.createContext(sandbox);
vm.runInContext(html.slice(helperStart, helperEnd) + html.slice(receiptStart, receiptEnd) + '; this.receive = receiveImportShipment;', sandbox);
assert.equal(sandbox.receive(shipment), true);
assert.equal(product.stock, 110);
assert.equal(product.batches.reduce((sum, batch) => sum + batch.remainingQty, 0), 110);
assert.equal(shipment.postedToWh, true);
assert.equal(vouchers.length, 1);
assert.equal(vouchers[0][1][0].debit, vouchers[0][1][1].credit);
assert.equal(sandbox.receive(shipment), false);
assert.equal(product.stock, 110);
console.log('PASS: import stock is posted once, only on warehouse receipt');


const multiProducts = [
  { id: 'P-A', stock: 10, buyPrice: 50, batches: [], kardex: [], lastMoveDays: 2 },
  { id: 'P-B', stock: 20, buyPrice: 80, batches: [], kardex: [], lastMoveDays: 3 }
];
const multiShipment = {
  id: 'IMP-MULTI', supplierPartyId: 'SUP-1', totalLandedRial: 5000, status: 'cleared', postedToWh: false,
  items: [
    { id: 'IMP-MULTI-A', productId: 'P-A', quantityKg: 2, cartons: 2, fxAmount: 20, landedCostRial: 2000, unitCost: 1000, landedCostPerKg: 1000, lot: 'LOT-A' },
    { id: 'IMP-MULTI-B', productId: 'P-B', quantityKg: 4, cartons: 4, fxAmount: 30, landedCostRial: 3000, unitCost: 750, landedCostPerKg: 750, lot: 'LOT-B' }
  ]
};
const multiVouchers = [];
const multiSandbox = {
  state: { products: multiProducts, costingMethod: 'FIFO', activeRole: 'ehsan', fiscalYear: '1405' },
  HolooImportDomain: require('../import-domain.js'), DEVICE_ID: 'DEVICE-MULTI',
  createStableId: (() => { let n = 0; return p => p + '-' + (++n); })(),
  getTodayJalaliDate: () => '1405/09/02', addAudit() {},
  postVoucher(...args) { multiVouchers.push(args); }
};
vm.createContext(multiSandbox);
vm.runInContext(html.slice(helperStart, helperEnd) + html.slice(receiptStart, receiptEnd) + '; this.receive = receiveImportShipment;', multiSandbox);
assert.equal(multiSandbox.receive(multiShipment), true);
assert.equal(multiProducts[0].stock, 12);
assert.equal(multiProducts[1].stock, 24);
assert.equal(multiProducts[0].batches.find(batch => batch.sourceRef === 'IMP-MULTI').sourceItemId, 'IMP-MULTI-A');
assert.equal(multiProducts[1].batches.find(batch => batch.sourceRef === 'IMP-MULTI').sourceItemId, 'IMP-MULTI-B');
assert.equal(multiProducts[0].batches.find(batch => batch.sourceRef === 'IMP-MULTI').unitCost, 1000);
assert.equal(multiVouchers.length, 1);
assert.equal(multiVouchers[0][1][0].debit, 5000);
assert.equal(multiVouchers[0][1][1].credit, 5000);
assert.equal(multiShipment.postedToWh, true);
assert.equal(multiSandbox.receive(multiShipment), false);
assert.equal(multiProducts[0].stock, 12);
console.log('PASS: multi-item shipment receipt creates item-linked lots and one balanced voucher');

const rollbackProducts = [
  { id: 'P-ROLL-1', stock: 5, buyPrice: 10, batches: [], kardex: [] },
  { id: 'P-ROLL-2', stock: 7, buyPrice: 20, batches: [], kardex: [] }
];
const rollbackShipment = {
  id: 'IMP-ROLLBACK', totalLandedRial: 300, postedToWh: false,
  items: [
    { id: 'R1', productId: 'P-ROLL-1', quantityKg: 2, landedCostRial: 100, unitCost: 50 },
    { id: 'R2', productId: 'P-ROLL-2', quantityKg: 2, landedCostRial: 200, unitCost: 100 }
  ]
};
const rollbackSandbox = {
  state: { products: rollbackProducts, costingMethod: 'FIFO', activeRole: 'mehran', fiscalYear: '1405' },
  HolooImportDomain: require('../import-domain.js'), DEVICE_ID: 'DEVICE-ROLLBACK',
  createStableId: (() => { let n = 0; return p => p + '-' + (++n); })(),
  getTodayJalaliDate: () => '1405/09/02', addAudit() {},
  postVoucher() { throw new Error('simulated voucher failure'); }
};
vm.createContext(rollbackSandbox);
vm.runInContext(html.slice(helperStart, helperEnd) + html.slice(receiptStart, receiptEnd) + '; this.receive = receiveImportShipment;', rollbackSandbox);
assert.throws(() => rollbackSandbox.receive(rollbackShipment), /simulated voucher failure/);
assert.deepEqual(rollbackProducts.map(product => product.stock), [5, 7]);
assert.deepEqual(rollbackProducts.map(product => product.batches.length), [0, 0]);
assert.equal(rollbackShipment.postedToWh, false);
console.log('PASS: failed multi-item receipt rolls back every product and lot');
