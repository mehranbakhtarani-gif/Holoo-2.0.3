const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const domain = fs.readFileSync('warehouse-audit-domain.js', 'utf8');

assert.ok(html.includes('function getWarehouseMovementCorrectionBlockReason(product, movement)'));
assert.ok(html.includes('TR-\\\\d+-[a-z0-9]+') === false, 'transfer ID regex must not match a literal backslash');
assert.ok(html.includes('function requestWarehouseMovementCorrection(productId, movementIndex)'));
assert.ok(html.includes('HolooWarehouseAudit.buildWarehouseTransferReversalPlan(state, transferMatch[0])'));
assert.ok(domain.includes('دو ردیف خروج و ورود حواله به‌صورت یکتا پیدا نشد'));
assert.ok(domain.includes('از بچ انتقالی در عملیات بعدی استفاده شده است'));
assert.ok(domain.includes('پس از این حواله گردش دیگری ثبت شده است'));
assert.ok(domain.includes('سند حسابداری وابسته پیدا شد'));
assert.ok(html.includes('id="modal-warehouse-transfer-correction"'));
assert.ok(html.includes('submitWarehouseTransferCorrection()'));
assert.ok(!html.includes('window.prompt(\'علت اصلاح حواله'));
assert.ok(html.includes('بررسی اصلاح گردش انبار'));
assert.ok(html.includes('const transferGroups = new Map()'), 'Kardex correction list must group paired rows by transfer ID');
assert.ok(!html.includes("match(/TR-\\\\d"), 'transfer ID matcher must use a digit pattern, not a literal backslash');
assert.ok(html.includes('بررسی / اصلاح حواله'), 'transfer correction action must be explicitly labeled');
assert.ok(!html.includes('✏️ اصلاح حواله انتقال</button>'), 'stocktake rows must not show the transfer correction action');
console.log('PASS: warehouse transfer correction is preflighted and unsafe dependencies remain blocked');
