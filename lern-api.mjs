import {EreignisQueue,insertUnveraenderlich} from './ereignisse.mjs?v=2026-11-18-r3';
const C=window.LERNTOOL||{},KEY='lerntool-sitzung';
export const $=id=>document.getElementById(id);
export function anzeigen(el,text){if(window.Inhalt?.anzeigen)window.Inhalt.anzeigen(el,String(text??''));else el.textContent=String(text??'');}
export function element(tag,text,css){const e=document.createElement(tag);if(text!==undefined)anzeigen(e,text);if(css)e.classList.add(...css.split(/\s+/).filter(Boolean));return e;}
export function meldung(t){$('meldung').textContent=t;}
export function konfiguriert(){return !!(C.supabaseUrl&&C.supabaseKey);}
function session(){try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch{return null;}}
export function angemeldet(){return !!session();}
export async function rest(path,options={}){
  async function getToken(){let s=session();if(!s)throw Error('Bitte auf der Startseite anmelden und hier neu laden.');
    if(Date.now()>s.bis){const r=await fetch(C.supabaseUrl+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:C.supabaseKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.erneuern}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Bitte auf der Startseite erneut anmelden.');const d=await r.json();s={token:d.access_token,erneuern:d.refresh_token,bis:Date.now()+(d.expires_in-60)*1000};localStorage.setItem(KEY,JSON.stringify(s));}return s.token;}
  const token=navigator.locks?await navigator.locks.request('lerntool-auth-r2',getToken):await getToken();
  const r=await fetch(C.supabaseUrl+'/rest/v1/'+path,{...options,headers:{apikey:C.supabaseKey,Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});
  if(!r.ok){const e=Error(r.status===401?'Bitte auf der Startseite erneut anmelden.':'Speichern/Laden fehlgeschlagen (HTTP '+r.status+').');e.status=r.status;throw e;}
  const t=await r.text();return t?JSON.parse(t):null;
}
export async function datei(path){const rows=await rest('dateien?select=inhalt&pfad=eq.'+encodeURIComponent(path));return rows?.[0]?.inhalt??null;}
export async function json(url){const r=await fetch(url);if(!r.ok)throw Error('Datei nicht verfügbar: '+url);const t=await r.text();if(new TextEncoder().encode(t).byteLength>1000000)throw Error('Datei größer als 1 MB.');return JSON.parse(t);}
export async function schemasLaden(){const namen=['lerneinheit','ereignisse'];return Object.fromEntries(await Promise.all(namen.map(async n=>[n,await json('schema/'+n+'.schema.json')])));}
export async function queueStart(schemas){
  function make(){return new EreignisQueue({storage:localStorage,schemas,geraet:/iPhone/.test(navigator.userAgent)?'iphone':(/iPad/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))?'ipad':'laptop',send:row=>insertUnveraenderlich(rest,row),onStatus:(count,status)=>{$('sync').textContent=count?`${count} Ereignisdatei(en) lokal vorgemerkt${status==='lokal'||status==='ok'?'':': '+status}`:'Alle vorgemerkten Ereignisse gesendet.';}});}
  const q=navigator.locks?await navigator.locks.request('lerntool-geraet-r2',make):make();
  const retry=()=>{if(konfiguriert()&&angemeldet())q.flush();};
  window.addEventListener('online',retry);window.addEventListener('storage',retry);document.addEventListener('visibilitychange',()=>{if(!document.hidden)retry();});
  setInterval(retry,30000);$('erneut').addEventListener('click',retry);retry();return q;
}
