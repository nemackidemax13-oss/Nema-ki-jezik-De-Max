/* DE-MAX V22 – automatic backups into a user-selected Google Drive for desktop folder.
   All records remain local unless the user explicitly grants write access to a folder.
   The browser cannot tell whether a selected folder is synchronized by Google Drive. */
(()=>{'use strict';
const DATA_KEY='demax:evidencija:v1';
const IDB='DEMAX_DRIVE_BACKUP_HANDLE_V1';
const BACKUP='DE_MAX_AUTOMATSKA_KOPIJA.json';
const PREVIOUS='DE_MAX_PRETHODNA_KOPIJA.json';
const VALID=['students','courses','enrollments','attendance'];
let folder=null, enabled=false, dirty=false, active=false, timer=null, lastSavedRaw='', lastSavedAt=null, status='Nije povezano';
let state='offline';
const $=id=>document.getElementById(id);
const formatTime=date=>new Intl.DateTimeFormat('sr-RS',{dateStyle:'short',timeStyle:'short'}).format(date);
function setStatus(message,mode='offline'){
 status=message;state=mode;
 const text=$('dmx-drive-status');if(text) text.textContent=message;
 const open=$('dmx-drive-open');if(open){
   open.title='Google Drive kopija: '+message;
   open.querySelector('.dmx-cloud-dot').textContent=mode==='ok'?'●':mode==='busy'?'◌':mode==='error'?'!':'○';
   open.querySelector('.dmx-cloud-dot').style.color=mode==='ok'?'#128344':mode==='error'?'#c52727':'#547fb7';
 }
 const details=$('dmx-drive-last');if(details)details.textContent=lastSavedAt?'Poslednje zapisivanje u izabrani folder: '+formatTime(lastSavedAt):'Još nema potvrđene rezervne kopije.';
}
function records(){
 const raw=localStorage.getItem(DATA_KEY);
 if(!raw)throw Error('Evidencija na ovom uređaju nije pronađena.');
 let data;try{data=JSON.parse(raw)}catch{throw Error('Evidencija nije ispravan JSON.')}
 if(!data||!VALID.every(k=>Array.isArray(data[k])))throw Error('Evidencija nije potpuna.');
 return {raw,data};
}
function openDB(){return new Promise((resolve,reject)=>{
 const r=indexedDB.open(IDB,1);
 r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('handles'))r.result.createObjectStore('handles');};
 r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
});}
async function saveHandle(handle){
 const db=await openDB();try{await new Promise((resolve,reject)=>{
  const tx=db.transaction('handles','readwrite');
  tx.objectStore('handles').put(handle,'folder');
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 })}finally{db.close()}}
async function readHandle(){
 const db=await openDB();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('handles','readonly'),r=tx.objectStore('handles').get('folder');
  r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);
 })}finally{db.close()}}
async function access(ask){
 if(!folder)return false;
 if(typeof folder.queryPermission!=='function')return true;
 try{
  if(await folder.queryPermission({mode:'readwrite'})==='granted')return true;
  return !!(ask&&typeof folder.requestPermission==='function'&&await folder.requestPermission({mode:'readwrite'})==='granted');
 }catch{return false}
}
async function getBackup(name){
 try{const fh=await folder.getFileHandle(name),f=await fh.getFile();
  if(f.size>20000000)throw Error('Rezervna kopija je veća od dozvoljene veličine (20 MB).');
  return await f.text();
 }catch(err){if(err.name==='NotFoundError')return null;throw err}
}
async function putBackup(name,text){
 const handle=await folder.getFileHandle(name,{create:true});
 const stream=await handle.createWritable();
 try{await stream.write(text);await stream.close()}catch(err){try{await stream.abort()}catch{}throw err}
}
function makeEnvelope(data){
 return JSON.stringify({app:'DE-MAX Evidencija',format:'DEMAX-DRIVE-AUTOBACKUP-1',version:22,updatedAt:new Date().toISOString(),data},null,2);
}
function isValidBackup(value){return value&&typeof value==='object'&&VALID.every(k=>Array.isArray((value.data||value)[k]));}
async function performWrite(force=false){
 if(!folder||!enabled)return;
 if(!(await access(false))){enabled=false;setStatus('Potrebna dozvola za folder – klikni Google Drive kopija','error');return}
 const {raw,data}=records();
 if(!force&&raw===lastSavedRaw){setStatus('Kopija je ažurna u izabranom folderu','ok');return}
 setStatus('Čuvanje u Drive folderu…','busy');
 const earlier=await getBackup(BACKUP);
 if(earlier){
  try{
   const parsed=JSON.parse(earlier);
   if(!isValidBackup(parsed))throw Error('Postojeća kopija nije DE-MAX fajl.');
  }catch{throw Error('Postojeća kopija nije ispravna – nije prepisana.')}
 }
 const today=new Date().toISOString().slice(0,10);
 const dayFile='DE_MAX_DNEVNA_KOPIJA_'+today+'.json';
 if((await getBackup(dayFile))===null)await putBackup(dayFile,earlier||makeEnvelope(data));
 if(earlier&&!lastSavedRaw)await putBackup(PREVIOUS,earlier);
 // Write the newest data only after the previous version is safely retained.
 await putBackup(BACKUP,makeEnvelope(data));
 lastSavedRaw=raw;lastSavedAt=new Date();
 setStatus('Sačuvano u Drive folderu: '+formatTime(lastSavedAt),'ok');
}
function schedule(delay=1100){
 if(!folder)return;dirty=true;
 clearTimeout(timer);
 timer=setTimeout(()=>{void flush()},delay);
}
async function flush(){
 if(active||!folder||!dirty||!enabled)return;
 active=true;
 try{
  while(dirty&&enabled){dirty=false;await performWrite()}
 }catch(err){enabled=false;setStatus('Greška: '+(err.message||'nije moguće sačuvati'),'error');}
 finally{active=false;if(dirty&&enabled)schedule(600)}
}
function modal(open){
 const el=$('dmx-drive-modal');if(!el)return;
 el.hidden=!open;
 if(open){setStatus(status,state);$('dmx-drive-connect').focus()}
}
async function connectFolder(){
 if(!window.showDirectoryPicker){
  setStatus('Ovaj pregledač ne podržava pristup folderu. Otvori u Chrome-u ili Edge-u.','error');return;
 }
 try{
  // Directly triggered by a click so Chrome preserves the required user activation.
  const chosen=await window.showDirectoryPicker({mode:'readwrite',id:'demax-drive'});
  folder=chosen;await saveHandle(folder);
  if(!(await access(true)))throw Error('Nije odobren pristup za upis.');
  const data=records();
  const existing=await getBackup(BACKUP);
  if(existing&&existing!==null){
   let old;try{old=JSON.parse(existing)}catch{throw Error('Postojeća kopija nije ispravan JSON.')}
   if(!isValidBackup(old))throw Error('Postojeća kopija nije DE-MAX evidencija.');
   if(JSON.stringify(old.data||old)!==data.raw){
    const proceed=confirm('U folderu već postoji DE-MAX kopija.\n\nOK: Sačuvaj evidenciju OVOG računara (postojeća kopija se zadržava i kao prethodna).\nOtkaži: Nemoj ništa prepisivati. Možeš kliknuti „Vrati kopiju“ ako želiš podatke iz foldera.');
    if(!proceed){enabled=false;setStatus('Folder povezan; čuvanje je pauzirano – možeš vratiti kopiju','offline');return}
   }
  }
  enabled=true;dirty=false;lastSavedRaw='';
  await performWrite(true);
 }catch(err){if(err.name==='AbortError')return;enabled=false;setStatus('Povezivanje nije uspelo: '+(err.message||String(err)),'error')}
}
async function reconnect(){
 if(!folder){await connectFolder();return}
 try{
  if(!(await access(true)))throw Error('Nije odobren pristup folderu.');
  const existing=await getBackup(BACKUP);
  if(existing){
   const old=JSON.parse(existing);
   if(!isValidBackup(old))throw Error('Fajl u folderu nije ispravna DE-MAX kopija.');
   const {raw}=records();
   if(JSON.stringify(old.data||old)!==raw&&!confirm('Postoji drugačija kopija u folderu. Želiš li da sačuvaš podatke sa ovog računara umesto nje? Ako ne, koristi „Vrati kopiju“.')){enabled=false;setStatus('Čuvanje pauzirano; kopija nije prepisana','offline');return}
  }
  enabled=true;dirty=false;lastSavedRaw='';
  await performWrite(true);
 }catch(err){enabled=false;setStatus('Greška pristupa: '+(err.message||String(err)),'error')}
}
async function saveNow(){
 if(!folder){await connectFolder();return}
 if(!enabled){await reconnect();return}
 try{dirty=false;lastSavedRaw='';await performWrite(true)}catch(err){enabled=false;setStatus('Nije sačuvano: '+(err.message||String(err)),'error')}
}
async function restore(){
 if(!folder){setStatus('Najpre izaberi Drive folder','error');return}
 try{
  if(!(await access(true)))throw Error('Nije dozvoljen pristup folderu.');
  const content=await getBackup(BACKUP);
  if(!content)throw Error('Nema DE_MAX_AUTOMATSKA_KOPIJA.json u folderu.');
  const doc=JSON.parse(content);
  if(!isValidBackup(doc))throw Error('Kopija ne sadrži kompletnu evidenciju.');
  const imported=doc.data||doc;
  if(!confirm('VRAĆANJE PODATAKA:\n\nOvo će zameniti sve lokalne učenike, kurseve, uplate i ostale podatke kopijom iz foldera.\n\nDa li želiš da nastaviš?'))return;
  const current=localStorage.getItem(DATA_KEY);
  if(current)await putBackup('DE_MAX_PRE_VRACANJA_'+Date.now()+'.json',
    JSON.stringify({app:'DE-MAX Evidencija',format:'DEMAX-DRIVE-PRE-RESTORE-1',updatedAt:new Date().toISOString(),data:JSON.parse(current)},null,2));
  localStorage.setItem(DATA_KEY,JSON.stringify(imported));
  enabled=false;location.reload();
 }catch(err){setStatus('Vraćanje nije uspelo: '+(err.message||String(err)),'error')}
}
function installUI(){
 if($('dmx-drive-open'))return;
 const nav=document.querySelector('aside.sidebar nav');
 if(!nav)return;
 const open=document.createElement('button');
 open.type='button';open.className='nav-btn';open.id='dmx-drive-open';
 open.innerHTML='<span class="nav-icon" aria-hidden="true">☁</span><span>Google Drive kopija <span class="dmx-cloud-dot">○</span></span>';
 nav.appendChild(open);
 const div=document.createElement('div');div.id='dmx-drive-modal';div.hidden=true;div.innerHTML=
 '<div class="dmx-drive-panel" role="dialog" aria-modal="true" aria-labelledby="dmx-drive-title">'+
 '<button type="button" class="dmx-drive-close" id="dmx-drive-close" aria-label="Zatvori">×</button>'+
 '<h2 id="dmx-drive-title">☁ Automatska kopija na Google Drive</h2>'+
 '<p>DE-MAX automatski čuva učenike, kurseve, prijave, termine i uplate u izabrani folder nakon svake promene.</p>'+
 '<p class="dmx-drive-warning"><strong>Prvo instaliraj Google Drive for desktop</strong> i odaberi folder unutar <strong>My Drive</strong>. Ako izabereš običan folder, fajl neće biti poslat na Google Drive.</p>'+
 '<div class="dmx-drive-status" id="dmx-drive-status" role="status">Nije povezano</div>'+
 '<div class="dmx-drive-last" id="dmx-drive-last">Još nema potvrđene rezervne kopije.</div>'+
 '<div class="dmx-drive-buttons">'+
 '<button type="button" id="dmx-drive-connect">📁 Poveži Google Drive folder</button>'+
 '<button type="button" id="dmx-drive-reconnect">🔓 Obnovi dozvolu</button>'+
 '<button type="button" id="dmx-drive-save">💾 Sačuvaj sada</button>'+
 '<button type="button" id="dmx-drive-restore">↩ Vrati kopiju</button>'+
 '</div>'+
 '<p class="dmx-drive-foot">Datoteka: <strong>DE_MAX_AUTOMATSKA_KOPIJA.json</strong>. Čuva se i dnevna kopija. Sinhronizaciju u oblak obavlja Google Drive for desktop, kada je pokrenut i povezan na internet. Fotografije i video iz „Uspomena“ nisu uključeni u ovu JSON kopiju.</p>'+
 '<p class="dmx-drive-foot">Podaci su privatni – izaberi folder na svom ličnom Google Drive-u. Ne deli taj folder javno. Za potpunu kopiju sa uspomenama i dalje koristi opciju u odeljku „Podaci“.</p>'+
 '</div>';
 document.body.appendChild(div);
 const css=document.createElement('style');css.textContent=
 '#dmx-drive-modal[hidden]{display:none!important}#dmx-drive-modal{position:fixed;inset:0;background:rgba(11,27,52,.55);z-index:999999;display:grid;place-items:center;padding:16px;overflow:auto}'+
 '.dmx-drive-panel{box-sizing:border-box;background:#fff;border-radius:19px;color:#142a4b;max-width:680px;width:100%;padding:24px;position:relative;max-height:94vh;overflow:auto;box-shadow:0 16px 55px #1115}'+
 '.dmx-drive-panel h2{font-size:22px;margin:0 38px 12px 0}.dmx-drive-panel p{margin:9px 0;line-height:1.5;font-size:14px}.dmx-drive-close{position:absolute;right:14px;top:12px;background:#eef2f9;border:0;border-radius:50%;font-size:26px;width:37px;height:37px;cursor:pointer}'+
 '.dmx-drive-warning{background:#fff5df;border:1px solid #ffdeb0;padding:12px;border-radius:10px}.dmx-drive-status{background:#e7f0ff;border-radius:9px;padding:12px;margin-top:14px;font-weight:700}.dmx-drive-last{font-size:12px;color:#5a6782;margin-top:6px}'+
 '.dmx-drive-buttons{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.dmx-drive-buttons button{border:0;border-radius:10px;background:#e6eefb;color:#13417f;padding:12px 10px;cursor:pointer;font-weight:700}.dmx-drive-buttons button:first-child{background:#11864b;color:white}.dmx-drive-buttons button:hover{filter:brightness(.95)}'+
 '.dmx-drive-foot{color:#64718b;font-size:12px!important}.dmx-cloud-dot{font-size:10px;color:#547fb7;margin-left:4px}@media(max-width:550px){.dmx-drive-panel{padding:18px}.dmx-drive-buttons{grid-template-columns:1fr}.dmx-drive-panel h2{font-size:19px}}';
 document.head.appendChild(css);
 $('dmx-drive-open').addEventListener('click',()=>modal(true));
 $('dmx-drive-close').addEventListener('click',()=>modal(false));
 div.addEventListener('click',e=>{if(e.target===div)modal(false)});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!div.hidden)modal(false)});
 $('dmx-drive-connect').addEventListener('click',()=>{void connectFolder()});
 $('dmx-drive-reconnect').addEventListener('click',()=>{void reconnect()});
 $('dmx-drive-save').addEventListener('click',()=>{void saveNow()});
 $('dmx-drive-restore').addEventListener('click',()=>{void restore()});
 setStatus(status,state);
}
async function initialize(){
 installUI();
 if(!('indexedDB' in window)){setStatus('Pregledač ne podržava čuvanje veze sa folderom','error');return}
 try{
  folder=await readHandle();
  if(!folder)return;
  if(await access(false)){enabled=true;setStatus('Folder povezan. Automatsko čuvanje je aktivno.','ok');schedule(1700)}
  else{enabled=false;setStatus('Folder zapamćen. Klikni „Obnovi dozvolu“ da nastaviš čuvanje.','offline')}
 }catch(err){setStatus('Nije moguće učitati folder: '+(err.message||String(err)),'error')}
}
window.addEventListener('demax:datachanged',()=>{if(!folder)return;schedule()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void initialize());
else void initialize();
})();