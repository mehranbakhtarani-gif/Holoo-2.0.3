const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: `index.html:inline-${i}` });
}

function sourceOf(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function: ${name}`);
  const ends = [
    html.indexOf('\n    function ', start + 10),
    html.indexOf('\n    async function ', start + 10)
  ].filter(index => index > 0);
  return html.slice(start, ends.length ? Math.min(...ends) : html.length).trim();
}

function createContext({ saveResult = true } = {}) {
  const sandbox = {
    state: {
      fiscalYear: '1404',
      vouchers: [
        { id: 1, date: '1404/01/01', desc: 'فروش', lines: [
          { code: '1103', debit: 1000, credit: 0 },
          { code: '4101', debit: 0, credit: 1000 }
        ] },
        { id: 2, date: '1404/01/02', desc: 'بهای تمام‌شده', lines: [
          { code: '5101', debit: 400, credit: 0 },
          { code: '1105', debit: 0, credit: 400 }
        ] },
        { id: 3, date: '1404/01/03', desc: 'هزینه اداری', lines: [
          { code: '6101', debit: 100, credit: 0 },
          { code: '1101', debit: 0, credit: 100 }
        ] }
      ],
      auditLogs: []
    },
    getTodayJalaliDate() { return '1405/08/28'; },
    saveState() { return saveResult; },
    renderAccountingModule() {}
  };
  sandbox.addAudit = message => sandbox.state.auditLogs.push(message);
  sandbox.showToast = (message, type) => { sandbox.lastToast = { message, type }; };
  vm.createContext(sandbox);
  for (const name of [
    'jalaliDateOrdinal',
    'normalizeLedgerDate',
    'inspectTrialBalanceVoucher',
    'getFiscalYearEndDate',
    'buildFiscalYearClosePreview',
    'postVoucher',
    'closeFiscalYear'
  ]) {
    vm.runInContext(sourceOf(name) + `; this.__loaded_${name} = ${name};`, sandbox);
  }
  return sandbox;
}

{
  const sandbox = createContext();
  const preview = sandbox.__loaded_buildFiscalYearClosePreview('1404');
  assert.equal(preview.alreadyClosed, false);
  assert.equal(preview.blocked, false);
  assert.equal(preview.profit, 500);
  assert.deepEqual(Array.from(preview.rows, row => row.code), ['4101', '5101', '6101']);
  assert.equal(preview.to, sandbox.__loaded_getFiscalYearEndDate('1404'));
}

{
  const sandbox = createContext();
  sandbox.state.vouchers.push({
    id: 4, date: '1404/01/04', desc: 'سند نامتوازن',
    lines: [{ code: '6101', debit: 100, credit: 0 }, { code: '1101', debit: 0, credit: 90 }]
  });
  const preview = sandbox.__loaded_buildFiscalYearClosePreview('1404');
  assert.equal(preview.blocked, true);
  assert.ok(preview.warnings.some(message => message.includes('نامعتبر، ناقص یا نامتوازن')));
}

{
  const sandbox = createContext();
  sandbox.__loaded_closeFiscalYear();
  const close = sandbox.state.vouchers.find(voucher =>
    voucher.sourceType === 'fiscal_year_close' && voucher.sourceId === '1404' && voucher.sourceEvent === 'closing');
  assert.ok(close, 'closing voucher must be created: ' + (sandbox.lastToast?.message || 'no toast'));
  assert.equal(close.locked, true);
  assert.equal(close.date, sandbox.__loaded_getFiscalYearEndDate('1404'));
  assert.equal(sandbox.state.auditLogs.length, 2);
  assert.equal(sandbox.lastToast.type, undefined);
  assert.match(sandbox.lastToast.message, /بسته شد/);
  assert.equal(sandbox.state.vouchers.filter(v => v.sourceType === 'fiscal_year_close').length, 1);
  assert.throws(() => sandbox.__loaded_postVoucher('ثبت دیرهنگام', [
    { code: '1101', debit: 10, credit: 0 }, { code: '3101', debit: 0, credit: 10 }
  ], close.date, { type: 'manual', id: 'LATE-1' }), /سال مالی 1404 بسته شده است/);
  assert.throws(() => sandbox.__loaded_postVoucher('اختتامیه با سال اشتباه', [
    { code: '1101', debit: 10, credit: 0 }, { code: '3101', debit: 0, credit: 10 }
  ], close.date, { type: 'fiscal_year_close', id: '1405', event: 'closing' }), /شناسه همان سال/);
  sandbox.__loaded_closeFiscalYear();
  assert.equal(sandbox.state.vouchers.filter(v => v.sourceType === 'fiscal_year_close').length, 1);
}

{
  const sandbox = createContext({ saveResult: false });
  const before = sandbox.state.vouchers.length;
  sandbox.__loaded_closeFiscalYear();
  assert.equal(sandbox.state.vouchers.length, before, 'failed local persistence must roll back the closing voucher');
  assert.equal(sandbox.state.auditLogs.length, 0, 'failed local persistence must roll back audit entries');
  assert.equal(sandbox.lastToast.type, 'error');
  assert.match(sandbox.lastToast.message, /ذخیره محلی/);
}

console.log('PASS: fiscal close preview, balanced closing voucher, closed-year posting lock, strict close source validation, idempotency and atomic rollback');
