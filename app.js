'use strict';
const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let me=null,stream=null,rafId=0;
async function api(p,o={}){let r;try{r=await fetch('/api'+p,{method:o.method||'GET',headers:o.body?{'Content-Type':'application/json'}:{},body:o.body?JSON.stringify(o.body):undefined,credentials:'same-origin'})}catch{throw new Error('Network error. Check your connection and try again.')}
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed ('+r.status+')');return d}
const spin='<div class="spin" role="status" aria-label="Loading"></div>';
const msg=(el,t,ok)=>{el.className=ok?'ok':'err';el.textContent=t};
const theme=localStorage.getItem('theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme;
const PAGES={about:['About','FACTLUME searches facts and history using Wikipedia and looks up packaged-food products using Open Food Facts. It does not generate or invent content.'],
privacy:['Privacy Policy','We store your name, email, a salted password hash, and the bookmarks/searches/products you save. Camera and microphone are used only on your request and nothing is recorded or uploaded. Barcode and search queries are sent to Wikipedia / Open Food Facts to fetch results. Contact us to delete your data.'],
terms:['Terms of Use','Use FACTLUME lawfully. Content comes from third parties under their own licences (Wikipedia: CC BY-SA; Open Food Facts: ODbL). The service is provided as is, without warranty.'],
disclaimer:['Disclaimer','Information is community-sourced and may be incomplete or wrong. Verify important facts, and check product labels (allergens, nutrition) before relying on this data. Not medical or legal advice.']};
const sbox=(q='',cat='facts')=>`<form class="sb" role="search" id="sf" autocomplete="off"><input id="q" type="search" aria-label="Search" aria-autocomplete="list" aria-controls="sug" value="${esc(q)}" placeholder="Search facts or history" maxlength="100" required>
<button type="button" id="clr" aria-label="Clear" hidden>✕</button><button type="button" id="mic" aria-label="Voice search">🎤</button><button class="p" aria-label="Search">Search</button><ul id="sug" role="listbox" hidden></ul></form>
<div class="cats"><a href="#/search?cat=facts&q=${encodeURIComponent(q)}" ${cat==='facts'?'aria-current="true"':''}>Facts</a><a href="#/search?cat=history&q=${encodeURIComponent(q)}" ${cat==='history'?'aria-current="true"':''}>History</a><a href="#/timeline">Timeline</a></div>`;
function bindSearch(cat){const q=$('#q'),sug=$('#sug'),clr=$('#clr');let t,idx=-1;
  const go=v=>{if(v.trim()){if(me)api('/saved',{method:'POST',body:{type:'search',key:v.trim().toLowerCase()+'|'+cat,title:v.trim()}}).catch(()=>{});location.hash=`#/search?cat=${cat}&q=${encodeURIComponent(v.trim())}`}};
  const upd=()=>{clr.hidden=!q.value};upd();
  q.oninput=()=>{upd();clearTimeout(t);const v=q.value.trim();if(v.length<2){sug.hidden=true;return}
    t=setTimeout(async()=>{try{const d=await api('/suggest?q='+encodeURIComponent(v));idx=-1;sug.innerHTML=d.suggestions.map((s,i)=>`<li role="option" id="o${i}">${esc(s)}</li>`).join('');sug.hidden=!d.suggestions.length;
      sug.querySelectorAll('li').forEach(li=>li.onclick=()=>go(li.textContent))}catch{sug.hidden=true}},200)};
  q.onkeydown=e=>{const li=[...sug.children];if(sug.hidden||!li.length)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();idx=(idx+(e.key==='ArrowDown'?1:-1)+li.length)%li.length;li.forEach((l,i)=>l.setAttribute('aria-selected',i===idx));q.value=li[idx].textContent}else if(e.key==='Escape')sug.hidden=true};
  clr.onclick=()=>{q.value='';upd();sug.hidden=true;q.focus()};
  $('#sf').onsubmit=e=>{e.preventDefault();go(q.value)};
  $('#mic').onclick=()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return alert('Voice search is not supported in this browser.');
    const r=new SR();r.lang=navigator.language;r.onresult=e=>{q.value=e.results[0][0].transcript;upd();go(q.value)};
    r.onerror=e=>alert(e.error==='not-allowed'?'Microphone permission was denied.':'Voice search failed: '+e.error);r.start()}}
const saveBtn=(type,key,title)=>`<button data-save data-type="${type}" data-key="${esc(key)}" data-title="${esc(title)}">☆ Save</button>`;
function bindSave(){document.querySelectorAll('[data-save]').forEach(b=>b.onclick=async()=>{if(!me){location.hash='#/login';return}
  try{await api('/saved',{method:'POST',body:{type:b.dataset.type,key:b.dataset.key,title:b.dataset.title}});b.textContent='★ Saved'}catch(e){alert(e.message)}})}
const form=(id,fields,btn)=>`<form class="f" id="${id}" novalidate>${fields.map(([n,l,t,x=''])=>`<label>${l}<input name="${n}" type="${t}" required ${x}></label>`).join('')}<button class="p">${btn}</button><p id="m" role="alert"></p></form>`;
function onForm(id,fn){const f=$('#'+id);f.onsubmit=async e=>{e.preventDefault();if(!f.checkValidity()){msg($('#m'),'Please complete all fields correctly (password: 10+ characters).');return}
  const b=f.querySelector('button');b.disabled=true;try{await fn(Object.fromEntries(new FormData(f)),$('#m'))}catch(x){msg($('#m'),x.message)}b.disabled=false}}
const stopCam=()=>{cancelAnimationFrame(rafId);stream?.getTracks().forEach(t=>t.stop());stream=null};
const productHTML=p=>`<div class="card"><div class="row">${p.image?`<img class="pr" src="${esc(p.image)}" alt="${esc(p.name)}">`:''}<div><h3>${esc(p.name)}</h3><p>${esc(p.brand||'')} ${esc(p.quantity||'')}<br>Barcode ${esc(p.code)}${p.nutriscore?` · Nutri-Score ${esc(p.nutriscore.toUpperCase())}`:''}</p></div></div>
<p>${p.ingredients?'<b>Ingredients:</b> '+esc(p.ingredients):'No ingredient data.'}</p><p><a href="${esc(p.url)}" rel="noopener" target="_blank">Source: Open Food Facts</a></p><div class="row">${saveBtn('product',p.code,p.name)}<button id="pc">Compare prices</button></div><p id="pm"></p></div>`;
async function lookup(code,out){out.innerHTML=spin;try{const p=await api('/product/'+encodeURIComponent(code));out.innerHTML=productHTML(p);bindSave();$('#pc').onclick=async()=>{try{await api('/prices?code='+p.code)}catch(e){msg($('#pm'),e.message)}}}catch(e){out.innerHTML=`<p class="err" role="alert">${esc(e.message)}</p>`}}
const routes={
 '':()=>{app.innerHTML=`<section class="hero"><h1>FACT<b>LUME</b></h1>${sbox()}</section>`;bindSearch('facts')},
 search:async q=>{const s=q.get('q')||'',cat=q.get('cat')==='history'?'history':'facts';app.innerHTML=sbox(s,cat)+'<div id="r">'+spin+'</div>';bindSearch(cat);
  if(!s){$('#r').innerHTML='';return}document.title=s+' – FACTLUME';
  try{const d=await api(`/search?cat=${cat}&q=${encodeURIComponent(s)}`);$('#r').innerHTML=d.results.length?d.results.map(r=>`<article class="card"><h3><a href="#/article?title=${encodeURIComponent(r.title)}">${esc(r.title)}</a></h3><p>${esc(r.snippet)}…</p><div class="row"><a href="${esc(r.url)}" rel="noopener" target="_blank">Reference</a>${saveBtn('article',r.title,r.title)}</div></article>`).join(''):'<p>No results found.</p>';bindSave()}catch(e){$('#r').innerHTML=`<p class="err" role="alert">${esc(e.message)}</p>`}},
 article:async q=>{app.innerHTML=spin;try{const a=await api('/article?title='+encodeURIComponent(q.get('title')||''));document.title=a.title+' – FACTLUME';
  app.innerHTML=`<article><h1>${esc(a.title)}</h1><p><em>${esc(a.description||'')}</em></p>${a.image?`<img class="pr" src="${esc(a.image)}" alt="">`:''}<p>${esc(a.extract)}</p><h2>References</h2><ul><li><a href="${esc(a.url)}" rel="noopener" target="_blank">Wikipedia: ${esc(a.title)}</a> (CC BY-SA)</li></ul>${saveBtn('article',a.title,a.title)}</article>`;bindSave()}catch(e){app.innerHTML=`<p class="err" role="alert">${esc(e.message)}</p>`}},
 timeline:async q=>{const d=new Date(),v=q.get('d')||`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,[,mo,da]=v.split('-').map(Number);
  app.innerHTML=`<h1>On this day</h1><form class="row" id="tf"><label>Date <input type="date" id="td" value="${esc(v)}" required></label><button class="p">Show</button></form><div id="r">${spin}</div>`;
  $('#tf').onsubmit=e=>{e.preventDefault();location.hash='#/timeline?d='+$('#td').value};
  try{const r=await api(`/timeline?month=${mo}&day=${da}`);$('#r').innerHTML=r.events.length?'<ol>'+r.events.map(e=>`<li><b>${esc(e.year)}</b> – ${esc(e.text)} ${e.url?`<a href="${esc(e.url)}" rel="noopener" target="_blank">ref</a>`:''}</li>`).join('')+'</ol>':'<p>No events found.</p>'}catch(e){$('#r').innerHTML=`<p class="err" role="alert">${esc(e.message)}</p>`}},
 scan:()=>{app.innerHTML=`<h1>Product lookup</h1><div class="row"><button class="p" id="cam">Scan with camera</button><button id="stop" hidden>Stop</button></div><video id="v" playsinline muted hidden></video><p id="cm" role="status"></p>
  <form class="row" id="bf"><input id="bc" inputmode="numeric" placeholder="Barcode (EAN-8/13, UPC-A)" aria-label="Barcode" required><button class="p">Look up</button></form>
  <form class="row" id="nf"><input id="nm" placeholder="Product name" aria-label="Product name" required maxlength="100"><button class="p">Search by name</button></form><div id="r"></div>`;
  const v=$('#v');$('#bf').onsubmit=e=>{e.preventDefault();lookup($('#bc').value.trim(),$('#r'))};
  $('#nf').onsubmit=async e=>{e.preventDefault();$('#r').innerHTML=spin;try{const d=await api('/products?q='+encodeURIComponent($('#nm').value));$('#r').innerHTML=d.products.length?d.products.map(p=>`<div class="card"><b>${esc(p.name)}</b> ${esc(p.brand||'')}<br><button data-c="${esc(p.code)}">View ${esc(p.code)}</button></div>`).join(''):'<p>No products found.</p>';
    $('#r').querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>lookup(b.dataset.c,$('#r')))}catch(x){$('#r').innerHTML=`<p class="err" role="alert">${esc(x.message)}</p>`}};
  $('#stop').onclick=()=>{stopCam();v.hidden=$('#stop').hidden=true};
  $('#cam').onclick=async()=>{if(!('BarcodeDetector'in window))return msg($('#cm'),'Camera scanning is not supported in this browser. Enter the barcode manually.');
   if(!navigator.mediaDevices?.getUserMedia)return msg($('#cm'),'Camera is not available (HTTPS required).');
   try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}})}catch(e){return msg($('#cm'),e.name==='NotAllowedError'?'Camera permission was denied. Enter the barcode manually.':'Could not open camera: '+e.message)}
   v.srcObject=stream;v.hidden=$('#stop').hidden=false;await v.play();msg($('#cm'),'Point the camera at a barcode…',true);
   const det=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e']});const tick=async()=>{if(!stream)return;try{const c=await det.detect(v);if(c.length){stopCam();v.hidden=$('#stop').hidden=true;$('#cm').textContent='';$('#bc').value=c[0].rawValue;lookup(c[0].rawValue,$('#r'));return}}catch{}rafId=requestAnimationFrame(tick)};tick()}},
 login:()=>{app.innerHTML='<h1>Log in</h1>'+form('lf',[['email','Email','email','autocomplete=email'],['password','Password','password','autocomplete=current-password']],'Log in')+'<p><a href="#/forgot">Forgot password?</a> · <a href="#/register">Register</a></p>';
  onForm('lf',async d=>{me=(await api('/login',{method:'POST',body:d})).user;nav();location.hash='#/dashboard'})},
 register:()=>{app.innerHTML='<h1>Register</h1>'+form('rf',[['name','Name','text','maxlength=60'],['email','Email','email','autocomplete=email'],['password','Password (10+ chars)','password','minlength=10 autocomplete=new-password']],'Create account');
  onForm('rf',async d=>{me=(await api('/register',{method:'POST',body:d})).user;nav();location.hash='#/dashboard'})},
 forgot:()=>{app.innerHTML='<h1>Forgot password</h1>'+form('ff',[['email','Email','email']],'Send reset link');onForm('ff',async(d,m)=>{await api('/forgot',{method:'POST',body:d});msg(m,'If that account exists, a reset link has been sent.',true)})},
 reset:q=>{app.innerHTML='<h1>Reset password</h1>'+form('pf',[['password','New password (10+ chars)','password','minlength=10 autocomplete=new-password']],'Reset');onForm('pf',async(d,m)=>{await api('/reset',{method:'POST',body:{token:q.get('token'),password:d.password}});msg(m,'Password updated. You can log in now.',true)})},
 profile:()=>{if(!me)return location.hash='#/login';app.innerHTML=`<h1>Profile</h1><p>${esc(me.email)} · ${esc(me.role)}</p>`+form('uf',[['name','Name','text',`maxlength=60 value="${esc(me.name)}"`]],'Save');onForm('uf',async(d,m)=>{me=(await api('/me',{method:'PATCH',body:d})).user;msg(m,'Saved.',true)})},
 dashboard:async()=>{if(!me)return location.hash='#/login';app.innerHTML=spin;try{const{items}=await api('/saved');
  const sec=(t,ty,f)=>`<h2>${t}</h2>`+(items.filter(i=>i.type===ty).map(i=>`<div class="card row">${f(i)}<button data-del="${i.id}" aria-label="Remove ${esc(i.title)}">Remove</button></div>`).join('')||'<p>Nothing yet.</p>');
  app.innerHTML=`<h1>Hello, ${esc(me.name)}</h1>`+sec('Saved articles','article',i=>`<a href="#/article?title=${encodeURIComponent(i.key)}">${esc(i.title)}</a>`)+sec('Searches','search',i=>`<a href="#/search?cat=${i.key.split('|')[1]}&q=${encodeURIComponent(i.title)}">${esc(i.title)}</a>`)+sec('Products','product',i=>`<span>${esc(i.title)} (${esc(i.key)})</span>`);
  app.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{try{await api('/saved/'+b.dataset.del,{method:'DELETE'});route()}catch(e){alert(e.message)}})}catch(e){app.innerHTML=`<p class="err" role="alert">${esc(e.message)}</p>`}},
 admin:async()=>{if(me?.role!=='admin'){app.innerHTML='<p class="err">Admin access required.</p>';return}app.innerHTML=spin;try{const[u,m]=await Promise.all([api('/admin/users'),api('/admin/messages')]);
  app.innerHTML=`<h1>Admin</h1><table><tr><th>Name</th><th>Email</th><th>Role</th></tr>${u.users.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td><select data-u="${x.id}" aria-label="Role for ${esc(x.email)}" ${x.id===me.id?'disabled':''}>${['user','admin'].map(r=>`<option ${r===x.role?'selected':''}>${r}</option>`).join('')}</select></td></tr>`).join('')}</table><h2>Messages</h2>${m.messages.map(x=>`<div class="card"><b>${esc(x.name)}</b> (${esc(x.email)})<p>${esc(x.message)}</p></div>`).join('')||'<p>None.</p>'}`;
  app.querySelectorAll('[data-u]').forEach(s=>s.onchange=async()=>{try{await api('/admin/role',{method:'POST',body:{id:s.dataset.u,role:s.value}})}catch(e){alert(e.message);route()}})}catch(e){app.innerHTML=`<p class="err" role="alert">${esc(e.message)}</p>`}},
 contact:()=>{app.innerHTML='<h1>Contact</h1>'+form('cf',[['name','Name','text','maxlength=60'],['email','Email','email'],['message','Message','text','maxlength=2000']],'Send');onForm('cf',async(d,m)=>{await api('/contact',{method:'POST',body:d});msg(m,'Message sent.',true);$('#cf').reset()})}};
function nav(){const l=(h,t)=>`<a href="#/${h}">${t}</a>`;$('#nav').innerHTML=l('','Search')+l('scan','Scan')+l('timeline','Timeline')+(me?l('dashboard','Dashboard')+l('profile','Profile')+(me.role==='admin'?l('admin','Admin'):'')+'<button id="lo">Logout</button>':l('login','Log in')+l('register','Register'))+`<button id="th" aria-label="Toggle theme">${document.documentElement.dataset.theme==='dark'?'☀️':'🌙'}</button>`;
  $('#th').onclick=()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;localStorage.setItem('theme',t);nav()};
  const lo=$('#lo');if(lo)lo.onclick=async()=>{try{await api('/logout',{method:'POST',body:{}})}catch{}me=null;nav();location.hash='#/'}}
async function route(){stopCam();$('#nav').classList.remove('open');$('#menu').setAttribute('aria-expanded','false');const[p,qs]=location.hash.slice(2).split('?'),q=new URLSearchParams(qs||'');document.title='FACTLUME';
  if(PAGES[p]){app.innerHTML=`<h1>${PAGES[p][0]}</h1><p>${PAGES[p][1]}</p>`;document.title=PAGES[p][0]+' – FACTLUME'}else(routes[p]||(()=>app.innerHTML='<h1>404</h1><p>Page not found.</p>'))(q);app.focus({preventScroll:true})}
$('#menu').onclick=()=>{const o=$('#nav').classList.toggle('open');$('#menu').setAttribute('aria-expanded',o)};
addEventListener('hashchange',route);
(async()=>{try{me=(await api('/me')).user}catch{}nav();route()})();
