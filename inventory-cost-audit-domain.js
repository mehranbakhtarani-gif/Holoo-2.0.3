;(function(root){'use strict';
function finiteAmount(value){return value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0;}
function buildInventoryCostAudit(state){
 const s=state&&typeof state==='object'?state:{}, invoices=Array.isArray(s.invoices)?s.invoices:[], vouchers=Array.isArray(s.vouchers)?s.vouchers:[], products=Array.isArray(s.products)?s.products:[];
 const issues=[], details=[]; let salesChecked=0,missingSaleVouchers=0,duplicateSaleVouchers=0,invalidCogsLines=0,cogsAmountMismatches=0,inventoryCounterpartMismatches=0,unbalancedVouchers=0,purchaseQuantityMismatches=0,missingPurchaseProducts=0,returnLinksUnverified=0;
 const add=(type,invoiceId,message,detail)=>issues.push({type,invoiceId:String(invoiceId||''),message,detail:String(detail||'')});
 const active=invoices.filter(x=>x&&!x.cancelled&&['sale','purchase'].includes(String(x.type||'')));
 active.filter(x=>x.type==='sale').forEach(inv=>{
  salesChecked++; const id=String(inv.id??''), lines=Array.isArray(inv.items)?inv.items:[];
  const matches=vouchers.filter(v=>v&&String(v.sourceType||'')==='invoice'&&String(v.sourceId||'')===id);
  if(!matches.length){missingSaleVouchers++;add('sale-voucher-missing',id,'سند حسابداری فاکتور فروش پیدا نشد.','');return;}
  if(matches.length!==1){duplicateSaleVouchers++;add('sale-voucher-duplicate',id,'برای فاکتور فروش بیش از یک سند با منشأ یکسان ثبت شده است.',matches.length+' سند');return;}
  const cogsValues=lines.map(x=>x&&x.costOfGoodsSold), invalid=cogsValues.some(x=>!finiteAmount(x));
  if(invalid){invalidCogsLines++;add('cogs-line-invalid',id,'بهای تمام‌شده حداقل یک ردیف فروش خالی یا نامعتبر است.','');return;}
  const expected=cogsValues.reduce((a,b)=>a+Number(b),0), v=matches[0], vl=Array.isArray(v.lines)?v.lines:[];
  const debit=vl.filter(x=>String(x&&x.code||'').trim()==='5101').reduce((a,x)=>a+(finiteAmount(x.debit)?Number(x.debit):0),0);
  const cogsLines=vl.filter(x=>String(x&&x.code||'').trim()==='5101');
  const malformed=cogsLines.some(x=>!finiteAmount(x.debit)||!finiteAmount(x.credit)||Number(x.credit)!==0);
  if(malformed||Math.abs(expected-debit)>1){cogsAmountMismatches++;add('cogs-5101-mismatch',id,'بهای تمام‌شده ردیف‌های فاکتور با بدهکار حساب ۵۱۰۱ برابر نیست.','فاکتور: '+expected+' | حساب ۵۱۰۱: '+debit);}
  const credit=vl.filter(x=>String(x&&x.code||'').trim()==='1105').reduce((a,x)=>a+(finiteAmount(x.credit)?Number(x.credit):0),0);
  const invLines=vl.filter(x=>String(x&&x.code||'').trim()==='1105');
  if(invLines.some(x=>!finiteAmount(x.debit)||!finiteAmount(x.credit))||Math.abs(expected-credit)>1){inventoryCounterpartMismatches++;add('inventory-1105-mismatch',id,'بستانکار حساب ۱۱۰۵ با بهای تمام‌شده فاکتور تطبیق ندارد.','فاکتور: '+expected+' | حساب ۱۱۰۵: '+credit);}
  const total=vl.reduce((a,x)=>({d:a.d+(finiteAmount(x&&x.debit)?Number(x.debit):0),c:a.c+(finiteAmount(x&&x.credit)?Number(x.credit):0)}),{d:0,c:0});
  if(Math.abs(total.d-total.c)>1){unbalancedVouchers++;add('voucher-unbalanced',id,'سند حسابداری فاکتور فروش تراز نیست.','بدهکار: '+total.d+' | بستانکار: '+total.c);}
  details.push({invoiceId:id,voucherId:String(v.id??''),expectedCogs:expected,account5101Debit:debit,account1105Credit:credit,status:malformed||Math.abs(expected-debit)>1||Math.abs(expected-credit)>1?'mismatch':'matched'});
  (Array.isArray(inv.returnRefs)?inv.returnRefs:[]).forEach(ref=>{
   const rid=String(ref&&ref.id||'').trim(); if(!rid){returnLinksUnverified++;add('return-id-missing',id,'برگشت فاکتور شناسه یکتا ندارد.','');return;}
   const rv=vouchers.filter(x=>x&&String(x.sourceType||'')==='invoice_return'&&String(x.sourceId||'')===rid);
   if(rv.length!==1){returnLinksUnverified++;add('return-voucher-link',id,'سند برگشت با شناسه منشأ یکتا پیدا نشد.','شناسه برگشت: '+rid+' | تعداد سند: '+rv.length);}
  });
 });
 active.filter(x=>x.type==='purchase').forEach(inv=>{
  const id=String(inv.id??'');
  (Array.isArray(inv.items)?inv.items:[]).forEach(line=>{
   const p=products.find(x=>x&&String(x.id)===String(line&&line.productId));
   if(!p){missingPurchaseProducts++;add('purchase-product-missing',id,'کالای فاکتور خرید در فهرست کالاها پیدا نشد.',String(line&&line.productId||''));return;}
   const lot=String(line.lot||('PUR-'+id+'-'+String(line.productId||'')));
   const received=(Array.isArray(p.batches)?p.batches:[]).filter(b=>b&&b.sourceType==='purchase'&&String(b.sourceRef||'')===id&&String(b.lot||'')===lot).reduce((n,b)=>n+(finiteAmount(b.quantity)?Number(b.quantity):0),0);
   const expected=Number(line.kg);
   if(!Number.isFinite(expected)||expected<0||Math.abs(received-expected)>0.000001){purchaseQuantityMismatches++;add('purchase-batch-quantity',id,'مقدار فاکتور خرید با بچ‌های ورودی تطبیق ندارد.','فاکتور: '+line.kg+' | بچ‌ها: '+received);}
  });
 });
 return {salesChecked,missingSaleVouchers,duplicateSaleVouchers,invalidCogsLines,cogsAmountMismatches,inventoryCounterpartMismatches,unbalancedVouchers,purchaseQuantityMismatches,missingPurchaseProducts,returnLinksUnverified,issueCount:issues.length,issues,details};
}
root.HolooInventoryCostAudit={buildInventoryCostAudit};
if(typeof module!=='undefined'&&module.exports)module.exports=root.HolooInventoryCostAudit;
})(typeof globalThis!=='undefined'?globalThis:this);
