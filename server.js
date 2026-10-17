'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PROD=process.env.NODE_ENV==='production',ADMIN=(process.env.ADMIN_EMAIL||'').toLowerCase();
const DBF=process.env.DB_FILE||path.join(__dirname,'data','db.json');
let db={users:[],sessions:[],saved:[],messages:[],resets:[]};
try{db=Object.assign(db,JSON.parse(fs.readFileSync(DBF,'utf8')))}catch{}
const save=()=>{fs.mkdirSync(path.dirname(DBF),{recursive:true});fs.writeFileSync(DBF+'.tmp',JSON.stringify(db));fs.renameSync(DBF+'.tmp',DBF)};
const rid=()=>crypto.randomBytes(24).toString('hex'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const hash=(p,s=crypto.randomBytes(16).toString('hex'))=>s+':'+crypto.scryptSync(p,s,64).toString('hex');
const verify=(p,h)=>{const[s,k]=h.split(':'),a=Buffer.from(k,'hex'),b=crypto.scryptSync(p,s,64);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const DUMMY=hash('x');
const hits=new Map();
const limited=(req,k,max=20)=>{const key=req.socket.remoteAddress+k,now=Date.now(),a=(hits.get(key)||[]).filter(t=>now-t<9e5);a.push(now);hits.set(key,a);return a.length>max};
const send=(res,c,o,h={})=>{res.writeHead(c,{'Content-Type':'application/json','Cache-Control':'no-store',...h});res.end(JSON.stringify(o))};
const fail=(c,m)=>Object.assign(new Error(m),{status:c});
const body=req=>new Promise((ok,no)=>{let s='';req.on('data',d=>{s+=d;if(s.length>1e4){no(fail(413,'Body too large'));req.destroy()}});req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch{no(fail(400,'Invalid JSON'))}});req.on('error',no)});
const ext=async u=>{let r;try{r=await fetch(u,{headers:{'User-Agent':'FACTLUME/1.0'},signal:AbortSignal.timeout(8000)})}catch{throw fail(502,'Upstream service unavailable')}if(r.status===404)throw fail(404,'Not found');if(!r.ok)throw fail(502,'Upstream service error');return r.json()};
const validCode=c=>{if(!/^(\d{8}|\d{12,13})$/.test(c))return false;const d=[...c].map(Number),k=d.pop();const s=d.reverse().reduce((a,n,i)=>a+n*(i%2?1:3),0);return (10-s%10)%10===k};
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const pub=u=>({id:u.id,name:u.name,email:u.email,role:u.role});
const cookie=(v,age)=>`sid=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${PROD?'; Secure':''}`;
function auth(req){const m=/(?:^|; )sid=([a-f0-9]+)/.exec(req.headers.cookie||'');if(!m)return null;const h=sha(m[1]),s=db.sessions.find(x=>x.h===h&&x.exp>Date.now());return s?db.users.find(u=>u.id===s.uid)||null:null}
const login=(res,u)=>{const t=rid();db.sessions=db.sessions.filter(s=>s.exp>Date.now());db.sessions.push({h:sha(t),uid:u.id,exp:Date.now()+6048e5});save();return cookie(t,604800)};
const need=(u,role)=>{if(!u)throw fail(401,'Please log in');if(role&&u.role!==role)throw fail(403,'Forbidden')};
const str=(v,max,min=1)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max)throw fail(400,'Invalid input');return v.trim()};
const wiki='https://en.wikipedia.org/';

async function api(req,res,url){
  const p=url.pathname.slice(4),m=req.method,q=url.searchParams,u=auth(req);
  if(m!=='GET'&&m!=='HEAD'&&!/^application\/json/.test(req.headers['content-type']||'')&&m!=='DELETE')throw fail(415,'JSON required');
  const b=['POST','PATCH'].includes(m)?await body(req):{};
  if(p==='/register'&&m==='POST'){if(limited(req,'auth'))throw fail(429,'Too many attempts');
    const name=str(b.name,60),email=str(b.email,120).toLowerCase(),pw=str(b.password,200,10);if(!EMAIL.test(email))throw fail(400,'Invalid email');
    if(db.users.some(x=>x.email===email))throw fail(409,'Could not register with these details');
    const n={id:rid(),name,email,pw:hash(pw),role:email===ADMIN?'admin':'user',created:Date.now()};db.users.push(n);return send(res,201,{user:pub(n)},{'Set-Cookie':login(res,n)})}
  if(p==='/login'&&m==='POST'){if(limited(req,'auth'))throw fail(429,'Too many attempts');
    const e=String(b.email||'').toLowerCase(),x=db.users.find(z=>z.email===e),ok=verify(String(b.password||''),x?x.pw:DUMMY);
    if(!x||!ok)throw fail(401,'Invalid email or password');return send(res,200,{user:pub(x)},{'Set-Cookie':login(res,x)})}
  if(p==='/logout'&&m==='POST'){const c=/sid=([a-f0-9]+)/.exec(req.headers.cookie||'');if(c){db.sessions=db.sessions.filter(s=>s.h!==sha(c[1]));save()}return send(res,200,{ok:true},{'Set-Cookie':cookie('',0)})}
  if(p==='/forgot'&&m==='POST'){if(limited(req,'auth',5))throw fail(429,'Too many attempts');
    if(!process.env.RESET_WEBHOOK_URL)throw fail(501,'Password reset email is not configured on this server');
    const e=str(b.email,120).toLowerCase(),x=db.users.find(z=>z.email===e);
    if(x){const t=rid();db.resets=db.resets.filter(r=>r.exp>Date.now()&&r.uid!==x.id);db.resets.push({h:sha(t),uid:x.id,exp:Date.now()+36e5});save();
      try{await fetch(process.env.RESET_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,link:`${process.env.PUBLIC_URL||''}/#/reset?token=${t}`}),signal:AbortSignal.timeout(8000)})}catch{throw fail(502,'Could not send reset email')}}
    return send(res,200,{ok:true})}
  if(p==='/reset'&&m==='POST'){if(limited(req,'auth'))throw fail(429,'Too many attempts');const pw=str(b.password,200,10),h=sha(String(b.token||'')),r=db.resets.find(z=>z.h===h&&z.exp>Date.now());
    if(!r)throw fail(400,'Reset link is invalid or expired');const x=db.users.find(z=>z.id===r.uid);x.pw=hash(pw);db.resets=db.resets.filter(z=>z!==r);db.sessions=db.sessions.filter(s=>s.uid!==x.id);save();return send(res,200,{ok:true})}
  if(p==='/me'&&m==='GET')return send(res,200,{user:u?pub(u):null});
  if(p==='/me'&&m==='PATCH'){need(u);u.name=str(b.name,60);save();return send(res,200,{user:pub(u)})}
  if(p==='/suggest'){const s=str(q.get('q')||'',100);const d=await ext(`${wiki}w/api.php?action=opensearch&limit=6&format=json&search=${encodeURIComponent(s)}`);return send(res,200,{suggestions:d[1]||[]})}
  if(p==='/search'){const s=str(q.get('q')||'',100),cat=q.get('cat')==='history'?' history':'';
    const d=await ext(`${wiki}w/api.php?action=query&list=search&format=json&srlimit=10&srsearch=${encodeURIComponent(s+cat)}`);
    return send(res,200,{results:(d.query?.search||[]).map(r=>({title:r.title,snippet:r.snippet.replace(/<[^>]+>/g,''),url:`${wiki}wiki/${encodeURIComponent(r.title.replace(/ /g,'_'))}`}))})}
  if(p==='/article'){const t=str(q.get('title')||'',200),d=await ext(`${wiki}api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g,'_'))}`);
    return send(res,200,{title:d.title,extract:d.extract,description:d.description,image:d.thumbnail?.source,url:d.content_urls?.desktop?.page})}
  if(p==='/timeline'){const mo=+q.get('month'),da=+q.get('day');if(!(mo>=1&&mo<=12&&da>=1&&da<=31))throw fail(400,'Invalid date');
    const d=await ext(`${wiki}api/rest_v1/feed/onthisday/events/${String(mo).padStart(2,'0')}/${String(da).padStart(2,'0')}`);
    return send(res,200,{events:(d.events||[]).sort((a,c)=>a.year-c.year).map(e=>({year:e.year,text:e.text,url:e.pages?.[0]?.content_urls?.desktop?.page}))})}
  if(p.startsWith('/product/')){const c=p.slice(9);if(!validCode(c))throw fail(400,'Invalid barcode. Use a valid EAN-8, EAN-13 or UPC-A number');
    const d=await ext(`https://world.openfoodfacts.org/api/v2/product/${c}.json`).catch(e=>{if(e.status===404)return{status:0};throw e});
    if(d.status!==1)throw fail(404,'Product not found in Open Food Facts');const x=d.product;
    return send(res,200,{code:c,name:x.product_name||'Unnamed product',brand:x.brands,quantity:x.quantity,ingredients:x.ingredients_text,nutriscore:x.nutrition_grades,image:x.image_front_small_url,url:`https://world.openfoodfacts.org/product/${c}`})}
  if(p==='/products'){const s=str(q.get('q')||'',100),d=await ext(`https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&json=1&page_size=10&fields=code,product_name,brands&search_terms=${encodeURIComponent(s)}`);
    return send(res,200,{products:(d.products||[]).filter(x=>x.product_name).map(x=>({code:x.code,name:x.product_name,brand:x.brands}))})}
  if(p==='/prices'){if(!process.env.PRICE_API_URL||!process.env.PRICE_API_KEY)throw fail(501,'Price comparison needs an authorised shopping API: set PRICE_API_URL and PRICE_API_KEY and implement the provider adapter in server.js');throw fail(501,'Price provider adapter not implemented')}
  if(p==='/contact'&&m==='POST'){if(limited(req,'contact',5))throw fail(429,'Too many messages');const e=str(b.email,120);if(!EMAIL.test(e))throw fail(400,'Invalid email');
    db.messages.push({id:rid(),name:str(b.name,60),email:e,message:str(b.message,2000),at:Date.now()});save();return send(res,201,{ok:true})}
  if(p==='/saved'&&m==='GET'){need(u);return send(res,200,{items:db.saved.filter(s=>s.uid===u.id).sort((a,c)=>c.at-a.at)})}
  if(p==='/saved'&&m==='POST'){need(u);const type=b.type;if(!['article','search','product'].includes(type))throw fail(400,'Invalid type');
    const key=str(b.key,200),it=db.saved.find(s=>s.uid===u.id&&s.type===type&&s.key===key);if(it)return send(res,200,{item:it});
    const n={id:rid(),uid:u.id,type,key,title:str(b.title,200),at:Date.now()};db.saved.push(n);save();return send(res,201,{item:n})}
  if(p.startsWith('/saved/')&&m==='DELETE'){need(u);const n=db.saved.length;db.saved=db.saved.filter(s=>!(s.id===p.slice(7)&&s.uid===u.id));if(n===db.saved.length)throw fail(404,'Not found');save();return send(res,200,{ok:true})}
  if(p==='/admin/users'){need(u,'admin');return send(res,200,{users:db.users.map(x=>({...pub(x),created:x.created}))})}
  if(p==='/admin/messages'){need(u,'admin');return send(res,200,{messages:db.messages})}
  if(p==='/admin/role'&&m==='POST'){need(u,'admin');const x=db.users.find(z=>z.id===b.id);if(!x||!['user','admin'].includes(b.role))throw fail(400,'Invalid input');if(x.id===u.id)throw fail(400,'Cannot change your own role');x.role=b.role;save();return send(res,200,{user:pub(x)})}
  throw fail(404,'Unknown endpoint');
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.txt':'text/plain'};
const sec={'Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Permissions-Policy':'camera=(self), microphone=(self), geolocation=()'};
const server=http.createServer(async(req,res)=>{
  for(const k in sec)res.setHeader(k,sec[k]);
  try{const url=new URL(req.url,'http://x');
    if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    if(!['GET','HEAD'].includes(req.method))throw fail(405,'Method not allowed');
    let f=path.join(__dirname,'public',url.pathname==='/'?'index.html':decodeURIComponent(url.pathname));
    if(!f.startsWith(path.join(__dirname,'public'))||!fs.existsSync(f)||fs.statSync(f).isDirectory())throw fail(404,'Not found');
    res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
  }catch(e){const c=e.status||500;if(c===500)console.error(e);if(!res.headersSent)send(res,c,{error:c===500?'Internal server error':e.message})}
});
if(require.main===module)server.listen(process.env.PORT||3000,()=>console.log('FACTLUME on :'+(process.env.PORT||3000)));
module.exports=server;
