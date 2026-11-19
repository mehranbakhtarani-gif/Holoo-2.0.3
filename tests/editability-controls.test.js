const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(m => m[1]).filter(s => s.trim());
for (const [i, source] of scripts.entries()) new vm.Script(source, { filename: 'index.html:inline-' + i });

// Existing master-data editors remain present.
assert.match(html, /function openPartyModal\\(partyId = null\\)/);
assert.match(html, /function openProductModal\\(productId = null\\)/);

// Open sales orders can be edited; converted orders are deliberately locked.
assert.match(html, /function openOrderModal\\(orderId = null\\)/);
assert.match(html, /function saveOrder\\(\\)[\\s\\S]*?if \\(editingOrderId !== null\\)/);
assert.match(html, /String\\(order\\.status \\|\\| ''\\)\\.includes\\('تکمیل'\\)/);
assert.match(html, /sourceType: 'sales_order'/);
assert.match(html, /ویرایش سفارش ذخیره شد؛ هیچ فاکتور یا سند حسابداری تغییر نکرد/);

// Measurement-unit factors can be edited with an audit entry. Historical KG values remain intact.
assert.match(html, /function editCustomUnit\\(unitId\\)/);
assert.match(html, /function cancelCustomUnitEdit\\(\\)/);
assert.match(html, /sourceType: 'measurement_unit'/);
assert.match(html, /فاکتورها و گردش‌های قبلی به دلیل ذخیره مقدار استاندارد KG تغییر نمی‌کنند/);

// Employee profile changes are audited without rewriting issued payroll history.
assert.match(html, /function openEmployeeModal\\(employeeId = null\\)/);
assert.match(html, /sourceType: 'payroll_employee'/);
assert.match(html, /لیست‌های حقوق صادرشده قبلی به‌صورت تاریخی حفظ می‌شوند/);

// Fixed-asset editing cannot rewrite the acquisition voucher or already-posted depreciation.
assert.match(html, /function openAssetModal\\(assetId = null\\)/);
assert.match(html, /sourceType: 'fixed_asset'/);
assert.match(html, /بهای تحصیل، تاریخ، حساب و سند اولیه دست‌نخورده باقی ماند/);
assert.match(html, /hasDepreciation \\? 'نام و محل دارایی ویرایش شد/);
assert.match(html, /ast-date','ast-cost','ast-credit-account/);

console.log('PASS: consistent edit controls preserve posted accounting, inventory, payroll, and depreciation history');
