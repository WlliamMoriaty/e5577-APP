// Devices page (block / allow lists, max users, isolation) + advanced Wi-Fi radio settings.
(()=>{
const raw=async(p,d)=>(await api('/api/raw',{p,d})).r;
const names=()=>JSON.parse(localStorage.getItem('devnames')||'{}');
const MAC=/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const nmac=m=>(m||'').trim().toUpperCase().replace(/-/g,':');
const dev=x=>names()[nmac(x.MacAddress)]||x.HostName||'جهاز';
let Q={status:0,list:[]},me={},hosts=[],mf={},bs={};

// write basic Wi-Fi settings exactly like the original WebUI (read everything, change fields, post, restart Wi-Fi)
async function setBasic(patch){
  const cur=await raw('wlan/basic-settings');
  await raw('wlan/basic-settings',{...cur,...patch,WifiRestart:'1'});
  toast('جارٍ التطبيق… قد ينقطع الواي فاي لثوانٍ');await sleep(7000);
  let after=null;for(let i=0;i<3&&!after;i++){try{after=await raw('wlan/basic-settings')}catch(e){await sleep(3000)}}
  const r=!after?'unknown':Object.entries(patch).every(([k,v])=>String(after[k])===String(v))?'ok':'ignored';
  toast(r==='ok'?'تم التطبيق':r==='ignored'?'الراوتر تجاهل التغيير (غير مدعوم في هذا الفيرمور)':'تم الإرسال، تعذّر التحقق');
  return r;
}

async function applyFilter(){
  const mine=nmac(me.mac);
  if(Q.status===1&&!Q.list.length)return toast('القائمة البيضاء فارغة');
  if(Q.status===1&&mine&&!Q.list.includes(mine))return toast('أضف جهازك ('+mine+') إلى القائمة البيضاء أولاً وإلا ستفقد الوصول');
  if(Q.status===1&&!mine&&!confirm('لم أستطع تحديد جهازك. القائمة البيضاء قد تقفل عليك الوصول عبر الواي فاي. متابعة؟'))return;
  if(Q.status===2&&mine&&Q.list.includes(mine))return toast('لا يمكن حظر جهازك الحالي');
  const d={...mf,WifiMacFilterStatus:String(Q.status)};
  for(let i=0;i<10;i++)d['WifiMacFilterMac'+i]=Q.status?(Q.list[i]||''):'';
  if(await act(()=>raw('wlan/mac-filter',d),'تم حفظ القائمة'))load();
}
function addMac(m,name){
  m=nmac(m);
  if(!MAC.test(m)||parseInt(m[1],16)%2)return toast('عنوان MAC غير صالح');
  if(Q.list.includes(m))return;
  if(Q.list.length>=10)return toast('الحد الأقصى 10 أجهزة في القائمة');
  Q.list.push(m);if(name){const o=names();o[m]=name;localStorage.setItem('devnames',JSON.stringify(o))}draw();
}

function draw(){
  const box=$('#t-devices'),mine=nmac(me.mac),dn=m=>{const x=hosts.find(h=>nmac(h.MacAddress)===m);return names()[m]||(x&&x.HostName)||''};
  const mode=[['معطّل',0],['قائمة بيضاء',1],['قائمة سوداء',2]];
  box.replaceChildren(
    h('h2',{},'الأجهزة المتصلة'),
    grp(...(hosts.length?hosts.map(x=>{const m=nmac(x.MacAddress),isMe=m&&m===mine;
      return h('div',{class:'row'},h('div',{},dev(x)+(isMe?' (جهازك)':''),h('small',{class:'num'},(x.IpAddress||'')+' · '+m)),
        h('div',{class:'rv'},lnk('اسم',()=>{const n=prompt('اسم الجهاز',dev(x));if(n===null)return;const o=names();n.trim()?o[m]=n.trim():delete o[m];localStorage.setItem('devnames',JSON.stringify(o));draw()}),
          isMe?null:h('button',{class:'mini',onclick:async()=>{if(!confirm('حظر '+dev(x)+'؟ سيتم فصله ومنعه من الاتصال.'))return;Q.status=2;if(!Q.list.includes(m))Q.list.push(m);await applyFilter()}},'حظر')))}):[h('div',{class:'empty'},'لا توجد أجهزة متصلة')])),
    h('h2',{},'التحكم بالوصول (واي فاي)'),
    h('div',{class:'seg'},...mode.map(([l,v])=>chip(l,Q.status===v,()=>{Q.status=v;draw()}))),
    Q.status?h('div',{class:'empty',style:'padding:4px 4px 10px;text-align:start'},Q.status===1?'يُسمح فقط للأجهزة في القائمة بالاتصال.':'يُمنع الاتصال على الأجهزة في القائمة.'):null,
    Q.status?grp(...(Q.list.length?Q.list.map(m=>h('div',{class:'row'},h('div',{},dn(m)||'جهاز',h('small',{class:'num'},m)),lnk('إزالة',()=>{Q.list=Q.list.filter(x=>x!==m);draw()}))):[h('div',{class:'empty'},'القائمة فارغة')])):null,
    Q.status?h('div',{class:'seg'},...hosts.filter(x=>!Q.list.includes(nmac(x.MacAddress))).map(x=>chip('+ '+dev(x),false,()=>addMac(x.MacAddress))),
      chip('+ MAC يدوي',false,()=>{const m=prompt('عنوان MAC (مثال AA:BB:CC:DD:EE:FF)');if(m)addMac(m,(prompt('اسم للجهاز (اختياري)')||'').trim())})):null,
    h('div',{style:'margin:10px 0'},h('button',{class:'btn',onclick:applyFilter},'تطبيق القائمة')),
    h('h2',{},'أقصى عدد أجهزة'),
    h('div',{class:'seg'},...[1,2,3,4,5,6,7,8,9,10].map(n=>chip(n,+bs.WifiMaxAssoc===n,async()=>{if(+bs.WifiMaxAssoc!==n&&confirm('تغيير أقصى عدد أجهزة سيعيد تشغيل الواي فاي. متابعة؟')){await setBasic({WifiMaxAssoc:n});load()}}))),
    h('h2',{},'عزل الأجهزة عن بعضها'),
    grp(row('AP Isolation',bs.WifiIsolate==='1'?'مفعّل':'معطّل',lnk(bs.WifiIsolate==='1'?'إيقاف':'تشغيل',async()=>{if(confirm('سيعاد تشغيل الواي فاي. متابعة؟')){await setBasic({WifiIsolate:bs.WifiIsolate==='1'?0:1});load()}}))),
    h('div',{class:'empty',style:'padding-top:10px;text-align:start'},'ملاحظة: لا يوجد في هذا الفيرمور إعداد لأولوية الإنترنت بين الأجهزة (QoS)، والحل المتاح هو تحديد الأجهزة المسموح لها وأقصى عدد.'));
}
async function load(){
  const box=$('#t-devices');box.replaceChildren(h('div',{class:'empty'},'جارٍ التحميل…'));
  try{
    const [m,hl,f,b]=await Promise.all([api('/api/whoami').catch(()=>({})),rpc('wlan.host_list').catch(()=>({})),raw('wlan/mac-filter'),raw('wlan/basic-settings')]);
    me=m;mf=f;bs=b;hosts=asList((hl.Hosts||{}).Host);
    Q={status:+f.WifiMacFilterStatus||0,list:Array.from({length:10},(_,i)=>nmac(f['WifiMacFilterMac'+i])).filter(Boolean)};
    draw();
  }catch(e){box.replaceChildren(h('div',{class:'empty'},e.message))}
}
registerPage({id:'devices',title:'الأجهزة والتحكم',parent:'more',desc:'قائمة سوداء وبيضاء، أقصى عدد أجهزة، العزل',load});

// ---- HOME_BLOCK_UI: connected-devices + block/unblock list on the home page ----
let homeMF=null, homeMFt=0;
async function homeFilter(force){
  if(force||!homeMF||Date.now()-homeMFt>8000){homeMF=await raw('wlan/mac-filter');homeMFt=Date.now()}
  return homeMF;
}
function homeMfList(mf){return Array.from({length:10},(_,i)=>nmac(mf['WifiMacFilterMac'+i])).filter(Boolean)}
async function homeWriteList(mf,list,status){
  const d={...mf,WifiMacFilterStatus:String(status)};
  for(let i=0;i<10;i++)d['WifiMacFilterMac'+i]=list[i]||'';
  return raw('wlan/mac-filter',d);
}
async function homeBlock(m,label){
  if(!confirm('حظر '+label+'؟ سيتم فصله ومنعه من الاتصال.'))return;
  const mf=await homeFilter(true),list=homeMfList(mf);
  if(!list.includes(m)){
    if(list.length>=10)return toast('الحد الأقصى 10 أجهزة في القائمة');
    list.push(m);
  }
  if(await act(()=>homeWriteList(mf,list,2),'تم الحظر')){await homeFilter(true);refresh(true)}
}
async function homeUnblock(m){
  const mf=await homeFilter(true),list=homeMfList(mf).filter(x=>x!==m);
  if(await act(()=>homeWriteList(mf,list,list.length?2:0),'تم إلغاء الحظر')){await homeFilter(true);refresh(true)}
}
window.renderHomeHosts=async function(hosts){
  const box=$('#hosts');if(!box)return;
  if(!window.__me)window.__me=await api('/api/whoami').catch(()=>({}));
  let mf;try{mf=await homeFilter()}catch(e){
    box.replaceChildren(...(hosts.length?hosts.map(x=>row(x.name||'جهاز',x.ip||'')):[h('div',{class:'empty'},'لا توجد أجهزة')]));return}
  const blockedList=mf.WifiMacFilterStatus==='2'?homeMfList(mf):[],blockedSet=new Set(blockedList);
  const mine=nmac((window.__me||{}).mac),visible=hosts.filter(x=>!blockedSet.has(nmac(x.mac)));
  box.replaceChildren(...(visible.length?visible.map(x=>{
    const m=nmac(x.mac),isMe=m&&m===mine,lbl=names()[m]||x.name||'جهاز';
    return h('div',{class:'row'},h('div',{},lbl+(isMe?' (جهازك)':''),h('small',{class:'num'},x.ip||'')),
      isMe||!m?null:h('button',{class:'mini',onclick:()=>homeBlock(m,lbl)},'حظر'));
  }):[h('div',{class:'empty'},'لا توجد أجهزة')]));
  let bb=document.getElementById('blockedarea');
  if(!bb){bb=h('div',{id:'blockedarea'});box.insertAdjacentElement('afterend',bb)}
  const blist=blockedList.map(m=>{
    const known=hosts.find(x=>nmac(x.mac)===m),lbl=names()[m]||(known&&known.name)||'جهاز';
    return h('div',{class:'row'},h('div',{},lbl,h('small',{class:'num'},m)),h('button',{class:'mini',onclick:()=>homeUnblock(m)},'إلغاء الحظر'));
  });
  bb.replaceChildren(h('div',{style:'border-top:1px solid var(--line);margin:14px 4px 4px'}),h('h2',{},'الأجهزة المحظورة'),
    blist.length?grp(...blist):h('div',{class:'empty'},'لا توجد أجهزة محظورة'));
};

// ---- advanced Wi-Fi radio settings, appended to the Wi-Fi page ----
HOOKS.wifi.push(async b=>{
  const cur=await raw('wlan/basic-settings'),on=cur.Wifioffenable==='1',redo=()=>go('wifi');
  const ask=async(patch)=>{if(confirm('سيعاد تشغيل الواي فاي وقد ينقطع اتصالك لثوانٍ. متابعة؟')){await setBasic(patch);redo()}};
  const sel=(opts,val,fn)=>h('select',{onchange:e=>fn(e.target.value),style:'width:auto;padding:8px 10px'},...opts.map(([v,l])=>h('option',v==val?{value:v,selected:''}:{value:v},l)));
  return [h('h2',{},'إعدادات متقدمة'),grp(
    row('القناة',null,sel([['0','تلقائي'],...Array.from({length:13},(_,i)=>[String(i+1),String(i+1)])],cur.WifiChannel,v=>ask({WifiChannel:v}))),
    row('عرض النطاق',null,sel([['20','20 MHz'],['40','40 MHz']],cur.wifibandwidth,v=>ask({wifibandwidth:v}))),
    row('قوة الإرسال',null,sel([['100','100%'],['75','75%'],['50','50%'],['25','25%']],cur.WifiTxPwrPcnt,v=>ask({WifiTxPwrPcnt:v}))),
    row('إطفاء الواي فاي تلقائياً عند عدم الاستخدام',on?'مفعّل':'معطّل',lnk(on?'إيقاف':'تشغيل',()=>ask({Wifioffenable:on?0:1}))),
    on?row('مدة الانتظار',null,sel([['600','10 دقائق'],['1200','20 دقيقة'],['1800','30 دقيقة']],cur.Wifiofftime,v=>ask({Wifiofftime:v}))):null),
    h('div',{class:'empty',style:'padding:8px 4px;text-align:start'},'بعض هذه القيم قد يتجاهلها الفيرمور، وسأخبرك بعد التطبيق إن لم تتغير.')];
});
})();
