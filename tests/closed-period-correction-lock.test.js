const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');

function sourceOf(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const candidates = [html.indexOf('\n    function ', start + 10), html.indexOf('\n    async function ', start + 10)].filter(i => i > start);
  return html.slice(start, candidates.length ? Math.min(...candidates) : html.length);
}
const sandbox = {
  state: { vouchers: [
    { id: 10, sourceType: 'fiscal_year_close', sourceId: '1404', sourceEvent: 'closing' }
  ] },
  normalizeLedgerDate(value) { return String(value || '').replace(/-/g, '/'); }
};
vm.createContext(sandbox);
vm.runInContext(sourceOf('getVoucherCorrectionBlockReason') + '; this.check = getVoucherCorrectionBlockReason;', sandbox);

const closedYearVoucher = { id: 1, date: '1404/06/10', sourceType: 'manual_voucher', lines: [] };
const reason = sandbox.check(closedYearVoucher);
assert.match(reason, /سال مالی 1404 بسته شده است/);

const openYearVoucher = { id: 2, date: '1405/01/10', sourceType: 'manual_voucher', lines: [] };
assert.equal(sandbox.check(openYearVoucher), '');

const saveCorrection = sourceOf('saveManualVoucherCorrection');
assert.ok(saveCorrection.includes('getVoucherCorrectionBlockReason(originalLive)'),
  'correction must re-check the period lock at commit time, not only when opening the dialog');
assert.ok(saveCorrection.indexOf('getVoucherCorrectionBlockReason(originalLive)') < saveCorrection.indexOf('const before = state'),
  'period lock must be checked before any state mutation');

console.log('PASS: manual voucher correction is blocked for closed fiscal years and revalidated at commit time');
