const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const html = fs.readFileSync('index.html', 'utf8');
const source = fs.readFileSync('operational-tools.js', 'utf8');

for (const token of ['operational-tools.js', 'guarantees', 'payableCommitments', 'payrollRuns', 'fixedAssets', 'ذخیره PDF', 'ذخیره به‌صورت PDF']) {
  assert(html.includes(token), 'missing index integration: ' + token);
}
for (const token of ['function buildCode39Svg(value)', 'CODE39_PATTERNS', 'function printOfficialInvoice(invId)', 'safe(item.name)', 'safe(settings.companyName', 'function getOperationalReportRows(type)', 'function csvCell(value)', 'function exportTableCSV(type)']) {
  assert(source.includes(token), 'missing operational implementation: ' + token);
}
assert(!source.includes('class="h-10 w-4/5 mx-auto barcode-bars"'), 'decorative fake barcode must be removed');

const sandbox = {
  escapeBankReconcileText: value => String(value == null ? '' : value).replace(/[&<>"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char])),
  state: { products:[{id:'P1',name:'Cotton',barcode:'123ABC',stock:10,buyPrice:20}], invoices:[], imports:[], checks:[], guarantees:[], payableCommitments:[], payrollRuns:[], fixedAssets:[], parties:[], fiscalYear:'1405' },
  getPartyName: () => '—'
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const svg = sandbox.buildCode39Svg('123ABC');
assert(svg.includes('<svg') && svg.includes('<rect'), 'Code39 SVG generation failed');
assert.strictEqual(sandbox.buildCode39Svg('کالای فارسی'), '', 'unsupported barcode must fail closed');
assert.strictEqual(sandbox.csvCell('=1+1'), '"\'=1+1"', 'formula injection guard failed');
assert.strictEqual(sandbox.csvCell('a,"b"'), '"a,""b"""', 'CSV quote escaping failed');
assert.strictEqual(sandbox.csvCell(1250), '"1250"', 'numeric CSV encoding failed');
assert.strictEqual(sandbox.getOperationalReportRows('products').rows.length, 1);
assert.strictEqual(sandbox.getOperationalReportRows('guarantees').headers.length, 8);
const unsafe = sandbox.reportTableHtml(['نام'], [['<img src=x onerror=alert(1)>']]);
assert(!unsafe.includes('<img') && unsafe.includes('&lt;img'), 'report preview must escape untrusted cells');
console.log('PASS: operational printing, Code39 barcode, report sources and safe CSV escaping');
