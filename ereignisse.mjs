import {pruefen,kanonisch} from './pruef-kern.mjs?v=2026-11-18-r3';
export const PREFIX='lerntool-r2-ereignis:';
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const datumBerlin=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
export function ereignisPfad(d,id){if(!UUID.test(id)||!/^\d{4}-\d{2}-\d{2}$/.test(d)||new Date(d).toISOString().slice(0,10)!==d)throw Error('Ungültiger Ereignispfad.');return `ereignisse/${d}/${id}.json`;}
export function pfadPruefen(p){if(typeof p!=='string'||!/^ereignisse\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.json$/i.test(p)||!/^[A-Za-z0-9._/-]+$/.test(p)||p.includes('..')||!UUID.test(p.split('/').at(-1).slice(0,-5)))return false;const d=p.split('/')[1];return Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;}
export function geraeteId(storage,uuid=()=>crypto.randomUUID()){
  let id=storage.getItem('lerntool-geraet-id');if(!UUID.test(id||'')){id=uuid();storage.setItem('lerntool-geraet-id',id);}return id;
}
export class EreignisQueue {
  constructor({storage,send,schemas,geraet='laptop',uuid=()=>crypto.randomUUID(),now=()=>new Date(),onStatus=()=>{}}){Object.assign(this,{storage,send,schemas,geraet,uuid,now,onStatus});this.id=geraeteId(storage,uuid);this.running=null;}
  keys(){const out=[];for(let i=0;i<this.storage.length;i++){const k=this.storage.key(i);if(k?.startsWith(PREFIX))out.push(k);}return out.sort();}
  async aufnehmen(event,context={}){
    const date=this.now(),id=this.uuid();
    const inhalt={format:'ereignisse/1',sitzung:id,geraet:this.geraet,geraet_id:this.id,einheit:context.einheit??null,einheit_version:context.version??null,timer:context.einheit?'25/5':null,regler_wiederholung:context.anteil??null,demo:!!context.demo,ereignisse:[{...event,id:this.uuid(),zeit:date.toISOString()}]};
    const row={pfad:ereignisPfad(datumBerlin(date),id),inhalt,von:'web'};
    await this.validieren(row);
    const key=PREFIX+id;
    if(this.storage.getItem(key)!==null)throw Error('UUID-Kollision; Ereignis nicht gespeichert.');
    const raw=JSON.stringify(row);this.storage.setItem(key,raw);
    if(this.storage.getItem(key)!==raw)throw Error('Lokaler Speicher konnte das Ereignis nicht sichern.');
    this.onStatus(this.keys().length,'lokal');return row;
  }
  async validieren(row){
    if(!pfadPruefen(row.pfad)||!row.pfad.endsWith('/'+row.inhalt?.sitzung+'.json'))throw Error('Unsicherer Ereignispfad.');
    if(new TextEncoder().encode(JSON.stringify(row.inhalt)).byteLength>1000000)throw Error('Ereignisdatei überschreitet 1 MB.');
    const errors=await pruefen(row.inhalt,{echt:!row.inhalt.demo,schemas:this.schemas});
    if(errors.length)throw Error(errors.map(e=>e.path+': '+e.msg).join('\n'));
  }
  async flush(){
    if(this.running)return this.running;
    this.running=this.senden();try{return await this.running;}finally{this.running=null;}
  }
  async senden(){
    let sent=0;
    for(const key of this.keys()){
      const raw=this.storage.getItem(key);if(raw===null)continue;
      try{
        const row=JSON.parse(raw);await this.validieren(row);
        if(row.inhalt.demo)continue; // Demo niemals nach Supabase, niemals in echten Lernstand.
        await this.send(row);
        if(this.storage.getItem(key)===raw)this.storage.removeItem(key);
        sent++;
      }catch(e){this.onStatus(this.keys().length,e.message);return {sent,fehler:e.message};}
    }
    this.onStatus(this.keys().length,'ok');return {sent};
  }
}
// Kein Upsert: Bereits vorhandene Dateien werden nie überschrieben. Nach verlorener
// Antwort ist nur ein byteinhaltlich identischer Konflikt eine erfolgreiche Wiederholung.
export async function insertUnveraenderlich(rest,row){
  try{await rest('dateien',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});}
  catch(e){if(e.status!==409)throw e;const old=await rest('dateien?select=inhalt&pfad=eq.'+encodeURIComponent(row.pfad));if(old?.length!==1||kanonisch(old[0].inhalt)!==kanonisch(row.inhalt))throw Error('Dateikonflikt: vorhandene Ereignisse bleiben erhalten.');}
}
