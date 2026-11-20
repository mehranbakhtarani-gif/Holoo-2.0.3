const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../index.html'), 'utf8');
function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'missing ' + name);
  const open = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated function ' + name);
}
const helpers = ['safeMoneyInteger','safeMoneySum','safePercentAmount','safeProportionalAmount']
  .map(extractFunction).join('\n');
const money = new Function(helpers + '\nreturn {' + helpers.map(name => name + ':' + name).join(',') + '};')();

assert.equal(money.safeMoneyInteger(100.4), 100);
assert.equal(money.safeMoneyInteger(100.5), 101);
assert.equal(money.safeMoneyInteger(Number.MAX_SAFE_INTEGER + 1), null);
assert.equal(money.safeMoneyInteger(Infinity), null);
assert.equal(money.safeMoneyInteger(null), null);
assert.equal(money.safeMoneySum([100, 200, 300]), 600);
assert.equal(money.safeMoneySum([Number.MAX_SAFE_INTEGER, 1]), null);
assert.equal(money.safeMoneySum([100, null]), null);
assert.equal(money.safePercentAmount(101, 9), 9);
assert.equal(money.safePercentAmount(10, 5), 1);
assert.equal(money.safePercentAmount(Number.MAX_SAFE_INTEGER, 100), Number.MAX_SAFE_INTEGER);
assert.equal(money.safePercentAmount(Number.MAX_SAFE_INTEGER, 101), null);
const allocated = [3, 7, 10].map(cumulative => money.safeProportionalAmount(1, cumulative, 10));
assert.deepEqual(allocated, [0, 1, 1]);
assert.equal(allocated[allocated.length - 1], 1);
assert.equal(money.safeProportionalAmount(10, 5, 0), null);
assert.equal(money.safeProportionalAmount(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1), null);

assert.ok(source.includes('total: safeMoneySum([grossAmount, -disc])'));
assert.ok(source.includes('const sub = safeMoneySum(invoiceLines.map(line => line.total));'));
assert.ok(source.includes('const vatAmount = sub === null ? null : safePercentAmount(sub, vatRate);'));
assert.ok(source.includes('safeProportionalAmount(vatAmount, nextBase, sub)'));
assert.ok(!source.includes('const vatAmount = Math.round(sub * (vatRate / 100));'));
assert.ok(!source.includes('const sub = invoiceLines.reduce((sum, line) => sum + Number(line.total || 0), 0);'));

console.log('PASS: whole-rial line amounts use deterministic rounding');
console.log('PASS: invoice aggregation and percentage calculations reject unsafe overflow');
console.log('PASS: cumulative purchase VAT allocation conserves the exact header VAT amount');
console.log('PASS: invoice UI and submit path use the same safe monetary arithmetic');
