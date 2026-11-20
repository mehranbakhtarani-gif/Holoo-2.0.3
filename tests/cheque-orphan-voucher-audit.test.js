const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function buildCheckAuditSummary()');
const end = html.indexOf('function buildBankTransferAuditSummary()', start);
assert.ok(start >= 0 && end > start, 'cheque audit function must exist');
const source = html.slice(start, end) + '; this.audit = buildCheckAuditSummary;';

const state = { checks: [], treasuryTxs: [], vouchers: [
  { id: 'V-ORPHAN-ISSUED', sourceType: 'check', sourceId: 'MISSING-CHECK', sourceEvent: 'issued' },
  { id: 'V-ORPHAN-BOUNCED', sourceType: 'check', sourceId: 'MISSING-CHECK-2', sourceEvent: 'bounced' },
  { id: 'V-OTHER', sourceType: 'treasury', sourceId: 'T1', sourceEvent: 'posted' }
] };
const before = JSON.stringify(state);
const sandbox = { state, normalizeSayadId: value => String(value || ''), isValidSayadId: () => true,
  jalaliDateOrdinal: () => 1, inspectTrialBalanceVoucher: () => ({ invalidLines: 0, invalidStructure: false, unbalanced: false }) };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const result = sandbox.audit();

assert.equal(result.orphanCheckVouchers, 2);
assert.equal(result.issueCount, 2);
assert.ok(result.issues.some(issue => issue.includes('V-ORPHAN-ISSUED')));
assert.ok(result.issues.some(issue => issue.includes('V-ORPHAN-BOUNCED')));
assert.equal(JSON.stringify(state), before, 'cheque audit must not mutate accounting state');
console.log('PASS: orphan issued and lifecycle cheque vouchers are detected');
console.log('PASS: unrelated voucher types are ignored');
console.log('PASS: cheque audit remains read-only');
