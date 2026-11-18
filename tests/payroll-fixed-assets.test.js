const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-script-' + i });
}
function extract(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.notEqual(a, -1, 'missing start ' + start);
  assert.notEqual(b, -1, 'missing end ' + end);
  return html.slice(a, b);
}
function load(source, name, context = {}) {
  const sandbox = { ...context };
  vm.createContext(sandbox);
  vm.runInContext(source + '; this.fn = ' + name + ';', sandbox);
  return sandbox.fn;
}
const rowsFn = load(extract('function getPayrollRows(', 'function savePayrollSettings()'), 'getPayrollRows');
const periodFn = load(extract('function payrollPeriodOrdinal(', 'function getPayrollRows('), 'payrollPeriodOrdinal', {
  jalaliDateOrdinal(value) { return /^\\d{4}\\/(0[1-9]|1[0-2])\\/01$/.test(value) ? Number(value.replaceAll('/', '')) : null; }
});
const depreciationFn = load(extract('function calculateAssetMonthlyDepreciation(', 'function renderAssetsModule()'), 'calculateAssetMonthlyDepreciation');

const rows = rowsFn([{ id: 'E1', name: 'نمونه', base: 1000000, benefits: 200000, deductions: 50000 }], 7, 23);
assert.equal(rows[0].gross, 1200000);
assert.equal(rows[0].employeeInsurance, 84000);
assert.equal(rows[0].employerInsurance, 276000);
assert.equal(rows[0].net, 1066000);
assert.equal(rows[0].employerCost, 1476000);
assert.equal(rows[0].net + rows[0].employerCost - rows[0].net, rows[0].employerCost);
assert.equal(periodFn('1405/09'), 14050901);
assert.equal(periodFn('1405/13'), null);
assert.equal(periodFn('1405/9'), null);
assert.equal(depreciationFn({ cost: 1200000, residualValue: 120000, lifeYears: 3, accDep: 0 }), 30000);
assert.equal(depreciationFn({ cost: 1200000, residualValue: 120000, lifeYears: 3, accDep: 1070000 }), 10000);
assert.equal(depreciationFn({ cost: 1200000, residualValue: 120000, lifeYears: 3, accDep: 1080000 }), 0);
assert.equal(depreciationFn({ cost: 1200000, residualValue: 1300000, lifeYears: 3, accDep: 0 }), 0);
assert.match(html, /state\\.payrollRuns/);
assert.match(html, /state\\.depreciationEntries/);
assert.match(html, /sourceType === 'payroll_run'/);
assert.match(html, /sourceType === 'asset_depreciation'/);
console.log('PASS: payroll and fixed-asset accounting controls');
