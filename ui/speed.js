// Speed page: gauge, ping / download / upload test, unit + range switches, history.
(()=>{
const CF=localStorage.getItem('speedbase')||'https://speed.cloudflare.com',LEN=Math.PI*100;
const st=(k,d)=>+localStorage.getItem(k)||d;
const Z={running:false,stop:false,srv:false,max:st('gmax',100),dur:st('sdur',10),used:0};
document.head.append(h('style',{},`
.gwrap{padding:14px 0 0;text-align:center}
#gs{width:100%;max-width:380px;direction:ltr}
.gtrack{stroke:var(--line)}.gfill{stroke:var(--sig);transition:stroke-dasharray .3s}
.needle{stroke:var(--ink);transform-origin:120px 130px;transition:transform .3s ease}
.hub{fill:var(--ink)}#gticks text{fill:var(--mute);font-size:9px;text-anchor:middle}
.gread{margin-top:-30px}.gread b{font-size:48px;line-height:1}.gread span{color:var(--mute);margin-inline-start:6px}
#gphase{color:var(--mute);min-height:24px;margin:4px 0 10px}
.opt{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.opt>span{color:var(--mute);font-size:13px;min-width:64px}
.opt .seg{padding:4px 0}
.chip.s{padding:4px 12px;min-height:34px;font-size:14px}`));

const stats=t=>({min:Math.min(...t),avg:t.reduce((a,b)=>a+b,0)/t.length,max:Math.max(...t),jit:t.slice(1).reduce((s,v,i)=>s+Math.abs(v-t[i]),0)/Math.max(1,t.length-1)});
const fv=v=>v>=100?v.toFixed(0):v>=10?v.toFixed(1):v.toFixed(2);
const nice=v=>v>=100?Math.round(v):+v.toFixed(1);
const tok=()=>({'X-Token':localStorage.getItem('tok')||''});

function ticks(){
  $('#gticks').innerHTML=[0,.25,.5,.75,1].map(f=>{const a=Math.PI*(1-f);return `<text x="${(120+112*Math.cos(a)).toFixed(1)}" y="${(133-112*Math.sin(a)).toFixed(1)}">${nice(Z.max*f)}</text>`}).join('');
  $('#gunit').textContent=unit();
}
function needle(Bps){
  const v=toUnit(Bps),f=Math.max(0,Math.min(1,v/Z.max));
  $('#gneedle').style.transform=`rotate(${-90+180*f}deg)`;
  $('#garc').setAttribute('stroke-dasharray',`${(LEN*f).toFixed(1)} ${LEN+5}`);
  $('#gval').textContent=fv(v);
}
const phase=t=>{$('#gphase').textContent=t};

async function pingTest(){
  if(!Z.srv){
    try{const t=[];for(let i=0;i<11;i++){const s=performance.now();await fetch(CF+'/__down?bytes=0&r='+Math.random(),{cache:'no-store'});t.push(performance.now()-s)}t.shift();return stats(t)}
    catch(e){Z.srv=true;toast('تعذّر الاتصال المباشر بخادم الاختبار، سيتم القياس عبر اللابتوب')}
  }
  return stats((await api('/api/speed/ping')).ms);
}
async function dlTest(secs){
  const ctl=new AbortController(),url=()=>Z.srv?'/api/speed/down?bytes=25000000&r='+Math.random():CF+'/__down?bytes=25000000&r='+Math.random();
  let bytes=0,warm=null,last=performance.now(),lastB=0,ema=0,peak=0;const start=last;
  const tick=setInterval(()=>{const n=performance.now(),inst=(bytes-lastB)/((n-last)/1000);lastB=bytes;last=n;ema=ema?ema*.6+inst*.4:inst;peak=Math.max(peak,ema);needle(ema);
    if(warm===null&&n-start>=1500)warm=[bytes,n]},250);
  const work=async()=>{while(!ctl.signal.aborted){try{const r=await fetch(url(),{cache:'no-store',signal:ctl.signal,headers:Z.srv?tok():{}});const rd=r.body.getReader();for(;;){const{done,value}=await rd.read();if(done)break;bytes+=value.length}}catch(e){if(ctl.signal.aborted)return;throw e}}};
  const ws=[1,2,3,4].map(()=>work().catch(()=>{}));
  for(let i=0;i<secs*10&&!Z.stop;i++)await sleep(100);
  ctl.abort();clearInterval(tick);await Promise.allSettled(ws);
  if(!bytes)throw new Error('blocked');
  Z.used+=bytes;const n=performance.now(),e=warm&&secs>3?(bytes-warm[0])/((n-warm[1])/1000):bytes/((n-start)/1000);
  return{bps:e,peak};
}
async function ulTest(secs){
  if(Z.srv){const r=await api('/api/speed/up',{bytes:secs>=15?24e6:secs>=8?12e6:6e6});needle(r.bps);Z.used+=r.bytes;return{bps:r.bps,peak:r.bps}}
  return new Promise((resolve,reject)=>{
    const chunk=new Uint8Array(65536);crypto.getRandomValues(chunk);const blob=new Blob(Array(64).fill(chunk));
    let done=0,stop=false,warm=null,last=performance.now(),lastB=0,ema=0,peak=0;const live=[0,0,0,0],xs=[],start=last;
    const total=()=>done+live.reduce((a,b)=>a+b,0);
    const end=err=>{if(stop)return;stop=true;clearInterval(tick);xs.forEach(x=>x.abort());const n=performance.now(),b=total();
      if(!b)return reject(new Error('blocked'));Z.used+=b;resolve({bps:warm&&secs>3?(b-warm[0])/((n-warm[1])/1000):b/((n-start)/1000),peak})};
    const tick=setInterval(()=>{const n=performance.now(),b=total(),inst=(b-lastB)/((n-last)/1000);lastB=b;last=n;ema=ema?ema*.6+inst*.4:inst;peak=Math.max(peak,ema);needle(ema);
      if(warm===null&&n-start>=1500)warm=[b,n];if(n-start>=secs*1000||Z.stop)end()},250);
    const run=i=>{if(stop)return;const x=new XMLHttpRequest();xs.push(x);x.open('POST',CF+'/__up');x.upload.onprogress=e=>{live[i]=e.loaded};x.onload=()=>{done+=blob.size;live[i]=0;run(i)};x.onerror=()=>end(true);x.send(blob)};
    [0,1,2,3].forEach(run);
  });
}

async function runTest(){
  if(Z.running){Z.stop=true;return}
  if(!localStorage.getItem('swarn')){if(!confirm('اختبار السرعة يستهلك بيانات من باقتك (من عشرات إلى مئات الميجابايت حسب السرعة والمدة). متابعة؟'))return;localStorage.setItem('swarn','1')}
  Z.running=true;Z.stop=false;Z.used=0;$('#sgo').textContent='إيقاف';needle(0);$('#sres').replaceChildren();
  const r={t:Date.now()};
  try{
    phase('قياس زمن الاستجابة…');r.ping=await pingTest();
    phase('قياس التحميل…');
    try{r.down=await dlTest(Z.dur)}catch(e){if(e.message!=='blocked'||Z.srv)throw e;Z.srv=true;toast('تعذّر التحميل المباشر، سيتم القياس عبر اللابتوب');r.down=await dlTest(Z.dur)}
    needle(r.down.bps);if(!Z.stop){phase('قياس الرفع…');await sleep(600);try{r.up=await ulTest(Z.dur)}catch(e){if(e.message!=='blocked'||Z.srv)throw e;Z.srv=true;toast('تعذّر الرفع المباشر، سيتم القياس عبر اللابتوب');r.up=await ulTest(Z.dur)}}
    r.used=Z.used;needle(r.down.bps);phase(Z.stop?'تم الإيقاف':'اكتمل الاختبار'+(Z.srv?' (عبر اللابتوب)':''));
    const hist=JSON.parse(localStorage.getItem('shist')||'[]');hist.unshift({t:r.t,ping:r.ping.avg,jit:r.ping.jit,down:r.down.bps,up:r.up&&r.up.bps,used:Z.used});
    localStorage.setItem('shist',JSON.stringify(hist.slice(0,10)));
  }catch(e){phase('فشل الاختبار: '+(e.message==='blocked'?'لا يمكن الوصول لخادم الاختبار (تأكد من وجود إنترنت)':e.message))}
  Z.running=false;Z.stop=false;$('#sgo').textContent='ابدأ الاختبار';draw();
}

function draw(){
  const hist=JSON.parse(localStorage.getItem('shist')||'[]'),last=hist[0];
  $('#sunits').replaceChildren(...UNITS.map(u=>chip(u,u===unit(),()=>{localStorage.setItem('unit',u);ticks();needle(last?last.down:0);draw()})));
  $('#smax').replaceChildren(...[10,100,1000].map(m=>chip(m,m===Z.max,()=>{Z.max=m;localStorage.setItem('gmax',m);ticks();needle(last?last.down:0);draw()})));
  $('#sdur').replaceChildren(...[5,10,20].map(d=>chip(d+' ث',d===Z.dur,()=>{Z.dur=d;localStorage.setItem('sdur',d);draw()})));
  $$('#t-speed .opt .chip').forEach(c=>c.classList.add('s'));
  if(!Z.running){
    $('#sres').replaceChildren(...(last?[h('h2',{},'آخر نتيجة'),grp(
      row('Ping',last.ping.toFixed(0)+' ms'),row('Jitter',last.jit.toFixed(1)+' ms'),row('التحميل',fmtRate(last.down)),row('الرفع',last.up?fmtRate(last.up):'—'),row('البيانات المستهلكة',fmt(last.used)))]:[]),
      ...(hist.length>1?[h('h2',{},'السجل'),grp(...hist.slice(1).map(x=>row(new Date(x.t).toLocaleString('ar',{dateStyle:'short',timeStyle:'short'}),`${fmtRate(x.down)} ↓ ${x.up?fmtRate(x.up):'—'} ↑ · ${x.ping.toFixed(0)}ms`))),h('button',{class:'lnk',onclick:()=>{localStorage.removeItem('shist');draw()}},'مسح السجل')]:[]));
    if(last&&$('#gval').textContent==='0')needle(last.down);
  }
}
function load(){
  const box=$('#t-speed');
  if(!$('#gs')){
    box.innerHTML=`<div class="gwrap"><svg id="gs" viewBox="-12 0 264 150" role="img" aria-label="عداد السرعة">
      <path class="gtrack" d="M20 130 A100 100 0 0 1 220 130" fill="none" stroke-width="14" stroke-linecap="round"/>
      <path id="garc" class="gfill" d="M20 130 A100 100 0 0 1 220 130" fill="none" stroke-width="14" stroke-linecap="round" stroke-dasharray="0 320"/>
      <g id="gticks"></g><line id="gneedle" class="needle" x1="120" y1="130" x2="120" y2="52" stroke-width="3" stroke-linecap="round" style="transform:rotate(-90deg)"/><circle class="hub" cx="120" cy="130" r="7"/></svg>
      <div class="gread"><b class="num" id="gval">0</b><span id="gunit"></span></div><div id="gphase">جاهز</div>
      <button class="btn" id="sgo" style="min-width:200px">ابدأ الاختبار</button></div>
      <h2>الإعدادات</h2><div class="grp"><div class="row opt"><span>الوحدة</span><div class="seg" id="sunits"></div></div>
      <div class="row opt"><span>أقصى العداد</span><div class="seg" id="smax"></div></div>
      <div class="row opt"><span>مدة القياس</span><div class="seg" id="sdur"></div></div></div><div id="sres"></div>`;
    $('#sgo').onclick=runTest;ticks();
  }
  ticks();draw();
}
registerPage({id:'speed',title:'السرعة',nav:3,load,leave:()=>{Z.stop=true}});
})();
