(function(){
  const $ = id => document.getElementById(id);
  const IS_APP = /SitePhotoApp/.test(navigator.userAgent);
  const F = {name:$('f-name'),dong:$('f-dong'),floor:$('f-floor'),work:$('f-work'),date:$('f-date'),room:$('f-room'),note:$('f-note')};
  const ROWS = [['공사명','name'],['위 치','dong'],['층','floor'],['공종','work'],['일 자','date'],['실','room'],['내 용','note']];
  let photos=[], openPhoto=null, unsub=null, queue=[], currentSrc=null;

  if(!window.firebase || !window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey){
    $('boot').innerHTML='<p class="status err">서버 설정이 아직 연결되지 않았어요. 인터넷 연결을 확인하거나 관리자에게 문의해 주세요.</p>';
    return;
  }
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth=firebase.auth(), fs=firebase.firestore(), st=firebase.storage();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});

  const today = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const dotDate = s => (s||'').replace(/-/g,'.');
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ---------- login ----------
  $('login-form').addEventListener('submit',async e=>{
    e.preventDefault(); $('lg-err').textContent=''; $('lg-btn').disabled=true;
    try{ await auth.signInWithEmailAndPassword($('lg-email').value.trim(),$('lg-pw').value); }
    catch(err){
      const c=err&&err.code||'';
      $('lg-err').textContent = /invalid|wrong-password|user-not-found/.test(c)?'이메일 또는 비밀번호가 맞지 않아요.':c==='auth/too-many-requests'?'시도가 너무 많아요. 잠시 후 다시 해 주세요.':c==='auth/network-request-failed'?'인터넷 연결을 확인해 주세요.':'로그인하지 못했어요. ('+c+')';
    }
    $('lg-btn').disabled=false;
  });
  $('btn-logout').onclick=()=>auth.signOut();

  auth.onAuthStateChanged(u=>{
    $('boot').hidden=true;
    $('login-view').hidden=!!u; $('app').hidden=!u;
    if(unsub){unsub();unsub=null;}
    if(u){
      unsub=fs.collection('photos').orderBy('createdAt','desc').limit(2000).onSnapshot(snap=>{
        photos=snap.docs.map(d=>Object.assign({id:d.id},d.data()));
        fillDatalists(); render();
      },()=>{ $('list').innerHTML='<div class="emptylist"><strong>사진 목록을 불러오지 못했어요</strong>새로고침해 주세요.</div>'; });
    } else { photos=[]; }
  });

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
  $('tab-cap').onclick=()=>show('cap'); $('tab-list').onclick=()=>show('list');
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

  async function compose(img){
    try{ await document.fonts.load('700 30px "Noto Sans KR"'); }catch(e){}
    const MAX=2048; let w=img.naturalWidth,h=img.naturalHeight; const r=Math.min(1,MAX/Math.max(w,h)); w=Math.round(w*r); h=Math.round(h*r);
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

  $('btn-upload').onclick=async()=>{
    const u=auth.currentUser; if(!u){ setStatus('다시 로그인해 주세요.','err'); return; }
    const btn=$('btn-upload'); btn.disabled=true; setStatus('올리는 중…');
    $('prog').hidden=false; $('prog-bar').style.width='0%';
    try{
      const blob=await new Promise(res=>$('canvas').toBlob(res,'image/jpeg',0.85));
      const ref=fs.collection('photos').doc();
      const path='photos/'+ref.id+'.jpg';
      const task=st.ref(path).put(blob,{contentType:'image/jpeg'});
      task.on('state_changed',snap=>{ $('prog-bar').style.width=Math.round(snap.bytesTransferred/snap.totalBytes*100)+'%'; });
      await task;
      const url=await st.ref(path).getDownloadURL();
      await ref.set({name:F.name.value.trim(),dong:F.dong.value.trim(),floor:F.floor.value.trim(),work:F.work.value.trim(),date:F.date.value,room:F.room.value.trim(),note:F.note.value.trim(),action:'',
        path,url,createdAt:new Date().toISOString(),by:u.email||''});
      saveFields();
      setStatus('올렸어요. PC 사진 목록에 바로 나타나요.','ok');
      if(queue.length){ nextFromQueue(); }
      else { F.note.value=''; currentSrc=null; $('canvas').hidden=true; $('prev-actions').hidden=true; $('prev-empty').hidden=false; $('in-camera').value=''; $('in-pick').value=''; }
    }catch(e){
      btn.disabled=false;
      setStatus(e&&e.code==='storage/unauthorized'?'올릴 권한이 없어요. 관리자에게 보안 규칙 설정을 확인해 달라고 해 주세요.':'올리지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.','err');
    }
    $('prog').hidden=true;
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
      byDate[d].map(p=>'<div class="card" data-id="'+esc(p.id)+'"><button class="open" aria-label="크게 보기"><img loading="lazy" src="'+esc(p.url)+'" alt="'+esc([p.dong,p.floor,p.room,p.work].filter(Boolean).join(' '))+'"></button>'+
        '<div class="meta">'+(p.work?'<span class="chip">'+esc(p.work)+'</span>':'')+'<span>'+esc([p.dong,p.floor].filter(Boolean).join(' '))+'</span><span class="where">'+esc(p.room||'')+'</span></div>'+
        (p.note?'<div class="note">'+esc(p.note)+'</div>':'')+
        '<div class="act"><span class="act-label">조치</span>'+actBtns(p)+'</div></div>').join('')+
      '</div></div>').join('');
  }
  async function setAction(id,v){
    const p=photos.find(x=>x.id===id); if(!p) return;
    const next=p.action===v?'':v, prev=p.action;
    p.action=next; render(); if(openPhoto&&openPhoto.id===id) syncLbAct();
    try{ await fs.collection('photos').doc(id).update({action:next}); }
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
    openPhoto=p; $('lb-img').src=p.url; $('lb-img').alt=[p.dong,p.floor,p.room].join(' ');
    $('lb-info').innerHTML=[['공사명',p.name],['위치',p.dong],['층',p.floor],['공종',p.work],['일자',dotDate(p.date)],['실',p.room],['내용',p.note]].filter(x=>x[1]).map(([k,v])=>'<span class="chip">'+k+'</span><span>'+esc(v)+'</span>').join(' ');
    $('lb-dl').href=p.url; $('lb-dl').hidden=IS_APP;
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
    try{ await fs.collection('photos').doc(p.id).delete(); if(p.path){ try{ await st.ref(p.path).delete(); }catch(e){} } closeLb(); }
    catch(e){ $('lb-del').textContent='삭제하지 못했어요'; }
  };

  // Android back button: close the photo viewer first, then go back to the capture tab.
  window.onAndroidBack=function(){
    if(!$('lb').hidden){ closeLb(); return true; }
    if(!$('view-list').hidden && IS_APP){ show('cap'); return true; }
    return false;
  };
})();
