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


  function inspectWarehouseAssignmentHistory(state, productId) {
    const data = state && typeof state === 'object' ? state : {};
    const products = Array.isArray(data.products) ? data.products : [];
    const id = String(productId == null ? '' : productId).trim();
    const matches = products.filter(product => String(product && product.id != null ? product.id : '').trim() === id);
    if (!id || matches.length !== 1) {
      return { ok: false, productId: id, reason: matches.length ? 'شناسه کالا یکتا نیست.' : 'کالا پیدا نشد.', classification: 'unresolved' };
    }
    const product = matches[0];
    const movements = (Array.isArray(product.kardex) ? product.kardex : []).map((row, index) => ({
      index,
      date: String(row && (row.date || row.operationDate) || ''),
      document: String(row && (row.doc || row.description || '') || ''),
      inQty: Number(row && row.inQty || 0),
      outQty: Number(row && row.outQty || 0),
      balance: Number(row && row.bal),
      warehouseIds: extractWarehouseIds(row)
    }));
    const batches = (Array.isArray(product.batches) ? product.batches : []).map((batch, index) => ({
      index,
      id: String(batch && batch.id || ''),
      lot: String(batch && batch.lot || ''),
      sourceType: String(batch && batch.sourceType || ''),
      sourceRef: String(batch && batch.sourceRef || ''),
      sourceBatchId: String(batch && batch.sourceBatchId || ''),
      quantity: Number(batch && batch.quantity),
      remainingQty: Number(batch && batch.remainingQty),
      warehouseIds: extractWarehouseIds(batch)
    }));
    const documents = [];
    const seen = new Set();
    const excludedRoots = new Set(['products', 'warehouses', 'auditLogs']);
    function visit(value, path) {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, path + '[' + index + ']'));
        return;
      }
      const referencesProduct = Object.entries(value).some(([key, child]) =>
        ['productId', 'product_id', 'stockProductId', 'stock_product_id', 'itemProductId'].includes(key) &&
        child != null && String(child).trim() === id
      );
      if (referencesProduct && documents.length < 100) {
        documents.push({
          path,
          recordId: String(value.id || value.voucherId || value.invoiceId || value.orderId || ''),
          date: String(value.date || value.operationDate || value.createdAt || ''),
          description: String(value.desc || value.description || value.doc || ''),
          warehouseIds: extractWarehouseIds(value)
        });
      }
      Object.entries(value).forEach(([key, child]) => visit(child, path ? path + '.' + key : key));
    }
    Object.entries(data).forEach(([key, value]) => {
      if (!excludedRoots.has(key)) visit(value, key);
    });
    const auditReferences = (Array.isArray(data.auditLogs) ? data.auditLogs : []).filter(entry =>
      entry && (
        String(entry.sourceId || '') === id ||
        String(entry.productId || '') === id ||
        String(entry.details && entry.details.productId || '') === id
      )
    ).map(entry => ({
      operationId: String(entry.operationId || ''),
      sourceType: String(entry.sourceType || ''),
      action: String(entry.action || ''),
      time: String(entry.time || entry.createdAt || '')
    }));
    const evidenceCount = movements.length + batches.length + documents.length + auditReferences.length;
    const warehouseIds = Array.from(new Set([
      ...movements.flatMap(item => item.warehouseIds),
      ...batches.flatMap(item => item.warehouseIds),
      ...documents.flatMap(item => item.warehouseIds)
    ]));
    return {
      ok: true,
      productId: id,
      productName: String(product.name || id),
      classification: evidenceCount ? 'historical-evidence' : 'no-history-found',
      canAutoReassign: evidenceCount === 0 && Number(product.stock) === 0,
      currentWarehouseId: product.warehouseId == null ? null : String(product.warehouseId),
      stock: Number(product.stock),
      movementCount: movements.length,
      batchCount: batches.length,
      documentReferenceCount: documents.length,
      auditReferenceCount: auditReferences.length,
      unresolvedWarehouseEvidenceCount: movements.concat(batches, documents).filter(item => !item.warehouseIds.length).length,
      warehouseIds,
      movements: movements.slice(0, 20),
      batches: batches.slice(0, 20),
      documents: documents.slice(0, 30),
      auditReferences: auditReferences.slice(0, 20),
      truncated: movements.length > 20 || batches.length > 20 || documents.length > 30 || auditReferences.length > 20
    };
  }

  function extractWarehouseIds(record) {
    if (!record || typeof record !== 'object') return [];
    return Array.from(new Set([
      record.warehouseId, record.warehouse_id, record.sourceWarehouseId,
      record.destinationWarehouseId, record.fromWarehouseId, record.toWarehouseId
    ].filter(value => value != null && String(value).trim()).map(String)));
  }

  root.HolooWarehouseAssignment = { buildWarehouseAssignmentPlan, inspectWarehouseAssignmentHistory };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HolooWarehouseAssignment;
})(typeof globalThis !== 'undefined' ? globalThis : this);
