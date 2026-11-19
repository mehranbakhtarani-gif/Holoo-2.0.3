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
assert.ok(html.includes('window.confirm(confirmation)'));
assert.ok(html.includes('بررسی اصلاح گردش انبار'));
console.log('PASS: warehouse transfer correction is preflighted and unsafe dependencies remain blocked');
