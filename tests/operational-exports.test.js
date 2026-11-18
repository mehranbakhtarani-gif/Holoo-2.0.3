const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const html = fs.readFileSync('index.html','utf8');
const source = fs.readFileSync('operational-tools.js','utf8');

for (const token of [
  'operational-tools.js', 'guarantees', 'payableCommitments', 'payrollRuns', 'fixedAssets',
  'ذخیره PDF', 'ذخیره به‌صورت PDF'
]) assert(html.includes(token), 'missing index integration: '+token);

for (const token of [
  'function buildCode39Svg(value)', 'CODE39_PATTERNS', 'aria-label="Code 39 barcode',
  'function printOfficialInvoice(invId)', 'safe(item.name)', 'safe(settings.companyName',
  'function getOperationalReportRows(type)', 'function csvCell(value)', 'function exportTableCSV(type)',
  'ذخیره PDF', 'ذخیره به‌صورت PDF'
]) assert(html.includes(token), 'missing operational feature: '+token);

assert(!html.includes('class="h-10 w-4/5 mx-auto barcode-bars"'), 'decorative fake barcode must be removed');
const barcodeStart=html.indexOf('function buildCode39Svg(value)');
const barcodeEnd=html.indexOf('function printBarcodeLabel(id)',barcodeStart);
const barcodeSource=html.slice(barcodeStart,barcodeEnd);
const sandbox={escapeBankReconcileText:s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))};
vm.runInNewContext(barcodeSource+'; this.buildCode39Svg=buildCode39Svg;',sandbox);
const svg=sandbox.buildCode39Svg('123ABC');
assert(svg.includes('<svg') && svg.includes('<rect'), 'Code39 SVG not generated');
assert.strictEqual(sandbox.buildCode39Svg('کالای فارسی'),'','unsupported barcode must fail closed');
const csvSandbox=sandbox;
assert.strictEqual(csvSandbox.csvCell('=1+1'), '"\'=1+1"');
assert.strictEqual(csvSandbox.csvCell('a,"b"'), '"a,""b"""');
assert.strictEqual(csvSandbox.csvCell(1250), '"1250"');
assert.strictEqual(sandbox.getOperationalReportRows('products').rows.length,1);
assert.strictEqual(sandbox.getOperationalReportRows('guarantees').headers.length,8);
const unsafe=sandbox.reportTableHtml(['نام'],[['<img src=x onerror=alert(1)>']]);
assert(!unsafe.includes('<img')&&unsafe.includes('&lt;img'),'report preview must escape untrusted cells');
console.log('PASS: operational printing, Code39 barcode, report sources and safe CSV escaping');
