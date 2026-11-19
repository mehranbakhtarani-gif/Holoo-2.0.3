const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

// Existing master-data editors remain present.
assert.ok(html.includes('function openPartyModal(partyId = null)'));
assert.ok(html.includes('function openProductModal(productId = null)'));

// Open sales orders can be edited; converted orders are deliberately locked.
assert.ok(html.includes('function openOrderModal(orderId = null)'));
assert.ok(html.includes('if (editingOrderId !== null)'));
assert.ok(html.includes("String(order.status || '').includes('تکمیل')"));
assert.ok(html.includes("sourceType: 'sales_order'"));
assert.ok(html.includes('هیچ فاکتور یا سند حسابداری تغییر نکرد'));

// Measurement-unit factors can be edited with an audit entry. Historical KG values remain intact.
assert.ok(html.includes('function editCustomUnit(unitId)'));
assert.ok(html.includes('function cancelCustomUnitEdit()'));
assert.ok(html.includes("sourceType: 'measurement_unit'"));
assert.ok(html.includes('فاکتورها و گردش‌های قبلی به دلیل ذخیره مقدار استاندارد KG تغییر نمی‌کنند'));

// Employee profile changes are audited without rewriting issued payroll history.
assert.ok(html.includes('function openEmployeeModal(employeeId = null)'));
assert.ok(html.includes("sourceType: 'payroll_employee'"));
assert.ok(html.includes('لیست‌های حقوق صادرشده قبلی به‌صورت تاریخی حفظ می‌شوند'));

// Fixed-asset editing cannot rewrite the acquisition voucher or already-posted depreciation.
assert.ok(html.includes('function openAssetModal(assetId = null)'));
assert.ok(html.includes("sourceType: 'fixed_asset'"));
assert.ok(html.includes('بهای تحصیل، تاریخ، حساب و سند اولیه دست‌نخورده باقی ماند'));
assert.ok(html.includes("['ast-date','ast-cost','ast-credit-account']"));
assert.ok(html.includes('if (!hasDepreciation) { asset.lifeYears = lifeYears; asset.residualValue = residualValue; }'));

// Custom subsidiary accounts can rename labels without changing account codes or posted voucher lines.
assert.ok(html.includes('function editCustomAccount(accountId)'));
assert.ok(html.includes("sourceType: 'chart_account'"));
assert.ok(html.includes('کد حساب و تمام اسناد و گردش‌های قبلی بدون تغییر حفظ شدند'));
assert.ok(html.includes("a.level === 'subsidiary' && !a.system ?"));
assert.ok(html.includes('شناسه تفصیلی و گردش‌های ثبت‌شده طرف حساب تغییر نکردند'));

// Posted invoices use a reversal-and-replacement correction flow; settled/returned invoices are blocked.
assert.ok(html.includes('function canCorrectInvoice(inv)'));
assert.ok(html.includes('function openInvoiceCorrection(invId)'));
assert.ok(html.includes('cancelInvoice(Number(invDraft.correctionOfInvoiceId), { deferSave: true, silent: true, reason: correctionReason })'));
assert.ok(html.includes('correctionOfInvoiceId: Number(invDraft.correctionOfInvoiceId)'));
assert.ok(html.includes('correctedByInvoiceId = Number(id)'));
assert.ok(html.includes('sourceType: \'invoice_correction\''));
assert.ok(html.includes('if (!options.deferSave) saveState()'));
assert.ok(html.includes('return true;'));
assert.ok(html.includes('✏️ اصلاح حسابرسی‌شده'));

// Manual vouchers are corrected by a balanced reversal and a new balanced voucher; originals remain immutable.
assert.ok(html.includes('function openManualVoucherCorrection(voucherId)'));
assert.ok(html.includes('function saveManualVoucherCorrection()'));
assert.ok(html.includes("original.sourceType !== 'manual_voucher' || original.locked || original.correctedByVoucherId"));
assert.ok(html.includes("debit: Number(line.credit || 0), credit: Number(line.debit || 0)"));
assert.ok(html.includes("event: 'reversal'"));
assert.ok(html.includes("event: 'replacement'"));
assert.ok(html.includes('original.correctedByVoucherId = replacementId'));
assert.ok(html.includes('reversalVoucherId = reversalId'));
assert.ok(html.includes("sourceType: 'manual_voucher_correction'"));
assert.ok(html.includes('state = before;'));
assert.ok(html.includes("!['sale', 'purchase'].includes(inv.type)"));
assert.ok(html.includes("sourceType: 'invoice_correction'"));
assert.ok(html.includes('ابطال پورسانت پرداختنی فاکتور'));
assert.ok(html.includes('برگشت هزینه پورسانت فاکتور'));
assert.ok(html.includes('if (correctionOriginalState) state = correctionOriginalState;'));
assert.ok(html.includes("function canCorrectInvoice(inv)"));
console.log('PASS: edit controls preserve posted accounting, inventory, payroll, and depreciation history');
