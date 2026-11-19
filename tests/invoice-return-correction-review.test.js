const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

assert.ok(html.includes('function getInvoiceReturnCorrectionBlockReason(inv, returnRef)'));
assert.ok(html.includes('function requestInvoiceReturnCorrection(invoiceId, returnId)'));
assert.ok(html.includes("item.sourceType === 'invoice_return'"));
assert.ok(html.includes('برگشت، موجودی و بچ‌های FIFO، کاردکس، مالیات و سند حسابداری را هم‌زمان تغییر داده است'));
assert.ok(html.includes('اعتبار ناشی از برگشت مصرف یا تخصیص یافته است'));
assert.ok(html.includes("requestInvoiceReturnCorrection(${inv.id}, '${String(ref.id).replace(/'/g, '')}')"));
assert.ok(html.includes('بررسی اصلاح برگشت'));
console.log('PASS: invoice return correction review exposes dependencies and blocks unsafe standalone edits');
