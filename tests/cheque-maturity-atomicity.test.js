const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function computeCheckRas()');
const end = html.indexOf('\n    function escapeBankReconciliationText', start);
assert.ok(start >= 0 && end > start, 'computeCheckRas must exist');
const source = html.slice(start, end) + '; this.computeCheckRas = computeCheckRas;';

function harness(saveResult) {
  const original = { checks: [
    { id: 'CHK-1', dir: 'receive', status: 'in_progress', dueDate: '1405/08/20', amount: 500 }
  ], auditLogs: [] };
  const banner = { classList: { remove() {} }, textContent: '' };
  const messages = [];
  const sandbox = {
    state: original,
    jalaliDateOrdinal(value) { return value === '1405/08/29' ? 100 : value === '1405/08/20' ? 91 : null; },
    getTodayJalaliDate() { return '1405/08/29'; },
    document: { getElementById() { return banner; } },
    faNum: String, money: String,
    addAudit(message) { sandbox.state.auditLogs.push(message); },
    saveState() { return saveResult; },
    showToast(message, type) { messages.push({ message, type }); },
    Date, JSON, Math, Number, String, Array
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { sandbox, original, messages };
}
{
  const { sandbox, original, messages } = harness(false);
  sandbox.computeCheckRas();
  assert.equal(sandbox.state, original, 'failed persistence must restore original state reference');
  assert.equal(original.checks[0].status, 'in_progress');
  assert.equal(original.auditLogs.length, 0);
  assert.match(messages.at(-1).message, /ذخیره تغییرات سررسید/);
}
{
  const { sandbox } = harness(true);
  sandbox.computeCheckRas();
  assert.equal(sandbox.state.checks[0].status, 'overdue');
  assert.equal(sandbox.state.auditLogs.length, 1);
}
console.log('PASS: cheque maturity recalculation is atomic on local persistence failure');
