// Advanced pages mirroring the original WebUI: connection (roaming/idle), firewall + NAT + DMZ + SIP + port forwarding, DHCP + DNS.
(()=>{
const raw=async(p,d)=>(await api('/api/raw',{p,d})).r;
const IPV4=/^(\d{1,3}\.){3}\d{1,3}$/,LAN=/^192\.168\.8\.(\d{1,3})$/;
const lastOct=ip=>+(ip||'').split('.')[3]||0;
const priv=ip=>/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip||'');

// read-modify-write exactly like the original WebUI, then read back to see whether the firmware accepted it
async function patch(p,upd){
  const cur=await raw(p);
  await raw(p,{...cur,...upd});
  let after=null;for(let i=0;i<3&&!after;i++){try{after=await raw(p)}catch(e){await sleep(2500)}}
  const r=!after?'unknown':Object.entries(upd).every(([k,v])=>String(after[k])===String(v))?'ok':'ignored';
  toast(r==='ok'?'تم الحفظ':r==='ignored'?'الراوتر تجاهل التغيير (غير مدعوم في هذا الفيرمور)':'تم الإرسال، تعذّر التحقق');
  return r;
}
const sel=(opts,val,fn)=>h('select',{onchange:e=>fn(e.target.value),style:'width:auto;padding:8px 10px'},...opts.map(([v,l])=>h('option',String(v)===String(val)?{value:v,selected:''}:{value:v},l)));
const sw=(label,on,fn,small)=>h('div',{class:'row'},h('div',{},label,small?h('small',{},small):null),lnk(on?'إيقاف':'تشغيل',fn),h('span',{class:'num'},on?'●':'○'));

// ---------- connection ----------
async function loadConn(){
  const box=$('#t-conn');box.replaceChildren(h('div',{class:'empty'},'جارٍ التحميل…'));
  try{
    const c=await raw('dialup/connection'),redo=()=>loadConn(),roam=c.RoamAutoConnectEnable==='1',auto=c.auto_dial_switch==='1';
    const set=async(u,ask)=>{if(ask&&!confirm(ask))return;await patch('dialup/connection',u);redo()};
    box.replaceChildren(
      h('h2',{},'الاتصال بالإنترنت'),
      grp(sw('تجوال البيانات (Roaming)',roam,()=>set({RoamAutoConnectEnable:roam?0:1},roam?'':'تشغيل التجوال قد يسبب رسوماً إضافية. متابعة؟'),'الاتصال التلقائي أثناء التجوال'),
        sw('الاتصال التلقائي عند التشغيل',auto,()=>set({auto_dial_switch:auto?0:1})),
        row('قطع الاتصال عند عدم الاستخدام',null,sel([[300,'5 دقائق'],[600,'10 دقائق'],[1200,'20 دقيقة'],[7200,'120 دقيقة']],c.MaxIdelTime,v=>set({MaxIdelTime:v}))),
        row('وضع الاتصال',c.ConnectMode==='0'?'تلقائي':'يدوي'),row('MTU',c.MTU||'—')),
      h('div',{class:'empty',style:'padding:10px 4px;text-align:start'},'قطع الاتصال عند عدم الاستخدام يفيد لو تستخدم بياناتك قليلاً وتبغى توفر الباقة.'));
  }catch(e){box.replaceChildren(h('div',{class:'empty'},e.message))}
}

// ---------- firewall / NAT / DMZ / SIP / port forwarding ----------
async function loadFw(){
  const box=$('#t-firewall');box.replaceChildren(h('div',{class:'empty'},'جارٍ التحميل…'));
  const g=p=>raw(p).catch(()=>null);
  const [fs,nat,dmz,sip,vs,dv,hl]=await Promise.all([g('security/firewall-switch'),g('security/nat'),g('security/dmz'),g('security/sip'),g('security/virtual-servers'),safe('device.information'),safe('wlan.host_list')]);
  const redo=()=>loadFw(),hosts=asList((hl.Hosts||{}).Host);
  const set=(p,u,ask)=>async()=>{if(ask&&!confirm(ask))return;await patch(p,u);redo()};
  const servers=asList(((vs||{}).Servers||{}).Server);
  const saveServers=async list=>{await raw('security/virtual-servers',{Servers:{Server:list}});toast('تم الحفظ');redo()};
  const out=[];
  if(fs){const t=k=>fs[k]==='1',f=(k,v)=>set('security/firewall-switch',{[k]:v});
    out.push(h('h2',{},'الجدار الناري'),grp(
      sw('تشغيل الجدار الناري',t('FirewallMainSwitch'),f('FirewallMainSwitch',t('FirewallMainSwitch')?0:1)),
      sw('فلتر عناوين IP',t('FirewallIPFilterSwitch'),f('FirewallIPFilterSwitch',t('FirewallIPFilterSwitch')?0:1)),
      sw('منع Ping من الإنترنت (WAN)',fs.FirewallWanPortPingSwitch==='0',f('FirewallWanPortPingSwitch',fs.FirewallWanPortPingSwitch==='0'?1:0)),
      sw('فلتر المواقع (URL)',t('firewallurlfilterswitch'),f('firewallurlfilterswitch',t('firewallurlfilterswitch')?0:1)),
      fs.firewallmacfilterswitch!==undefined?sw('فلتر MAC في الجدار',t('firewallmacfilterswitch'),f('firewallmacfilterswitch',t('firewallmacfilterswitch')?0:1)):null))}
  if(nat)out.push(h('h2',{},'نوع NAT'),h('div',{class:'seg'},chip('Cone (أفضل للألعاب وP2P)',nat.NATType==='1',set('security/nat',{NATType:1})),chip('Symmetric (أكثر أماناً)',nat.NATType==='0',set('security/nat',{NATType:0}))));
  if(dmz)out.push(h('h2',{},'DMZ'),grp(
    sw('تفعيل DMZ',dmz.DmzStatus==='1',async()=>{
      if(dmz.DmzStatus==='1')return set('security/dmz',{DmzStatus:0})();
      const ip=(prompt('عنوان الجهاز الذي يستقبل كل الاتصالات (مثال 192.168.8.101)',dmz.DmzIPAddress||'')||'').trim();
      if(!LAN.test(ip)||ip==='192.168.8.1'||lastOct(ip)>254)return toast('عنوان غير صالح');
      if(confirm('DMZ يفتح كل المنافذ لهذا الجهاز ويعرّضه للإنترنت. متابعة؟'))set('security/dmz',{DmzStatus:1,DmzIPAddress:ip})()},'يفتح كل المنافذ لجهاز واحد'),
    row('الجهاز',dmz.DmzIPAddress||'—')));
  if(sip)out.push(h('h2',{},'SIP ALG'),grp(sw('SIP ALG',sip.SipStatus==='1',set('security/sip',{SipStatus:sip.SipStatus==='1'?0:1}),'مفيد لبعض تطبيقات الاتصال الصوتي'),row('المنفذ',sip.SipPort||'—')));
  if(vs){
    out.push(h('h2',{},`فتح المنافذ (${servers.length}/16)`),
      grp(...(servers.length?servers.map((s,i)=>h('div',{class:'row'},h('div',{},s.VirtualServerIPName||'قاعدة',h('small',{class:'num'},`${s.VirtualServerWanPort} → ${s.VirtualServerIPAddress}:${s.VirtualServerLanPort} · ${({0:'TCP/UDP',6:'TCP',17:'UDP'})[s.VirtualServerProtocol]||s.VirtualServerProtocol}${s.VirtualServerStatus==='1'?'':' · معطّلة'}`)),
        h('div',{class:'rv'},lnk(s.VirtualServerStatus==='1'?'إيقاف':'تفعيل',()=>saveServers(servers.map((x,j)=>j===i?{...x,VirtualServerStatus:x.VirtualServerStatus==='1'?0:1}:x))),
          h('button',{class:'mini',onclick:()=>{if(confirm('حذف هذه القاعدة؟'))saveServers(servers.filter((_,j)=>j!==i))}},'حذف')))):[h('div',{class:'empty'},'لا توجد قواعد')])));
    if(priv(dv.WanIPAddress))out.push(h('div',{class:'empty',style:'padding:8px 4px;text-align:start;color:var(--warn)'},'عنوان الإنترنت (WAN) عندك عنوان خاص ('+dv.WanIPAddress+')، يعني الشركة غالباً تستخدم CGNAT، وفتح المنافذ لن يوصّل أحداً من الإنترنت لجهازك.'));
    if(servers.length<16){
      const nm=h('input',{placeholder:'الاسم',id:'pfn'}),ip=h('select',{id:'pfip',style:'padding:11px'},...hosts.map(x=>h('option',{value:x.IpAddress},`${x.HostName||'جهاز'} (${x.IpAddress})`)),h('option',{value:''},'عنوان آخر…')),
        wp=h('input',{class:'ltr',placeholder:'منفذ WAN',id:'pfw',inputmode:'numeric'}),lp=h('input',{class:'ltr',placeholder:'منفذ LAN (اختياري)',id:'pfl',inputmode:'numeric'}),pr=sel([[0,'TCP/UDP'],[6,'TCP'],[17,'UDP']],0,()=>{});
      out.push(h('h2',{},'إضافة قاعدة'),h('div',{class:'grp',style:'display:grid;gap:10px;padding:12px 14px'},nm,ip,wp,lp,pr,h('button',{class:'btn',onclick:()=>{
        let a=ip.value;if(!a){a=(prompt('عنوان الجهاز (192.168.8.x)')||'').trim()}
        const w=+wp.value,l=+(lp.value||wp.value);
        if(!LAN.test(a)||lastOct(a)>254)return toast('عنوان الجهاز غير صالح');
        if(!(w>=1&&w<=65535&&l>=1&&l<=65535))return toast('رقم منفذ غير صالح (1 إلى 65535)');
        if(servers.some(s=>+s.VirtualServerWanPort===w&&(s.VirtualServerProtocol===pr.value||s.VirtualServerProtocol==='0'||pr.value==='0')))return toast('يوجد قاعدة بنفس منفذ WAN والبروتوكول');
        saveServers([...servers,{VirtualServerIPName:nm.value.trim()||'rule',VirtualServerStatus:1,VirtualServerRemoteIP:'',VirtualServerWanPort:w,VirtualServerWanEndPort:'',VirtualServerLanPort:l,VirtualServerIPAddress:a,VirtualServerProtocol:pr.value}])}},'إضافة')));
    }
  }
  box.replaceChildren(...(out.length?out:[h('div',{class:'empty'},'هذه الميزات غير متاحة في هذا الفيرمور')]));
}

// ---------- DHCP + DNS ----------
const DNS=[['Google','8.8.8.8','8.8.4.4'],['Cloudflare','1.1.1.1','1.0.0.1'],['Quad9','9.9.9.9','149.112.112.112'],['AdGuard (يحجب الإعلانات)','94.140.14.14','94.140.15.15']];
async function loadLan(){
  const box=$('#t-lan');box.replaceChildren(h('div',{class:'empty'},'جارٍ التحميل…'));
  try{
    const d=await raw('dhcp/settings'),redo=()=>loadLan();
    if(d.DnsStatus==='1'&&d.PrimaryDns===d.DhcpIPAddress&&!localStorage.getItem('dhcp_orig'))localStorage.setItem('dhcp_orig',JSON.stringify({DnsStatus:d.DnsStatus,PrimaryDns:d.PrimaryDns,SecondaryDns:d.SecondaryDns}));
    const orig=JSON.parse(localStorage.getItem('dhcp_orig')||'null'),auto=d.DnsStatus==='1';
    const go=(u,ask)=>async()=>{if(ask&&!confirm(ask))return;toast('جارٍ التطبيق… قد ينقطع الاتصال لثوانٍ');const r=await patch('dhcp/settings',u);if(r!=='ignored')await sleep(1000);redo()};
    const range=async()=>{
      const s=+prompt('بداية النطاق (آخر رقم من العنوان، 2 إلى 253)',lastOct(d.DhcpStartIPAddress)),e=+prompt('نهاية النطاق (آخر رقم، أكبر من البداية)',lastOct(d.DhcpEndIPAddress));
      if(!(s>=2&&e<=254&&s<e))return toast('نطاق غير صالح');
      go({DhcpStartIPAddress:'192.168.8.'+s,DhcpEndIPAddress:'192.168.8.'+e})()};
    box.replaceChildren(
      h('h2',{},'الشبكة المحلية (DHCP)'),
      grp(row('عنوان الراوتر',d.DhcpIPAddress),row('القناع',d.DhcpLanNetmask),row('نطاق العناوين',`${lastOct(d.DhcpStartIPAddress)} – ${lastOct(d.DhcpEndIPAddress)}`,lnk('تعديل',range)),
        row('مدة التأجير',null,sel([[3600,'ساعة'],[43200,'12 ساعة'],[86400,'24 ساعة'],[172800,'48 ساعة']],d.DhcpLeaseTime,v=>go({DhcpLeaseTime:v})()))),
      h('div',{class:'empty',style:'padding:8px 4px;text-align:start'},'عنوان الراوتر وتشغيل DHCP محميان من التغيير هنا حتى لا تفقد الوصول.'),
      h('h2',{},'خادم DNS الموزّع على الأجهزة'),
      grp(row('الوضع',auto?'تلقائي (الراوتر)':'مخصص'),row('الأساسي',d.PrimaryDns),row('الثانوي',d.SecondaryDns)),
      h('div',{class:'seg'},...DNS.map(([n,a,b])=>chip(n,!auto&&d.PrimaryDns===a,go({DnsStatus:0,PrimaryDns:a,SecondaryDns:b},'تغيير DNS إلى '+n+'؟ الأجهزة تحتاج إعادة اتصال بالواي فاي لتأخذه.'))),
        orig?chip('الرجوع للتلقائي',auto,go(orig)):null),
      h('div',{class:'empty',style:'padding:8px 4px;text-align:start'},'تجريبي: بعض الفيرمورات لا تقبل DNS مخصصاً. سأخبرك لو تجاهله، وزر "الرجوع للتلقائي" يعيد القيم الأصلية.'));
  }catch(e){box.replaceChildren(h('div',{class:'empty'},e.message))}
}

registerPage({id:'conn',title:'الاتصال والتجوال',parent:'more',desc:'تجوال البيانات، قطع الاتصال التلقائي',load:loadConn});
registerPage({id:'firewall',title:'الحماية والمنافذ',parent:'more',desc:'جدار ناري، NAT، DMZ، فتح المنافذ',load:loadFw});
registerPage({id:'lan',title:'الشبكة المحلية وDNS',parent:'more',desc:'DHCP ومدة التأجير وخوادم DNS',load:loadLan});
})();
