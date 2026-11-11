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
const normalizeName=name=>name.trim().replace(/\s+/g,' ').toLocaleLowerCase('es');
function validateChange(c){
  if(c?.kind==='order'){
    ensure(/^[a-f0-9-]{36}$/i.test(c.id) && integer(c.week,1,8) && integer(c.day,1,5) && Number.isSafeInteger(c.created) &&
      Array.isArray(c.names) && c.names.length>1 && c.names.every(n=>string(n,120)&&n.trim()));
    return {id:c.id,kind:'order',week:c.week,day:c.day,names:c.names,created:c.created};
  }
  ensure(c && typeof c.id==='string' && /^[a-f0-9-]{36}$/i.test(c.id) &&
    ['exercise','set','remove','replace'].includes(c.kind) && integer(c.week,1,8) && integer(c.day,1,5) &&
    string(c.exercise,120) && c.exercise.trim() && integer(c.base,1,100) && Number.isSafeInteger(c.created));
  const change={id:c.id,kind:c.kind,week:c.week,day:c.day,exercise:c.exercise.trim(),base:c.base,created:c.created};
  if(c.kind==='replace'){
    ensure(string(c.next,120)&&c.next.trim()&&normalizeName(c.next)!==normalizeName(c.exercise));
    change.next=c.next.trim();
  }
  return change;
}
function validateWorkout(w){
  ensure(w && typeof w.id==='string' && /^[a-f0-9-]{36}$/i.test(w.id) && /^\d{4}-\d{2}-\d{2}$/.test(w.date) &&
    integer(w.week,1,8) && integer(w.day,1,5) && string(w.label,80) && Number.isSafeInteger(w.finished) &&
    Number.isSafeInteger(w.duration) && w.duration>=0 && Array.isArray(w.sets) && w.sets.every(id=>typeof id==='string' && /^[a-f0-9-]{36}$/i.test(id)));
  return {id:w.id,date:w.date,week:w.week,day:w.day,label:w.label,finished:w.finished,duration:w.duration,sets:w.sets};
}
function durationText(ms){
  const s=Math.floor(ms/1000);
  return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');
}
function backup() {
  const entries=Object.keys(localStorage).filter(k=>k.startsWith(ns+'set.')).sort()
    .map(k=>validateEntry(JSON.parse(localStorage.getItem(k))));
  const changes=Object.keys(localStorage).filter(k=>k.startsWith(ns+'change.')).sort()
    .map(k=>validateChange(JSON.parse(localStorage.getItem(k))));
  const workouts=Object.keys(localStorage).filter(k=>k.startsWith(ns+'workout.')).sort()
    .map(k=>validateWorkout(JSON.parse(localStorage.getItem(k))));
  return {format:workouts.length?'mi-rutina-rir-v3':changes.length?'mi-rutina-rir-v2':'mi-rutina-rir-v1',plan:JSON.parse(localStorage.getItem(ns+'plan')),entries,changes,workouts};
}
function parseBackup(b) {
  ensure(['mi-rutina-rir-v1','mi-rutina-rir-v2','mi-rutina-rir-v3'].includes(b?.format) && Array.isArray(b.entries));
  ensure(b.format==='mi-rutina-rir-v1' && b.changes===undefined || Array.isArray(b.changes));
  ensure(b.format!=='mi-rutina-rir-v3' && b.workouts===undefined || Array.isArray(b.workouts));
  return {format:b.format,plan:b.plan===null?null:validatePlan(b.plan),entries:b.entries.map(validateEntry),changes:(b.changes||[]).map(validateChange).sort((a,b)=>a.id.localeCompare(b.id)),workouts:(b.workouts||[]).map(validateWorkout).sort((a,b)=>a.id.localeCompare(b.id))};
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
  const changes=new Map(existing.changes.map(c=>[c.id,JSON.stringify(c)]));
  for(const change of b.changes||[]){
    const value=JSON.stringify(change);
    ensure(!changes.has(change.id)||changes.get(change.id)===value,'Hay dos cambios incompatibles con el mismo identificador.');
    changes.set(change.id,value);
  }
  if(b.plan && !existing.plan) localStorage.setItem(ns+'plan',JSON.stringify(b.plan));
  for(const w of b.workouts||[]){
    const key=ns+'workout.'+w.id, value=JSON.stringify(w), old=localStorage.getItem(key);
    ensure(old===null || old===value,'Hay dos resúmenes distintos del mismo entrenamiento.');
    if(old===null)localStorage.setItem(key,value);
  }
  for(const [id,value] of changes)if(localStorage.getItem(ns+'change.'+id)===null)localStorage.setItem(ns+'change.'+id,value);
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
function dayExercises(data,week,day){
  const exercises=(data.plan?.weeks[week-1]?.[day-1]||[]).map(ex=>[...ex]);
  const removed=new Set();
  for(const c of data.changes.filter(c=>c.day===day && c.week<=week).sort((a,b)=>a.week-b.week || a.created-b.created || a.id.localeCompare(b.id))){
    if(c.kind==='order'){
      const rank=new Map(c.names.map((name,i)=>[normalizeName(name),i]));
      exercises.sort((a,b)=>(rank.get(normalizeName(a[0]))??Infinity)-(rank.get(normalizeName(b[0]))??Infinity));
      continue;
    }
    const key=normalizeName(c.exercise);
    const index=exercises.findIndex(ex=>normalizeName(ex[0])===key);
    if(c.kind==='remove'||c.kind==='replace'){
      if(index>=0)exercises.splice(index,1);
      removed.add(key);
      if(c.kind==='replace'){
        const nextKey=normalizeName(c.next);
        removed.delete(nextKey);
        if(!exercises.some(ex=>normalizeName(ex[0])===nextKey))
          exercises.splice(index<0?exercises.length:index,0,[c.next,c.base,'','','','']);
      }
      continue;
    }
    if(c.kind==='exercise')removed.delete(key);
    if(removed.has(key))continue;
    const ex=exercises[index]||[c.exercise,c.base,'','','',''];
    if(index<0)exercises.push(ex);
    ex[1]=c.kind==='set'?Math.min(100,ex[1]+1):Math.max(c.base,ex[1]);
  }
  return exercises;
}
let orderDraft=[];
function drawOrder(){
  $('order-list').replaceChildren(...orderDraft.map((name,i)=>{
    const row=element('li',name);
    for(const [step,icon,label] of [[-1,'↑','Subir'],[1,'↓','Bajar']]){
      const button=element('button',icon);
      button.setAttribute('aria-label',label+' '+name);
      const to=i+step;button.disabled=to<0||to>=orderDraft.length;
      button.onclick=()=>{[orderDraft[to],orderDraft[i]]=[orderDraft[i],orderDraft[to]];drawOrder();
        $('order-list').children[to].querySelector('button:not(:disabled)')?.focus();};
      row.append(button);
    }
    return row;
  }));
}
$('order-open').onclick=()=>{
  orderDraft=dayExercises(backup(),+$('week').value,+$('day').value).map(x=>x[0]);
  drawOrder();$('order-dialog').showModal();
};
$('order-save').onclick=localAction(()=>{
  const change=validateChange({kind:'order',week:+$('week').value,day:+$('day').value,id:crypto.randomUUID(),created:Date.now(),names:orderDraft});
  localStorage.setItem(ns+'change.'+change.id,JSON.stringify(change));
  $('order-dialog').close();renderPlan();schedule();
  $('local').textContent='Orden guardado desde la semana '+change.week+'.';
});
$('order-cancel').onclick=()=>$('order-dialog').close();
const atlasNames=[
  ['Aductores en máquina','Peso muerto rumano','Gemelos prensa','Prensa','Sillón de isquios','Sentadilla búlgara'],
  ['Press de banca','Press de hombro con mancuerna','JM press en smith','Cruces poleas sentado / aperturas','Vuelos laterales polea','Press inclinado con mancuernas'],
  ['Jalón diagonal','Remo con mancuerna 1 brazo','Remo pecho apoyado','Bíceps con mancuerna','Bíceps en banco inclinado','Bíceps martillo con mancuerna'],
  ['Sentadilla con barra','Sillón de cuadriceps','Vuelos laterales mancuerna','Vuelos posteriores en polea 45°','Extensión de tríceps tras nuca','Crunch declinado'],
  ['Flexiones de brazos','Dominadas','Puente de glúteos','Remo sentado en polea','Zancadas con mancuernas','Extensión de tríceps con cuerda']
];
const artKey=s=>normalizeName(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace('sillon isquios','sillon de isquios');
const artwork=new Map(atlasNames.flatMap((sheet,j)=>sheet.map((name,i)=>[artKey(name),[j,i]])));
for(const name of atlasNames.flat().sort((a,b)=>a.localeCompare(b,'es'))) $('catalog').append(new Option(name));
for(const [alias,name] of Object.entries({'flexiones':'Flexiones de brazos','lagartijas':'Flexiones de brazos','pull ups':'Dominadas','remo en polea baja':'Remo sentado en polea','estocadas con mancuernas':'Zancadas con mancuernas','tríceps en polea con cuerda':'Extensión de tríceps con cuerda'}))artwork.set(artKey(alias),artwork.get(artKey(name)));
function exerciseHeading(name){
  const head=element('div',undefined,'exercise-head');
  const tile=artwork.get(artKey(name));
  if(tile){
    const [sheet,index]=tile;
    const picture=element('span',undefined,'picture');
    picture.style.backgroundImage='url("./lamina-'+sheet+'.jpg")';
    picture.style.backgroundPosition=(index%2*100)+'% '+(Math.floor(index/2)*50)+'%';
    const button=element('button',undefined,'thumbnail');button.append(picture);
    button.setAttribute('aria-label','Ver ilustración de '+name);
    button.onclick=()=>{$('art-name').textContent=name;$('art-large').replaceChildren(picture.cloneNode());$('art').showModal();};
    head.append(button);
  }
  head.append(element('h3',name));return head;
}
$('art-close').onclick=()=>$('art').close();
function addChange(kind,exercise,base,next){
  const change=validateChange({kind,exercise,base,next,week:+$('week').value,day:+$('day').value,id:crypto.randomUUID(),created:Date.now()});
  localStorage.setItem(ns+'change.'+change.id,JSON.stringify(change));
  renderPlan();schedule();
  $('local').textContent='Cambio guardado para este día desde la semana '+change.week+'.';
}
let managing;
function manageExercise(name,count){
  managing={name,count};
  $('manage-title').textContent=name;
  $('replace-name').value='';$('replace-count').value=count;$('manage-error').textContent='';
  $('manage').showModal();
}
$('manage-close').onclick=()=>$('manage').close();
$('remove-ex').onclick=localAction(()=>{
  if(!confirm('¿Quitar '+managing.name+' de este día desde la semana '+$('week').value+'? Las series registradas quedan en el historial.'))return;
  addChange('remove',managing.name,managing.count);$('manage').close();
});
$('replace-form').onsubmit=event=>{
  event.preventDefault();
  try{
    const next=$('replace-name').value.trim();
    ensure(next,'Escribí el nombre del nuevo ejercicio.');
    ensure(!dayExercises(backup(),+$('week').value,+$('day').value).some(ex=>normalizeName(ex[0])===normalizeName(next)),'Ese ejercicio ya figura en el día.');
    addChange('replace',managing.name,+$('replace-count').value,next);$('manage').close();
  }catch(e){$('manage-error').textContent=e.message;}
};
$('new-exercise').onsubmit=localAction(event=>{
  event.preventDefault();
  const name=$('new-name').value.trim();
  ensure(name,'Escribí el nombre del ejercicio.');
  const exercises=dayExercises(backup(),+$('week').value,+$('day').value);
  ensure(!exercises.some(ex=>normalizeName(ex[0])===normalizeName(name)),'Ese ejercicio ya está en este día. Podés agregarle una serie.');
  addChange('exercise',name,+$('new-count').value);
  $('new-exercise').reset();$('add-panel').open=false;
});
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
      card.append(exerciseHeading(exercise),element('p',[count+(count===1?' serie':' series'),reps && reps+' reps',rir && 'RIR objetivo '+rir,rest && 'Descanso '+rest,tempo].filter(Boolean).join(' · '),'note'));
      const menu=element('button','⋯','manage-button');
      menu.setAttribute('aria-label','Reemplazar o quitar '+exercise);
      menu.onclick=()=>manageExercise(exercise,count);card.firstChild.append(menu);
      const columns=element('div',undefined,'columns');
      for(const label of ['Serie','Anterior','Kilos','Reps','RIR','✓']) columns.append(element('span',label));
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
      const priorCell=element('small',previous?(previous.kg===null?'':previous.kg+' kg × ')+previous.reps:'—');
      if(previous)priorCell.title='Semana anterior · '+previous.reps+' reps · RIR '+previous.rir;
      form.append(priorCell);
      const inputs={};
      for(const [name,label,max] of [['kg','Kilos',2000],['reps','Repeticiones',999],['rir','RIR real',99]]){
        const input=element('input');
        input.type='number';input.name=name;input.inputMode=name==='kg'?'decimal':'numeric';
        input.min=name==='reps'?1:0;input.max=max;input.step=name==='kg'?'any':'1';
        input.required=name!=='kg';input.disabled=!!saved;input.placeholder='—';
        input.setAttribute('aria-label',exercise+', serie '+set+', '+label);
        input.value=values[name]??'';inputs[name]=input;form.append(input);
      }
      if(saved){
        const edit=editButton(saved);edit.textContent='✓';edit.className='saved';
        edit.setAttribute('aria-label','Editar serie '+set);form.classList.add('complete');form.append(edit);
      }
      else{
        const done=element('button','✓');done.setAttribute('aria-label','Guardar serie '+set);form.append(done);
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
    if(rebuild){
      const add=element('button','+ Agregar serie');
      add.type='button';add.disabled=count>=100;
      add.onclick=localAction(()=>addChange('set',exercise,count));
      card.append(add);
    }
  }
}
function renderPlan(){
  const data=backup();
  $('workout-count').textContent=String(data.workouts.length);
  $('workouts').replaceChildren(...data.workouts.sort((a,b)=>b.finished-a.finished).map(w=>{
    const li=element('li',w.date.split('-').reverse().join('/')+' · '+w.label);
    li.append(element('small','Semana '+w.week+' · '+durationText(w.duration)+' · '+w.sets.length+(w.sets.length===1?' serie':' series')));
    return li;
  }));
  if(!data.workouts.length)$('workouts').textContent='Tus entrenamientos aparecerán acá al finalizarlos.';
  plan=data.plan;
  const day=$('day').value || '1';
  options($('day'),(plan?.days || names).map((n,i)=>[n,i+1]));
  $('day').value=day;
  const exercises=dayExercises(data,+$('week').value,+day);
  $('order-open').disabled=exercises.length<2;
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
  const expanded=new Set(Array.from($('history').querySelectorAll('details[open]'),g=>g.dataset.key));
  const groups=new Map();
  for(const e of rows){
    const key=normalizeName(e.exercise);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(e);
  }
  $('history-count').textContent=String(rows.length);
  $('history').replaceChildren(...Array.from(groups,([key,sets])=>{
    const group=element('details');group.dataset.key=key;group.open=expanded.has(key);
    group.append(element('summary',sets[0].exercise+' · '+sets.length+(sets.length===1?' serie':' series')));
    const list=element('ul');
    for(const e of sets.sort((a,b)=>a.set-b.set)){
      const li=element('li','Serie '+e.set);li.append(element('small',stats(e)),editButton(e));list.append(li);
    }
    group.append(list);return group;
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
$('drive-top').onclick=()=>{
  if(token && Date.now()<expires){sync();return;}
  if(token)disconnect('Volvé a conectar Google Drive.');
  if($('client').value.trim())$('connect').click();
  else{$('settings').open=true;$('client').focus();$('client').scrollIntoView({block:'center'});}
};
window.addEventListener('online',sync);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
window.addEventListener('storage',localAction(e=>{if(e.key?.startsWith(ns+'set.')||e.key?.startsWith(ns+'change.')||e.key?.startsWith(ns+'workout.')||e.key===ns+'plan'){renderPlan();schedule();}}));
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
    $('finish-workout').disabled=$('clock-reset').disabled;
  }
  $('clock-toggle').onclick=localAction(()=>{
    state=read();
    const now=Date.now();
    ensure(state.id || $('date').value,'Elegí la fecha del entrenamiento.');
    const context=state.id?state:{...state,id:crypto.randomUUID(),date:$('date').value,week:+$('week').value,day:+$('day').value,label:$('day').selectedOptions[0].textContent};
    const next=state.started===null?{...context,started:now}:{...context,elapsed:elapsed(now),started:null};
    localStorage.setItem(key,JSON.stringify(next));
    refresh();
  });
  $('clock-reset').onclick=localAction(()=>{
    if(!window.confirm('¿Volver el cronómetro a cero?'))return;
    localStorage.removeItem(key);
    refresh();
  });
  $('finish-workout').onclick=localAction(()=>{
    state=read();
    if(state.started===null && !state.elapsed)return;
    const date=state.date||$('date').value, week=state.week||+$('week').value, day=state.day||+$('day').value;
    const label=state.label||$('day').selectedOptions[0].textContent, data=backup();
    const assigned=new Set(data.workouts.flatMap(w=>w.sets));
    const sets=data.entries.filter(e=>e.date===date && e.week===week && e.day===day && !assigned.has(e.id)).map(e=>e.id);
    const finished=Date.now(), duration=elapsed(finished);
    const w=validateWorkout({id:state.id||crypto.randomUUID(),date,week,day,label,finished,duration,sets});
    if(!confirm('¿Finalizar '+label+' del '+date.split('-').reverse().join('/')+'?\nTiempo: '+durationText(duration)+' · Series: '+sets.length))return;
    const keyWorkout=ns+'workout.'+w.id;
    if(!localStorage.getItem(keyWorkout))localStorage.setItem(keyWorkout,JSON.stringify(w));
    localStorage.removeItem(key);refresh();renderPlan();schedule();
    $('local').textContent='Entrenamiento guardado · '+durationText(duration)+' · '+sets.length+' series.';
    $('workout-history').open=true;
  });
  window.addEventListener('storage',event=>{if(event.key===key || event.key===null)refresh();});
  window.addEventListener('pageshow',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(()=>{if(state.started!==null && !document.hidden)display();},250);
  refresh();
}
try{initStopwatch();}catch(e){alertUser('No se pudo iniciar el cronómetro. '+e.message);}




