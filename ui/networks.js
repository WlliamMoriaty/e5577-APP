// Manual network search: scan available operators/cells and register on the one you choose (or go back to automatic).
(()=>{
const raw=async(p,d)=>(await api('/api/raw',{p,d})).r;
const STATE={'1':'متاحة','2':'مسجّل عليها حالياً','3':'ممنوعة'},RAT={'0':'2G','2':'3G','7':'4G','3':'4G'};
let found=null;

async function register(mode,plmn,rat){
  if(await act(()=>raw('net/register',{Mode:mode,Plmn:plmn,Rat:rat}),mode==='0'?'تم الرجوع للبحث التلقائي':'تم إرسال طلب التسجيل، انتظر بضع ثوانٍ'))setTimeout(load,4000);
}
async function scan(){
  if(!confirm('البحث اليدوي يقطع الإنترنت لدقيقة إلى عدة دقائق أثناء مسح الشبكات. متابعة؟'))return;
  const out=$('#nlist');out.replaceChildren(h('div',{class:'empty'},'جارٍ البحث… لا تغلق الصفحة (قد يستغرق حتى 4 دقائق)'));
  try{
    const r=await raw('net/plmn-list');
    found=asList(((r||{}).Networks||{}).Network);
    out.replaceChildren(...(found.length?[h('h2',{},'الشبكات المتاحة'),grp(...found.map(n=>h('div',{class:'row'},h('div',{},n.FullName||n.ShortName||n.Numeric,h('small',{},`${RAT[n.Rat]||n.Rat||''} · ${n.Numeric||''} · ${STATE[n.State]||'غير معروف'}`)),
      n.State==='3'?null:lnk(n.State==='2'?'الحالية':'اختيار',()=>{if(n.State!=='2'&&confirm('التسجيل يدوياً على '+(n.FullName||n.Numeric)+'؟ ستبقى عليها حتى ترجع للتلقائي.'))register('1',n.Numeric,n.Rat)}))))]:[h('div',{class:'empty'},'لم يتم العثور على شبكات')]));
  }catch(e){out.replaceChildren(h('div',{class:'empty'},'فشل البحث: '+e.message))}
}
async function load(){
  const box=$('#t-networks');box.replaceChildren(h('div',{class:'empty'},'جارٍ التحميل…'));
  const [reg,pl]=await Promise.all([raw('net/register').catch(()=>({})),rpc('net.current_plmn').catch(()=>({}))]);
  const manual=String(reg.Mode)==='1';
  box.replaceChildren(
    h('h2',{},'الحالة'),
    grp(row('المشغّل الحالي',pl.FullName||'—'),row('طريقة الاختيار',manual?'يدوي':'تلقائي'),manual?h('div',{class:'row'},h('div',{},'العودة للوضع التلقائي'),lnk('رجوع',()=>register('0','',''))):null),
    h('h2',{},'البحث اليدوي'),
    h('div',{},h('button',{class:'btn',onclick:scan},'ابحث عن الشبكات')),
    h('div',{class:'empty',style:'padding:10px 4px;text-align:start'},'مفيد لو الإشارة ضعيفة أو لتجربة مشغّل آخر مع شريحة تدعم التجوال. اختيار شبكة ممنوعة أو غير مدعومة قد يفشل.'),
    h('div',{id:'nlist'}));
}
registerPage({id:'networks',title:'البحث عن الشبكات',parent:'more',desc:'اختيار مشغّل أو برج يدوياً',load});
})();
