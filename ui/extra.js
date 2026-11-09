// Extra pages found in the device's own API catalog but not in either WebUI:
// scheduled (time-based) access, carrier remote-management (CWMP/TR-069), DDNS, USB/SD storage sharing status.
// These were NOT visible in the original WebUI's menus, so support varies — every call is wrapped and fails softly.
(()=>{
const raw=async(p,d)=>(await api('/api/raw',{p,d})).r;
const DAYS=['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
const pad=n=>String(n).padStart(2,'0');

// ---------- scheduled access (Wi-Fi / mobile data time rules) ----------
async function loadSchedule(){
  const box=$('#t-schedule');box.replaceChildren(h('div',{class:'empty'},'جارٍ التحميل…'));
  let cur;
  try{cur=await rpc('timerule.timerule')}
  catch(e){box.replaceChildren(h('div',{class:'empty'},'هذه الميزة غير مدعومة في هذا الفيرمور (غير متاحة أصلاً في واجهته الأصلية).'));return}
  const rules=asList((cur.Timerulelist||cur.TimeRuleList||{}).Timerule||cur.rules);
  const save=async list=>{
    try{await raw('timerule/timerule',{Timerulelist:{Timerule:list}});toast('تم الحفظ');load()}
    catch(e){toast('الراوتر رفض الحفظ: '+e.message)}
  };
  const draw=()=>{
    box.replaceChildren(
      h('h2',{},'إيقاف الإنترنت حسب الوقت'),
      h('div',{class:'empty',style:'padding:4px 4px 12px;text-align:start'},'مثال: إيقاف الإنترنت عن الكل من 11 مساءً حتى 7 صباحاً.'),
      grp(...(rules.length?rules.map((r,i)=>h('div',{class:'row'},h('div',{},`${DAYS[+r.week]||r.week} ${r.starttime||r.StartTime}–${r.endtime||r.EndTime}`,
        h('small',{},r.enable==='1'||r.Enable==='1'?'مفعّل':'معطّل')),
        h('div',{class:'rv'},lnk('حذف',()=>{if(confirm('حذف هذا الموعد؟'))save(rules.filter((_,j)=>j!==i))})))):[h('div',{class:'empty'},'لا توجد مواعيد محفوظة')])),
      h('h2',{},'إضافة موعد'),
      h('div',{class:'grp',style:'display:grid;gap:10px;padding:12px 14px'},
        h('select',{id:'schd',style:'padding:11px'},...DAYS.map((d,i)=>h('option',{value:i},'كل '+d))),
        h('div',{class:'send'},h('input',{class:'ltr',id:'scht1',type:'time',value:'23:00'}),h('span',{style:'align-self:center'},'إلى'),h('input',{class:'ltr',id:'scht2',type:'time',value:'07:00'})),
        h('button',{class:'btn',onclick:()=>{
          if(rules.length>=8)return toast('الحد الأقصى 8 مواعيد');
          const week=$('#schd').value,s=$('#scht1').value,e=$('#scht2').value;
          save([...rules,{week,starttime:s,endtime:e,enable:'1'}])}},'إضافة')));
  };
  draw();
}

// ---------- carrier remote management (CWMP / TR-069) ----------
async function loadRemote(){
  const box=$('#t-remote');box.replaceChildren(h('div',{class:'empty'},'جارٍ التحميل…'));
  try{
    const c=await rpc('cwmp.basic_info');
    const on=!(c.cwmpstatus==='0'||c.Enable==='0');
    box.replaceChildren(
      h('h2',{},'الإدارة عن بُعد من الشركة'),
      h('div',{class:'empty',style:'padding:4px 4px 12px;text-align:start'},'شركة الاتصالات تقدر تتحكم أو تراقب إعدادات الراوتر عن بُعد عبر بروتوكول يسمى TR-069/CWMP. إيقافه يزيد خصوصيتك، وقد يمنع تحديثات أو دعماً تلقائياً من الشركة.'),
      grp(row('الخادم',c.url||c.URL||'—'),row('الحالة',on?'مفعّل':'معطّل')),
      h('div',{class:'empty',style:'padding:8px 4px;text-align:start;color:var(--warn)'},'لم أجد زراً لإيقافه من واجهة الراوتر الأصلية ولا طريقة آمنة مؤكدة لإيقافه من هنا، فعرضت الحالة للقراءة فقط حتى لا أخاطر بإعداد تتحكم فيه الشركة.'));
  }catch(e){box.replaceChildren(h('div',{class:'empty'},'تعذّرت القراءة: '+e.message))}
}

// ---------- DDNS ----------
async function loadDdns(){
  const box=$('#t-ddns');box.replaceChildren(h('div',{class:'empty'},'جارٍ التحميل…'));
  let list;
  try{list=asList(((await raw('ddns/ddns-list'))||{}).ddnss?.ddns || ((await rpc('d_dns.get_ddns_list'))||{}).ddnss?.ddns)}
  catch(e){box.replaceChildren(h('div',{class:'empty'},'هذه الميزة غير متاحة في هذا الفيرمور.'));return}
  const save=async l=>{try{await raw('ddns/ddns-list',{ddnss:{ddns:l}});toast('تم الحفظ');load()}catch(e){toast(e.message)}};
  box.replaceChildren(
    h('h2',{},'DDNS (الوصول للراوتر من الإنترنت باسم ثابت)'),
    h('div',{class:'empty',style:'padding:4px 4px 12px;text-align:start'},'مفيد فقط إذا عنوان الإنترنت (WAN) عندك عام، تحقق من ذلك في صفحة الحماية والمنافذ.'),
    grp(...(list.length?list.map((d,i)=>h('div',{class:'row'},h('div',{},d.domainname||'—',h('small',{},d.provider||'')),
      h('div',{class:'rv'},lnk(d.status==='1'?'إيقاف':'تشغيل',()=>save(list.map((x,j)=>j===i?{...x,status:x.status==='1'?'0':'1'}:x))),
        h('button',{class:'mini',onclick:()=>{if(confirm('حذف؟'))save(list.filter((_,j)=>j!==i))}},'حذف')))):[h('div',{class:'empty'},'لا يوجد')])),
    list.length<4?h('div',{class:'grp',style:'display:grid;gap:10px;padding:12px 14px;margin-top:12px'},
      h('input',{class:'ltr',id:'ddp',placeholder:'المزوّد (مثال: 3322.org أو no-ip.com)'}),
      h('input',{class:'ltr',id:'ddd',placeholder:'النطاق (مثال: myrouter.ddns.net)'}),
      h('input',{class:'ltr',id:'ddu',placeholder:'اسم المستخدم'}),
      h('input',{class:'ltr',id:'ddw',placeholder:'كلمة السر',type:'password'}),
      h('button',{class:'btn',onclick:()=>{
        const p=$('#ddp').value.trim(),d=$('#ddd').value.trim(),u=$('#ddu').value.trim(),w=$('#ddw').value;
        if(!p||!d)return toast('أدخل المزوّد والنطاق');
        save([...list,{index:String(list.length+1),provider:p,status:'1',domainname:d,username:u,password:w}])}},'إضافة')):null);
}

// ---------- storage sharing status (matches "مشاركة SD" in the original UI) ----------
async function loadStorage(){
  const box=$('#t-storage');box.replaceChildren(h('div',{class:'empty'},'جارٍ التحميل…'));
  const rows=[];
  try{const fs=await rpc('usb_storage.fsstatus');rows.push(row('بطاقة/تخزين متصل',fs.FsStatus==='1'||fs.status==='1'?'نعم':'لا'))}catch(e){}
  try{const sd=await rpc('sd_card.share_account');rows.push(row('مشاركة SD مفعّلة',sd.enable==='1'||sd.Enable==='1'?'نعم':'لا'))}catch(e){}
  box.replaceChildren(h('h2',{},'مشاركة التخزين'),
    rows.length?grp(...rows):h('div',{class:'empty'},'لا توجد بطاقة SD أو تخزين متصل بالراوتر حالياً.'),
    h('div',{class:'empty',style:'padding:8px 4px;text-align:start'},'هذا الجهاز بالذات لا يحتوي منفذ تخزين USB، والميزة هنا لبطاقة microSD فقط إن وُجدت.'));
}

registerPage({id:'schedule',title:'الجدولة الزمنية',parent:'more',desc:'إيقاف الإنترنت تلقائياً بأوقات محددة',load:loadSchedule});
registerPage({id:'remote',title:'الإدارة عن بُعد',parent:'more',desc:'هل تتحكم الشركة بالراوتر عن بُعد (TR-069)؟',load:loadRemote});
registerPage({id:'ddns',title:'DDNS',parent:'more',desc:'الوصول للراوتر من الإنترنت باسم ثابت',load:loadDdns});
registerPage({id:'storage',title:'مشاركة التخزين',parent:'more',desc:'حالة مشاركة بطاقة SD',load:loadStorage});
})();
