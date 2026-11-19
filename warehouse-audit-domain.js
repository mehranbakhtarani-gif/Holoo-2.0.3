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


  function buildWarehouseTransferReversalPlan(state, transferId) {
    const products = Array.isArray(state && state.products) ? state.products : [];
    const vouchers = Array.isArray(state && state.vouchers) ? state.vouchers : [];
    const id = String(transferId || '').trim();
    if (!/^TR-\d+-[a-z0-9]+$/i.test(id)) return { ok: false, reason: 'شناسه حواله معتبر نیست.' };

    const related = [];
    products.forEach(product => {
      (Array.isArray(product && product.kardex) ? product.kardex : []).forEach((movement, index) => {
        if (movement && String(movement.doc || '').includes(id)) related.push({ product, movement, index });
      });
    });
    const outgoing = related.filter(row => Number(row.movement.outQty || 0) > 0 && Number(row.movement.inQty || 0) === 0);
    const incoming = related.filter(row => Number(row.movement.inQty || 0) > 0 && Number(row.movement.outQty || 0) === 0);
    if (related.length !== 2 || outgoing.length !== 1 || incoming.length !== 1) {
      return { ok: false, reason: 'دو ردیف خروج و ورود حواله به‌صورت یکتا پیدا نشد.' };
    }
    const source = outgoing[0], destination = incoming[0];
    const quantity = Number(source.movement.outQty);
    if (!Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(Number(destination.movement.inQty)) ||
        Math.abs(quantity - Number(destination.movement.inQty)) > 0.000001) {
      return { ok: false, reason: 'مقدار خروج و ورود برابر یا معتبر نیست.' };
    }
    if (String(source.movement.date || '') !== String(destination.movement.date || '')) {
      return { ok: false, reason: 'تاریخ دو سمت حواله یکسان نیست.' };
    }
    if (String(source.product.baseProductId || source.product.id) !== String(destination.product.baseProductId || destination.product.id)) {
      return { ok: false, reason: 'کالای دو سمت حواله یکسان نیست.' };
    }
    if (!source.product.warehouseId || !destination.product.warehouseId ||
        String(source.product.warehouseId) === String(destination.product.warehouseId)) {
      return { ok: false, reason: 'انبار مبدأ و مقصد معتبر و متفاوت نیستند.' };
    }
    if (source.index !== source.product.kardex.length - 1 || destination.index !== destination.product.kardex.length - 1) {
      return { ok: false, reason: 'پس از این حواله گردش دیگری ثبت شده است؛ برگشت خودکار برای جلوگیری از تغییر گردش‌های بعدی مسدود شد.' };
    }
    if (!Number.isFinite(Number(source.product.stock)) ||
        !Number.isFinite(Number(destination.product.stock)) ||
        !Number.isFinite(Number(source.movement.bal)) ||
        !Number.isFinite(Number(destination.movement.bal)) ||
        Math.abs(Number(source.product.stock) - Number(source.movement.bal)) > 0.000001 ||
        Math.abs(Number(destination.product.stock) - Number(destination.movement.bal)) > 0.000001) {
      return { ok: false, reason: 'موجودی فعلی با مانده ثبت‌شده در زمان حواله برابر نیست.' };
    }
    if (products.some(product => (Array.isArray(product && product.kardex) ? product.kardex : []).some(row =>
      row && (String(row.reversalOf || '') === id || String(row.doc || '').includes('برگشت حواله انتقال ' + id))
    ))) return { ok: false, reason: 'برای این حواله قبلاً برگشت ثبت شده است.' };

    if (vouchers.some(voucher =>
      voucher && (String(voucher.sourceId || '') === id ||
        String(voucher.desc || '').includes(id) ||
        (Array.isArray(voucher.lines) && voucher.lines.some(line => String(line.desc || '').includes(id)))
      )
    )) return { ok: false, reason: 'برای این حواله سند حسابداری وابسته پیدا شد؛ برگشت خودکار بدون اصلاح زنجیره سند مجاز نیست.' };

    const transferBatches = [];
    products.forEach(product => (Array.isArray(product && product.batches) ? product.batches : []).forEach(batch => {
      if (batch && String(batch.sourceType || '') === 'warehouse_transfer' && String(batch.sourceRef || '') === id) {
        transferBatches.push({ product, batch });
      }
    }));
    const fifo = String(state.costingMethod || '').toUpperCase() === 'FIFO';
    const fifoRestores = [];
    if (fifo) {
      if (!transferBatches.length || transferBatches.some(item => String(item.product.id) !== String(destination.product.id))) {
        return { ok: false, reason: 'بچ‌های انتقال FIFO ناقص‌اند یا خارج از انبار مقصد پیدا شده‌اند.' };
      }
      let batchTotal = 0;
      const grouped = new Map();
      for (const item of transferBatches) {
        const batch = item.batch;
        const qty = Number(batch.quantity), remaining = Number(batch.remainingQty);
        const sourceBatchId = String(batch.sourceBatchId || '');
        if (!batch.id || !sourceBatchId || !Number.isFinite(qty) || qty <= 0 ||
            !Number.isFinite(remaining) || Math.abs(remaining - qty) > 0.000001) {
          return { ok: false, reason: 'حداقل یک بچ مقصد مصرف یا دست‌کاری شده است؛ برگشت FIFO مسدود شد.' };
        }
        if (products.some(product => (Array.isArray(product && product.batches) ? product.batches : []).some(child =>
          child && String(child.sourceBatchId || '') === String(batch.id)
        ))) return { ok: false, reason: 'از بچ انتقالی در عملیات بعدی استفاده شده است؛ برگشت FIFO مسدود شد.' };
        const sourceBatch = (Array.isArray(source.product.batches) ? source.product.batches : [])
          .find(candidate => candidate && String(candidate.id) === sourceBatchId);
        if (!sourceBatch || !Number.isFinite(Number(sourceBatch.quantity)) ||
            !Number.isFinite(Number(sourceBatch.remainingQty)) ||
            Number(sourceBatch.remainingQty) < 0 ||
            Number(sourceBatch.remainingQty) + qty > Number(sourceBatch.quantity) + 0.000001) {
          return { ok: false, reason: 'بچ مبدأ برای بازیابی دقیق مقدار اولیه معتبر نیست.' };
        }
        const previous = grouped.get(sourceBatchId) || { quantity: 0, batch: sourceBatch };
        previous.quantity += qty;
        grouped.set(sourceBatchId, previous);
        batchTotal += qty;
        fifoRestores.push({ sourceBatchId, destinationBatchId: String(batch.id), quantity: qty });
      }
      if (Math.abs(batchTotal - quantity) > 0.000001) {
        return { ok: false, reason: 'جمع بچ‌های انتقال با مقدار حواله برابر نیست.' };
      }
      for (const entry of grouped.values()) {
        if (Number(entry.batch.remainingQty) + entry.quantity > Number(entry.batch.quantity) + 0.000001) {
          return { ok: false, reason: 'جمع تخصیص بچ‌ها از مقدار قابل بازیابی بچ مبدأ بیشتر است.' };
        }
      }
    } else if (transferBatches.length) {
      return { ok: false, reason: 'بچ‌های انتقال ثبت شده‌اند اما روش قیمت‌گذاری فعلی FIFO نیست؛ بررسی دستی لازم است.' };
    }

    return {
      ok: true,
      transferId: id,
      quantity,
      date: String(source.movement.date || ''),
      sourceProductId: String(source.product.id),
      destinationProductId: String(destination.product.id),
      sourceWarehouseId: String(source.product.warehouseId),
      destinationWarehouseId: String(destination.product.warehouseId),
      sourceMovementIndex: source.index,
      destinationMovementIndex: destination.index,
      fifo,
      fifoRestores
    };
  }

  root.HolooWarehouseAudit = { getWarehouseMovementAuditView, escapeAuditText, buildWarehouseTransferReversalPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HolooWarehouseAudit;
})(typeof globalThis !== 'undefined' ? globalThis : this);
