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

