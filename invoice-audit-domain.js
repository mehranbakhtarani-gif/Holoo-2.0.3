(function (root) {
  'use strict';

  const TOLERANCE = 0.01;
  const finite = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
  const amount = value => finite(value) ? Number(value) : 0;
  const close = (a, b) => Math.abs(amount(a) - amount(b)) <= TOLERANCE;
  const key = value => String(value ?? '');
  const addFinding = (findings, invoice, severity, code, message) => {
    findings.push({
      invoiceId: invoice?.id ?? '—',
      invoiceType: invoice?.type || 'unknown',
      severity, code, message
    });
  };
  const sum = (items, selector) => items.reduce((total, item) => total + amount(selector(item)), 0);

  function auditInvoices(state, options = {}) {
    const source = state && typeof state === 'object' ? state : {};
    const invoices = Array.isArray(source.invoices) ? source.invoices : [];
    const vouchers = Array.isArray(source.vouchers) ? source.vouchers : [];
    const parties = Array.isArray(source.parties) ? source.parties : [];
    const warehouses = Array.isArray(source.warehouses) ? source.warehouses : [];
    const products = Array.isArray(source.products) ? source.products : [];
    const findings = [];
    const seenIds = new Set();

    for (const invoice of invoices) {
      const invoiceId = key(invoice?.id);
      if (!invoice || !invoiceId || invoiceId === 'undefined') {
        addFinding(findings, invoice, 'error', 'invoice-id-missing', 'شناسه فاکتور خالی یا نامعتبر است.');
      } else if (seenIds.has(invoiceId)) {
        addFinding(findings, invoice, 'error', 'invoice-id-duplicate', 'شناسه فاکتور تکراری است.');
      } else {
        seenIds.add(invoiceId);
      }

      if (!['sale', 'purchase'].includes(invoice?.type)) {
        addFinding(findings, invoice, 'error', 'invoice-type-invalid', 'نوع فاکتور خرید یا فروش معتبر نیست.');
      }
      const dateOrdinal = typeof options.dateOrdinal === 'function'
        ? options.dateOrdinal(invoice?.date)
        : (/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(String(invoice?.date || '')) ? 1 : null);
      if (dateOrdinal === null || dateOrdinal === undefined) {
        addFinding(findings, invoice, 'error', 'invoice-date-invalid', 'تاریخ فاکتور معتبر نیست.');
      }
      if (invoice?.dueDate) {
        const dueOrdinal = typeof options.dateOrdinal === 'function'
          ? options.dateOrdinal(invoice.dueDate)
          : (/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(String(invoice.dueDate)) ? 1 : null);
        if (dueOrdinal === null || dueOrdinal === undefined ||
            (dateOrdinal !== null && dateOrdinal !== undefined && dueOrdinal < dateOrdinal)) {
          addFinding(findings, invoice, 'warning', 'invoice-due-date-invalid', 'تاریخ سررسید نامعتبر یا قبل از تاریخ فاکتور است.');
        }
      }

      if (!parties.some(party => key(party?.id) === key(invoice?.partyId))) {
        addFinding(findings, invoice, 'error', 'party-missing', 'طرف‌حساب متصل به فاکتور در فهرست اشخاص پیدا نشد.');
      }
      if (!warehouses.some(warehouse => key(warehouse?.id) === key(invoice?.warehouseId))) {
        addFinding(findings, invoice, 'warning', 'warehouse-missing', 'انبار ثبت‌شده روی فاکتور در فهرست انبارها پیدا نشد.');
      }

      const lines = Array.isArray(invoice?.items) ? invoice.items : [];
      if (!lines.length) {
        addFinding(findings, invoice, 'error', 'invoice-lines-missing', 'فاکتور فاقد ردیف کالا است.');
      }
      let gross = 0, net = 0, discount = 0;
      const expectedQtyByProduct = new Map();
      for (const [index, line] of lines.entries()) {
        const qtyValid = finite(line?.kg);
        const priceValid = finite(line?.price);
        const totalValid = finite(line?.total);
        const qty = qtyValid ? Number(line.kg) : NaN;
        const price = priceValid ? Number(line.price) : NaN;
        const lineDiscount = Number(line?.disc ?? 0);
        const lineTotal = totalValid ? Number(line.total) : NaN;
        const lineGross = qty * price;
        const valid = qtyValid && qty > 0 &&
          priceValid && price >= 0 &&
          Number.isFinite(lineDiscount) && lineDiscount >= 0 && lineDiscount <= lineGross &&
          totalValid && lineTotal >= 0 &&
          close(lineTotal, Math.max(0, lineGross - lineDiscount));
        if (!valid) {
          addFinding(findings, invoice, 'error', 'invoice-line-invalid', 'ردیف ' + (index + 1) + ': مقدار، قیمت، تخفیف یا مبلغ ردیف ناسازگار است.');
        }
        gross += Number.isFinite(lineGross) ? lineGross : 0;
        net += Number.isFinite(lineTotal) ? lineTotal : 0;
        discount += Number.isFinite(lineDiscount) ? lineDiscount : 0;
        if (line?.productId !== undefined && line?.productId !== null) {
          const productId = key(line.productId);
          expectedQtyByProduct.set(productId, (expectedQtyByProduct.get(productId) || 0) + (Number.isFinite(qty) ? qty : 0));
        }
      }

      const vatRate = Number(invoice?.vatRate ?? 0);
      const expectedVat = Math.round(net * (vatRate / 100));
      const expectedGrand = net + expectedVat;
      const totals = [
        ['subtotal', gross, 'جمع ناخالص فاکتور با ردیف‌های کالا مغایرت دارد.'],
        ['netSubtotal', net, 'جمع خالص فاکتور با ردیف‌های کالا مغایرت دارد.'],
        ['discount', discount, 'جمع تخفیف فاکتور با ردیف‌های کالا مغایرت دارد.'],
        ['vatAmount', expectedVat, 'مبلغ مالیات و عوارض با نرخ ثبت‌شده و جمع خالص فاکتور مغایرت دارد.'],
        ['grandTotal', expectedGrand, 'مبلغ نهایی فاکتور با جمع خالص و مالیات مغایرت دارد.']
      ];
      for (const [field, expected, message] of totals) {
        if (!finite(invoice?.[field]) || !close(invoice[field], expected)) {
          addFinding(findings, invoice, 'error', 'invoice-' + field + '-mismatch', message);
        }
      }
      if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
        addFinding(findings, invoice, 'error', 'vat-rate-invalid', 'نرخ مالیات خارج از بازه معتبر است.');
      }

      const linkedVouchers = vouchers.filter(voucher =>
        voucher?.sourceType === 'invoice' && key(voucher?.sourceId) === invoiceId
      );
      if (!linkedVouchers.length) {
        addFinding(findings, invoice, 'error', 'journal-missing', 'سند حسابداری متناظر فاکتور پیدا نشد.');
      } else if (linkedVouchers.length > 1) {
        addFinding(findings, invoice, 'error', 'journal-duplicate', 'بیش از یک سند حسابداری به این فاکتور متصل است.');
      } else {
        const voucher = linkedVouchers[0];
        if (invoice?.voucherId === undefined || invoice?.voucherId === null || String(invoice.voucherId).trim() === '') {
          addFinding(findings, invoice, 'warning', 'journal-backlink-missing', 'شناسه سند حسابداری در خود فاکتور ثبت نشده است؛ پیوند دوطرفه کامل نیست.');
        } else if (String(invoice.voucherId) !== String(voucher.id)) {
          addFinding(findings, invoice, 'error', 'journal-backlink-mismatch', 'شناسه سند ثبت‌شده در فاکتور با سند متصل به همان فاکتور یکسان نیست.');
        }
        const voucherLines = Array.isArray(voucher.lines) ? voucher.lines : [];
        if (!voucherLines.length) {
          addFinding(findings, invoice, 'error', 'journal-lines-missing', 'سند حسابداری فاکتور فاقد ردیف است.');
        }
        const debit = sum(voucherLines, line => line?.debit);
        const credit = sum(voucherLines, line => line?.credit);
        if (!close(debit, credit)) {
          addFinding(findings, invoice, 'error', 'journal-unbalanced', 'جمع بدهکار و بستانکار سند فاکتور برابر نیست.');
        }
        if (String(voucher.date || '') !== String(invoice.date || '')) {
          addFinding(findings, invoice, 'warning', 'journal-date-mismatch', 'تاریخ سند حسابداری با تاریخ فاکتور یکسان نیست.');
        }
        const accountTotals = new Map();
        for (const line of voucherLines) {
          const code = key(line?.code);
          const current = accountTotals.get(code) || { debit: 0, credit: 0 };
          current.debit += amount(line?.debit);
          current.credit += amount(line?.credit);
          accountTotals.set(code, current);
        }
        const expectedAccounts = [];
        if (invoice.type === 'sale') {
          const debitCode = invoice.payMethod === 'credit' ? '1103' : (invoice.payMethod === 'bank' ? '1102' : '1101');
          const cogs = sum(lines, line => line?.costOfGoodsSold);
          expectedAccounts.push([debitCode, 'debit', expectedGrand, 'حساب دریافتنی/صندوق/بانک فاکتور فروش با مبلغ نهایی مغایرت دارد.']);
          expectedAccounts.push(['4101', 'credit', net, 'درآمد فروش با جمع خالص فاکتور مغایرت دارد.']);
          expectedAccounts.push(['2103', 'credit', expectedVat, 'مالیات فروش در سند حسابداری با مبلغ محاسبه‌شده مغایرت دارد.']);
          expectedAccounts.push(['5101', 'debit', cogs, 'بهای تمام‌شده فروش در سند با ردیف‌های فاکتور مغایرت دارد.']);
          expectedAccounts.push(['1105', 'credit', cogs, 'خروج حساب کنترل موجودی با بهای تمام‌شده فروش مغایرت دارد.']);
          if (amount(invoice.commAmount) > 0) {
            expectedAccounts.push(['6101', 'debit', amount(invoice.commAmount), 'هزینه پورسانت با مبلغ فاکتور مغایرت دارد.']);
            expectedAccounts.push(['2101', 'credit', amount(invoice.commAmount), 'بدهی پورسانت با مبلغ فاکتور مغایرت دارد.']);
          }
          const receivableLine = voucherLines.find(line => key(line?.code) === debitCode && amount(line?.debit) > 0);
          if (!receivableLine || key(receivableLine.partyId) !== key(invoice.partyId)) {
            addFinding(findings, invoice, 'warning', 'party-ledger-link-mismatch', 'ردیف بدهکار فاکتور فروش به همان طرف‌حساب متصل نیست.');
          }
        } else if (invoice.type === 'purchase') {
          const creditCode = invoice.payMethod === 'credit' ? '2101' : (invoice.payMethod === 'bank' ? '1102' : '1101');
          expectedAccounts.push(['1105', 'debit', net, 'ورود موجودی در حساب کنترل ۱۱۰۵ با جمع خالص خرید مغایرت دارد.']);
          expectedAccounts.push(['1106', 'debit', expectedVat, 'اعتبار مالیات خرید در سند با مبلغ محاسبه‌شده مغایرت دارد.']);
          expectedAccounts.push([creditCode, 'credit', expectedGrand, 'بستانکار حساب طرف‌حساب/صندوق/بانک با مبلغ نهایی خرید مغایرت دارد.']);
          if (invoice.payMethod === 'credit') {
            const payableLine = voucherLines.find(line => key(line?.code) === '2101' && amount(line?.credit) > 0);
            if (!payableLine || key(payableLine.partyId) !== key(invoice.partyId)) {
              addFinding(findings, invoice, 'warning', 'party-ledger-link-mismatch', 'ردیف بستانکار خرید به همان تأمین‌کننده متصل نیست.');
            }
          }
        }
        for (const [code, side, expected, message] of expectedAccounts) {
          const actual = accountTotals.get(code)?.[side] || 0;
          if (!close(actual, expected)) {
            addFinding(findings, invoice, 'error', 'journal-account-mismatch-' + code, message);
          }
        }
      }

      const movementLabel = (invoice.type === 'sale' ? 'فاکتور فروش #' : 'فاکتور خرید #') + invoice.id;
      for (const [productId, expectedQty] of expectedQtyByProduct.entries()) {
        const product = products.find(item => key(item?.id) === productId);
        if (!product) {
          addFinding(findings, invoice, 'warning', 'inventory-product-missing', 'کالای ردیف فاکتور در اطلاعات فعلی انبار پیدا نشد: ' + productId);
          continue;
        }
        const movements = (Array.isArray(product.kardex) ? product.kardex : [])
          .filter(move => String(move?.doc || '') === movementLabel);
        const movedQty = sum(movements, move => invoice.type === 'sale' ? move?.outQty : move?.inQty);
        if (!movements.length || !close(movedQty, expectedQty)) {
          addFinding(findings, invoice, 'warning', 'inventory-movement-mismatch', 'گردش کاردکس با مقدار کالای فاکتور تطبیق ندارد: ' + (product.name || productId));
        }
      }
    }

    const summary = {
      invoicesChecked: invoices.length,
      findings: findings.length,
      errors: findings.filter(item => item.severity === 'error').length,
      warnings: findings.filter(item => item.severity === 'warning').length
    };
    return { summary, findings };
  }

  const api = Object.freeze({ auditInvoices });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HolooInvoiceAudit = api;
})(typeof window !== 'undefined' ? window : globalThis);
