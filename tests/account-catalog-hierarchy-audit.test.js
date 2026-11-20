const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: 'index.html:inline-' + i });
}
const start = html.indexOf('function buildSubsidiaryInvoiceAuditSummary()');
const end = html.indexOf('function ', start + 10);
assert.ok(start >= 0 && end > start, 'subsidiary audit function must exist');
const source = html.slice(start, end);
const state = {
  accountCatalog: [
    {id:'G1',code:'1',name:'دارایی‌ها',level:'group',parentId:null,active:true},
    {id:'G1-DUP',code:'1',name:'گروه تکراری',level:'group',parentId:null,active:true},
    {id:'GL11',code:'11',name:'دارایی جاری',level:'general',parentId:'G1',active:true},
    {id:'GL11-DUP',code:'11',name:'کل تکراری',level:'general',parentId:'G1',active:true},
    {id:'SUB1103',code:'1103',name:'حساب مشتریان',level:'subsidiary',parentId:'GL11',active:true},
    {id:'SUB1103-DUP',code:'1103',name:'معین تکراری',level:'subsidiary',parentId:'GL11',active:true},
    {id:'BAD-CODE',code:'A7',name:'کد نامعتبر',level:'general',parentId:'G1',active:true},
    {id:'ORPHAN',code:'21',name:'کل بدون گروه',level:'general',parentId:'MISSING-GROUP',active:true},
    {id:'DUP-ID',code:'2',name:'گروه اول',level:'group',parentId:null,active:true},
    {id:'DUP-ID',code:'3',name:'گروه دوم',level:'group',parentId:null,active:true},
    {id:'INACTIVE-DUP',code:'11',name:'غیرفعال',level:'general',parentId:'G1',active:false}
  ],
  parties:[], invoices:[], vouchers:[]
};
const before = JSON.stringify(state);
const sandbox = {
  state,
  isSupplierParty: () => false,
  jalaliDateOrdinal: () => null
};
vm.createContext(sandbox);
vm.runInContext(source + '; this.audit = buildSubsidiaryInvoiceAuditSummary;', sandbox);
const result = sandbox.audit();

assert.equal(result.duplicateGroupCodes,1,'duplicate active group codes must be detected');
assert.equal(result.duplicateGeneralCodes,1,'duplicate active general account codes must be detected');
assert.equal(result.duplicateSubsidiaryCodes,1,'duplicate active subsidiary codes must be detected');
assert.equal(result.duplicateAccountIds,1,'ambiguous account IDs must be detected');
assert.equal(result.invalidAccountCodes,1,'invalid account-code formats must be detected');
assert.equal(result.hierarchyIssues,2,'invalid parent links and code-prefix relationships must be detected');
assert.ok(result.issues.some(issue=>issue.startsWith('کد گروه تکراری: 1')));
assert.ok(result.issues.some(issue=>issue.startsWith('کد حساب کل تکراری: 1')));
assert.ok(result.issues.some(issue=>issue.startsWith('شناسه تکراری در درخت حساب‌ها: 1')));
assert.ok(result.issues.some(issue=>issue.startsWith('قالب کد حساب نامعتبر: 1')));
assert.equal(JSON.stringify(state),before,'catalog audit must be read-only');
console.log('PASS: duplicate group, general, and subsidiary codes are reported');
console.log('PASS: duplicate account IDs and invalid code formats are reported');
console.log('PASS: missing parent and broken hierarchy links are reported');
console.log('PASS: inactive account records do not create false active-code duplicates');
console.log('PASS: account catalog audit does not mutate source data');
