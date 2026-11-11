'use strict';
const $ = id => document.getElementById(id);
const ns = 'mi-rutina-rir.v1.';
const scope = 'https://www.googleapis.com/auth/drive.appdata';
const backupName = 'mi-rutina-rir-v1.json';
const fields = ['date','week','day','exercise','set','kg','reps','rir'];
const names = Array.from({length:5},(_,i)=>'Día '+(i+1));
let plan, token = '', expires = 0, running = false, again = false, timer;
const say = msg => $('cloud').textContent = msg;
const alertUser = msg => $('alerts').textContent = msg;
const integer = (n,min,max) => Number.isInteger(n) && n>=min && n<=max;
const string = (s,max) => typeof s === 'string' && s.length<=max;
function ensure(condition,message='El archivo tiene un formato incompatible.') {
  if (!condition) throw Error(message);
}
function validatePlan(p) {
  ensure(p?.format==='rir-plan-v1' && Array.isArray(p.days) && p.days.length===5 &&
    p.days.every(x=>string(x,80) && x.trim()) && Array.isArray(p.weeks) && p.weeks.length===8 &&
    p.weeks.every(w=>Array.isArray(w) && w.length===5 && w.every(d=>Array.isArray(d) && d.length<=100 &&
      d.every(x=>Array.isArray(x) && x.length===6 && string(x[0],120) && x[0].trim() &&
        integer(x[1],1,100) && x.slice(2).every(v=>string(v,500))))));
  return {format:p.format,days:p.days,weeks:p.weeks};
}
function validateEntry(e) {
  ensure(e && /^[a-f0-9-]{36}$/i.test(e.id) && string(e.exercise,120) && e.exercise.trim() &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(Date.parse(e.date)) &&
    integer(e.week,1,8) && integer(e.day,1,5) && integer(e.set,1,100) &&
    integer(e.reps,1,999) && integer(e.rir,0,99) && (e.kg===null || Number.isFinite(e.kg) && e.kg>=0 && e.kg<=2000) &&
    Number.isSafeInteger(e.created) && e.created>=0);
  const entry=Object.fromEntries(['id','created',...fields].map(k=>[k,e[k]]));
  if(e.updated!==undefined){
    ensure(Number.isSafeInteger(e.updated) && e.updated>e.created && /^[a-f0-9-]{36}$/i.test(e.editId));
    entry.updated=e.updated;entry.editId=e.editId;
  }
  return entry;
}
function backup() {
  const entries=Object.keys(localStorage).filter(k=>k.startsWith(ns+'set.')).sort()
    .map(k=>validateEntry(JSON.parse(localStorage.getItem(k))));
  return {format:'mi-rutina-rir-v1',plan:JSON.parse(localStorage.getItem(ns+'plan')),entries};
}
function parseBackup(b) {
  ensure(b?.format==='mi-rutina-rir-v1' && Array.isArray(b.entries));
  return {format:b.format,plan:b.plan===null?null:validatePlan(b.plan),entries:b.entries.map(validateEntry)};
}
function merge(b) {
  const existing=backup();
  if (b.plan && existing.plan) ensure(JSON.stringify(existing.plan)===JSON.stringify(b.plan),'Las plantillas difieren. Se conservó la copia existente.');
  const seen=new Map(existing.entries.map(e=>[e.id,e]));
  for(const e of b.entries){
    const prior=seen.get(e.id);
    if(prior){
      ensure(['created','date','week','day','exercise','set'].every(k=>prior[k]===e[k]),'Dos series distintas tienen el mismo identificador.');
      const order=(e.updated??0)-(prior.updated??0) || (e.editId??'').localeCompare(prior.editId??'');
      if(order===0) ensure(JSON.stringify(e)===JSON.stringify(prior),'Hay dos versiones incompatibles de la misma serie.');
      if(order<=0)continue;
    }
    seen.set(e.id,e);
  }
  if(b.plan && !existing.plan) localStorage.setItem(ns+'plan',JSON.stringify(b.plan));
  for(const e of seen.values()) {
    const key=ns+'set.'+e.id;
    const value=JSON.stringify(e);
    if(localStorage.getItem(key)!==value) localStorage.setItem(key,value);
  }
}
function formValues(){ return Object.fromEntries(fields.map(k=>[k,$(k).value])); }
function draft(){ localStorage.setItem(ns+'draft',JSON.stringify(formValues())); }
function options(select,labels) {
  select.replaceChildren(...labels.map(([label,value])=>new Option(label,value)));
}
function element(tag, text, className){
  const node=document.createElement(tag);
  if(text!==undefined) node.textContent=text;
  if(className) node.className=className;
  return node;
}
function renderSession(exercises){
  const session=$('session');
  const date=$('date').value, week=+$('week').value, day=+$('day').value;
  const context=JSON.stringify([date,week,day,exercises]);
  const rebuild=session.dataset.context!==context;
  if(rebuild){
    session.replaceChildren();
    session.dataset.context=context;
  }
  const entries=backup().entries.sort((a,b)=>b.created-a.created);
  for(const [i,ex] of exercises.entries()){
    const [exercise,count,reps,tempo,rir,rest]=ex;
    let card=session.children[i];
    if(rebuild){
      card=element('section',undefined,'exercise');
      card.append(element('h3',exercise),element('p',count+' series · '+reps+' reps\nRIR objetivo '+rir+' · Descanso '+rest+(tempo?'\n'+tempo:''),'note'));
      const columns=element('div',undefined,'columns');
      for(const label of ['Serie','Kilos','Reps','RIR']) columns.append(element('span',label));
      card.append(columns);session.append(card);
    }
    const matching=entries.filter(e=>e.day===day && e.exercise.trim().toLocaleLowerCase()===exercise.trim().toLocaleLowerCase());
    for(let set=1;set<=count;set++){
      const saved=matching.find(e=>e.week===week && e.date===date && e.set===set);
      const previous=matching.find(e=>e.week===week-1 && e.set===set);
      const signature=JSON.stringify([saved?.id,saved?.editId,previous?.id,previous?.editId]);
      const old=card.querySelector('[data-set="'+set+'"]');
      if(old?.dataset.signature===signature) continue;
      const form=element('form',undefined,'setrow');
      form.dataset.set=set;form.dataset.signature=signature;
      const draftKey=ns+'row.'+JSON.stringify([date,week,day,exercise,set]);
      const values=saved || JSON.parse(localStorage.getItem(draftKey)) || {};
      form.append(element('strong',String(set)));
      const inputs={};
      for(const [name,label,max] of [['kg','Kilos',2000],['reps','Repeticiones',999],['rir','RIR real',99]]){
        const input=element('input');
        input.type='number';input.name=name;input.inputMode=name==='kg'?'decimal':'numeric';
        input.min=name==='reps'?1:0;input.max=max;input.step=name==='kg'?'any':'1';
        input.required=name!=='kg';input.disabled=!!saved;input.placeholder='—';
        input.setAttribute('aria-label',exercise+', serie '+set+', '+label);
        input.value=values[name]??'';inputs[name]=input;form.append(input);
      }
      if(previous) form.append(element('small','Semana anterior · '+(previous.kg===null?'Sin carga':previous.kg+' kg')+' · '+previous.reps+' reps · RIR '+previous.rir));
      if(saved) form.append(element('span','✓ Guardada','saved'),editButton(saved));
      else{
        form.append(element('button','Guardar serie '+set));
        form.oninput=localAction(()=>localStorage.setItem(draftKey,JSON.stringify(Object.fromEntries(new FormData(form)))));
        form.onsubmit=localAction(event=>{
          event.preventDefault();
          ensure(date,'Elegí una fecha antes de guardar.');
          const entry=validateEntry({date,week,day,exercise,set,id:crypto.randomUUID(),created:Date.now(),
            kg:inputs.kg.value===''?null:+inputs.kg.value,reps:+inputs.reps.value,rir:+inputs.rir.value});
          localStorage.setItem(ns+'set.'+entry.id,JSON.stringify(entry));
          localStorage.removeItem(draftKey);renderPlan();schedule();
        });
      }
      if(old)old.replaceWith(form);else card.append(form);
    }
  }
}
function renderPlan(){
  plan=backup().plan;
  const day=$('day').value || '1';
  options($('day'),(plan?.days || names).map((n,i)=>[n,i+1]));
  $('day').value=day;
  const exercises=plan?.weeks[+$('week').value-1]?.[+day-1] || [];
  renderSession(exercises);
  if(!exercises.length) $('manual').open=true;
  render();
}
function render(){
  const f=formValues(), entries=backup().entries.sort((a,b)=>b.created-a.created);
  const match=e=>e.day===+f.day && e.exercise.toLocaleLowerCase()===f.exercise.trim().toLocaleLowerCase() && e.set===+f.set;
  const prior=entries.find(e=>e.week===+f.week-1 && match(e));
  const stats=e=>(e.kg===null?'Sin carga registrada':e.kg+' kg')+' · '+e.reps+' reps · RIR '+e.rir;
  $('previous').textContent=prior?'Semana anterior · '+stats(prior):'';
  const ex=plan?.weeks[+f.week-1]?.[+f.day-1]?.find(x=>x[0]===f.exercise);

  $('target').textContent=ex?ex[1]+' series · '+ex[2]+' reps\nRIR objetivo '+ex[4]+' · Descanso '+ex[5]+(ex[3]?'\n'+ex[3]:''):'';
  const rows=entries.filter(e=>e.week===+f.week && e.day===+f.day && e.date===f.date);
  $('history').replaceChildren(...rows.map(e=>{
    const li=document.createElement('li'), small=document.createElement('small');
    li.textContent=e.exercise+' · Serie '+e.set;
    small.textContent=stats(e);li.append(small,editButton(e));return li;
  }));
  if(!rows.length) $('history').textContent='Todavía no registraste series para esta fecha, semana y día.';
}
function localAction(fn){
  return async event=>{try{alertUser('');await fn(event);}catch(e){alertUser(e.message || 'No se pudo guardar. Revisá el espacio del navegador.');}};
}
let editing;
function editButton(entry){
  const button=element('button','Editar serie');
  button.type='button';
  button.onclick=()=>{
    editing=entry;
    $('edit-title').textContent=entry.exercise+' · Serie '+entry.set;
    for(const k of ['kg','reps','rir']) $('edit-'+k).value=entry[k]??'';
    $('edit-error').textContent='';
    $('editor').showModal();
  };
  return button;
}
$('edit-cancel').onclick=()=>$('editor').close();
$('edit-form').onsubmit=event=>{
  event.preventDefault();
  try{
    const key=ns+'set.'+editing.id;
    const current=validateEntry(JSON.parse(localStorage.getItem(key)));
    ensure(JSON.stringify(current)===JSON.stringify(editing),'Esta serie cambió en otra sesión. Tocá Cancelar y volvé a abrirla para revisar los valores.');
    const kg=$('edit-kg').value;
    const edited=validateEntry({...current,kg:kg===''?null:+kg,reps:+$('edit-reps').value,rir:+$('edit-rir').value,
      updated:Math.max(Date.now(),(current.updated??current.created)+1),editId:crypto.randomUUID()});
    localStorage.setItem(key,JSON.stringify(edited));
    $('editor').close();renderPlan();$('local').textContent='Corrección guardada en este dispositivo.';schedule();
  }catch(e){$('edit-error').textContent=e.message;}
};
function init(){
  options($('week'),Array.from({length:8},(_,i)=>['Semana '+(i+1),i+1]));
  const today=new Date();
  $('date').value=new Date(today-today.getTimezoneOffset()*60000).toISOString().slice(0,10);
  renderPlan();
  const saved=JSON.parse(localStorage.getItem(ns+'draft'));
  if(saved) for(const k of fields) $(k).value=saved[k]??'';
  renderPlan();
  $('client').value=localStorage.getItem(ns+'client') || '';
}
for(const id of ['week','day','date']){
  $(id).onchange=localAction(()=>{
    $('exercise').value='';$('set').value=1;
    for(const field of ['kg','reps','rir']) $(field).value='';
    draft();renderPlan();
  });
}
$('entry').oninput=localAction(e=>{
  draft(); render(); $('local').textContent='Borrador guardado en este dispositivo.';
});
$('entry').onsubmit=localAction(e=>{
  e.preventDefault();
  const f=formValues();
  const entry=validateEntry({...f,id:crypto.randomUUID(),created:Date.now(),exercise:f.exercise.trim(),
    week:+f.week,day:+f.day,set:+f.set,kg:f.kg===''?null:+f.kg,reps:+f.reps,rir:+f.rir});
  localStorage.setItem(ns+'set.'+entry.id,JSON.stringify(entry));
  $('set').value=Math.min(100,entry.set+1);$('reps').value='';$('rir').value='';
  draft();renderPlan();$('local').textContent='Serie guardada en este dispositivo.';schedule();
});
$('export').onclick=localAction(()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(backup(),null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='mi-rutina-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
});
$('import').onchange=localAction(async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  const data=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
  const b=data?.format==='rir-plan-v1'?{entries:[],plan:validatePlan(data)}:parseBackup(data);
  merge(b);renderPlan();$('local').textContent='Importación guardada en este dispositivo.';schedule();
});
function disconnect(message){
  token='';expires=0;$('sync').disabled=true;$('off').disabled=true;
  $('connect').disabled=false;$('client').disabled=false;say(message);
}
$('off').onclick=()=>disconnect('Desconectado. Tus series siguen en este dispositivo.');
const gis=document.createElement('script');
gis.src='https://accounts.google.com/gsi/client';gis.async=true;document.head.append(gis);
$('connect').onclick=localAction(()=>{
  const id=$('client').value.trim();
  ensure(/^[\w-]+\.apps\.googleusercontent\.com$/.test(id),'Pegá el Client ID web completo.');
  ensure(window.google?.accounts?.oauth2,'Google todavía no cargó. Revisá la conexión y recargá la página.');
  localStorage.setItem(ns+'client',id);
  const oauth=google.accounts.oauth2.initTokenClient({client_id:id,scope,include_granted_scopes:false,
    error_callback:()=>disconnect('Se cerró la ventana de Google. Podés volver a conectar.'),
    callback:r=>{
      if(!r.access_token || !google.accounts.oauth2.hasGrantedAllScopes(r,scope))return disconnect('Google no autorizó el acceso a la copia.');
      token=r.access_token;expires=Date.now()+Number(r.expires_in)*1000-15000;
      $('client').disabled=true;$('sync').disabled=false;$('off').disabled=false;
      sync();
    }});
  $('connect').disabled=true;
  try{oauth.requestAccessToken({prompt:'select_account'});}catch(err){disconnect('Volvé a conectar Drive.');throw err;}
});
function schedule(){
  if(!token)return;
  say('Cambios locales pendientes de sincronización.');clearTimeout(timer);timer=setTimeout(sync,800);
}
const drive='https://www.googleapis.com/drive/v3/';
const upload='https://www.googleapis.com/upload/drive/v3/files';
async function api(session,url,options={}){
  ensure(token===session,'La sesión cambió.');
  const response=await fetch(url,{...options,cache:'no-store',headers:{...options.headers,Authorization:'Bearer '+session}});
  ensure(token===session,'La sesión cambió.');
  if(!response.ok){const err=Error('Drive respondió '+response.status+'. Tus series siguen guardadas aquí.');err.status=response.status;throw err;}
  return response;
}
async function findFile(session){
  const q=new URLSearchParams({spaces:'appDataFolder',q:"trashed = false and name = '"+backupName+"'",fields:'nextPageToken,files(id,version)',pageSize:'2'});
  const list=await (await api(session,drive+'files?'+q)).json();
  ensure(list.files.length<=1 && !list.nextPageToken,'Drive tiene más de una copia. La sincronización se pausó para conservarlas.');
  return list.files[0];
}
async function createBackup(session,b){
  const boundary='rir_'+crypto.randomUUID();
  const parts=[JSON.stringify({name:backupName,parents:['appDataFolder'],mimeType:'application/json'}),JSON.stringify(b)];
  const body=parts.map(p=>'--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+p+'\r\n').join('')+'--'+boundary+'--';
  const response=await api(session,upload+'?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
  return (await response.json()).id;
}
async function exchange(session){
  const who=await (await api(session,drive+'about?fields=user(permissionId)')).json();
  const account=who.user?.permissionId;
  ensure(typeof account==='string' && account,'No se pudo identificar la cuenta.');
  const bound=localStorage.getItem(ns+'account');
  ensure(!bound || bound===account,'Este dispositivo ya está vinculado a otra cuenta. Reconectá con tu cuenta original.');
  localStorage.setItem(ns+'account',account);
  let justCreated;
  for(let attempt=0;attempt<4;attempt++){
    let file=await findFile(session);
    if(!file && justCreated){
      file=await (await api(session,drive+'files/'+encodeURIComponent(justCreated)+'?fields=id,version')).json();
    }
    if(!file){
      justCreated=await createBackup(session,backup());continue;
    }
    const url=drive+'files/'+encodeURIComponent(file.id);
    const media=await api(session,url+'?alt=media');
    const remote=parseBackup(await media.json());
    ensure(token===session,'La sesión cambió.');
    merge(remote);
    const combined=backup();
    if(JSON.stringify(combined)===JSON.stringify({...remote,entries:remote.entries.sort((a,b)=>a.id.localeCompare(b.id))}))return;
    const meta=await api(session,url+'?fields=id,version');
    if((await meta.json()).version!==file.version)continue;
    const headers={'Content-Type':'application/json'};
    const etag=meta.headers.get('etag');
    if(etag)headers['If-Match']=etag;
    try{
      await api(session,upload+'/'+encodeURIComponent(file.id)+'?uploadType=media',{method:'PATCH',headers,body:JSON.stringify(combined)});
    }catch(e){if(e.status!==412)throw e;}
  }
  throw Error('Hay cambios simultáneos. La app volverá a intentar la sincronización.');
}
async function sync(){
  if(!token)return;
  if(running){again=true;return;}
  if(Date.now()>=expires)return disconnect('La autorización venció. Tocá Conectar Google Drive para continuar.');
  running=true;const session=token;say('Sincronizando…');
  try{
    const task=async()=>{await exchange(session);};
    if(navigator.locks)await navigator.locks.request(ns+'drive',task);else await task();
    if(token===session){renderPlan();say('Sincronizado a las '+new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})+'.');}
  }catch(e){
    if(token===session){
      if(e.status===401)disconnect('Google pide que vuelvas a conectar. Tus series están guardadas aquí.');
      else say((e instanceof TypeError?'Sin conexión con Drive.':e.message)+' Podés reintentar con Sincronizar.');
    }
  }finally{running=false;if(again){again=false;schedule();}}
}
$('sync').onclick=sync;
window.addEventListener('online',sync);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
window.addEventListener('storage',localAction(e=>{if(e.key?.startsWith(ns+'set.')||e.key===ns+'plan'){renderPlan();schedule();}}));
setInterval(()=>{if(!document.hidden)sync();},60000);
try{init();}catch(e){alertUser('No se pudo leer el almacenamiento local. '+e.message);}

function initStopwatch(){
  const key=ns+'stopwatch';
  const initial={elapsed:0,started:null};
  const read=()=>JSON.parse(localStorage.getItem(key)) || initial;
  let state=read();
  function elapsed(now){
    return state.elapsed+(state.started===null?0:Math.max(0,now-state.started));
  }
  function display(){
    const seconds=Math.floor(elapsed(Date.now())/1000);
    const parts=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60];
    const value=parts.map(n=>String(n).padStart(2,'0')).join(':');
    if($('elapsed').textContent!==value) $('elapsed').textContent=value;
  }
  function refresh(){
    state=read();
    display();
    $('clock-toggle').textContent=state.started!==null?'Pausar':state.elapsed?'Continuar':'Iniciar';
    $('clock-reset').disabled=state.started===null && !state.elapsed;
  }
  $('clock-toggle').onclick=localAction(()=>{
    state=read();
    const now=Date.now();
    const next=state.started===null?{elapsed:state.elapsed,started:now}:{elapsed:elapsed(now),started:null};
    localStorage.setItem(key,JSON.stringify(next));
    refresh();
  });
  $('clock-reset').onclick=localAction(()=>{
    if(!window.confirm('¿Volver el cronómetro a cero?'))return;
    localStorage.removeItem(key);
    refresh();
  });
  window.addEventListener('storage',event=>{if(event.key===key || event.key===null)refresh();});
  window.addEventListener('pageshow',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(()=>{if(state.started!==null && !document.hidden)display();},250);
  refresh();
}
try{initStopwatch();}catch(e){alertUser('No se pudo iniciar el cronómetro. '+e.message);}


