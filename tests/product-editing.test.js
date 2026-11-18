const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]).filter(source => source.trim());
for (const [index, source] of scripts.entries()) new (require('node:vm').Script)(source, { filename: `index.html:inline-script-${index}` });

assert.match(html, /✏️ ویرایش/);
assert.match(html, /data-product-id=/);
assert.match(html, /function openProductModal\\(productId = null\\)/);
assert.match(html, /const preserveIds = \\['p-wh', 'p-carton-kg', 'p-stock', 'p-lot', 'p-buy-price'\\]/);
assert.match(html, /Object\\.assign\\(product, fields\\)/);
assert.match(html, /addAudit\\(\\`ویرایش مشخصات کالا:/);
assert.match(html, /مشخصات کالا و ۱۰ سطح قیمت ذخیره و همگام‌سازی شد/);

const saveStart = html.indexOf('    function saveProduct() {');
const saveEnd = html.indexOf('    function printBarcodeLabel', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'saveProduct function must exist');
const save = html.slice(saveStart, saveEnd);
const editStart = save.indexOf('      if (editingProductId) {');
const editEnd = save.indexOf('      const stock = Number', editStart);
assert.ok(editStart >= 0 && editEnd > editStart, 'edit branch must be isolated from new-product stock posting');
const editBranch = save.slice(editStart, editEnd);
assert.match(editBranch, /Object\\.assign\\(product, fields\\)/);
assert.match(editBranch, /saveState\\(\\)/);
assert.doesNotMatch(editBranch, /postVoucher|stock\\s*=|batches\\s*=|kardex\\s*=/, 'editing must not post vouchers or rewrite inventory history');
assert.match(editBranch, /product\\.id/);
assert.match(editBranch, /barcode.*قبلاً/);
console.log('PASS: product editing preserves identity and inventory history without posting accounting vouchers');
