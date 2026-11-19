const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');

function body(name) {
  const start = html.indexOf('    function ' + name + '(');
  const end = html.indexOf('\n    function ', start + 20);
  assert.ok(start >= 0 && end > start, name + ' must exist');
  return html.slice(start, end);
}

for (const name of ['saveTreasuryCorrection', 'saveCheckCorrection']) {
  const source = body(name);
  assert.ok(source.includes('const before = state; state = JSON.parse(JSON.stringify(state))'),
    name + ' must work on an isolated full-state snapshot');
  assert.ok(source.includes('if (!saveState()) throw new Error('),
    name + ' must reject failed local persistence');
  assert.ok(source.includes('catch (error) { state = before;'),
    name + ' must restore the original state on failure');
  assert.ok(source.indexOf('if (!saveState())') < source.indexOf('closeModal('),
    name + ' must keep the correction dialog open until persistence succeeds');
}

{
  const source = body('updateCheckStatus');
  assert.ok(source.includes('const checkStatusPreCommitSnapshot = JSON.parse(JSON.stringify(state))'),
    'check status changes must snapshot the complete state before posting');
  assert.ok(source.includes('if (!saveState())'),
    'check status changes must reject failed local persistence');
  assert.ok((source.match(/state = checkStatusPreCommitSnapshot/g) || []).length >= 3,
    'check status, bank balance, allocations and vouchers must roll back on failure');
  assert.ok(source.indexOf('if (!saveState())') < source.indexOf('renderAll()'),
    'check status must not show success before persistence succeeds');
}

console.log('PASS: treasury and cheque correction/status operations enforce atomic local persistence');
