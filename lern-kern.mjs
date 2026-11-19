import {innerhalb} from './pruef-kern.mjs?v=2026-11-18-r3';

export const minutenMitPausen = minuten => minuten + Math.max(0,Math.ceil(minuten/25)-1)*5;
export function auswahl(p, minuten=25, anteil=.5, fest=[], auffuellen=false) {
  minuten=Math.min(75,Math.max(25,Number(minuten)||25));
  anteil=Math.min(1,Math.max(0,Number(anteil)||0));
  const pool=p.aufgaben.filter(a=>a.pruefung.status==='ok');
  const byId=new Map(pool.map(a=>[a.id,a]));
  const selected=[], ids=new Set();
  const counts=()=>selected.reduce((s,a)=>{s[a.art==='neu'?'neu':'alt']+=a.sekunden;return s;},{neu:0,alt:0});
  const budget=Math.max(0,minuten*60-p.abschluss.sekunden);
  const limits={alt:budget*anteil,neu:budget*(1-anteil)};
  function bundle(a,seen=new Set()) {
    if(ids.has(a.id)||seen.has(a.id))return [];
    seen.add(a.id);
    const result=[];
    for(const id of a.braucht) {const b=byId.get(id);if(!b)return null;const part=bundle(b,seen);if(!part)return null;result.push(...part);}
    return [...result,a];
  }
  function add(a,force=false) {
    if(!a)return;
    const part=bundle(a);if(!part)return;
    const s=counts();for(const v of part)s[v.art==='neu'?'neu':'alt']+=v.sekunden;
    if(!force&&(s.alt+s.neu>budget||(!auffuellen&&(s.alt>limits.alt||s.neu>limits.neu))))return;
    for(const v of part){selected.push(v);ids.add(v.id);}
  }
  for(const id of fest)add(byId.get(id),true);
  add(byId.get(p.auswahl.erste_aufgabe),true);
  for(const a of [...pool.filter(a=>a.art!=='neu'),...pool.filter(a=>a.art==='neu')])add(a);
  const s=counts();
  return {aufgaben:selected,sekunden:s.alt+s.neu+p.abschluss.sekunden,wiederholung:s.alt,neu:s.neu,ziel:minuten*60,
    knapp:s.alt+s.neu+p.abschluss.sekunden<minuten*60,anteil:s.alt+s.neu?s.alt/(s.alt+s.neu):0};
}
export function neuerVersuch(){return {versuche:0,hinweise:0,loesung:false};}
export function naechsterHinweis(state,a){if(state.hinweise>=Math.min(3,a.hinweise?.length||0))return null;return a.hinweise[state.hinweise++];}
export function loesungErlaubt(state){return state.versuche>0;}
export function zahl(s){const t=String(s).trim();if(!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(t))return NaN;return Number(t.replace(',','.'));}
export function auswerten(a,eingabe){
  if(a.typ==='zahl')return {richtig:innerhalb(zahl(eingabe),a.antwort),methode:'zahl_toleranz'};
  if(a.typ==='luecken')return {richtig:a.schritte.filter(s=>s.luecke).every((s,i)=>innerhalb(zahl(eingabe[i]),s.luecke)),methode:'luecken'};
  if(['wahrfalsch','mc','formelwahl'].includes(a.typ))return {richtig:eingabe===a.richtig,methode:'exakt'};
  if(a.typ==='code_ausgabe')return {richtig:String(eingabe).trim()===a.erwartete_ausgabe.trim(),methode:'exakt'};
  if(a.typ==='code_fehler')return {richtig:JSON.stringify([...eingabe].sort((a,b)=>a-b))===JSON.stringify([...a.richtig_zeilen].sort((a,b)=>a-b)),methode:'exakt'};
  if(a.typ==='eclipse')return {richtig:eingabe==='laeuft',methode:'eclipse_selbst'};
  return null;
}

// Wall-clock-Deadlines überleben Hintergrund-Tabs. Freiwillige Blöcke starten nie automatisch.
export class LernTimer {
  constructor(now=()=>Date.now()){this.now=now;this.phase='bereit';this.block=1;this.rest=25*60;this.deadline=null;this.ende=null;this.pausiert=false;}
  start(){if(!this.ende)this.ende=this.now()+90*60000;if(this.phase==='bereit')this.phase='lernen';this.deadline=this.now()+this.rest*1000;this.pausiert=false;}
  pause(){this.tick();if(this.deadline!==null){this.rest=Math.max(0,Math.ceil((this.deadline-this.now())/1000));this.deadline=null;this.pausiert=true;}}
  tick(){
    if(this.ende&&this.now()>=this.ende){this.phase='fertig';this.deadline=null;this.rest=0;return;}
    if(this.deadline===null)return;
    this.rest=Math.max(0,Math.ceil((this.deadline-this.now())/1000));if(this.rest)return;
    this.deadline=null;
    if(this.phase==='lernen')this.phase=this.block===3?'fertig':'freiwillig';
    else if(this.phase==='pause'){this.block++;this.phase='bereit';this.rest=25*60;}
    else if(this.phase==='lange_pause')this.phase='fertig';
  }
  weiter(){this.tick();if(this.phase!=='freiwillig')return;this.phase='pause';this.rest=5*60;this.start();}
  langePause(){if(this.phase!=='fertig'||this.block!==3)return;this.phase='lange_pause';this.rest=20*60;this.deadline=this.now()+this.rest*1000;this.ende=null;}
}

export function pruefeBefragung(p){
  if(new TextEncoder().encode(JSON.stringify(p)).byteLength>1000000)throw Error('Befragungsdatei überschreitet 1 MB.');
  if(p?.format!=='befragung/1'||!Number.isInteger(p.version)||p.version<1||typeof p.titel!=='string'||!p.titel.trim()||!Number.isFinite(p.minuten)||p.minuten<=0||!Array.isArray(p.fragen)||!p.fragen.length||p.fragen.length>100)throw Error('Ungültige Befragung.');
  const ids=new Set();
  for(const f of p.fragen){
    if(typeof f.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(f.id)||ids.has(f.id)||typeof f.gruppe!=='string'||typeof f.text!=='string'||!f.text.trim()||typeof f.pflicht!=='boolean'||!['wahl','mehrfach','skala','zahl','text'].includes(f.art))throw Error('Ungültige Frage oder doppelte ID.');
    ids.add(f.id);
    if(f.hilfe!=null&&typeof f.hilfe!=='string')throw Error('Hilfe muss Text sein.');
    if(['wahl','mehrfach'].includes(f.art)&&(!Array.isArray(f.optionen)||!f.optionen.length||f.optionen.length>100||f.optionen.some(o=>typeof o!=='string'||!o||o.length>1000)||new Set(f.optionen).size!==f.optionen.length))throw Error('Antwortoptionen müssen eindeutige Texte sein.');
    if(['skala','zahl'].includes(f.art)&&((f.min!=null&&!Number.isFinite(f.min))||(f.max!=null&&!Number.isFinite(f.max))||(f.min!=null&&f.max!=null&&f.min>f.max)))throw Error('Ungültiger Zahlenbereich.');
    if(f.art==='skala'&&(!Number.isInteger(f.min)||!Number.isInteger(f.max)))throw Error('Skala braucht ganzzahlige Grenzen.');
  }
  return p;
}
export function pruefeAntworten(p,werte){
  const result=[];
  for(const f of p.fragen){
    const v=werte[f.id],leer=v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length);
    if(leer){if(f.pflicht)throw Error('Bitte beantworten: '+f.text);continue;}
    if(f.art==='wahl'&&!f.optionen.includes(v))throw Error('Ungültige Auswahl: '+f.text);
    if(f.art==='mehrfach'&&(!Array.isArray(v)||new Set(v).size!==v.length||v.some(x=>!f.optionen.includes(x))))throw Error('Ungültige Mehrfachauswahl: '+f.text);
    if(['zahl','skala'].includes(f.art)&&(!Number.isFinite(v)||(f.min!=null&&v<f.min)||(f.max!=null&&v>f.max)||(f.art==='skala'&&!Number.isInteger(v))))throw Error('Zahl außerhalb des Bereichs: '+f.text);
    if(f.art==='text'&&(typeof v!=='string'||v.length>8000))throw Error('Text ist zu lang.');
    result.push({frage:f.id,wert:v});
  }
  if(!result.length)throw Error('Bitte mindestens eine Frage beantworten.');
  return result;
}
