const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}

function sourceOf(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const candidates = [
    html.indexOf('\\n    function ', start + 10),
    html.indexOf('\\n    async function ', start + 10)
  ].filter(index => index > start);
  return html.slice(start, candidates.length ? Math.min(...candidates) : html.length);
}

const sandbox = { state: { accountingPeriodLocks: [] } };
vm.createContext(sandbox);
for (const name of ['jalaliDateOrdinal', 'normalizeAccountingDate', 'getAccountingPeriodBounds',
  'getActiveAccountingPeriodLocks', 'getAccountingPeriodLockForDate']) {
  vm.runInContext(sourceOf(name) + '; this.' + name + ' = ' + name + ';', sandbox);
}

const bounds = (type, period) => sandbox.getAccountingPeriodBounds(type, '1405', String(period));
const ordinal = value => sandbox.jalaliDateOrdinal(value);

// Every month is a valid, inclusive, contiguous range; the next month starts
// exactly one Jalali day after the prior month ends.
const months = Array.from({ length: 12 }, (_, index) => bounds('month', index + 1));
for (let index = 0; index < months.length; index++) {
  assert.equal(ordinal(months[index].from), months[index].fromOrdinal);
  assert.equal(ordinal(months[index].to), months[index].toOrdinal);
  assert.ok(months[index].toOrdinal >= months[index].fromOrdinal);
  if (index > 0) assert.equal(months[index].fromOrdinal, months[index - 1].toOrdinal + 1,
    'monthly ranges must have no gaps or overlaps');
}
assert.equal(months[0].from, '1405/01/01');
assert.equal(months[11].toOrdinal, ordinal('1406/01/01') - 1,
  'month 12 must end on the actual final day of the Jalali year');

// Quarterly ranges must cover exactly the same year as the twelve monthly ranges.
const quarters = Array.from({ length: 4 }, (_, index) => bounds('quarter', index + 1));
assert.equal(quarters[0].fromOrdinal, months[0].fromOrdinal);
assert.equal(quarters[3].toOrdinal, months[11].toOrdinal);
for (let index = 1; index < quarters.length; index++) {
  assert.equal(quarters[index].fromOrdinal, quarters[index - 1].toOrdinal + 1,
    'quarterly ranges must be contiguous');
}
for (let index = 0; index < 4; index++) {
  assert.equal(quarters[index].fromOrdinal, months[index * 3].fromOrdinal);
  assert.equal(quarters[index].toOrdinal, months[index * 3 + 2].toOrdinal);
}

assert.throws(() => bounds('month', 0), /ماه انتخاب‌شده معتبر نیست/);
assert.throws(() => bounds('month', 13), /ماه انتخاب‌شده معتبر نیست/);
assert.throws(() => bounds('quarter', 5), /فصل انتخاب‌شده معتبر نیست/);
assert.throws(() => sandbox.getAccountingPeriodBounds('year', '1405', '1'), /نوع دوره حسابداری معتبر نیست/);
assert.throws(() => sandbox.getAccountingPeriodBounds('month', '1200', '1'), /سال شمسی معتبر نیست/);

// Active locks block both endpoints, but not the days immediately outside.
// Reopened records must never continue blocking a date. Month and quarter
// locks are independent and may overlap without cancelling one another.
sandbox.state.accountingPeriodLocks = [
  { periodKey: 'month:1405:1', status: 'locked', from: months[0].from, to: months[0].to, label: 'ماه ۱' },
  { periodKey: 'quarter:1405:1', status: 'locked', from: quarters[0].from, to: quarters[0].to, label: 'فصل ۱' },
  { periodKey: 'month:1405:2', status: 'reopened', from: months[1].from, to: months[1].to, label: 'ماه ۲' },
  { periodKey: 'broken', status: 'locked', from: '1405/13/01', to: '1405/13/30' }
];
assert.equal(sandbox.getActiveAccountingPeriodLocks().length, 2);
assert.equal(sandbox.getAccountingPeriodLockForDate(months[0].from).periodKey, 'month:1405:1');
assert.equal(sandbox.getAccountingPeriodLockForDate(months[0].to).periodKey, 'month:1405:1');
assert.equal(sandbox.getAccountingPeriodLockForDate('1405/01/01') !== null, true);
assert.equal(sandbox.getAccountingPeriodLockForDate('1405/02/01'), null,
  'a reopened month must not block posting');
assert.equal(sandbox.getAccountingPeriodLockForDate('1405/04/01'), null,
  'the next quarter must remain open');
assert.equal(sandbox.getAccountingPeriodLockForDate('1404/12/30'), null);
assert.equal(sandbox.getAccountingPeriodLockForDate('not-a-date'), null);

console.log('PASS: all 12 monthly and 4 quarterly Jalali period boundaries are contiguous and valid');
console.log('PASS: year-end boundary uses the actual Jalali leap-year length');
console.log('PASS: invalid period selections are rejected');
console.log('PASS: locked periods block inclusive endpoints; reopened periods and dates outside locks remain open');
