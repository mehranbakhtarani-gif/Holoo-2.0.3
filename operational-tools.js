/* Operational printing, barcode and report export enhancements.
 * Loaded after the main Holoo application so these functions replace legacy handlers.
 */
const CODE39_PATTERNS = {
  '0':'111221211','1':'211211112','2':'112211112','3':'212211111','4':'111221112',
  '5':'211221111','6':'112221111','7':'111211212','8':'211211211','9':'112211211',
  'A':'211112112','B':'112112112','C':'212112111','D':'111122112','E':'211122111',
  'F':'112122111','G':'111112212','H':'211112211','I':'112112211','J':'111122211',
  'K':'211111122','L':'112111122','M':'212111121','N':'111121122','O':'211121121',
  'P':'112121121','Q':'111111222','R':'211111221','S':'112111221','T':'111121221',
  'U':'221111112','V':'122111112','W':'222111111','X':'121121112','Y':'221121111',
  'Z':'122121111','-':'121111212','.':'221111211',' ':'122111211','$':'121212111',
  '/':'121211121','+':'121112121','%':'111212121','*':'121121211'
};

function buildCode39Svg(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw || !/^[0-9A-Z. $/+%-]+$/.test(raw)) return '';
  const encoded = '*' + raw + '*';
  const unit = 2, height = 54, interCharacterGap = 2;
  let x = 0, bars = '';
  for (let ci = 0; ci < encoded.length; ci++) {
    const pattern = CODE39_PATTERNS[encoded[ci]];
    if (!pattern) return '';
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]) * unit;
      if (i % 2 === 0) bars += '<rect x="' + x + '" y="0" width="' + width + '" height="' + height + '" />';
      x += width;
    }
    if (ci < encoded.length - 1) x += interCharacterGap;
  }
  return '<svg role="img" aria-label="Code 39 barcode ' + escapeBankReconcileText(raw) +
    '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + x + ' ' + height +
    '" width="100%" height="54"><rect width="' + x + '" height="' + height +
    '" fill="#fff"/><g fill="#111827">' + bars + '</g></svg>';
}

function printBarcodeLabel(id) {
  const product = (state.products || []).find(item => String(item.id) === String(id));
  if (!product) return;
  const safe = escapeBankReconcileText;
  const barcodeSvg = buildCode39Svg(product.barcode);
  document.getElementById('print-title').textContent = 'چاپ لیبل مشخصات کالا و بارکد Code 39';
  document.getElementById('print-area').innerHTML =
    '<div class="max-w-xs mx-auto border-2 border-dashed border-slate-800 p-3 rounded-xl text-center space-y-1.5">' +
      '<div class="font-black text-sm">' + safe(product.name) + '</div>' +
      '<div class="text-[11px] font-bold">' + safe([product.yarnType, product.denier, product.color, product.twist].filter(Boolean).join(' | ')) + '</div>' +
      '<div class="w-full mx-auto">' + (barcodeSvg || '<div class="text-[10px] text-rose-700">بارکد فقط از حروف لاتین بزرگ، اعداد و علائم استاندارد Code 39 پشتیبانی می‌کند.</div>') + '</div>' +
      '<div class="font-mono text-[11px]">' + safe(product.barcode) + ' | LOT: ' + safe(product.lot) + '</div>' +
      '<div class="font-black text-holoo-900">وزن کارتن: ' + faNum(product.cartonKg) + ' KG</div>' +
    '</div>';
  openModal('modal-print-preview');
}

function printOfficialInvoice(invId) {
  const invoice = (state.invoices || []).find(item => String(item.id) === String(invId));
  if (!invoice) return;
  const settings = state.settings || {};
  const safe = escapeBankReconcileText;
  const isPos = settings.invTemplate === 'POS80';
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  document.getElementById('print-title').textContent =
    'صورتحساب رسمی #' + faNum(invoice.id) + ' (' + safe(settings.invTemplate || 'A4') + ')';
  const itemRows = items.map(item =>
    '<tr><td class="border p-1.5">' + safe(item.name) + '</td>' +
    '<td class="border p-1.5 tabular-nums">' + faNum(item.kg) + '</td>' +
    '<td class="border p-1.5 tabular-nums">' + faNum(item.cartons) + '</td>' +
    '<td class="border p-1.5 tabular-nums">' + money(item.price, false) + '</td>' +
    '<td class="border p-1.5 font-bold tabular-nums">' + money(item.total, false) + '</td></tr>'
  ).join('');
  document.getElementById('print-area').innerHTML =
    '<div class="' + (isPos ? 'max-w-xs mx-auto' : '') + ' space-y-2 text-[11px]">' +
      '<div class="bg-holoo-900 text-white p-3 rounded-xl flex justify-between items-center">' +
        '<div><div class="font-black text-sm">' + safe(settings.companyName || '') + '</div>' +
        '<div>کد اقتصادی: ' + faNum(settings.ecoCode) + ' | تلفن: ' + faNum(settings.phone) + '</div>' +
        '<div>' + safe(settings.address || '') + '</div></div>' +
        '<div class="text-left"><div>شماره: <strong>' + faNum(invoice.id) + '</strong></div>' +
        '<div>تاریخ: <strong>' + faNum(invoice.date) + '</strong></div></div>' +
      '</div>' +
      '<div class="p-2 bg-slate-100 rounded-lg border"><strong>خریدار / طرف حساب:</strong> ' +
        safe(getPartyName(invoice.partyId)) + ' | سررسید: ' + faNum(invoice.dueDate) + '</div>' +
      '<table class="w-full border-collapse border text-right"><thead><tr class="bg-slate-200">' +
        '<th class="border p-1.5">شرح کالا</th><th class="border p-1.5">وزن (KG)</th>' +
        '<th class="border p-1.5">کارتن</th><th class="border p-1.5">فی</th><th class="border p-1.5">مبلغ کل</th>' +
      '</tr></thead><tbody>' + itemRows + '</tbody></table>' +
      '<div class="p-2.5 bg-slate-50 border rounded-lg space-y-1">' +
        '<div class="flex justify-between"><span>جمع ناخالص:</span><strong>' + money(invoice.subtotal) + '</strong></div>' +
        '<div class="flex justify-between text-rose-700"><span>تخفیف:</span><strong>' + money(invoice.discount || 0) + '</strong></div>' +
        '<div class="flex justify-between"><span>جمع پس از تخفیف:</span><strong>' + money(invoice.netSubtotal ?? invoice.subtotal) + '</strong></div>' +
        '<div class="flex justify-between"><span>مالیات ارزش افزوده (' + faNum(invoice.vatRate) + '٪):</span><strong>' + money(invoice.vatAmount) + '</strong></div>' +
        '<div class="flex justify-between font-black text-sm text-holoo-900 border-t pt-1"><span>مبلغ قابل پرداخت:</span><span>' + money(invoice.grandTotal) + '</span></div>' +
      '</div>' +
      (settings.footerNote ? '<div class="text-[10px] text-slate-600">' + safe(settings.footerNote) + '</div>' : '') +
      (settings.showSig ? '<div class="grid grid-cols-2 text-center pt-4 text-slate-500"><div>مهر و امضای فروشنده</div><div>مهر و امضای خریدار</div></div>' : '') +
    '</div>';
  openModal('modal-print-preview');
}

function getOperationalReportRows(type) {
  const party = id => getPartyName(id);
  if (type === 'products') return {
    headers:['کد','نام کالا','نوع نخ','دنیر','رنگ','موجودی KG','بهای خرید'],
    rows:(state.products || []).map(p=>[p.id,p.name,p.yarnType,p.denier,p.color,p.stock,p.buyPrice])
  };
  if (type === 'invoices') return {
    headers:['شماره','نوع','تاریخ','طرف حساب','مبلغ نهایی'],
    rows:(state.invoices || []).map(i=>[i.id,i.type,i.date,party(i.partyId),i.grandTotal])
  };
  if (type === 'imports') return {
    headers:['شناسه محموله','کانتینر','مرحله','ارز','مبلغ ارزی','پرداخت ارزی','بهای تمام‌شده هر KG'],
    rows:(state.imports || []).map(m=>[m.id,m.containerNo,m.stage || m.status,m.currency,m.fxTotal,m.fxPaid,m.landedCostPerKg])
  };
  if (type === 'checks') return {
    headers:['شناسه صیادی','بانک','سررسید','مبلغ','وضعیت'],
    rows:(state.checks || []).map(c=>[c.sayad,c.bank,c.dueDate,c.amount,c.status])
  };
  if (type === 'guarantees') return {
    headers:['نوع','جهت','مرجع','طرف حساب','مبلغ','تاریخ صدور','تاریخ انقضا','وضعیت'],
    rows:(state.guarantees || []).map(g=>[g.kind,g.direction,g.reference,party(g.partyId),g.amount,g.issueDate,g.expiryDate,g.status])
  };
  if (type === 'payableCommitments') return {
    headers:['شرح تعهد','مرجع','طرف حساب','مبلغ','سررسید','وضعیت'],
    rows:(state.payableCommitments || []).map(c=>[c.title,c.reference,party(c.partyId),c.amount,c.dueDate,c.status])
  };
  if (type === 'payrollRuns') return {
    headers:['دوره','مبلغ خالص','هزینه کارفرما','شناسه سند'],
    rows:(state.payrollRuns || []).map(p=>[p.period,p.netTotal,p.expenseTotal,p.voucherId])
  };
  if (type === 'fixedAssets') return {
    headers:['شناسه','نام دارایی','تاریخ تحصیل','بهای تمام‌شده','استهلاک انباشته','عمر مفید (سال)'],
    rows:(state.fixedAssets || []).map(a=>[a.id,a.name,a.date || a.acquisitionDate,a.cost,a.accDep,a.lifeYears])
  };
  return {headers:[],rows:[]};
}

function reportTableHtml(headers, rows) {
  const safe = escapeBankReconcileText;
  return '<table class="w-full text-right border-collapse"><thead><tr class="bg-slate-100">' +
    headers.map(header=>'<th class="p-2">'+safe(header)+'</th>').join('') +
    '</tr></thead><tbody>' +
    rows.map(row=>'<tr class="border-t">'+row.map(cell=>'<td class="p-2">'+safe(cell)+'</td>').join('')+'</tr>').join('') +
    '</tbody></table>';
}

function runCustomReportBuilder() {
  const source = document.getElementById('rep-builder-source')?.value || 'products';
  const box = document.getElementById('rep-builder-table');
  if (!box) return;
  const report = getOperationalReportRows(source);
  box.innerHTML = report.headers.length
    ? reportTableHtml(report.headers, report.rows)
    : '<p class="p-3 text-xs text-slate-400">برای این منبع داده‌ای وجود ندارد.</p>';
}

function exportCustomReportCSV() {
  const source = document.getElementById('rep-builder-source')?.value || 'products';
  exportTableCSV(source);
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
}

function exportTableCSV(type) {
  const report = getOperationalReportRows(type);
  if (!report.headers.length) {
    showToast('نوع گزارش برای خروجی CSV پشتیبانی نمی‌شود.', 'error');
    return;
  }
  const csv = '\uFEFF' + [report.headers, ...report.rows]
    .map(row=>row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'Holoo_' + type + '_' + state.fiscalYear + '.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  showToast('فایل CSV با قالب امن و سازگار با Excel دانلود شد 📊');
}

// Refresh the visible custom report if the settings module was rendered before this file loaded.
if (typeof document !== 'undefined' && document.getElementById('rep-builder-source')) {
  runCustomReportBuilder();
}
