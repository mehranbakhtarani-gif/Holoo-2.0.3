const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const cases = [
  ['saveFxCommitment', 'function payFxCommitmentStage', 'fxCommitmentPreCommitSnapshot'],
  ['payFxCommitmentStage', 'function postFxRevaluation', 'fxPaymentPreCommitSnapshot'],
  ['postFxRevaluation', 'function updateFxRates', 'fxRevaluationPreCommitSnapshot'],
  ['payFxStage', 'function getProductDaysSinceLastMovement', 'importFxPaymentPreCommitSnapshot']
];

for (const [name, nextName, snapshotName] of cases) {
  const start = html.indexOf('    function ' + name + '(');
  const end = html.indexOf('    ' + nextName, start);
  assert.ok(start >= 0 && end > start, name + ' must exist');
  const body = html.slice(start, end);
  assert.ok(body.includes('const ' + snapshotName + ' = JSON.parse(JSON.stringify(state))'),
    name + ' must capture the complete pre-commit state');
  assert.ok(body.includes('if (!saveState())'),
    name + ' must treat failed local persistence as a failed transaction');
  assert.ok(body.includes('state = ' + snapshotName),
    name + ' must restore the complete state on failure');
  assert.ok(body.indexOf('if (!saveState())') < body.lastIndexOf('render'),
    name + ' must not render a successful result before persistence succeeds');
}

console.log('PASS: foreign-currency commitment, staged payments and revaluation roll back complete state on failed persistence');
