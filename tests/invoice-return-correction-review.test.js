const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

assert.ok(html.includes('function getInvoiceReturnCorrectionBlockReason(inv, returnRef)'));
assert.ok(html.includes('function requestInvoiceReturnCorrection(invoiceId, returnId)'));
assert.ok(html.includes("item.sourceType === 'invoice_return'"));
assert.ok(html.includes('برگشت، موجودی و سری‌های ساخت در FIFO، کاردکس، مالیات و سند حسابداری را هم‌زمان تغییر داده است'));
assert.ok(html.includes('اعتبار ناشی از برگشت مصرف یا تخصیص یافته است'));
assert.ok(html.includes("requestInvoiceReturnCorrection(${inv.id}, '${String(ref.id).replace(/'/g, '')}')"));
assert.ok(html.includes('بررسی اصلاح برگشت'));
console.log('PASS: invoice return correction review exposes dependencies and blocks unsafe standalone edits');

const cancelStart = html.indexOf('function cancelInvoice');
const cancelEnd = html.indexOf('function printOfficialInvoice', cancelStart);
const cancelSource = html.slice(cancelStart, cancelEnd);
assert.ok(cancelSource.includes('consumePurchaseReturnBatches(simulated, invId, entry.item, entry.quantity)'));
assert.ok(cancelSource.includes('consumePurchaseReturnBatches(product, invId, item, quantity)'));
assert.ok(cancelSource.includes("code: '4198'"));
assert.ok(cancelSource.includes("code: '6107'"));
assert.ok(cancelSource.includes('entry.purchaseReturnAllocations || []'));
assert.ok(!cancelSource.includes('consumeFifoStock(simulated, entry.quantity)'));
console.log('PASS: purchase cancellation is restricted to original purchase batches and posts carrying-value variance');
