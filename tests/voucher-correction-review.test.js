const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

// Every journal entry exposes one correction review action, but only open manual vouchers enter the reversal flow.
assert.ok(html.includes('function getVoucherCorrectionBlockReason(voucher)'));
assert.ok(html.includes('function requestVoucherCorrection(voucherId)'));
assert.ok(html.includes('onclick="requestVoucherCorrection(${v.id})"'));
assert.ok(html.includes("if (voucher.sourceType === 'manual_voucher') return ''"));
assert.ok(html.includes('openManualVoucherCorrection(voucherId)'));
assert.ok(html.includes('این سند سیستمی است؛ اصلاح آن باید از ماژول سازنده سند انجام شود'));
assert.ok(html.includes('سند اختتامیه فقط از فرایند بستن سال مالی قابل پیگیری است.'));
assert.ok(html.includes('این سند بخشی از زنجیره اصلاح قبلی است و نباید جداگانه اصلاح شود.'));
assert.ok(html.includes('سند قفل سخت‌گیرانه دارد؛ اصلاح مستقیم آن مجاز نیست.'));
console.log('PASS: journal correction review is visible and routes only eligible manual vouchers to audited correction');
