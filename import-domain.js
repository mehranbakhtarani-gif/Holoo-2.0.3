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
        result.forEach((item, index) => { item.allocatedExpenses[key] = Math.round(weights[index]); });
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

  const api = { normalizeItems, allocateImportExpenses, calculateLandedCost, calculateShipmentProfit };
  root.HolooImportDomain = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
