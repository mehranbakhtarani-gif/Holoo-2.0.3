const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, m] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (m[1].trim()) new vm.Script(m[1], { filename: `index.html:inline-${i}` });
}
function functionSource(name) {
  let start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  if (html.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const next = html.indexOf('\n    function ', start + 10);
  const nextAsync = html.indexOf('\n    async function ', start + 10);
  const ends = [next, nextAsync].filter(x => x > 0);
  return html.slice(start, ends.length ? Math.min(...ends) : html.length).trim();
}
function load(name, context) {
  const sandbox = { ...context, fetchWithTimeout: context.fetchWithTimeout || ((url, options) => context.fetch(url, options)) };
  vm.createContext(sandbox);
  vm.runInContext(functionSource(name) + `; this.__fn = ${name};`, sandbox);
  return sandbox.__fn;
}
const passed = [];
async function test(name, fn) { await fn(); passed.push(name); }

(async () => {
  // Trial-balance math and party subledger reconciliation using synthetic journal lines.
  await test('account balances calculate debit and credit turnovers and ending balances', () => {
    const state = { vouchers: [
      { date:'1405/01/01', lines: [{code:'1101',debit:1000,credit:0},{code:'4101',debit:0,credit:1000}] },
      { date:'1405/01/02', lines: [{code:'1101',debit:250,credit:0},{code:'1101',debit:0,credit:100}] }
    ] };
    const get = load('getAccountBalances', { state, CHART_ACCOUNTS:[{code:'1101',name:'Cash'},{code:'4101',name:'Sales'}], normalizeLedgerDate(value){return /^\\d{4}\\/\\d{2}\\/\\d{2}$/.test(String(value||'')) ? String(value).replace(/\\//g,'') : null;}, jalaliDateOrdinal(value){return /^\\d{4}\\/(0[1-9]|1[0-2])\\/(0[1-9]|[12]\\d|3[01])$/.test(String(value||'')) ? 1 : null;}, countInvalidReportVoucherLines(v){return (v.lines||[]).filter(line=>{const d=Number(line.debit||0),c=Number(line.credit||0);return !Number.isFinite(d)||!Number.isFinite(c)||d<0||c<0||(d>0&&c>0);}).length;} });
    const balances = get();
    assert.equal(balances['1101'].debTurn,1250);
    assert.equal(balances['1101'].credTurn,100);
    assert.equal(balances['1101'].debBal,1150);
    assert.equal(balances['4101'].credBal,1000);
  });

  await test('party net balance reconciles only the selected party subledger', () => {
    const state = {
      parties:[{id:'P1',ledgerAccountCode:'1103'},{id:'P2',ledgerAccountCode:'1103'}],
      vouchers:[
        {lines:[{code:'1103',partyId:'P1',debit:500,credit:0},{code:'1103',partyId:'P1',debit:0,credit:150}]},
        {lines:[{code:'1103',partyId:'P2',debit:900,credit:0}]}
      ]
    };
    const get=load('getPartyNetBalance',{state});
    assert.equal(get('P1'),350);
    assert.equal(get('P2'),900);
  });

  // RPC success and CAS conflict are simulated; no network/database calls are made.
  await test('operation journal acknowledges an applied operation and clears empty outbox', async () => {
    const op={operationId:'op-1',companyRecordId:'main_company_state',payload:{demo:true},entityChanges:[],rootChanges:{},actor:'mehran',deviceId:'device-a',sequence:1,operationType:'state_snapshot',summary:'synthetic',createdAt:'2026-11-18T00:00:00Z'};
    let listCalls=0, acknowledged=[];
    const storage=new Map([['holoo_textile_import_erp_v2_cloud_outbox_v1','queued'],['holoo_textile_import_erp_v2_updated_at','local-1'],['holoo_textile_import_erp_v2_cloud_baseline_v1','base-1']]);
    const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
    const push=load('pushOperationJournalToSupabase',{
      listPendingOperations:async()=> (++listCalls===1?[op]:[]),
      acknowledgeOperations:async(ids,stamp)=>{acknowledged.push({ids,stamp});},
      cloudConfig:{url:'https://demo.supabase.co',key:'anon',recordId:'main_company_state',table:'holoo_sync'},
      STORE_KEY:'holoo_textile_import_erp_v2',
      CLOUD_OUTBOX_KEY:'holoo_textile_import_erp_v2_cloud_outbox_v1',
      LOCAL_UPDATED_KEY:'holoo_textile_import_erp_v2_updated_at',
      CLOUD_BASELINE_KEY:'holoo_textile_import_erp_v2_cloud_baseline_v1',
      localStorage,
      fetch:async()=>({status:200,ok:true,json:async()=>({status:'applied',updated_at:'server-2'})}),
      renderCloudSyncStatus:async()=>{},scheduleCloudSync(){},setCloudBadge(){},showToast(){}
    });
    const result=await push();
    assert.equal(result.applied,1);
    assert.equal(acknowledged.length,1);
    assert.equal(Array.from(acknowledged[0].ids).join(','),'op-1');
    assert.equal(storage.get('holoo_textile_import_erp_v2_cloud_baseline_v1'),'server-2');
    assert.equal(storage.has('holoo_textile_import_erp_v2_cloud_outbox_v1'),false);
  });

  await test('operation journal detects CAS conflict and preserves pending operation', async () => {
    const op={operationId:'op-2',companyRecordId:'main_company_state',payload:{local:true},entityChanges:[],rootChanges:{},actor:'ehsan',deviceId:'device-b',sequence:3,operationType:'state_snapshot',summary:'conflict test',createdAt:'2026-11-18T00:00:00Z'};
    let fetchCalls=0, conflictSaved=null, acknowledged=0, badge='';
    const storage=new Map([['holoo_textile_import_erp_v2_cloud_outbox_v1','queued'],['holoo_textile_import_erp_v2_updated_at','local-2'],['holoo_textile_import_erp_v2_cloud_baseline_v1','old-base']]);
    const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
    const push=load('pushOperationJournalToSupabase',{
      listPendingOperations:async()=>[op],
      acknowledgeOperations:async()=>{acknowledged++;},
      saveCloudConflict:async(c)=>{conflictSaved=c;},
      cloudConfig:{url:'https://demo.supabase.co',key:'anon',recordId:'main_company_state',table:'holoo_sync'},
      STORE_KEY:'holoo_textile_import_erp_v2',
      CLOUD_OUTBOX_KEY:'holoo_textile_import_erp_v2_cloud_outbox_v1',
      LOCAL_UPDATED_KEY:'holoo_textile_import_erp_v2_updated_at',
      CLOUD_BASELINE_KEY:'holoo_textile_import_erp_v2_cloud_baseline_v1',
      localStorage,
      fetch:async()=> (++fetchCalls===1
        ? {status:200,ok:true,json:async()=>({status:'conflict',updated_at:'remote-3'})}
        : {status:200,ok:true,json:async()=>[{data:{remote:true},updated_at:'remote-3'}]}),
      renderCloudSyncStatus:async()=>{},scheduleCloudSync(){},setCloudBadge:(v)=>{badge=v;},showToast(){}
    });
    const result=await push();
    assert.equal(result.conflict,true);
    assert.equal(acknowledged,0);
    assert.equal(conflictSaved.remoteData.remote,true);
    assert.equal(badge,'⚠️ تعارض عملیات؛ هیچ نسخه‌ای بازنویسی نشد');
    assert.equal(storage.get('holoo_textile_import_erp_v2_cloud_outbox_v1'),'queued');
  });

  console.log(`PASS: ${passed.length} reporting and multi-device journal tests`);
  for (const name of passed) console.log(`- ${name}`);
})().catch(error => { console.error(error); process.exitCode=1; });
