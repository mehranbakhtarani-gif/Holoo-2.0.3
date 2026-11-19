const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function saveManualVoucherCorrection()');
const end = html.indexOf('    function saveManualVoucher()', start);
assert.ok(start >= 0 && end > start, 'manual voucher correction function must exist');
const source = html.slice(start, end) + '; this.saveManualVoucherCorrection = saveManualVoucherCorrection;';

function makeHarness(saveResult) {
  const original = {
    vouchers: [{
      id: 10, sourceType: 'manual_voucher', desc: 'سند اولیه', locked: false,
      lines: [{ code: '1101', debit: 100, credit: 0, partyId: null }, { code: '4101', debit: 0, credit: 100, partyId: null }]
    }],
    auditLogs: []
  };
  const modal = { dataset: { voucherId: '10' } };
  const fields = {
    'modal-manual-voucher-correction': modal,
    'mvc-desc': { value: 'سند اصلاح‌شده' },
    'mvc-date': { value: '1405/08/29' }
  };
  const rows = [
    { querySelector(selector) { return ({ '[data-vc-code]': { value: '1101' }, '[data-vc-desc]': { value: 'صندوق' }, '[data-vc-debit]': { value: '120' }, '[data-vc-credit]': { value: '0' } })[selector]; } },
    { querySelector(selector) { return ({ '[data-vc-code]': { value: '4101' }, '[data-vc-desc]': { value: 'فروش' }, '[data-vc-debit]': { value: '0' }, '[data-vc-credit]': { value: '120' } })[selector]; } }
  ];
  const calls = { save: 0, closed: 0, rendered: 0, tab: 0, toasts: [] };
  const sandbox = {
    state: original,
    CHART_ACCOUNTS: [{ code: '1101' }, { code: '4101' }],
    document: {
      getElementById(id) { return fields[id] || null; },
      querySelectorAll() { return rows; }
    },
    createStableId() { return 'CORR-10'; },
    getTodayJalaliDate() { return '1405/08/29'; },
    getVoucherCorrectionBlockReason() { return ''; },
    jalaliDateOrdinal(value) { return value === '1405/08/29' ? 1 : null; },
    postVoucher(desc, lines, date, source) {
      const id = sandbox.state.vouchers.reduce((max, voucher) => Math.max(max, Number(voucher.id) || 0), 0) + 1;
      sandbox.state.vouchers.unshift({ id, desc, lines, date, sourceType: source.type, sourceId: source.id, sourceEvent: source.event });
      return id;
    },
    addAudit(action, meta) { sandbox.state.auditLogs.push({ action, meta }); },
    saveState() { calls.save++; return saveResult; },
    closeModal() { calls.closed++; },
    renderAll() { calls.rendered++; },
    setAccTab() { calls.tab++; },
    showToast(message, type) { calls.toasts.push({ message, type }); },
    Date, JSON, Math, Number, String, Array
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { sandbox, original, calls };
}

{
  const { sandbox, original, calls } = makeHarness(false);
  sandbox.saveManualVoucherCorrection();
  assert.equal(sandbox.state, original, 'failed local persistence must restore the exact pre-operation state reference');
  assert.equal(original.vouchers.length, 1, 'reversal and replacement vouchers must not leak after failed persistence');
  assert.equal(original.vouchers[0].correctedByVoucherId, undefined, 'original voucher must remain unmodified');
  assert.equal(original.auditLogs.length, 0, 'audit event must roll back with the failed correction');
  assert.equal(calls.save, 1);
  assert.equal(calls.closed, 0, 'modal must remain open when persistence fails');
  assert.equal(calls.rendered, 0);
  assert.equal(calls.toasts.at(-1).type, 'error');
}

{
  const { sandbox, original, calls } = makeHarness(true);
  sandbox.saveManualVoucherCorrection();
  assert.notEqual(sandbox.state, original, 'successful correction commits a new state snapshot');
  assert.equal(sandbox.state.vouchers.length, 3, 'original, reversal and replacement must all be retained');
  const corrected = sandbox.state.vouchers.find(voucher => Number(voucher.id) === 10);
  assert.equal(corrected.correctedByVoucherId, 12);
  assert.equal(corrected.reversalVoucherId, 11);
  assert.equal(sandbox.state.vouchers.find(voucher => Number(voucher.id) === 11).reversesVoucherId, 10);
  assert.equal(sandbox.state.vouchers.find(voucher => Number(voucher.id) === 12).correctsVoucherId, 10);
  assert.equal(sandbox.state.auditLogs.length, 1);
  assert.equal(calls.save, 1);
  assert.equal(calls.closed, 1);
  assert.equal(calls.rendered, 1);
  assert.equal(calls.toasts.at(-1).type, 'success');
}

console.log('PASS: manual voucher correction rolls back all journal and audit changes when local persistence fails');
console.log('PASS: successful correction keeps the original, reversal, replacement and audit links');
