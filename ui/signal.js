// Signal finder: live meter + graph + saved spots + optional pitch sound, to find the best place for the router.
(()=>{
const N=60;let timer=null,hist=[],best=null,audio=null,osc=null,gain=null;
const num=v=>{const m=/-?\d+(\.\d+)?/.exec(v||'');return m?+m[0]:null};
const spots=()=>JSON.parse(localStorage.getItem('spots')||'[]');
document.head.append(h('style',{},`.sgraph{width:100%;height:110px;direction:ltr;background:var(--panel);border:1px solid var(--line);border-radius:14px}
.sgraph polyline{fill:none;stroke:var(--sig);stroke-width:2}.sbig{display:flex;align-items:flex-end;gap:18px;padding:18px 4px}
.sbig b{font-size:56px;line-height:1}`));

// 0..100 score: real dBm when the firmware reports it, otherwise the 0-5 bars
function score(level,rsrp){return rsrp!==null?Math.max(0,Math.min(100,(rsrp+120)/50*100)):level*20}
async function sample(){
  const [mon,sg]=await Promise.all([rpc('monitoring.status'),rpc('device.signal').catch(()=>({}))]);
  const level=+mon.SignalIcon||0,rsrp=num(sg.rsrp),sinr=num(sg.sinr),rsrq=num(sg.rsrq);
  const s=score(level,rsrp);
  hist.push(s);if(hist.length>N)hist.shift();
  if(best===null||s>best)best=s;
  draw({level,rsrp,sinr,rsrq,s,type:netLabel(mon.CurrentNetworkType),cell:sg.cell_id,pci:sg.pci});
  if(osc)osc.frequency.value=200+s*8;
}
function draw(o){
  const box=$('#sig');if(!box)return;
  const pts=hist.map((v,i)=>`${(i/(N-1)*300).toFixed(1)},${(100-v).toFixed(1)}`).join(' ');
  const extra=Object.entries({RSRP:o.rsrp!==null?o.rsrp+' dBm':null,SINR:o.sinr!==null?o.sinr+' dB':null,RSRQ:o.rsrq!==null?o.rsrq+' dB':null,'Cell ID':o.cell,PCI:o.pci}).filter(([,v])=>v);
  box.replaceChildren(
    h('div',{class:'sbig'},h('b',{class:'num'},Math.round(o.s)+'%'),h('div',{},h('div',{},'نوع الشبكة: '+o.type),h('div',{style:'color:var(--mute)'},'الأعمدة: '+o.level+' / 5'),h('div',{style:'color:var(--mute)'},'أفضل قراءة: '+Math.round(best)+'%'))),
    (()=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 300 100');s.setAttribute('preserveAspectRatio','none');s.setAttribute('class','sgraph');s.innerHTML=`<polyline points="${pts}"/>`;return s})(),
    extra.length?kv(Object.fromEntries(extra)):h('div',{class:'empty',style:'padding:10px 4px;text-align:start'},'هذا الفيرمور لا يعرض قيم RSRP وSINR، لذلك يعتمد المقياس على أعمدة الإشارة (0 إلى 5).'),
    h('div',{class:'seg'},h('button',{class:'btn',onclick:()=>{const n=(prompt('اسم هذا المكان (مثال: قرب النافذة)')||'').trim();if(!n)return;
        const avg=hist.slice(-5).reduce((a,b)=>a+b,0)/Math.min(5,hist.length);localStorage.setItem('spots',JSON.stringify([...spots(),{n,s:avg,t:o.type,d:Date.now()}]));draw(o)}},'سجّل هذا المكان'),
      chip(osc?'🔊 الصوت يعمل':'🔈 تشغيل الصوت',!!osc,toggleSound)),
    spots().length?h('h2',{},'الأماكن المسجّلة'):null,
    spots().length?grp(...[...spots()].sort((a,b)=>b.s-a.s).map((x,i)=>h('div',{class:'row'},h('div',{},(i===0?'⭐ ':'')+x.n,h('small',{},x.t)),h('div',{class:'rv'},h('span',{class:'num'},Math.round(x.s)+'%'),
      h('button',{class:'mini',onclick:()=>{localStorage.setItem('spots',JSON.stringify(spots().filter(y=>y.d!==x.d)));draw(o)}},'حذف'))))):null,
    h('div',{class:'empty',style:'padding:14px 4px;text-align:start'},'حرّك الراوتر ببطء وراقب الرقم، وانتظر ثانيتين في كل مكان قبل التسجيل. الصوت يرتفع كلما تحسنت الإشارة.'));
}
function toggleSound(){
  if(osc){osc.stop();osc=null;audio.close();audio=null;return draw0()}
  try{audio=new (window.AudioContext||window.webkitAudioContext)();osc=audio.createOscillator();gain=audio.createGain();gain.gain.value=.05;osc.connect(gain).connect(audio.destination);osc.frequency.value=300;osc.start()}
  catch(e){toast('تعذّر تشغيل الصوت')}
  draw0();
}
const draw0=()=>hist.length&&sample().catch(()=>{});
function stop(){clearInterval(timer);timer=null;if(osc){try{osc.stop();audio.close()}catch(e){}osc=null;audio=null}}
function load(){
  const box=$('#t-signal');box.replaceChildren(h('div',{id:'sig'},h('div',{class:'empty'},'جارٍ القياس…')));
  hist=[];best=null;stop();
  const tick=()=>sample().catch(e=>{const b=$('#sig');if(b)b.replaceChildren(h('div',{class:'empty'},e.message))});
  tick();timer=setInterval(tick,1000);
}
registerPage({id:'signal',title:'مقياس الإشارة',parent:'more',desc:'ابحث عن أفضل مكان للراوتر',load,leave:stop});
})();
