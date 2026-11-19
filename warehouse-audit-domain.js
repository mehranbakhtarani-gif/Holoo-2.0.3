;(function (root) {
  'use strict';

  function escapeAuditText(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getWarehouseMovementAuditView(products, warehouses, product, movement, vouchers) {
    const allProducts = Array.isArray(products) ? products : [];
    const allWarehouses = Array.isArray(warehouses) ? warehouses : [];
    const allVouchers = Array.isArray(vouchers) ? vouchers : [];
    if (!product || !movement) return { kind: 'unknown', verified: false, reason: 'گردش یا کالا موجود نیست.' };

    const description = String(movement.doc || '');
    if (/اصلاحیه انبارگردانی/.test(description)) {
      const expectedVoucherDescription = 'سند مغایرت انبارگردانی: ' + String(product.name || '');
      const candidates = allVouchers.filter(voucher =>
        voucher && String(voucher.desc || '') === expectedVoucherDescription &&
        String(voucher.date || voucher.operationDate || '') === String(movement.date || '')
      );
      return {
        kind: 'stocktake',
        verified: false,
        movementDate: String(movement.date || ''),
        productId: String(product.id || ''),
        productName: String(product.name || ''),
        inQty: Number(movement.inQty || 0),
        outQty: Number(movement.outQty || 0),
        balance: Number(movement.bal || 0),
        voucherCandidates: candidates.map(voucher => ({ id: String(voucher.id || ''), description: String(voucher.desc || '') })),
        reason: 'ردیف انبارگردانی شناسه یکتای عملیات ندارد؛ تطبیق سند فقط بر اساس شرح و تاریخ، پیوند قطعی حسابرسی محسوب نمی‌شود.'
      };
    }

    const match = description.match(/TR-\d+-[a-z0-9]+/i);
    if (!match) return { kind: 'unknown', verified: false, reason: 'شناسه انتقال از شرح گردش قابل استخراج نیست.' };
    const transferId = match[0];
    const related = [];
    allProducts.forEach(item => {
      (Array.isArray(item && item.kardex) ? item.kardex : []).forEach(row => {
        if (row && String(row.doc || '').includes(transferId)) related.push({ product: item, movement: row });
      });
    });
    const outgoing = related.filter(row => Number(row.movement.outQty || 0) > 0);
    const incoming = related.filter(row => Number(row.movement.inQty || 0) > 0);
    const pairUnique = related.length === 2 && outgoing.length === 1 && incoming.length === 1;
    const source = pairUnique ? outgoing[0] : null;
    const destination = pairUnique ? incoming[0] : null;
    const quantityMatches = !!source && !!destination &&
      Number.isFinite(Number(source.movement.outQty)) &&
      Number.isFinite(Number(destination.movement.inQty)) &&
      Math.abs(Number(source.movement.outQty) - Number(destination.movement.inQty)) <= 0.000001;
    const dateMatches = !!source && !!destination &&
      String(source.movement.date || '') === String(destination.movement.date || '');
    const transferBatches = allProducts.flatMap(item =>
      (Array.isArray(item && item.batches) ? item.batches : []).filter(batch =>
        batch && String(batch.sourceType || '') === 'warehouse_transfer' &&
        String(batch.sourceRef || '') === transferId
      ).map(batch => ({ product: item, batch }))
    );
    const sourceBatchMap = new Map();
    allProducts.forEach(item => (Array.isArray(item && item.batches) ? item.batches : []).forEach(batch => {
      if (batch && batch.id != null) sourceBatchMap.set(String(batch.id), { product: item, batch });
    }));
    const batchLinks = transferBatches.map(({ product: destinationProduct, batch }) => {
      const parent = batch.sourceBatchId != null ? sourceBatchMap.get(String(batch.sourceBatchId)) : null;
      return {
        destinationProductId: String(destinationProduct.id || ''),
        destinationBatchId: String(batch.id || ''),
        sourceBatchId: String(batch.sourceBatchId || ''),
        sourceProductId: parent ? String(parent.product.id || '') : '',
        sourceLot: parent ? String(parent.batch.lot || '') : '',
        destinationLot: String(batch.lot || ''),
        quantity: Number(batch.quantity || 0),
        remainingQty: Number(batch.remainingQty || 0),
        unitCost: Number(batch.unitCost || 0),
        parentFound: !!parent
      };
    });
    const warehouseName = id => {
      const found = allWarehouses.find(item => item && String(item.id) === String(id));
      return found ? String(found.name || found.title || id) : String(id || 'نامشخص');
    };
    const productMatches = !!source && !!destination &&
      String(source.product.baseProductId || source.product.id) === String(destination.product.baseProductId || destination.product.id);
    const warehouseDiffers = !!source && !!destination && String(source.product.warehouseId || '') !== String(destination.product.warehouseId || '');
    const verified = pairUnique && quantityMatches && dateMatches && productMatches && warehouseDiffers;
    return {
      kind: 'transfer',
      transferId,
      verified,
      pairCount: related.length,
      source: source ? {
        productId: String(source.product.id || ''),
        productName: String(source.product.name || ''),
        warehouseId: String(source.product.warehouseId || ''),
        warehouseName: warehouseName(source.product.warehouseId),
        date: String(source.movement.date || ''),
        quantity: Number(source.movement.outQty || 0),
        balanceAfter: Number(source.movement.bal || 0)
      } : null,
      destination: destination ? {
        productId: String(destination.product.id || ''),
        productName: String(destination.product.name || ''),
        warehouseId: String(destination.product.warehouseId || ''),
        warehouseName: warehouseName(destination.product.warehouseId),
        date: String(destination.movement.date || ''),
        quantity: Number(destination.movement.inQty || 0),
        balanceAfter: Number(destination.movement.bal || 0)
      } : null,
      quantityMatches,
      dateMatches,
      productMatches,
      warehouseDiffers,
      batchLinks,
      beforeSnapshotAvailable: false,
      actorAvailable: false,
      deviceAvailable: false,
      reason: verified
        ? 'دو سمت انتقال از نظر تعداد، مقدار و تاریخ تطبیق دارند؛ این تطبیق به‌تنهایی مجوز برگشت یا اصلاح نیست.'
        : 'جفت خروج و ورود، مقدار یا تاریخ انتقال کامل و منطبق نیست؛ اصلاح مسدود می‌ماند.'
    };
  }

  root.HolooWarehouseAudit = { getWarehouseMovementAuditView, escapeAuditText };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HolooWarehouseAudit;
})(typeof globalThis !== 'undefined' ? globalThis : this);
