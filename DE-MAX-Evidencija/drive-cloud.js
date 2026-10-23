/* DE-MAX V23: Google Drive direct cloud backup, OAuth GIS.
   Needs user-created Google Cloud OAuth Client ID, consent, Drive API enabled.
   OAuth tokens remain in memory; access is limited to app-created Drive files.
*/
(()=>{'use strict';
const DATA_KEY='demax:evidencija:v1', CLIENT_KEY='demax:drive:oauth-client:v1';
const SCOPE='https://www.googleapis.com/auth/drive.file';
const BASE='https://www.googleapis.com/drive/v3/files';
const UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
const MAIN='DE_MAX_EVIDENCIJA_AKTUELNA.json';
const FOLDER_NAME='DE-MAX Evidencija';
const FOLDER_NOTE='Kopije se čuvaju u folderu „'+FOLDER_NAME+'“ na Google Drive-u. Aplikacija sama pravi taj folder pri prvom povezivanju.';
const HAS_DATA=['students','courses','enrollments','attendance'];
let token='',validUntil=0,cloudFile=null,cloudVersion='',currentClient='',folderId=null;
let active=false,queued=false,timer=null,paused=false,lastUploaded='',lastSaved='',status='Nije povezano',mode='offline';
const get=id=>document.getElementById(id);
const nowText=()=>new Intl.DateTimeFormat('sr-RS',{dateStyle:'short',timeStyle:'short'}).format(new Date());
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
function report(message,state='offline'){
 status=message;mode=state;
 const line=get('dmx-direct-status');if(line)line.textContent=message;
 const label=get('dmx-direct-lastsaved');if(label)label.textContent=lastSaved?'Poslednje potvrđeno čuvanje na Google Drive: '+lastSaved:'Još nije potvrđeno čuvanje na Google Drive.';
 const dot=get('dmx-direct-dot');if(dot){dot.textContent=state==='ok'?'●':state==='busy'?'◌':state==='error'?'!':'○';dot.style.color=state==='ok'?'#16904a':state==='error'?'#c62a3a':'#6484af'}
}
function hasAccess(){const ok=!!token&&Date.now()<validUntil;if(token&&!ok){token='';paused=true;report('Google prijava je istekla. Obnovi povezivanje da nastaviš automatsko čuvanje.','error')}return ok}
function checkData(d){return !!d&&typeof d==='object'&&HAS_DATA.every(k=>Array.isArray(d[k]))}
function localData(){
 const raw=localStorage.getItem(DATA_KEY)||'';
 if(!raw)return {raw:'',data:null};
 let data;try{data=JSON.parse(raw)}catch{throw Error('Lokalna evidencija nije ispravan JSON.')}
 if(!checkData(data))throw Error('Lokalna evidencija ne sadrži sva osnovna polja.');
 return {raw,data};
}
function envelope(data){
 return JSON.stringify({app:'DE-MAX Evidencija',format:'DEMAX-DRIVE-DIRECT-1',version:23,updatedAt:new Date().toISOString(),data},null,2);
}
function unwrap(data){const d=data&&data.data||data;if(!checkData(d))throw Error('Google Drive kopija nije ispravna DE-MAX evidencija.');return d}
function is403or401(response){
 if(response.status===401){token='';validUntil=0;paused=true;report('Google prijava je istekla. Poveži nalog ponovo.','error');return true}
 return false;
}
async function api(url,options={}){
 if(!hasAccess())throw Error('Google prijava nije aktivna. Klikni „Poveži Google nalog“.');
 const h=new Headers(options.headers||{});h.set('Authorization','Bearer '+token);
 const res=await fetch(url,{...options,headers:h,cache:'no-store'});
 if(!res.ok){
  is403or401(res);
  let detail='';try{const j=await res.json();detail=j?.error?.message||''}catch{}
  throw Error('Google Drive greška '+res.status+(detail?': '+detail:''));
 }
 return res;
}
async function ensureFolder(){
 if(folderId)return folderId;
 // drive.file can see app-created items. Manually created folders may need the Google Picker.
 const q="name = '"+FOLDER_NAME.replace(/'/g,"\\'")+"' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
 const url=BASE+'?spaces=drive&pageSize=100&fields='+encodeURIComponent('files(id,name,mimeType,modifiedTime),nextPageToken')+'&q='+encodeURIComponent(q);
 const found=await (await api(url)).json();
 let selected=(found.files||[]).find(f=>f.name===FOLDER_NAME&&f.mimeType==='application/vnd.google-apps.folder');
 if(!selected){
   const created=await api(BASE+'?fields=id,name,mimeType',{
     method:'POST',headers:{'Content-Type':'application/json;charset=UTF-8'},
     body:JSON.stringify({name:FOLDER_NAME,mimeType:'application/vnd.google-apps.folder'})
   });
   selected=await created.json();
 }
 if(!selected?.id)throw Error('Google Drive nije vratio ID foldera.');
 folderId=selected.id;
 const link=get('dmx-direct-folder-link');
 if(link){link.href='https://drive.google.com/drive/u/0/folders/'+encodeURIComponent(folderId);link.hidden=false;}
 return folderId;
}
async function listByName(name){
 const id=await ensureFolder();
 const q="name = '"+name.replace(/'/g,"\\'")+"' and '"+id+"' in parents and trashed = false";
 const url=BASE+'?spaces=drive&pageSize=100&fields='+encodeURIComponent('files(id,name,mimeType,modifiedTime),nextPageToken')+'&q='+encodeURIComponent(q);
 const r=await api(url);const j=await r.json();
 return (j.files||[]).filter(f=>f.name===name&&f.mimeType!=='application/vnd.google-apps.folder');
}
async function newestByName(name){
 const entries=await listByName(name);
 entries.sort((a,b)=>(b.modifiedTime||'').localeCompare(a.modifiedTime||''));
 return entries[0]||null;
}
async function fileMeta(id){
 return (await(await api(BASE+'/'+encodeURIComponent(id)+'?fields=id,name,modifiedTime')).json());
}
async function fileBody(id){
 const txt=await(await api(BASE+'/'+encodeURIComponent(id)+'?alt=media')).text();
 let parsed;try{parsed=JSON.parse(txt)}catch{throw Error('Postojeći Drive fajl nije JSON.')}
 return parsed;
}
async function createFile(name,content){
 const parent=await ensureFolder();
 const bound='demax_'+Math.random().toString(36).slice(2)+Date.now();
 const body=new Blob([
  '--'+bound+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
  JSON.stringify({name,mimeType:'application/json',parents:[parent]})+'\r\n',
  '--'+bound+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
  content+'\r\n','--'+bound+'--'
 ]);
 const r=await api(UPLOAD+'?uploadType=multipart&fields=id,name,modifiedTime',{
  method:'POST',headers:{'Content-Type':'multipart/related; boundary='+bound},body
 });
 return r.json();
}
async function updateFile(id,content){
 const r=await api(UPLOAD+'/'+encodeURIComponent(id)+'?uploadType=media&fields=id,modifiedTime',{
  method:'PATCH',headers:{'Content-Type':'application/json; charset=UTF-8'},body:content
 });
 return r.json();
}
async function ensureDailySnapshot(current){
 const name='DE_MAX_DNEVNA_KOPIJA_'+today()+'.json';
 const existing=await newestByName(name);
 if(existing)return;
 await createFile(name,envelope(current));
}
async function uploadOnce(force=false){
 if(!hasAccess()||paused)return;
 const {raw,data}=localData();
 if(!data){report('Nema lokalne evidencije za slanje. Prvo dodaj podatke ili vrati Drive kopiju.','offline');return}
 if(!force&&raw===lastUploaded){report('Google Drive kopija je ažurna.','ok');return}
 report('Provera i čuvanje na Google Drive…','busy');
 if(cloudFile){
  let meta;
  try{meta=await fileMeta(cloudFile.id)}catch(err){paused=true;throw err}
  if(cloudVersion&&meta.modifiedTime!==cloudVersion){
   paused=true;throw Error('Fajl je promenjen na drugom uređaju. Sačuvaj lokalnu rezervnu kopiju, ponovo poveži nalog i izaberi verziju koju želiš da zadržiš.');
  }
 }else{
  // Handle a file created from another tab after initial authorization.
  const found=await newestByName(MAIN);
  if(found){cloudFile=found;cloudVersion=found.modifiedTime;paused=true;throw Error('Na Drive-u je pronađena nova kopija. Ponovo poveži nalog radi provere razlika.')}
 }
 await ensureDailySnapshot(data);
 const txt=envelope(data);
 let uploaded;
 if(!cloudFile){uploaded=await createFile(MAIN,txt)}
 else uploaded=await updateFile(cloudFile.id,txt);
 cloudFile=uploaded;cloudVersion=uploaded.modifiedTime||'';
 lastUploaded=raw;lastSaved=nowText();
 report('Sačuvano u folder „'+FOLDER_NAME+'“ na Google Drive-u.','ok');
}
function schedule(delay=1300){
 if(!hasAccess()){
  if(currentClient||localStorage.getItem(CLIENT_KEY))report('Promena sačuvana samo lokalno – poveži Google nalog za čuvanje na Drive.','error');
  return;
 }
 if(paused)return;
 queued=true;clearTimeout(timer);timer=setTimeout(()=>{void flush()},delay);
}
async function flush(){
 if(active||!queued||paused||!hasAccess())return;
 active=true;
 try{
  while(queued&&!paused&&hasAccess()){queued=false;await uploadOnce()}
 }catch(err){paused=true;report(err.message||'Automatsko čuvanje nije uspelo.','error')}
 finally{active=false;if(queued&&!paused&&hasAccess())schedule(500)}
}
async function beginSession(){
 paused=true;queued=false;clearTimeout(timer);
 await ensureFolder();
 const {data,raw}=localData();
 const remote=await newestByName(MAIN);
 if(remote){
  const remoteDoc=await fileBody(remote.id);
  const cloudData=unwrap(remoteDoc);
  const comparison=JSON.stringify(cloudData)===raw;
  if(!comparison){
   const choice=confirm(
    'Na Google Drive-u postoji drugačija DE-MAX evidencija.\n\n'+
    (data?'Na ovom računaru već imaš podatke.':'Na ovom računaru trenutno nema sačuvanih podataka.')+
    '\n\nOK = Sačuvaj podatke sa OVOG računara preko Drive kopije uz prethodnu dodatnu sigurnosnu kopiju.\n'+
    'OTKAŽI = Ništa ne prepisuj. Možeš koristiti „Vrati sa Drive-a“.'
   );
   if(!choice){
    cloudFile=remote;cloudVersion=remote.modifiedTime;lastUploaded='';
    report('Različite kopije: sinhronizacija je pauzirana, Drive nije prepisan.','error');return;
   }
   if(!data){cloudFile=remote;cloudVersion=remote.modifiedTime;report('Na ovom računaru nema podataka. Izaberi „Vrati sa Drive-a“.','error');return}
   const ts=new Date().toISOString().replace(/[:.]/g,'-');
   await createFile('DE_MAX_PRE_PREPISIVANJA_'+ts+'.json',JSON.stringify(remoteDoc,null,2));
  }
  cloudFile=remote;cloudVersion=remote.modifiedTime;
 }else{cloudFile=null;cloudVersion=''}
 if(!data){
  report('Povezano, ali lokalna evidencija još ne postoji. Dodaj prvog učenika.','ok');
  paused=false;lastUploaded='';return;
 }
 paused=false;lastUploaded='';
 await uploadOnce(true);
}
function loadGoogleLibrary(){
 if(window.google?.accounts?.oauth2)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const t=document.querySelector('script[data-dmx-google-gis]');
  if(t){let attempts=0;const poll=setInterval(()=>{if(window.google?.accounts?.oauth2){clearInterval(poll);resolve()}else if(++attempts>50){clearInterval(poll);reject(Error('Google prijava se nije učitala.'))}},100);return}
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';
  script.async=true;script.dataset.dmxGoogleGis='1';
  script.onload=()=>window.google?.accounts?.oauth2?resolve():reject(Error('Google prijava nije dostupna.'));
  script.onerror=()=>reject(Error('Nije moguće učitati Google Identity Services.'));
  document.head.appendChild(script);
 });
}
function connect(){
 const client=(get('dmx-direct-client')?.value||'').trim();
 if(!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(client)){
  report('Unesi ispravan Google OAuth Client ID iz Google Cloud konzole.','error');return;
 }
 localStorage.setItem(CLIENT_KEY,client);
 // Token client is only used from an explicit click, never silently on page load.
 if(!window.google?.accounts?.oauth2){report('Google prijava se učitava. Klikni ponovo.','offline');void loadGoogleLibrary();return}
 currentClient=client;
 let oauth;
 try{
  oauth=window.google.accounts.oauth2.initTokenClient({
   client_id:client,scope:SCOPE,
   callback:async result=>{
    if(result.error||!result.access_token){report('Google prijava nije uspela: '+(result.error_description||result.error||'nema dozvole'),'error');return}
    if(typeof window.google.accounts.oauth2.hasGrantedAllScopes==='function'&&!window.google.accounts.oauth2.hasGrantedAllScopes(result,SCOPE)){
     report('Nije odobrena dozvola za čuvanje fajlova na Drive-u.','error');return
    }
    token=result.access_token;
    validUntil=Date.now()+Math.max(60,Number(result.expires_in||3600)-120)*1000;
    report('Google nalog povezan. Proveravam postojeću kopiju…','busy');
    try{await beginSession()}catch(err){paused=true;report('Povezano, ali nije sačuvano: '+(err.message||String(err)),'error')}
   },
   error_callback: e=>report('Google prozor je zatvoren ili blokiran: '+(e?.type||'pokušaj ponovo'),'error')
  });
  oauth.requestAccessToken({prompt:'consent'});
 }catch(err){report('Neuspešno pokretanje Google prijave: '+(err.message||String(err)),'error')}
}
async function saveNow(){
 if(!hasAccess()){report('Najpre poveži Google nalog.','error');return}
 if(paused){await beginSession();return}
 try{await uploadOnce(true)}catch(err){paused=true;report('Nije sačuvano: '+(err.message||String(err)),'error')}
}
async function restore(){
 if(!hasAccess()){report('Najpre poveži Google nalog.','error');return}
 try{
  await ensureFolder();
  const found=await newestByName(MAIN);
  if(!found)throw Error('Nema DE-MAX kopije na Drive-u.');
  const remoteDoc=await fileBody(found.id),data=unwrap(remoteDoc);
  if(!confirm('VRAĆANJE SA GOOGLE DRIVE-A\n\nSvi lokalni učenici, kursevi, uplate i prijave biće zamenjeni Drive kopijom.\n\nDa li želiš da nastaviš?'))return;
  const current=localData();
  if(current.data){
   await createFile('DE_MAX_PRE_VRACANJA_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',envelope(current.data));
  }
  localStorage.setItem(DATA_KEY,JSON.stringify(data));
  token='';paused=true;
  location.reload();
 }catch(err){report('Nije uspelo vraćanje kopije: '+(err.message||String(err)),'error')}
}
function show(on){const el=get('dmx-direct-modal');if(!el)return;el.hidden=!on;if(on)report(status,mode)}
function addUI(){
 const nav=document.querySelector('aside.sidebar nav');if(!nav||get('dmx-direct-open'))return;
 const b=document.createElement('button');b.type='button';b.id='dmx-direct-open';b.className='nav-btn';
 b.innerHTML='<span class="nav-icon" aria-hidden="true">☁</span><span>Google Drive – direktno <span id="dmx-direct-dot" style="color:#6484af">○</span></span>';
 nav.appendChild(b);
 const dialog=document.createElement('div');dialog.id='dmx-direct-modal';dialog.hidden=true;
 dialog.innerHTML=
 '<section class="dmx-direct-panel" role="dialog" aria-modal="true" aria-labelledby="dmx-direct-title">'+
 '<button class="dmx-direct-close" id="dmx-direct-close" type="button" aria-label="Zatvori">×</button>'+
 '<h2 id="dmx-direct-title">☁ Google Drive – direktno čuvanje</h2>'+
 '<p><strong>Nije potrebna instalacija.</strong> Nakon povezivanja, DE-MAX automatski pravi folder <strong>DE-MAX Evidencija</strong> na tvom Google Drive-u i u njemu čuva kopije dok je aplikacija otvorena i Google dozvola važeća.</p>'+
 '<div class="dmx-direct-status" id="dmx-direct-status" role="status">Nije povezano</div>'+
 '<div class="dmx-direct-last" id="dmx-direct-lastsaved">Još nije potvrđeno čuvanje na Google Drive.</div>'+
 '<a id="dmx-direct-folder-link" href="https://drive.google.com/drive/my-drive" target="_blank" rel="noopener noreferrer" hidden>📂 Otvori DE-MAX folder na Google Drive-u</a>'+
 '<label class="dmx-direct-label" for="dmx-direct-client">Google OAuth Client ID (jednokratno podešavanje)</label>'+
 '<input id="dmx-direct-client" type="text" autocomplete="off" spellcheck="false" placeholder="1234567890-xxxx.apps.googleusercontent.com">'+
 '<div class="dmx-direct-buttons">'+
 '<button type="button" id="dmx-direct-connect">🔐 Poveži Google nalog</button>'+
 '<button type="button" id="dmx-direct-save">💾 Sačuvaj odmah</button>'+
 '<button type="button" id="dmx-direct-restore">↩ Vrati sa Drive-a</button>'+
 '</div>'+
 '<div class="dmx-direct-help"><strong>Prvo podešavanje (bez instalacije):</strong>'+
 '<ol><li>Otvori <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> i napravi projekat „DE-MAX“.</li>'+
 '<li>Uključi <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">Google Drive API</a>.</li>'+
 '<li>U <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener noreferrer">Google Auth Platform</a> podesi Audience = External, dodaj svoj Google nalog kao test korisnika i uključi opseg <code>https://www.googleapis.com/auth/drive.file</code>.</li>'+
 '<li>U Clients napravi <strong>OAuth client ID → Web application</strong>. Kao <strong>Authorized JavaScript origin</strong> unesi <code>https://nemackidemax13-oss.github.io</code>.</li>'+
 '<li>Kopiraj samo <strong>Client ID</strong> u polje iznad i klikni „Poveži Google nalog“.</li></ol>'+
 '<p>Ne unosi nikakav Client Secret ili Google lozinku u DE-MAX. Token se drži samo u memoriji pregledača.</p>'+
 '<p class="dmx-direct-foot">'+FOLDER_NOTE+' Ako si folder ranije napravio ručno, zbog ograničenih Google dozvola može se pojaviti novi folder istog naziva koji je kreirala aplikacija. Rezervna kopija sadrži učenike, prijave, uplate i kurseve; fotografije/video u „Uspomenama“ nisu uključeni. Sačuvana je i lokalna kopija. Za veće arhive i dalje preuzimaj rezervne kopije u delu „Podaci“.</p>'+
 '<p class="dmx-direct-foot"><strong>Napomena:</strong> Posle isteka Google pristupa ili zatvaranja aplikacije moraš ponovo da klikneš „Poveži Google nalog“. Sinhronizacija ne funkcioniše u pozadini kada je aplikacija zatvorena.</p>'+
 '</div></section>';
 document.body.appendChild(dialog);
 const style=document.createElement('style');
 style.textContent='#dmx-direct-modal[hidden]{display:none!important}#dmx-direct-modal{position:fixed;inset:0;background:rgba(12,22,44,.55);z-index:1000001;display:grid;place-items:center;padding:12px;overflow:auto}'+
 '.dmx-direct-panel{position:relative;box-sizing:border-box;background:white;color:#19324e;width:min(100%,710px);padding:22px;border-radius:18px;max-height:94vh;overflow:auto;box-shadow:0 20px 60px #0004}'+
 '.dmx-direct-panel h2{font-size:22px;margin:0 36px 12px 0}.dmx-direct-panel p,.dmx-direct-panel li{font-size:13px;line-height:1.5;margin:8px 0}'+
 '.dmx-direct-close{position:absolute;right:12px;top:12px;width:36px;height:36px;border:0;border-radius:50%;background:#eef1f8;font-size:25px;cursor:pointer}'+
 '.dmx-direct-status{padding:10px 12px;background:#e8f1ff;border-radius:9px;font-size:13px;font-weight:700;margin:12px 0 4px}'+
 '.dmx-direct-last{font-size:12px;color:#62718c;margin-bottom:9px}#dmx-direct-folder-link{display:inline-block;color:#0b5dbc;text-decoration:underline;font-size:13px;margin-bottom:13px}#dmx-direct-folder-link[hidden]{display:none}.dmx-direct-label{display:block;font-weight:750;font-size:13px;margin-bottom:7px}'+
 '#dmx-direct-client{box-sizing:border-box;display:block;width:100%;font-size:13px;padding:11px 12px;border-radius:8px;border:1px solid #adbcd4}'+
 '.dmx-direct-buttons{display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:9px;margin:12px 0}'+
 '.dmx-direct-buttons button{cursor:pointer;border:0;border-radius:9px;font-weight:700;padding:12px 9px;background:#e5eefc;color:#19478f}'+
 '#dmx-direct-connect{background:#168145;color:white}.dmx-direct-help{border-top:1px solid #e3e7ec;padding-top:11px}'+
 '.dmx-direct-help a{color:#135abe;text-decoration:underline}.dmx-direct-help ol{padding-left:20px}'+
 '.dmx-direct-foot{color:#64718a;font-size:11px!important}.dmx-direct-help code{overflow-wrap:anywhere;font-size:11px}'+
 '@media(max-width:540px){.dmx-direct-panel{padding:16px}.dmx-direct-panel h2{font-size:19px}.dmx-direct-buttons{grid-template-columns:1fr}}';
 document.head.appendChild(style);
 b.addEventListener('click',()=>show(true));
 get('dmx-direct-close').addEventListener('click',()=>show(false));
 dialog.addEventListener('click',e=>{if(e.target===dialog)show(false)});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.hidden)show(false)});
 get('dmx-direct-connect').addEventListener('click',()=>connect());
 get('dmx-direct-save').addEventListener('click',()=>{void saveNow()});
 get('dmx-direct-restore').addEventListener('click',()=>{void restore()});
 get('dmx-direct-client').value=localStorage.getItem(CLIENT_KEY)||'';
 report(status,mode);
}
window.addEventListener('demax:datachanged',()=>schedule());
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addUI);
else addUI();
void loadGoogleLibrary().catch(()=>{});
})();