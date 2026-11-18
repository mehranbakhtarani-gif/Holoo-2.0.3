const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');

function extractFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' must exist');
  const end = html.indexOf('\n    }', start);
  assert.notEqual(end, -1, name + ' must close');
  return html.slice(start, end + 6);
}

const source = [
  extractFunction('normalizeJalaliDateInputValue'),
  extractFunction('jalaliDateOrdinal'),
  extractFunction('normalizeLedgerDate')
].join('\n');
const context = {};
vm.runInNewContext(source + '\nthis.normalizeJalaliDateInputValue = normalizeJalaliDateInputValue; this.jalaliDateOrdinal = jalaliDateOrdinal; this.normalizeLedgerDate = normalizeLedgerDate;', context);

assert.equal(context.normalizeJalaliDateInputValue('02011405'), '1405/01/02');
assert.equal(context.normalizeJalaliDateInputValue('۰۲۰۱۱۴۰۵'), '1405/01/02');
assert.equal(context.normalizeJalaliDateInputValue('1405/01/02', true), '1405/01/02');
assert.equal(context.normalizeJalaliDateInputValue('1405/01/02', true), '1405/01/02');
assert.equal(context.normalizeJalaliDateInputValue('02/', false), '02/');
assert.equal(context.normalizeJalaliDateInputValue('02/01/', false), '02/01/');
assert.equal(context.normalizeLedgerDate('1405/01/02'), '14050102');
assert.equal(context.normalizeLedgerDate('1405/01/02'), '14050102');
assert.equal(context.jalaliDateOrdinal('1405/01/02'), context.jalaliDateOrdinal('1405/01/02'));
assert.equal(context.jalaliDateOrdinal('1405/01/02'), context.jalaliDateOrdinal('1405/1/2'));

console.log('PASS: Jalali date input uses YYYY/MM/DD while internal date comparisons remain YYYYMMDD');
