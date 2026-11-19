const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

assert.ok(html.includes('function getWarehouseMovementCorrectionBlockReason(product, movement)'));
assert.ok(html.includes('function requestWarehouseMovementCorrection(productId, movementIndex)'));
assert.ok(html.includes('دو سمت خروج و ورود انتقال به‌صورت یکتا پیدا نشد'));
assert.ok(html.includes('بچ‌های FIFO، دو کاردکس و موجودی هر دو انبار'));
assert.ok(html.includes('شناسه یکتای عملیات و پیوند قطعی به سند مغایرت ندارد'));
assert.ok(html.includes('requestWarehouseMovementCorrection'));
assert.ok(html.includes('بررسی اصلاح گردش انبار'));
console.log('PASS: warehouse transfer and stocktake review guard prevents unsafe standalone edits');
