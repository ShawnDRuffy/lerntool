import {pruefen} from './pruef-kern.mjs';
import {auswahl,neuerVersuch,naechsterHinweis,loesungErlaubt,auswerten,zahl,LernTimer,minutenMitPausen} from './lern-kern.mjs';
import {$,anzeigen,element,meldung,datei,json,schemasLaden,queueStart,konfiguriert,angemeldet} from './lern-api.mjs';
let paket,schemas,queue,wahl,aktuell,stopp=false,index=0;const begonnen=[],fertig=new Set(),states=new Map();const timer=new LernTimer();
const context=()=>({einheit:paket.id,version:paket.version,anteil:Number($('anteil').value)/100,demo:paket.demo});
async function speichern(event){if(paket.demo)return;await queue.aufnehmen(event,context());queue.flush();}
const action=fn=>async e=>{const b=e?.currentTarget;if(b)b.disabled=true;try{await fn(e);}catch(err){meldung(err.message);}finally{if(b)b.disabled=false;}};
function knob(text,fn,css){const b=element('button',text,css);b.type='button';b.addEventListener('click',action(fn));return b;}
function content(parent,text,tag='div'){const e=element(tag,text,'inhalt');parent.append(e);return e;}
function neuWaehlen(fill=false){
  wahl=auswahl(paket,Number($('laenge').value),Number($('anteil').value)/100,begonnen,fill);
  $('anteil-wert').textContent=$('anteil').value+' %';$('laenge-wert').textContent=$('laenge').value+' Min.';
  $('auswahl-info').textContent=`${wahl.aufgaben.length} Aufgaben · ${(wahl.sekunden/60).toLocaleString('de-DE',{maximumFractionDigits:1})} Min. mit Abschluss · tatsächlich ${Math.round(wahl.anteil*100)} % Wiederholung. ${wahl.knapp?'Der Vorrat oder die Voraussetzungen reichen für diesen Mix nicht aus. ':''}Geplant mit Pausen: ${minutenMitPausen(Number($('laenge').value))} Min. Begonnene Aufgaben bleiben erhalten.`;
  $('auffuellen').hidden=!wahl.knapp;
  if(!aktuell)zeigeAufgabe();else fortschritt();
}
function fortschritt(){$('fortschritt').textContent=`${fertig.size} von ${wahl.aufgaben.length} Aufgaben bearbeitet · ${aktuell?.art==='neu'?'Neues':'Wiederholung / Aufholen'}`;}
function loesung(a){
  if(['mc','formelwahl'].includes(a.typ))return a.optionen[a.richtig]+'\n'+a.erklaerung;
  if(a.typ==='wahrfalsch')return (a.richtig?'Wahr':'Falsch')+'\n'+a.erklaerung;
  if(a.typ==='zahl')return `${a.antwort.wert} ${a.antwort.einheit}\n${a.erklaerung}`;
  if(a.typ==='luecken')return a.schritte.map(s=>s.luecke?s.text.replace('___',s.luecke.wert):s.text).join('\n')+'\n'+a.erklaerung;
  if(a.typ==='code_ausgabe')return a.erwartete_ausgabe+'\n'+a.erklaerung;
  if(a.typ==='code_fehler')return 'Zeilen: '+a.richtig_zeilen.join(', ')+'\n'+a.erklaerung;
  return [...(a.kernpunkte||[]),a.erklaerung].join('\n');
}
function zeigeAufgabe(){
  const a=wahl.aufgaben.find(a=>!fertig.has(a.id));if(!a){abschliessen();return;}
  aktuell=a;if(!begonnen.includes(a.id))begonnen.push(a.id);index=wahl.aufgaben.indexOf(a);
  const state=states.get(a.id)||{...neuerVersuch(),aktiv:0};states.set(a.id,state);
  const root=$('aufgabe');root.replaceChildren();root.tabIndex=-1;$('naechste').disabled=true;
  const thema=paket.themen.find(t=>t.id===a.thema);
  content(root,thema?.titel||a.thema,'h2');
  if(thema?.einstieg&&!wahl.aufgaben.slice(0,index).some(x=>x.thema===a.thema)){content(root,thema.einstieg.text);content(root,thema.einstieg.alltag);for(const f of thema.formeln||[])content(root,typeof f==='string'?f:[f.zeichen,f.wann].filter(Boolean).join(' · '));}
  content(root,a.frage);
  if(a.skizze){const s=paket.skizzen[a.skizze];content(root,'Skizzenbeschreibung: '+s.beschreibung+' · '+s.massstab);}
  // Historisches SVG wird absichtlich nie geparst oder ins DOM eingesetzt.
  if(a.code)root.append(element('pre',undefined));if(a.code)root.lastChild.textContent=a.code;
  const form=document.createElement('form');root.append(form);let getInput,code=null,laufstatus=null;
  function textInput(label,area=false){const l=element('label',label),i=document.createElement(area?'textarea':'input');i.maxLength=8000;i.required=true;if(area)i.rows=4;else i.type='text';l.append(i);form.append(l);return i;}
  function options(values,multi=false){const fs=document.createElement('fieldset');fs.append(element('legend',multi?'Zeilen auswählen':'Deine Antwort'));values.forEach((v,i)=>{const l=element('label',undefined,'auswahloption'),r=document.createElement('input');r.type=multi?'checkbox':'radio';r.name='wahl';r.value=String(i);if(!multi)r.required=true;l.append(r,element('span',v));fs.append(l);});form.append(fs);return()=>Array.from(fs.querySelectorAll('input:checked')).map(i=>Number(i.value));}
  if(['mc','formelwahl','wahrfalsch'].includes(a.typ)){const get=options(a.typ==='wahrfalsch'?['Wahr','Falsch']:a.optionen);getInput=()=>a.typ==='wahrfalsch'?get()[0]===0:get()[0];}
  else if(a.typ==='zahl'){const i=textInput('Dein Ergebnis ('+a.antwort.einheit+')');i.inputMode='decimal';getInput=()=>{if(!Number.isFinite(zahl(i.value)))throw Error('Bitte eine endliche Zahl eingeben, zum Beispiel 1,5.');return i.value;};}
  else if(a.typ==='luecken'){const inputs=[];for(const s of a.schritte){content(form,s.text);if(s.luecke){const i=textInput('Zahlenlücke ('+s.luecke.einheit+')');i.inputMode='decimal';inputs.push(i);}}getInput=()=>{const v=inputs.map(i=>i.value);if(v.some(x=>!Number.isFinite(zahl(x))))throw Error('Bitte alle Zahlenlücken ausfüllen.');return v;};}
  else if(a.typ==='code_fehler'){const get=options(a.code.split(/\r?\n/).map((s,i)=>(i+1)+': '+s),true);getInput=()=>{const v=get().map(i=>i+1);if(!v.length)throw Error('Bitte mindestens eine Zeile wählen.');return v;};}
  else if(a.typ==='beispiel'){for(const s of a.schritte)content(form,s);content(form,a.erklaerung);getInput=()=>'';}
  else if(a.typ==='eclipse'){
    for(const t of a.testfaelle){content(form,'Testeingabe: '+t.eingabe);content(form,'Erwartete Ausgabe: '+t.ausgabe);}
    const status=document.createElement('fieldset');status.append(element('legend','Dein Test in Eclipse'));let selected=null;
    for(const [value,label] of [['laeuft','läuft'],['laeuft_nicht','läuft nicht']]){const b=knob(label,()=>{selected=value;laufstatus=value;for(const x of status.querySelectorAll('button'))x.setAttribute('aria-pressed',String(x===b));});b.setAttribute('aria-pressed','false');status.append(b);}form.append(status);
    getInput=()=>{if(!selected)throw Error('Bitte „läuft“ oder „läuft nicht“ wählen.');return selected;};
  }else{const i=textInput(a.typ==='code_ausgabe'?'Erwartete Ausgabe':'Deine Erklärung',true);getInput=()=>{if(!i.value.trim())throw Error('Bitte erst eine Antwort schreiben.');return i.value;};}
  if(['code_ausgabe','code_fehler'].includes(a.typ)){const fs=element('fieldset');fs.append(element('legend','Dein eigener Code-Test (optional)'));for(const [value,label] of [['laeuft','läuft'],['laeuft_nicht','läuft nicht']]){const b=knob(label,()=>{laufstatus=value;for(const x of fs.querySelectorAll('button'))x.setAttribute('aria-pressed',String(x===b));});b.setAttribute('aria-pressed','false');fs.append(b);}form.append(fs);}
  if(['eclipse','code_ausgabe','code_fehler'].includes(a.typ)){code=textInput('Dein C-Code (optional, Prüfung später)',true);code.required=false;}
  const submit=element('button',a.typ==='beispiel'?'Als gelesen markieren':'Antwort prüfen');submit.type='submit';form.append(submit);
  const feedback=element('p',undefined,'rueckmeldung');feedback.setAttribute('role','status');feedback.hidden=true;form.append(feedback);
  const help=element('ol',undefined,'hinweise');root.append(help);
  if(a.hinweise){const hb=element('button','Hinweis 1 von 3','sekundaer');hb.type='button';hb.addEventListener('click',()=>{const t=naechsterHinweis(state,a);if(t!==null)help.append(element('li',t));hb.textContent=state.hinweise<3?`Hinweis ${state.hinweise+1} von 3`:'Alle 3 Hinweise geöffnet';hb.disabled=state.hinweise===3;});root.append(hb);}
  const solution=element('div',undefined,'rueckmeldung');solution.hidden=true;
  const sb=knob('Lösung zeigen',()=>{if(!loesungErlaubt(state))return;anzeigen(solution,loesung(a));solution.hidden=false;state.loesung=true;},'sekundaer');sb.disabled=true;if(a.typ!=='beispiel')root.append(sb,solution);
  const self=document.createElement('fieldset');self.hidden=true;self.append(element('legend','Wie sicher fühlst du dich?'));
  for(const wert of ['sitzt','wackelt','noch unklar'])self.append(knob(wert,async()=>{await speichern({art:'selbsteinschaetzung',thema:a.thema,wert});for(const b of self.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.textContent===wert));}));root.append(self);
  const errorArea=document.createElement('details');errorArea.append(element('summary','Fehler melden'));const comment=element('textarea');comment.rows=2;comment.maxLength=2000;comment.setAttribute('aria-label','Was stimmt an der Aufgabe nicht?');errorArea.append(comment,knob('Fehlerbericht speichern',async()=>{await speichern({art:'fehler_gemeldet',aufgabe:a.id,aufgabe_version:a.version,...(comment.value.trim()?{text:comment.value.trim()}:{})});meldung(paket.demo?'Demo: Fehlerbericht nur ausprobiert.':'Fehlerbericht auf diesem Gerät gesichert.');}));root.append(errorArea);
  form.addEventListener('submit',async e=>{
    e.preventDefault();submit.disabled=true;
    try{const value=getInput(),result=auswerten(a,value);
      if(a.typ==='beispiel')await speichern({art:'gelesen',aufgabe:a.id,aufgabe_version:a.version});
      else if(a.typ==='offen')await speichern({art:'erklaerung',thema:a.thema,text:value});
      else await speichern({art:'antwort',aufgabe:a.id,aufgabe_version:a.version,eingabe:typeof value==='string'?value:JSON.stringify(value),bewertung:result.richtig?'richtig':'falsch',methode:result.methode,hinweise:state.hinweise,aktive_sekunden:Math.floor(state.aktiv),fehlerbild:a.typ==='zahl'&&a.fehlerbild?.[String(zahl(value))]?String(zahl(value)):null,code:code?.value||null,...(laufstatus?{laufstatus}:{})});
      state.versuche++;sb.disabled=false;self.hidden=false;fertig.add(a.id);$('naechste').disabled=false;
      anzeigen(feedback,a.typ==='beispiel'?'Als gelesen erfasst.':a.typ==='offen'?'Erklärung gesichert. Vergleiche sie mit den Kernpunkten und schätze dich selbst ein.':a.typ==='eclipse'?'Teststatus gesichert. Dein Code wird später geprüft.':result.richtig?'Richtig.':'Noch nicht richtig. Du kannst es erneut versuchen oder einen Hinweis öffnen.');feedback.hidden=false;fortschritt();
    }catch(err){meldung(err.message);}finally{submit.disabled=false;}
  });
  fortschritt();if(begonnen.length>1)root.focus();
}
function abschliessen(){aktuell=null;$('aufgabe').hidden=true;$('naechste').hidden=true;$('abschluss').hidden=false;$('beenden').hidden=true;anzeigen($('abschluss-frage'),paket.abschluss.frage);timer.pause();stopp=true;}
async function paketStart(p,demo){
  if(new TextEncoder().encode(JSON.stringify(p)).byteLength>1000000)throw Error('Einheit größer als 1 MB.');
  const errors=await pruefen(p,{echt:!demo,schemas});if(errors.length)throw Error('Einheit gesperrt: '+errors.slice(0,4).map(e=>e.path+' '+e.msg).join('; '));
  paket=p;$('demo-banner').hidden=!p.demo;$('demo-laden').hidden=true;$('player').hidden=false;$('anteil').value=String(p.auswahl.standard_wiederholung*100);
  $('einheit-titel').textContent=(p.demo?'Demo · ':'Einheit · ')+p.fuer_tag;
  anzeigen($('warum'),Array.isArray(p.warum_heute)?p.warum_heute.map(x=>typeof x==='string'?x:x.text||'').join('\n'):p.hinweis||'');
  meldung(p.demo?'Physik-Demo geladen.':'Geprüfte Einheit geladen.');neuWaehlen();
}
$('anteil').addEventListener('input',()=>neuWaehlen());$('laenge').addEventListener('input',()=>neuWaehlen());$('auffuellen').addEventListener('click',()=>neuWaehlen(true));
$('naechste').addEventListener('click',()=>{aktuell=null;zeigeAufgabe();});
$('beenden').addEventListener('click',action(async()=>{await speichern({art:'abbruch',nach_aufgabe:aktuell?.id??null,grund:'nutzer'});abschliessen();}));
$('abschluss-speichern').addEventListener('click',action(async()=>{const text=$('abschluss-text').value.trim();if(!text)throw Error('Bitte zuerst deine Erklärung schreiben.');await speichern({art:'erklaerung',text});anzeigen($('abschluss-loesung'),paket.abschluss.kernpunkte.join('\n'));$('abschluss-loesung').hidden=false;$('abschluss-status').textContent=paket.demo?'Demo abgeschlossen.':'Erklärung lokal gesichert; Versand wird versucht.';}));
$('timer-start').addEventListener('click',()=>{timer.start();timerZeigen();});$('timer-pause').addEventListener('click',()=>{timer.pause();timerZeigen();});$('timer-weiter').addEventListener('click',()=>{timer.weiter();timerZeigen();});$('timer-lang').addEventListener('click',()=>{timer.langePause();timerZeigen();});
function timerZeigen(){timer.tick();const names={bereit:`Block ${timer.block} · ${timer.block===1?'Kern':'freiwillig'}`,lernen:`Block ${timer.block} · Lernen`,pause:'Kurze Pause',freiwillig:'Block geschafft · Weiterlernen ist freiwillig',fertig:'Lernabend beendet',lange_pause:'20 Minuten Erholung · außerhalb der Einheit'};$('timer-phase').textContent=names[timer.phase];$('timer-uhr').textContent=Math.floor(timer.rest/60).toString().padStart(2,'0')+':'+(timer.rest%60).toString().padStart(2,'0');$('timer-start').disabled=!['bereit','lernen','pause'].includes(timer.phase)||timer.deadline!==null;$('timer-start').textContent=timer.pausiert?'Timer fortsetzen':'Timer starten';$('timer-pause').disabled=timer.deadline===null;$('timer-weiter').hidden=timer.phase!=='freiwillig';$('timer-lang').hidden=timer.phase!=='fertig'||timer.block!==3;
  const blocked=['pause','freiwillig','fertig','lange_pause'].includes(timer.phase);$('aufgabe').inert=blocked;$('naechste').disabled=blocked||!fertig.has(aktuell?.id);
  if(timer.phase==='fertig'&&!stopp&&paket){stopp=true;speichern({art:'abbruch',nach_aufgabe:aktuell?.id??null,grund:'zeit_um'}).catch(e=>meldung(e.message));abschliessen();}
}
let last=performance.now();setInterval(()=>{const now=performance.now();if(aktuell&&!document.hidden&&!stopp&&['bereit','lernen'].includes(timer.phase))states.get(aktuell.id).aktiv+=Math.min(2,(now-last)/1000);last=now;timerZeigen();},1000);
$('demo-laden').addEventListener('click',action(async()=>paketStart(await json('demo/physik.json'),true)));
(async()=>{try{schemas=await schemasLaden();queue=await queueStart(schemas);if(new URLSearchParams(location.search).get('demo')==='1'){await paketStart(await json('demo/physik.json'),true);return;}if(!konfiguriert()||!angemeldet()){meldung('Bitte auf der Startseite anmelden. Ohne Anmeldung kannst du die Demo ausprobieren.');$('demo-laden').hidden=false;return;}const p=await datei('einheiten/aktuell.json');if(p)await paketStart(p,false);else{meldung('Noch keine aktuelle Einheit vorbereitet. Die Demo kannst du jetzt ausprobieren.');$('demo-laden').hidden=false;}}catch(e){meldung(e.message);$('demo-laden').hidden=false;}})();
