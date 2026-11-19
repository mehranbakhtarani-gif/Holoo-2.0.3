;(function (root) {
  'use strict';

  function number(value, label) {
    const n = value === undefined || value === null || value === '' ? 0 : Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error((label || 'مقدار') + ' باید عددی و نامنفی باشد.');
    return n;
  }

  function normalizeItems(shipment) {
    if (!shipment || typeof shipment !== 'object') return [];
    if (Array.isArray(shipment.items) && shipment.items.length) {
      return shipment.items.map((item, index) => ({
        ...item,
        id: String(item.id || (shipment.id + '-ITEM-' + (index + 1))),
        productId: item.productId,
        quantityKg: number(item.quantityKg ?? item.weightKg ?? item.kg, 'وزن قلم'),
        cartons: number(item.cartons, 'تعداد کارتن'),
        fxAmount: number(item.fxAmount ?? 0, 'مبلغ ارزی قلم'),
        lot: String(item.lot || shipment.lot || shipment.id || ''),
        productionDate: item.productionDate || '',
        expiryDate: item.expiryDate || ''
      }));
    }
    if (!shipment.productId) return [];
    return [{
      id: String(shipment.id || 'LEGACY') + '-ITEM-1',
      productId: shipment.productId,
      quantityKg: number(shipment.weightKg, 'وزن محموله'),
      cartons: number(shipment.cartons, 'تعداد کارتن'),
      fxAmount: number(shipment.fxTotal, 'مبلغ ارزی محموله'),
      lot: String(shipment.lot || shipment.id || ''),
      productionDate: shipment.productionDate || '',
      expiryDate: shipment.expiryDate || ''
    }];
  }

  function allocateImportExpenses(items, expenses, bases, manualAllocations) {
    if (!Array.isArray(items) || !items.length) throw new Error('محموله باید حداقل یک قلم کالا داشته باشد.');
    const result = items.map(item => ({ ...item, allocatedExpenses: {} }));
    const keys = Object.keys(expenses || {});
    const totals = {};
    for (const key of keys) {
      const amount = number(expenses[key], 'هزینه ' + key);
      totals[key] = amount;
      if (amount === 0) {
        result.forEach(item => { item.allocatedExpenses[key] = 0; });
        continue;
      }
      const basis = (bases || {})[key] || 'weight';
      let weights;
      if (basis === 'manual') {
        const allocation = (manualAllocations || {})[key] || {};
        weights = result.map(item => number(allocation[item.id] || 0, 'تخصیص دستی ' + key));
        const sum = weights.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - amount) > 0.01) throw new Error('جمع تخصیص دستی هزینه ' + key + ' باید دقیقاً برابر مبلغ هزینه باشد.');
        // Manual shares are explicit amounts, not weights; preserve them exactly so rounding cannot change the entered total.
        result.forEach((item, index) => { item.allocatedExpenses[key] = weights[index]; });
        continue;
      }
      if (basis === 'weight') weights = result.map(item => number(item.quantityKg, 'وزن قلم'));
      else if (basis === 'cartons') weights = result.map(item => number(item.cartons, 'کارتن قلم'));
      else if (basis === 'value') weights = result.map(item => number(item.fxAmount, 'ارزش ارزی قلم'));
      else throw new Error('مبنای تخصیص هزینه ' + key + ' معتبر نیست.');
      const denominator = weights.reduce((a, b) => a + b, 0);
      if (denominator <= 0) throw new Error('مبنای تخصیص هزینه ' + key + ' صفر است.');
      let allocated = 0;
      result.forEach((item, index) => {
        const share = index === result.length - 1
          ? amount - allocated
          : Math.round(amount * weights[index] / denominator);
        item.allocatedExpenses[key] = share;
        allocated += share;
      });
    }
    return { items: result, expenseTotals: totals };
  }

  function calculateLandedCost(items, fxRate, expenses, bases, manualAllocations) {
    const rate = Number(fxRate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('نرخ ارز باید بزرگ‌تر از صفر باشد.');
    if (!Array.isArray(items) || !items.length) throw new Error('محموله باید حداقل یک قلم کالا داشته باشد.');
    const seen = new Set();
    const prepared = items.map((item, index) => {
      const id = String(item.id || ('ITEM-' + (index + 1)));
      if (seen.has(id)) throw new Error('شناسه اقلام محموله تکراری است.');
      seen.add(id);
      const quantityKg = number(item.quantityKg ?? item.weightKg ?? item.kg, 'وزن قلم');
      if (!item.productId || quantityKg <= 0) throw new Error('کالا و وزن مثبت برای هر قلم الزامی است.');
      return { ...item, id, quantityKg, cartons: number(item.cartons, 'تعداد کارتن'), fxAmount: number(item.fxAmount, 'مبلغ ارزی قلم') };
    });
    const fxTotal = prepared.reduce((sum, item) => sum + item.fxAmount, 0);
    if (fxTotal <= 0) throw new Error('جمع مبلغ ارزی اقلام باید بزرگ‌تر از صفر باشد.');
    const allocation = allocateImportExpenses(prepared, expenses || {}, bases || {}, manualAllocations || {});
    const costedItems = allocation.items.map(item => {
      const purchaseRial = Math.round(item.fxAmount * rate);
      const allocatedExpenseRial = Object.values(item.allocatedExpenses).reduce((sum, value) => sum + value, 0);
      const landedCostRial = purchaseRial + allocatedExpenseRial;
      return {
        ...item,
        purchaseRial,
        allocatedExpenseRial,
        landedCostRial,
        unitCost: landedCostRial / item.quantityKg,
        landedCostPerKg: Math.round(landedCostRial / item.quantityKg)
      };
    });
    return {
      items: costedItems,
      fxTotal,
      totalWeightKg: costedItems.reduce((sum, item) => sum + item.quantityKg, 0),
      totalCartons: costedItems.reduce((sum, item) => sum + item.cartons, 0),
      totalPurchaseRial: costedItems.reduce((sum, item) => sum + item.purchaseRial, 0),
      totalExpenseRial: Object.values(allocation.expenseTotals).reduce((sum, value) => sum + value, 0),
      totalLandedRial: costedItems.reduce((sum, item) => sum + item.landedCostRial, 0),
      expenseTotals: allocation.expenseTotals
    };
  }

  function calculateShipmentProfit(shipment, products, invoices, currentRates) {
    const items = normalizeItems(shipment);
    const itemTotals = new Map(items.map(item => [item.id, {
      itemId: item.id, productId: item.productId, quantityKg: item.quantityKg,
      soldKg: 0, returnedKg: 0, revenue: 0, cogs: 0, grossProfit: 0
    }]));
    const productByBatch = new Map();
    (products || []).forEach(product => (product.batches || []).forEach(batch => {
      productByBatch.set(String(batch.id), { product, batch });
    }));
    let untraceableSales = 0;
    for (const invoice of invoices || []) {
      if (invoice.type !== 'sale' || invoice.status === 'cancelled') continue;
      for (const line of invoice.items || []) {
        const allocations = Array.isArray(line.fifoAllocations) ? line.fifoAllocations : [];
        if (!(Number(line.kg) > 0)) continue;
        if (!allocations.length) {
          if (items.some(item => String(item.productId) === String(line.productId))) untraceableSales += Math.max(0, Number(line.kg) - Number(line.returnedKg || 0));
          continue;
        }
        const netQty = Math.max(0, Number(line.kg) - Number(line.returnedKg || 0));
        if (netQty <= 0) continue;
        const returnedByBatch = new Map();
        (line.fifoReturnedAllocations || []).forEach(entry => {
          returnedByBatch.set(String(entry.batchId), (returnedByBatch.get(String(entry.batchId)) || 0) + Number(entry.quantity || 0));
        });
        let unallocatedReturn = Math.max(0, Number(line.returnedKg || 0) - [...returnedByBatch.values()].reduce((sum, value) => sum + value, 0));
        const remainingAllocations = allocations.map(allocation => {
          const originalQty = Math.max(0, Number(allocation.quantity || 0));
          const explicitReturn = Math.min(originalQty, returnedByBatch.get(String(allocation.batchId)) || 0);
          const inferredReturn = Math.min(Math.max(0, originalQty - explicitReturn), unallocatedReturn);
          unallocatedReturn -= inferredReturn;
          const returnedQuantity = explicitReturn + inferredReturn;
          return { ...allocation, returnedQuantity, quantity: Math.max(0, originalQty - returnedQuantity) };
        }).filter(allocation => allocation.quantity > 0 || allocation.returnedQuantity > 0);
        const remainingTotal = remainingAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
        if (remainingTotal <= 0) continue;
        const revenue = Number(line.total ?? (Number(line.kg) * Number(line.price || 0))) * (netQty / Number(line.kg));
        const cogs = Number(line.costOfGoodsSold || 0) * (netQty / Number(line.kg));
        const fifoCostFromAllocations = remainingAllocations.reduce((sum, allocation) => sum + allocation.quantity * Number(allocation.unitCost || 0), 0);
        const inferredFifo = line.costingMethod === 'FIFO' || (!line.costingMethod && Math.abs(fifoCostFromAllocations - cogs) < 1);
        for (const allocation of remainingAllocations) {
          const batchInfo = productByBatch.get(String(allocation.batchId));
          if (!batchInfo) { untraceableSales += allocation.quantity; continue; }
          if (String(batchInfo.batch.sourceRef) !== String(shipment.id)) continue;
          const sourceItemId = batchInfo.batch.sourceItemId ? String(batchInfo.batch.sourceItemId) : null;
          let target = sourceItemId ? itemTotals.get(sourceItemId) : null;
          if (!target) target = [...itemTotals.values()].find(item => String(item.productId) === String(batchInfo.product.id));
          if (!target) continue;
          const share = allocation.quantity / remainingTotal;
          target.soldKg += allocation.quantity;
          target.returnedKg += allocation.returnedQuantity;
          target.revenue += revenue * share;
          target.cogs += inferredFifo ? allocation.quantity * Number(allocation.unitCost || 0) : cogs * share;
        }
      }
    }
    const rows = [...itemTotals.values()].map(item => ({
      ...item,
      revenue: Math.round(item.revenue),
      cogs: Math.round(item.cogs),
      grossProfit: Math.round(item.revenue - item.cogs)
    }));
    const realizedFx = (shipment.fxPayments || []).reduce((sum, payment) => sum + Number(payment.realizedDiff || 0), 0);
    const postedRevaluationFx = (shipment.revaluationHistory || []).reduce((sum, entry) => sum + Number(entry.difference || 0), 0);
    const remainingFx = Math.max(0, Number(shipment.fxTotal || 0) - Number(shipment.fxPaid || 0));
    const currentRate = Number((currentRates || {})[shipment.currency] || shipment.fxRate || 0);
    const unrealizedFx = (Number(shipment.carryingRate || shipment.fxRate || 0) - currentRate) * remainingFx;
    const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    const cogs = rows.reduce((sum, row) => sum + row.cogs, 0);
    return {
      items: rows, revenue, cogs, grossProfit: revenue - cogs,
      realizedFx: Math.round(realizedFx) || 0, postedRevaluationFx: Math.round(postedRevaluationFx) || 0,
      unrealizedFx: Math.round(unrealizedFx) || 0,
      profitAfterRealizedFx: Math.round(revenue - cogs + realizedFx) || 0,
      profitAfterPostedFx: Math.round(revenue - cogs + realizedFx + postedRevaluationFx) || 0,
      untraceableSalesKg: Math.round(untraceableSales * 1000) / 1000
    };
  }

  function createReceiptSnapshot(shipment, products, metadata = {}) {
    if (!shipment || !shipment.id) throw new Error('شناسه محموله برای snapshot رسید الزامی است.');
    if (metadata.schemaVersion !== undefined && Number(metadata.schemaVersion) !== 1) {
      throw new Error('نسخه snapshot رسید پشتیبانی نمی‌شود.');
    }
    const items = normalizeItems(shipment);
    if (!items.length) throw new Error('اقلام محموله برای snapshot رسید موجود نیست.');
    const productById = new Map((products || []).map(product => [String(product.id), product]));
    const productStates = new Map();
    for (const item of items) {
      const productId = String(item.productId || '');
      const product = productById.get(productId);
      if (!product) throw new Error('کالای ' + productId + ' برای snapshot رسید پیدا نشد.');
      if (!productStates.has(productId)) {
        // Persist the complete pre-receipt product state so a future audited
        // compensation can restore stock, weighted-average cost, Kardex and batches.
        productStates.set(productId, {
          productId,
          state: JSON.parse(JSON.stringify(product))
        });
      }
    }
    return {
      schemaVersion: 1,
      snapshotId: String(metadata.snapshotId || ''),
      shipmentId: String(shipment.id),
      capturedAt: String(metadata.capturedAt || new Date().toISOString()),
      receivedDate: String(metadata.receivedDate || ''),
      previousStatus: String(metadata.previousStatus || ''),
      actor: String(metadata.actor || ''),
      deviceId: String(metadata.deviceId || ''),
      costingMethod: String(metadata.costingMethod || ''),
      items: JSON.parse(JSON.stringify(items)),
      products: [...productStates.values()]
    };
  }

  function getReceiptReversalBlockReason(shipment, products, invoices, vouchers) {
    if (!shipment) return 'محموله وارداتی پیدا نشد.';
    if (!shipment.postedToWh) return 'رسید این محموله در حال حاضر به انبار ثبت نشده است.';
    const snapshot = shipment.receiptSnapshot;
    if (!snapshot || Number(snapshot.schemaVersion) !== 1 || String(snapshot.shipmentId) !== String(shipment.id) || !snapshot.snapshotId) {
      return 'snapshot معتبر و نسخه‌دار پیش از رسید برای این محموله وجود ندارد؛ رسیدهای قدیمی قابل برگشت خودکار نیستند.';
    }
    const registrationVoucher = (vouchers || []).find(voucher =>
      voucher.sourceType === 'import' &&
      String(voucher.sourceId) === String(shipment.id) &&
      (voucher.sourceEvent || 'default') === 'registration'
    );
    if (!registrationVoucher) return 'سند ثبت مالی محموله پیدا نشد؛ برگشت فیزیکی رسید بدون تطبیق سند مجاز نیست.';
    const items = normalizeItems(shipment);
    if (!items.length || JSON.stringify(items) !== JSON.stringify(snapshot.items || [])) {
      return 'اقلام محموله پس از ثبت رسید تغییر کرده‌اند یا با snapshot تطبیق ندارند.';
    }
    const productById = new Map((products || []).map(product => [String(product.id), product]));
    const snapshotById = new Map((snapshot.products || []).map(entry => [String(entry.productId), entry]));
    const itemsByProduct = new Map();
    items.forEach(item => {
      const key = String(item.productId);
      if (!itemsByProduct.has(key)) itemsByProduct.set(key, []);
      itemsByProduct.get(key).push(item);
    });
    const snapshotProductIds = (snapshot.products || []).map(entry => String(entry.productId));
    const expectedProductIds = [...itemsByProduct.keys()].sort();
    if (new Set(snapshotProductIds).size !== snapshotProductIds.length ||
        JSON.stringify(snapshotProductIds.slice().sort()) !== JSON.stringify(expectedProductIds)) {
      return 'فهرست کالاهای snapshot با اقلام محموله تطبیق ندارد؛ بازیابی متوقف شد.';
    }
    if (!snapshot.capturedAt || !snapshot.receivedDate || !snapshot.actor || !snapshot.deviceId ||
        !snapshot.costingMethod) {
      return 'اطلاعات هویتی یا زمانی snapshot کامل نیست.';
    }
    const sourceBatchIds = new Set();
    for (const [productId, productItems] of itemsByProduct) {
      const product = productById.get(productId);
      const before = snapshotById.get(productId)?.state;
      if (!product || !before || String(before.id) !== productId) {
        return 'snapshot یا کالای متناظر برای ' + productId + ' کامل نیست.';
      }
      const currentBatches = Array.isArray(product.batches) ? product.batches : [];
      const beforeBatches = Array.isArray(before.batches) ? before.batches : [];
      const currentKardex = Array.isArray(product.kardex) ? product.kardex : [];
      const beforeKardex = Array.isArray(before.kardex) ? before.kardex : [];
      const receiptRows = [];
      let expectedStock = Number(before.stock || 0);
      let expectedBuyPrice = Number(before.buyPrice || 0);
      for (const item of productItems) {
        const qty = Number(item.quantityKg || 0);
        const rows = currentKardex.filter(row =>
          String(row.batchRef || '') === String(shipment.id) &&
          String(row.sourceItemId || '') === String(item.id) &&
          String(row.doc || '').includes(String(shipment.id)) &&
          Number(row.inQty || 0) > 0
        );
        const batches = currentBatches.filter(batch =>
          String(batch.sourceType || '') === 'import' &&
          String(batch.sourceRef || '') === String(shipment.id) &&
          String(batch.sourceItemId || '') === String(item.id)
        );
        if (rows.length !== 1 || batches.length !== 1) {
          return 'ردیف کاردکس یا بچ وارداتی برای قلم ' + item.id + ' یکتا نیست.';
        }
        const batch = batches[0];
        if (Math.abs(Number(rows[0].inQty || 0) - qty) > 0.000001 ||
            Math.abs(Number(batch.quantity || 0) - qty) > 0.000001 ||
            Math.abs(Number(batch.remainingQty || 0) - qty) > 0.000001) {
          return 'بخشی از موجودی قلم ' + item.id + ' مصرف، منتقل یا تغییر داده شده است.';
        }
        sourceBatchIds.add(String(batch.id));
        receiptRows.push(rows[0]);
        const itemCost = Number(item.landedCostRial ?? (qty * Number(item.landedCostPerKg ?? shipment.landedCostPerKg ?? 0)));
        if (snapshot.costingMethod === 'AVG') {
          expectedBuyPrice = Math.round(((expectedStock * expectedBuyPrice) + itemCost) / (expectedStock + qty));
        }
        expectedStock += qty;
      }
      const receiptRowIndexes = receiptRows.map(row => currentKardex.indexOf(row));
      if (receiptRowIndexes.some(index => index < 0)) return 'ردیف کاردکس رسید قابل بازیابی نیست.';
      const firstReceiptIndex = Math.min(...receiptRowIndexes);
      if (firstReceiptIndex !== beforeKardex.length ||
          currentKardex.length !== beforeKardex.length + receiptRows.length ||
          JSON.stringify(currentKardex.slice(0, beforeKardex.length)) !== JSON.stringify(beforeKardex)) {
        return 'پس از رسید، گردش دیگری در کاردکس ثبت شده یا سابقه قبلی تغییر کرده است.';
      }
      if (JSON.stringify(currentBatches.filter(batch => !sourceBatchIds.has(String(batch.id)))) !== JSON.stringify(beforeBatches)) {
        return 'بچ‌های قبلی کالا پس از رسید تغییر کرده‌اند؛ بازیابی snapshot می‌تواند عملیات دیگری را حذف کند.';
      }
      if (Math.abs(Number(product.stock || 0) - expectedStock) > 0.000001 ||
          Math.abs(Number(product.buyPrice || 0) - expectedBuyPrice) > 0.000001 ||
          Number(product.lastMoveDays || 0) !== 0) {
        return 'موجودی یا بهای کالا با اثر مورد انتظار همین رسید تطبیق ندارد.';
      }
    }
    const allBatches = (products || []).flatMap(product =>
      (Array.isArray(product.batches) ? product.batches : []).map(batch => ({ product, batch }))
    );
    const descendants = new Set(sourceBatchIds);
    let grew = true;
    while (grew) {
      grew = false;
      allBatches.forEach(entry => {
        const parentId = String(entry.batch.sourceBatchId || '');
        if (parentId && descendants.has(parentId) && !descendants.has(String(entry.batch.id))) {
          descendants.add(String(entry.batch.id));
          grew = true;
        }
      });
    }
    if (descendants.size !== sourceBatchIds.size) return 'برای بچ‌های رسید، بچ انتقالی وابسته وجود دارد.';
    const invoiceReference = (invoices || []).some(invoice =>
      (invoice.items || []).some(line =>
        [...(line.fifoAllocations || []), ...(line.fifoReturnedAllocations || [])]
          .some(allocation => descendants.has(String(allocation.batchId || '')))
      )
    );
    if (invoiceReference) return 'حداقل یک فاکتور به بچ‌های رسید ارجاع داده است؛ برگشت متوقف شد.';
    if (snapshot.costingMethod !== 'AVG' && snapshot.costingMethod !== 'FIFO') {
      return 'روش قیمت‌گذاری ثبت‌شده در snapshot معتبر نیست.';
    }
    return null;
  }

  const api = { normalizeItems, allocateImportExpenses, calculateLandedCost, calculateShipmentProfit, createReceiptSnapshot, getReceiptReversalBlockReason };
  root.HolooImportDomain = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
