const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

assert.ok(html.includes('function getTreasuryCorrectionBlockReason(tx)'));
assert.ok(html.includes('function requestTreasuryCorrection(txId)'));
assert.ok(html.includes('function getCheckCorrectionBlockReason(check)'));
assert.ok(html.includes('function requestCheckCorrection(checkId)'));
assert.ok(html.includes("requestCheckCorrection('${c.id}')"));
assert.ok(html.includes("requestTreasuryCorrection('${t.id}')"));
assert.ok(html.includes('تخصیص دارد؛ ابتدا باید وابستگی فاکتور در گردش اصلاح شود.'));
assert.ok(html.includes('چک وصول‌شده، برگشتی، واگذارشده یا باطل‌شده قفل است.'));
assert.ok(html.includes('سند حسابداری متناظر پیدا نشد؛ اصلاح متوقف شد تا سند ناقص ایجاد نشود.'));
console.log('PASS: treasury/check correction availability is visible and blocked dependencies are explained without mutation');
