import {$,element,anzeigen,meldung,datei,json,schemasLaden,queueStart,konfiguriert,angemeldet} from './lern-api.mjs';
import {pruefeBefragung,pruefeAntworten} from './lern-kern.mjs';
let p,queue,demo=false,draftKey,werte=Object.create(null),sent=false;const getters=new Map();
function zwischenstand(){for(const [id,get] of getters)werte[id]=get();try{localStorage.setItem(draftKey,JSON.stringify(werte));$('zwischenstand').textContent='Zwischenstand auf diesem Gerät gespeichert.';}catch{$('zwischenstand').textContent='Zwischenstand konnte nicht gespeichert werden. Bitte diese Seite geöffnet lassen.';}}
function zeichnen(data,isDemo){
  p=pruefeBefragung(data);demo=isDemo;draftKey=`lerntool-befragung:${demo?'demo':'echt'}:${p.version}`;
  try{werte=Object.assign(Object.create(null),JSON.parse(localStorage.getItem(draftKey)||'{}'));}catch{werte=Object.create(null);}
  $('befragung').hidden=false;$('demo-banner').hidden=!demo;$('demo-laden').hidden=true;anzeigen($('titel'),p.titel);$('dauer').textContent=`Etwa ${p.minuten} Minuten. Du kannst unterbrechen und später auf diesem Gerät fortsetzen.`;
  for(const f of p.fragen){
    const fs=element('fieldset');fs.dataset.frage=f.id;const legend=element('legend',f.text+(f.pflicht?' *':''));fs.append(legend);if(f.gruppe)fs.append(element('p',f.gruppe,'klein'));if(f.hilfe)fs.append(element('p',f.hilfe,'klein'));
    if(['wahl','mehrfach'].includes(f.art)){
      const inputs=[];for(const [index,o] of f.optionen.entries()){const label=element('label',undefined,'auswahloption'),input=document.createElement('input');input.type=f.art==='wahl'?'radio':'checkbox';input.name=f.id;input.value=o;input.checked=f.art==='wahl'?werte[f.id]===o:Array.isArray(werte[f.id])&&werte[f.id].includes(o);input.id=`frage-${f.id}-${index}`;if(f.art==='wahl')input.required=f.pflicht;label.append(input,element('span',o));fs.append(label);inputs.push(input);}
      getters.set(f.id,()=>f.art==='wahl'?inputs.find(i=>i.checked)?.value??'':inputs.filter(i=>i.checked).map(i=>i.value));
    }else{
      const input=document.createElement(f.art==='text'?'textarea':'input');input.id='frage-'+f.id;input.name=f.id;input.setAttribute('aria-label',f.text);input.required=f.pflicht;if(f.art==='text'){input.rows=3;input.maxLength=8000;}else{input.type='number';input.step=f.art==='skala'?'1':'any';if(f.min!=null)input.min=f.min;if(f.max!=null)input.max=f.max;}
      input.value=werte[f.id]??'';fs.append(input);getters.set(f.id,()=>input.value===''?'':f.art==='text'?input.value:Number(input.value));
    }
    $('fragen').append(fs);
  }
  meldung(demo?'Platzhalter geladen.':'Befragung geladen. * bedeutet Pflichtfrage.');
}
$('befragung').addEventListener('input',zwischenstand);
$('befragung').addEventListener('submit',async e=>{e.preventDefault();if(sent)return;$('absenden').disabled=true;try{zwischenstand();const antworten=pruefeAntworten(p,werte);if(!demo){await queue.aufnehmen({art:'befragung',befragung_version:p.version,antworten});queue.flush();}sent=true;localStorage.removeItem(draftKey);meldung(demo?'Platzhalter abgeschlossen. Es wurde nichts gesendet.':'Antworten auf diesem Gerät gesichert und zum Senden vorgemerkt.');$('absenden').textContent='Abgeschlossen';}catch(err){meldung(err.message);$('absenden').disabled=false;}});
$('demo-laden').addEventListener('click',async()=>{try{zeichnen(await json('befragung-platzhalter.json'),true);}catch(e){meldung(e.message);}});
(async()=>{try{queue=await queueStart(await schemasLaden());if(new URLSearchParams(location.search).get('demo')==='1'){zeichnen(await json('befragung-platzhalter.json'),true);return;}if(!konfiguriert()||!angemeldet()){meldung('Bitte auf der Startseite anmelden. Du kannst den Platzhalter ausprobieren.');$('demo-laden').hidden=false;return;}const data=await datei('befragung/aktuell.json');if(data)zeichnen(data,false);else{meldung('Noch keine Befragung hinterlegt.');$('demo-laden').hidden=false;}}catch(e){meldung(e.message);$('demo-laden').hidden=false;}})();
