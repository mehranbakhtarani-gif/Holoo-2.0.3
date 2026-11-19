;(function (root) {
  'use strict';

  function hasDocumentReference(value, productId, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some(item => hasDocumentReference(item, productId, seen));
    for (const [key, child] of Object.entries(value)) {
      if (['productId', 'product_id', 'stockProductId', 'stock_product_id'].includes(key) &&
          child != null && String(child) === productId) return true;
      if (hasDocumentReference(child, productId, seen)) return true;
    }
    return false;
  }

  function buildWarehouseAssignmentPlan(state, productId, targetWarehouseId) {
    const data = state && typeof state === 'object' ? state : {};
    const products = Array.isArray(data.products) ? data.products : [];
    const warehouses = Array.isArray(data.warehouses) ? data.warehouses : [];
    const id = String(productId == null ? '' : productId).trim();
    const targetId = String(targetWarehouseId == null ? '' : targetWarehouseId).trim();
    const matches = products.filter(product => String(product && product.id != null ? product.id : '').trim() === id);
    const reasons = [];
    if (!id) reasons.push('شناسه کالا معتبر نیست.');
    if (matches.length !== 1) reasons.push(matches.length ? 'شناسه کالا تکراری است؛ اصلاح خودکار مسدود شد.' : 'کالا پیدا نشد.');
    const product = matches.length === 1 ? matches[0] : null;
    const target = warehouses.find(warehouse => String(warehouse && warehouse.id != null ? warehouse.id : '').trim() === targetId);
    if (!targetId) reasons.push('ابتدا انبار مقصد را انتخاب کنید.');
    else if (!target) reasons.push('انبار مقصد در فهرست انبارهای شرکت وجود ندارد.');
    if (product) {
      const currentWarehouseId = String(product.warehouseId == null ? '' : product.warehouseId).trim();
      const currentIsValid = warehouses.some(warehouse => String(warehouse && warehouse.id != null ? warehouse.id : '').trim() === currentWarehouseId);
      if (currentIsValid) reasons.push('این کالا هم‌اکنون به یک انبار معتبر متصل است؛ تغییر مسیر از این فرایند مجاز نیست.');
      if (!product.name || !String(product.name).trim()) reasons.push('نام کالا ثبت نشده است.');
      const stock = Number(product.stock);
      if (!Number.isFinite(stock) || stock < 0) reasons.push('موجودی کالا نامعتبر است؛ ابتدا مغایرت موجودی باید بررسی شود.');
      else if (Math.abs(stock) > 0.000001) reasons.push('کالا موجودی غیرصفر دارد؛ تغییر انتساب می‌تواند تاریخچه و گزارش موجودی را جابه‌جا کند و از این مسیر مجاز نیست.');
      if (Array.isArray(product.kardex) && product.kardex.length) reasons.push('کالا سابقه کاردکس دارد؛ تغییر انتساب می‌تواند انبارِ نمایش تاریخچه را عوض کند.');
      if (Array.isArray(product.batches) && product.batches.length) reasons.push('کالا دارای سری ساخت/بچ است؛ تغییر انتساب خودکار مجاز نیست.');
      if (product.baseProductId && String(product.baseProductId).trim() !== id &&
          products.some(other => other !== product &&
            String(other && (other.baseProductId || other.id) || '').trim() === String(product.baseProductId).trim() &&
            String(other && other.warehouseId != null ? other.warehouseId : '').trim() === targetId)) {
        reasons.push('برای همین کالای پایه در انبار مقصد رکورد دیگری وجود دارد؛ از ایجاد رکورد تکراری جلوگیری شد.');
      } else if (products.some(other => other !== product &&
        String(other && (other.baseProductId || other.id) || '').trim() === String(product.baseProductId || product.id).trim() &&
        String(other && other.warehouseId != null ? other.warehouseId : '').trim() === targetId)) {
        reasons.push('برای همین کالای پایه در انبار مقصد رکورد دیگری وجود دارد؛ از ایجاد رکورد تکراری جلوگیری شد.');
      }
      const linkedCollections = ['invoices', 'orders', 'imports', 'vouchers'];
      const linked = linkedCollections.some(key => hasDocumentReference(data[key], id));
      if (linked) reasons.push('در اسناد یا عملیات ثبت‌شده ارجاعی به این کالا وجود دارد؛ تغییر انتساب خودکار مسدود شد.');
    }
    if (product && target && reasons.length === 0) {
      return {
        ok: true,
        productId: id,
        productName: String(product.name),
        targetWarehouseId: targetId,
        targetWarehouseName: String(target.name || target.title || targetId),
        previousWarehouseId: product.warehouseId == null ? null : String(product.warehouseId),
        stock: Number(product.stock || 0),
        accountingImpact: 'none',
        inventoryMovement: false,
        reasons: []
      };
    }
    return {
      ok: false,
      productId: id,
      productName: product ? String(product.name || '') : '',
      targetWarehouseId: targetId || null,
      targetWarehouseName: target ? String(target.name || target.title || targetId) : '',
      reasons
    };
  }

  root.HolooWarehouseAssignment = { buildWarehouseAssignmentPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HolooWarehouseAssignment;
})(typeof globalThis !== 'undefined' ? globalThis : this);
