const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function getTodayJalaliDate(');
const end = html.indexOf('    function showToast(', start);
assert.notEqual(start, -1, 'operation date helpers must exist');
const state = { fiscalYear: '1405', activeRole: 'mehran', auditLogs: [] };
const sandbox = {
  state, DEVICE_ID: 'DEVICE-TEST',
  USER_ROLE_LABELS: { mehran: 'مهران', ehsan: 'احسان' },
  createStableId: (() => { let n = 0; return p => p + '-' + (++n); })()
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '; this.api = { getTodayJalaliDate, addAudit };', sandbox);
const { getTodayJalaliDate, addAudit } = sandbox.api;
assert.match(getTodayJalaliDate(), /^14\d{2}\/\d{2}\/\d{2}$/);

addAudit('ثبت سند دستی', { mode: 'manual', operationDate: '1405/09/02', sourceType: 'manual_voucher' });
addAudit('صدور خودکار فاکتور', { mode: 'automatic', operationDate: '1405/09/03', sourceType: 'invoice' });
assert.equal(state.auditLogs[0].operationDate, '1405/09/03');
assert.equal(state.auditLogs[0].operationMode, 'automatic');
assert.equal(state.auditLogs[1].operationMode, 'manual');
assert.equal(state.auditLogs[1].sourceType, 'manual_voucher');
assert.equal(state.auditLogs[0].actor, 'mehran');
assert.equal(state.auditLogs[0].deviceId, 'DEVICE-TEST');
assert.ok(state.auditLogs[0].createdAt);

assert.match(html, /id="mv-date"/);
assert.match(html, /mode: 'manual'/);
assert.match(html, /function postVoucher\(desc, lines, date = getTodayJalaliDate\(\)/);
console.log('PASS: 8 manual/automatic operation date and audit tests');
