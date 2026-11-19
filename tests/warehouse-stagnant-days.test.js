const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
function extract(name, nextName) {
  const start = html.indexOf('    function ' + name + '(');
  const end = html.indexOf('    function ' + nextName + '(', start);
  assert.notEqual(start, -1, name + ' must exist');
  assert.notEqual(end, -1, nextName + ' section must have an end');
  return html.slice(start, end);
}
const dateSource = extract('jalaliDateOrdinal', 'currentJalaliOrdinal');
const helperSource = extract('getProductDaysSinceLastMovement', 'jalaliDateOrdinal');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(dateSource + '\n' + helperSource + '\nthis.api = { getProductDaysSinceLastMovement, jalaliDateOrdinal };', sandbox);
const { getProductDaysSinceLastMovement, jalaliDateOrdinal } = sandbox.api;

function test(name, fn) { fn(); console.log('PASS: ' + name); }

test('uses the latest dated Kardex movement instead of stale cached days', () => {
  const today = jalaliDateOrdinal('1405/08/28');
  const days = getProductDaysSinceLastMovement({
    lastMoveDays: 180,
    kardex: [{ date: '1405/08/01', inQty: 5 }, { date: '1405/08/25', outQty: 2 }]
  }, today);
  assert.equal(days, 3);
});

test('selects the latest movement even when Kardex rows are not chronological', () => {
  const today = jalaliDateOrdinal('1405/08/28');
  const days = getProductDaysSinceLastMovement({
    lastMoveDays: 90,
    kardex: [{ date: '1405/08/20' }, { date: '1405/08/04' }, { date: '1405/08/27' }]
  }, today);
  assert.equal(days, 1);
});

test('accepts Persian-digit Jalali dates', () => {
  const today = jalaliDateOrdinal('1405/08/28');
  const days = getProductDaysSinceLastMovement({ kardex: [{ date: '۱۴۰۵/۰۸/۱۸' }] }, today);
  assert.equal(days, 10);
});

test('uses a positive legacy age only when no valid dated Kardex row exists', () => {
  const today = jalaliDateOrdinal('1405/08/28');
  assert.equal(getProductDaysSinceLastMovement({ lastMoveDays: 75, kardex: [{ date: 'invalid' }] }, today), 75);
});

test('does not label products active when no dated movement or reliable legacy age exists', () => {
  const today = jalaliDateOrdinal('1405/08/28');
  assert.equal(getProductDaysSinceLastMovement({ lastMoveDays: 0, kardex: [] }, today), null);
  assert.equal(getProductDaysSinceLastMovement({ kardex: [] }, today), null);
});

test('returns null when the reference date is invalid', () => {
  assert.equal(getProductDaysSinceLastMovement({ kardex: [{ date: '1405/08/01' }] }, null), null);
});

console.log('PASS: 6 warehouse stagnant-days tests');
