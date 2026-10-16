(function(){
  const $ = id => document.getElementById(id);
  const IS_APP = /SitePhotoApp/.test(navigator.userAgent);
  const F = {name:$('f-name'),dong:$('f-dong'),floor:$('f-floor'),work:$('f-work'),date:$('f-date'),room:$('f-room'),note:$('f-note')};
  const ROWS = [['공사명','name'],['위 치','dong'],['층','floor'],['공종','work'],['일 자','date'],['실','room'],['내 용','note']];
  let photos=[], openPhoto=null, queue=[], currentSrc=null, pollTimer=null;

  const URL_=(window.APP_CONFIG||{}).scriptUrl;
  if(!URL_){
    $('boot').innerHTML='<p class="status err">저장 서버 주소가 아직 연결되지 않았어요. 관리자에게 문의해 주세요.</p>';
    return;
  }
  let pass=(()=>{try{return localStorage.getItem('pass')||''}catch(e){return ''}})();
  class ApiError extends Error{ constructor(code){ super(code); this.code=code; } }
  async function api(action,body){
    let res;
    try{
      res=await fetch(URL_,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({action,pass},body||{}))});
    }catch(e){ throw new ApiError('network'); }
    let j; try{ j=await res.json(); }catch(e){ throw new ApiError('server'); }
    if(!j.ok){ if(j.error==='auth'){ logout(true); } throw new ApiError(j.error||'server'); }
    return j;
  }
  const thumbUrl=(p,w)=>'https://drive.google.com/thumbnail?id='+encodeURIComponent(p.fileId)+'&sz=w'+(w||480);
  const altUrl=(p,w)=>'https://lh3.googleusercontent.com/d/'+encodeURIComponent(p.fileId)+'=w'+(w||480);
  const viewUrl=p=>'https://drive.google.com/file/d/'+encodeURIComponent(p.fileId)+'/view';
  // If Drive's thumbnail endpoint refuses an image, try the second host once.
  document.addEventListener('error',e=>{ const im=e.target; if(im.tagName==='IMG'&&im.dataset.alt&&!im.dataset.tried){ im.dataset.tried='1'; im.src=im.dataset.alt; } },true);

  const today = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const dotDate = s => (s||'').replace(/-/g,'.');
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ---------- login ----------
  $('login-form').addEventListener('submit',async e=>{
    e.preventDefault(); $('lg-err').textContent=''; $('lg-btn').disabled=true;
    pass=$('lg-pw').value;
    try{ await api('ping'); try{localStorage.setItem('pass',pass)}catch(_){} enter(); }
    catch(err){ $('lg-err').textContent = err.code==='auth'?'비밀번호가 맞지 않아요.':err.code==='network'?'인터넷 연결을 확인해 주세요.':'서버에 연결하지 못했어요. 잠시 후 다시 해 주세요.'; }
    $('lg-btn').disabled=false;
  });
  function logout(wrong){
    pass=''; try{localStorage.removeItem('pass')}catch(_){}
    clearInterval(pollTimer); photos=[];
    $('boot').hidden=true; $('app').hidden=true; $('login-view').hidden=false;
    if(wrong) $('lg-err').textContent='팀 비밀번호가 바뀌었어요. 새 비밀번호를 입력해 주세요.';
  }
  $('btn-logout').onclick=()=>logout(false);
  function enter(){
    $('boot').hidden=true; $('login-view').hidden=true; $('app').hidden=false;
    load(); updateBadge(); pump(); clearInterval(pollTimer);
    pollTimer=setInterval(()=>{ if(!document.hidden && !$('view-list').hidden && $('lb').hidden) load(); },30000);
  }
  let loading=false;
  async function load(){
    if(loading) return; loading=true;
    try{ const j=await api('list'); photos=j.photos||[]; fillDatalists(); render(); }
    catch(e){ if(e.code!=='auth' && !photos.length) $('list').innerHTML='<div class="emptylist"><strong>사진 목록을 불러오지 못했어요</strong>인터넷 연결을 확인하고 새로고침을 눌러 주세요.</div>'; }
    loading=false;
  }
  $('btn-refresh').onclick=load;
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && pass && !$('app').hidden) load(); });

  // ---------- fields ----------
  try{ const saved=JSON.parse(localStorage.getItem('board')||'{}'); for(const k of ['name','dong','floor','work','room']) if(saved[k]) F[k].value=saved[k]; }catch(e){}
  F.date.value=today();
  const saveFields=()=>{ try{ const o={}; for(const k of ['name','dong','floor','work','room']) o[k]=F[k].value; localStorage.setItem('board',JSON.stringify(o)); }catch(e){} };
  Object.values(F).forEach(el=>el.addEventListener('change',()=>{saveFields(); if(currentSrc) compose(currentSrc);}));
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && !currentSrc) F.date.value=today(); });

  // ---------- tabs ----------
  function show(tab){
    $('tab-cap').setAttribute('aria-selected',tab==='cap'); $('tab-list').setAttribute('aria-selected',tab==='list');
    $('view-cap').hidden=tab!=='cap'; $('view-list').hidden=tab!=='list';
    try{localStorage.setItem('tab',tab)}catch(e){}
  }
  $('tab-cap').onclick=()=>show('cap'); $('tab-list').onclick=()=>{ show('list'); if(pass) load(); };
  show(IS_APP ? 'cap' : (location.hash==='#cap' ? 'cap' : (matchMedia('(min-width:900px)').matches ? 'list' : ((()=>{try{return localStorage.getItem('tab')}catch(e){return null}})()||'cap'))));

  // ---------- capture ----------
  $('btn-shoot').onclick=()=>$('in-camera').click();
  $('btn-pick').onclick=()=>$('in-pick').click();
  $('btn-retake').onclick=()=>$('in-camera').click();
  $('in-camera').onchange=e=>takeFiles(e.target.files);
  $('in-pick').onchange=e=>takeFiles(e.target.files);

  function takeFiles(list){ queue=Array.from(list||[]); if(!queue.length) return; setStatus(''); nextFromQueue(); }
  function nextFromQueue(){
    const f=queue.shift(); if(!f) return;
    const url=URL.createObjectURL(f); const img=new Image();
    img.onload=()=>{ currentSrc=img; compose(img); };
    img.onerror=()=>setStatus('사진을 열 수 없어요. 다른 사진으로 다시 시도해 주세요.','err');
    img.src=url;
  }

  const fontReady=(document.fonts&&document.fonts.load)?document.fonts.load('700 30px "Noto Sans KR"').catch(()=>{}):Promise.resolve();
  async function compose(img){
    try{ await Promise.race([fontReady, new Promise(r=>setTimeout(r,800))]); }catch(e){}
    const MAX=1400; let w=img.naturalWidth,h=img.naturalHeight; const r=Math.min(1,MAX/Math.max(w,h)); w=Math.round(w*r); h=Math.round(h*r);
    const c=$('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
    g.drawImage(img,0,0,w,h);
    const s=Math.max(w,h)/2048;
    const rows=ROWS.map(([lab,k])=>[lab,k==='date'?dotDate(F.date.value):F[k].value.trim()]).filter(([,v])=>v);
    if(rows.length){
      const fs_=Math.round(26*s), lh=Math.round(34*s), rh=Math.round(44*s), lw=Math.round(84*s), pad=Math.round(10*s);
      g.font='700 '+fs_+'px "Noto Sans KR", sans-serif';
      const maxVw=Math.round(Math.min(w*0.55, w-lw));
      const vw=Math.min(maxVw, Math.max(Math.round(300*s), ...rows.map(([,v])=>g.measureText(v).width+pad*2)));
      const wrap=t=>{ const out=[]; let line=''; for(const ch of t){ if(g.measureText(line+ch).width>vw-pad*2 && line){ out.push(line); line=ch.trim()?ch:''; } else line+=ch; } if(line) out.push(line); return out.length?out:['']; };
      const lines=rows.map(([,v])=>wrap(v));
      const hs=lines.map(l=>Math.max(rh, l.length*lh+(rh-lh)));
      const bw=lw+vw, bh=hs.reduce((a,b)=>a+b,0), x=w-bw, y=h-bh;
      g.fillStyle='#fff'; g.fillRect(x,y,bw,bh);
      g.strokeStyle='#000'; g.lineWidth=Math.max(1,2*s);
      g.strokeRect(x+g.lineWidth/2,y+g.lineWidth/2,bw-g.lineWidth,bh-g.lineWidth);
      g.beginPath(); g.moveTo(x+lw,y); g.lineTo(x+lw,y+bh);
      let yy=y; for(let i=1;i<rows.length;i++){ yy+=hs[i-1]; g.moveTo(x,yy); g.lineTo(x+bw,yy); }
      g.stroke();
      g.fillStyle='#000'; g.textBaseline='middle';
      yy=y;
      rows.forEach(([lab],i)=>{
        g.fillText(lab,x+pad*.6,yy+hs[i]/2);
        const top=yy+hs[i]/2-(lines[i].length-1)*lh/2;
        lines[i].forEach((ln,j)=>g.fillText(ln,x+lw+pad,top+j*lh,vw-pad*2));
        yy+=hs[i];
      });
    }
    c.hidden=false; $('prev-empty').hidden=true; $('prev-actions').hidden=false;
    $('btn-upload').disabled=false;
    $('btn-upload').textContent = queue.length ? '올리기 (남은 '+queue.length+'장)' : '올리기';
  }

  // ---------- background upload outbox ----------
  // Photos are saved on the phone first and sent in the background, so the next shot can start right away.
  // The outbox survives closing the app (IndexedDB) and retries when the connection comes back.
  const ob={mem:[],db:null};
  const idb=new Promise(res=>{ try{ const r=indexedDB.open('outbox',1); r.onupgradeneeded=()=>r.result.createObjectStore('items',{keyPath:'key'}); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); }catch(e){ res(null); } });
  async function obAll(){ const d=await idb; if(!d) return ob.mem.slice(); return new Promise(res=>{ const q=d.transaction('items').objectStore('items').getAll(); q.onsuccess=()=>res(q.result.sort((a,b)=>a.key-b.key)); q.onerror=()=>res([]); }); }
  async function obPut(it){ const d=await idb; if(!d){ ob.mem.push(it); return; } await new Promise(res=>{ const t=d.transaction('items','readwrite'); t.objectStore('items').put(it); t.oncomplete=res; t.onerror=res; }); }
  async function obDel(key){ const d=await idb; if(!d){ ob.mem=ob.mem.filter(x=>x.key!==key); return; } await new Promise(res=>{ const t=d.transaction('items','readwrite'); t.objectStore('items').delete(key); t.oncomplete=res; t.onerror=res; }); }

  let sending=false, retryTimer=null;
  async function updateBadge(){
    const n=(await obAll()).length, el=$('outbox');
    if(!n){ el.hidden=!el.dataset.done; el.className='outbox ok'; el.textContent='✓ 모두 올라갔어요'; return; }
    el.hidden=false; el.dataset.done='1';
    el.className='outbox'+(el.dataset.err?' err':'');
    el.textContent=(el.dataset.err? '⚠ 연결이 불안정해요. 자동으로 다시 보내는 중 · ' : '⏫ 보내는 중 · ')+'남은 사진 '+n+'장';
  }
  async function pump(){
    if(sending||!pass) return; sending=true; clearTimeout(retryTimer);
    try{
      let items=await obAll();
      while(items.length){
        const it=items[0];
        try{
          const j=await api('upload',{image:it.image,meta:it.meta});
          if(j.photo && !photos.some(p=>p.id===j.photo.id)){ photos.unshift(j.photo); fillDatalists(); render(); }
          await obDel(it.key); delete $('outbox').dataset.err;
        }catch(e){
          if(e.code==='auth') break;
          $('outbox').dataset.err='1'; await updateBadge();
          retryTimer=setTimeout(pump, 8000); break;
        }
        items=await obAll(); await updateBadge();
      }
    } finally { sending=false; updateBadge(); }
  }
  window.addEventListener('online',()=>pump());

  $('btn-upload').onclick=async()=>{
    const btn=$('btn-upload'); btn.disabled=true;
    const image=$('canvas').toDataURL('image/jpeg',0.75).split(',')[1];
    const meta={name:F.name.value.trim(),dong:F.dong.value.trim(),floor:F.floor.value.trim(),work:F.work.value.trim(),date:F.date.value,room:F.room.value.trim(),note:F.note.value.trim()};
    await obPut({key:Date.now()+Math.random(),image,meta});
    saveFields();
    setStatus('저장했어요. 뒤에서 자동으로 올라가니 바로 다음 사진을 찍으세요.','ok');
    updateBadge(); pump();
    if(queue.length){ nextFromQueue(); }
    else { F.note.value=''; currentSrc=null; $('canvas').hidden=true; $('prev-actions').hidden=true; $('prev-empty').hidden=false; $('in-camera').value=''; $('in-pick').value=''; }
  };
  function setStatus(t,kind){ const s=$('status'); s.textContent=t; s.className='status'+(kind?' '+kind:''); }

  // ---------- gallery ----------
  const fDong=$('flt-dong'),fWork=$('flt-work'),fDate=$('flt-date'),fAct=$('flt-act'),fQ=$('flt-q');
  [fDong,fWork,fDate,fAct].forEach(el=>el.onchange=render); fQ.oninput=render;
  function fillSelect(sel,vals,label,fmt){
    const cur=sel.value; sel.innerHTML='<option value="">'+label+'</option>'+vals.map(v=>'<option value="'+esc(v)+'">'+esc(fmt?fmt(v):v)+'</option>').join('');
    if(vals.includes(cur)) sel.value=cur;
  }
  const uniq=(k,sortDesc)=>{ const a=[...new Set(photos.map(p=>p[k]).filter(Boolean))]; a.sort((x,y)=>sortDesc?y.localeCompare(x,'ko',{numeric:true}):x.localeCompare(y,'ko',{numeric:true})); return a; };
  function fillDatalists(){ for(const k of ['name','dong','floor','work','room','note']) $('dl-'+k).innerHTML=uniq(k).map(v=>'<option value="'+esc(v)+'">').join(''); }
  function actBtns(p){ return ['O','X'].map(v=>'<button class="ox ox-'+v+'" data-act="'+v+'" aria-pressed="'+(p.action===v)+'">'+v+'</button>').join(''); }
  function render(){
    fillSelect(fDong,uniq('dong'),'전체 동'); fillSelect(fWork,uniq('work'),'전체 공종'); fillSelect(fDate,uniq('date',true),'전체 일자',dotDate);
    const q=fQ.value.trim().toLowerCase();
    const list=photos.filter(p=>(!fDong.value||p.dong===fDong.value)&&(!fWork.value||p.work===fWork.value)&&(!fDate.value||p.date===fDate.value)&&
      (!fAct.value||(fAct.value==='-'?!p.action:p.action===fAct.value))&&
      (!q||[p.name,p.dong,p.floor,p.work,p.room,p.note].join(' ').toLowerCase().includes(q)));
    $('count').textContent=list.length+'장';
    const box=$('list');
    if(!photos.length){ box.innerHTML='<div class="emptylist"><strong>아직 올라온 사진이 없어요</strong>휴대폰 앱의 [촬영] 탭에서 사진을 찍어 올리면 여기 바로 나타나요.</div>'; return; }
    if(!list.length){ box.innerHTML='<div class="emptylist"><strong>조건에 맞는 사진이 없어요</strong>필터를 바꾸거나 검색어를 지워 보세요.</div>'; return; }
    const byDate={}; list.forEach(p=>{(byDate[p.date||'']=byDate[p.date||'']||[]).push(p)});
    box.innerHTML=Object.keys(byDate).sort().reverse().map(d=>
      '<div class="day"><h2>'+esc(dotDate(d)||'날짜 없음')+' · '+byDate[d].length+'장</h2><div class="grid">'+
      byDate[d].map(p=>'<div class="card" data-id="'+esc(p.id)+'"><button class="open" aria-label="크게 보기"><img loading="lazy" referrerpolicy="no-referrer" src="'+esc(thumbUrl(p))+'" data-alt="'+esc(altUrl(p))+'" alt="'+esc([p.dong,p.floor,p.room,p.work].filter(Boolean).join(' '))+'"></button>'+
        '<div class="meta">'+(p.work?'<span class="chip">'+esc(p.work)+'</span>':'')+'<span>'+esc([p.dong,p.floor].filter(Boolean).join(' '))+'</span><span class="where">'+esc(p.room||'')+'</span></div>'+
        (p.note?'<div class="note">'+esc(p.note)+'</div>':'')+
        '<div class="act"><span class="act-label">조치</span>'+actBtns(p)+'</div></div>').join('')+
      '</div></div>').join('');
  }
  async function setAction(id,v){
    const p=photos.find(x=>x.id===id); if(!p) return;
    const next=p.action===v?'':v, prev=p.action;
    p.action=next; render(); if(openPhoto&&openPhoto.id===id) syncLbAct();
    try{ await api('setAction',{id,value:next}); }
    catch(e){ p.action=prev; render(); if(openPhoto&&openPhoto.id===id) syncLbAct(); }
  }
  $('list').addEventListener('click',e=>{
    const card=e.target.closest('.card'); if(!card) return;
    const ox=e.target.closest('.ox'); if(ox){ setAction(card.dataset.id,ox.dataset.act); return; }
    if(e.target.closest('.open')){ const p=photos.find(x=>x.id===card.dataset.id); if(p) openLb(p); }
  });

  // ---------- lightbox ----------
  let delArmed=false;
  function openLb(p){
    openPhoto=p; $('lb-img').removeAttribute('data-tried'); $('lb-img').dataset.alt=altUrl(p,1600); $('lb-img').src=thumbUrl(p,1600); $('lb-img').alt=[p.dong,p.floor,p.room].join(' ');
    $('lb-info').innerHTML=[['공사명',p.name],['위치',p.dong],['층',p.floor],['공종',p.work],['일자',dotDate(p.date)],['실',p.room],['내용',p.note]].filter(x=>x[1]).map(([k,v])=>'<span class="chip">'+k+'</span><span>'+esc(v)+'</span>').join(' ');
    $('lb-dl').href=viewUrl(p); $('lb-dl').hidden=IS_APP;
    $('lb-del').hidden=false; $('lb-del').textContent='삭제'; delArmed=false;
    syncLbAct(); $('lb').hidden=false;
  }
  function closeLb(){ $('lb').hidden=true; openPhoto=null; }
  function syncLbAct(){ document.querySelectorAll('#lb-act .ox').forEach(b=>b.setAttribute('aria-pressed',!!openPhoto&&openPhoto.action===b.dataset.act)); }
  $('lb-act').addEventListener('click',e=>{ const b=e.target.closest('.ox'); if(b&&openPhoto) setAction(openPhoto.id,b.dataset.act); });
  $('lb-close').onclick=closeLb;
  $('lb').addEventListener('click',e=>{ if(e.target.id==='lb'||e.target.classList.contains('imgbox')) closeLb(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!$('lb').hidden) closeLb(); });
  $('lb-del').onclick=async()=>{
    const p=openPhoto; if(!p) return;
    if(!delArmed){ delArmed=true; $('lb-del').textContent='정말 삭제할까요? 한 번 더 누르세요'; return; }
    try{ await api('delete',{id:p.id}); photos=photos.filter(x=>x.id!==p.id); render(); closeLb(); }
    catch(e){ $('lb-del').textContent='삭제하지 못했어요'; }
  };

  // Android back button: close the photo viewer first, then go back to the capture tab.
  window.onAndroidBack=function(){
    if(!$('lb').hidden){ closeLb(); return true; }
    if(!$('view-list').hidden && IS_APP){ show('cap'); return true; }
    return false;
  };
  // ---------- start ----------
  if(pass){ enter(); } else { $('boot').hidden=true; $('login-view').hidden=false; }
})();
