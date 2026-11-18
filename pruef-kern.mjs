// Gemeinsamer Validator für Browser und CLI. Aus Runde 1 extrahiert.
const namen = {'lerneinheit/2':'lerneinheit','ereignisse/1':'ereignisse','tagesplan/1':'tagesplan','wochenendplan/1':'wochenendplan','auffrischung/2':'auffrischung'};
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const sum = xs => xs.reduce((a,b)=>a+b,0);
const near = (a,b) => typeof a==='number' && typeof b==='number' && Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(b));
const cloneWithout = (o,keys) => Object.fromEntries(Object.entries(o).filter(([k])=>!keys.includes(k)));

// Rekursiv lexikografisch sortierte Schlüssel, Array-Reihenfolge bleibt erhalten.
// Keine Unicode-Normalisierung; JSON.stringify-Zahlen, UTF-8, ohne BOM/Zeilenumbruch.
export function kanonisch(x) {
  if (Array.isArray(x)) return '['+x.map(kanonisch).join(',')+']';
  if (x!==null && typeof x==='object') return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+kanonisch(x[k])).join(',')+'}';
  if (typeof x==='number' && !Number.isFinite(x)) throw Error('Nicht-endliche Zahl ist kein gültiger Hashinhalt.');
  return JSON.stringify(x);
}
export const hash = async x => 'sha256:'+Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(kanonisch(x)))),b=>b.toString(16).padStart(2,'0')).join('');
export const inhaltsHash = x => hash(cloneWithout(x,['pruefung']));
export function kontextHash(p) {
  if (p.format==='lerneinheit/2') return hash({format:p.format,demo:p.demo,quellen:p.quellen,modell:p.modell??null,skizzen:p.skizzen,themen:p.themen,abschluss:p.abschluss});
  if (p.format==='auffrischung/2') return hash(cloneWithout(p,['eintraege','freigegeben']));
  throw Error('Kontext-Hash nur für Lerneinheit und Auffrischung definiert.');
}
const equal = (a,b) => kanonisch(a)===kanonisch(b);
const uuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const dateOK = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
const stampOK = s => /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(s) && dateOK(s.slice(0,10)) && Number.isFinite(Date.parse(s));
const dateBerlin = s => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s));
const addDays = (d,n) => new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
const minute = t => Number(t.slice(0,2))*60+Number(t.slice(3));
const numericText = s => typeof s==='string' && /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(s.trim()) && Number.isFinite(Number(s.trim().replace(',','.')));
export function innerhalb(x,a) {
  if(!Number.isFinite(x))return false;
  const tol=Math.max(a.tol_abs,a.tol_rel*Math.abs(a.wert));
  if(tol===0)return x===a.wert;
  // Nur Rundungsrauschen am Rand abfangen, keine zusätzliche fachliche Toleranz.
  const roundoff=Number.EPSILON*Math.max(Math.abs(x),Math.abs(a.wert),tol)*4;
  return Math.abs(x-a.wert)<=tol+roundoff;
}

// Bewusst begrenzter JSON-Schema-2020-12-Interpreter für exakt die mitgelieferten
// Schlüsselwörter. Neue/unbekannte Schlüsselwörter führen zu einem Fehler.
const keywords = new Set('$schema title description examples $defs $ref type const enum required properties additionalProperties items minItems maxItems uniqueItems minLength maxLength pattern format minimum maximum exclusiveMinimum exclusiveMaximum anyOf oneOf'.split(' '));
export function schemaPruefen(x,s,root=s,path='$') {
  const e=[]; const fail = msg => e.push({path,msg});
  for(const k of Object.keys(s)) if(!keywords.has(k)) throw Error('Nicht unterstütztes Schema-Schlüsselwort: '+k);
  if(s.$ref) {
    if(!s.$ref.startsWith('#/$defs/') || !own(root.$defs??{},s.$ref.slice(8))) throw Error('Unbekannter lokaler Schema-Verweis '+s.$ref);
    e.push(...schemaPruefen(x,root.$defs[s.$ref.slice(8)],root,path));
  }
  if(s.const!==undefined && !equal(x,s.const)) fail('erwartet '+JSON.stringify(s.const)+', erhalten '+JSON.stringify(x));
  if(s.enum && !s.enum.some(v=>equal(v,x))) fail('erwartet einen Wert aus '+JSON.stringify(s.enum)+', erhalten '+JSON.stringify(x));
  for(const key of ['anyOf','oneOf']) if(s[key]) {
    const results=s[key].map(v=>schemaPruefen(x,v,root,path));
    const count=results.filter(r=>!r.length).length;
    if(key==='oneOf'?count!==1:count===0) {
      const discr=s[key].findIndex(v=>['typ','art'].some(k=>v.properties?.[k]?.const!==undefined && x?.[k]===v.properties[k].const));
      if(discr>=0 && results[discr].length) e.push(...results[discr]);
      else if(count===0) {
        fail('keine zulässige Typvariante (Typ/Art und Pflichtfelder prüfen)');
        e.push(...results.reduce((a,b)=>a.length<=b.length?a:b));
      } else fail('genau eine Typvariante erwartet');
    }
  }
  const type=Array.isArray(x)?'array':x===null?'null':typeof x;
  if(s.type && !(s.type==='integer'?Number.isInteger(x):s.type===type)) {fail('erwartet Typ '+s.type+', erhalten '+type);return e;}
  if(typeof x==='number') {
    if(!Number.isFinite(x)) fail('erwartet eine endliche Zahl');
    for(const [k,bad,op] of [['minimum',x<s.minimum,'≥'],['maximum',x>s.maximum,'≤'],['exclusiveMinimum',x<=s.exclusiveMinimum,'>'],['exclusiveMaximum',x>=s.exclusiveMaximum,'<']]) if(s[k]!==undefined && bad) fail('erwartet '+op+' '+s[k]+', erhalten '+x);
  }
  if(typeof x==='string') {
    if(s.minLength!==undefined && [...x].length<s.minLength) fail('Text muss mindestens '+s.minLength+' Zeichen enthalten');
    if(s.maxLength!==undefined && [...x].length>s.maxLength) fail('Text darf höchstens '+s.maxLength+' Zeichen enthalten');
    if(s.pattern && !new RegExp(s.pattern,'u').test(x)) fail('erwartetes Muster '+s.pattern+' nicht erfüllt');
    if(s.format) {
      let valid;
      if(s.format==='date') valid=dateOK(x);
      else if(s.format==='date-time') valid=stampOK(x);
      else if(s.format==='uuid') valid=uuid(x);
      else if(s.format==='uri') {try {const u=new URL(x);valid=['http:','https:'].includes(u.protocol) && !u.username && !u.password;}catch{valid=false;}}
      else throw Error('Nicht unterstütztes Schema-Format '+s.format);
      if(!valid) fail('erwartet gültiges '+s.format+(s.format==='date-time'?' mit Sekunden und UTC-Offset (oder Z)':''));
    }
  }
  if(Array.isArray(x)) {
    if(s.minItems!==undefined && x.length<s.minItems) fail('mindestens '+s.minItems+' Einträge erwartet');
    if(s.maxItems!==undefined && x.length>s.maxItems) fail('höchstens '+s.maxItems+' Einträge erwartet');
    if(s.uniqueItems && new Set(x.map(kanonisch)).size!==x.length) fail('Einträge müssen eindeutig sein');
    if(s.items) x.forEach((v,i)=>e.push(...schemaPruefen(v,s.items,root,path+'['+i+']')));
  }
  if(type==='object') {
    for(const k of s.required??[]) if(!own(x,k)) e.push({path:path+'.'+k,msg:'Pflichtfeld fehlt'});
    for(const [k,v] of Object.entries(x)) {
      if(own(s.properties??{},k)) e.push(...schemaPruefen(v,s.properties[k],root,path+'.'+k));
      else if(s.additionalProperties===false) e.push({path:path+'.'+k,msg:'unbekanntes Feld; nicht im Schema erlaubt'});
      else if(s.additionalProperties && typeof s.additionalProperties==='object') e.push(...schemaPruefen(v,s.additionalProperties,root,path+'.'+k));
    }
  }
  return e;
}

async function pruefnachweis(p,a,path,check) {
  const q=a.pruefung;
  check(q.status==='ok',path+'.pruefung.status','erwartet ok; erhalten '+q.status);
  check(q.geschrieben_von!=='unbekannt',path+'.pruefung.geschrieben_von','Autor muss bekannt sein');
  check(q.fachlich_geprueft_von.length>0,path+'.pruefung.fachlich_geprueft_von','mindestens ein unabhängiger fachlicher Prüfer erwartet');
  for(const k of ['nachgerechnet_von','fachlich_geprueft_von']) check(!q[k].includes(q.geschrieben_von),path+'.pruefung.'+k,'Vier-Augen-Regel: Autor '+q.geschrieben_von+' darf nicht sein eigener Prüfer sein');
  if(['zahl','luecken'].includes(a.typ)) check(q.nachgerechnet_von.length>0,path+'.pruefung.nachgerechnet_von','Zahlenaufgabe braucht unabhängigen Nachrechner');
  check(q.fuer_version===a.version,path+'.pruefung.fuer_version','erwartet Aufgaben-/Inhaltsversion '+a.version+'; erhalten '+q.fuer_version);
  check(q.pruef_hash===await inhaltsHash(a),path+'.pruefung.pruef_hash','SHA-256 passt nicht zum Inhalt ohne pruefung; Änderung erneut prüfen');
  check(q.kontext_hash===await kontextHash(p),path+'.pruefung.kontext_hash','SHA-256 passt nicht zu Quellen/Modell/Kontext; Änderung erneut prüfen');
}

export async function pruefen(p,{echt=true,schemas}={}) {
  const fehler=[]; const check=(ok,path,msg)=>{if(!ok) fehler.push({path,msg});};
  const name=namen[p?.format];
  if(!name) return [{path:'$.format',msg:'unbekanntes Format; erwartet '+Object.keys(namen).join(', ')}];
  const schema=schemas?.[name]; if(!schema) throw Error('Schema fehlt: '+name);
  fehler.push(...schemaPruefen(p,schema));
  if(fehler.length) return fehler; // Keine Folgefehler/Abstürze bei falschen Typen.
  check(!echt || !p.demo,'$.demo','Demo-Paket ist als echte Einheit/echter Betriebsdatensatz gesperrt; nur --demo erlaubt die technische Demonstration');
  if(own(p,'freigegeben')) {
    check(!p.demo || !p.freigegeben,'$.freigegeben','Demo muss freigegeben=false behalten');
    check(!echt || p.freigegeben,'$.freigegeben','im echten Betrieb muss freigegeben=true sein');
  }
  const unique=(xs,path,key='id')=>check(new Set(xs.map(x=>x[key])).size===xs.length,path,'doppelte '+key+'; eindeutige Kennungen erwartet');
  const safePath=(s,path)=>check(!s || (!/^(?:[a-z]+:|[\\/])/i.test(s) && !s.split(/[\\/]/).includes('..') && !/[?#]/.test(s)),path,'relativer Pfad ohne .., URL, Query oder Zugangsdaten erwartet');

  if(p.format==='lerneinheit/2') {
    unique(p.aufgaben,'$.aufgaben');unique(p.themen,'$.themen');unique(p.quellen,'$.quellen');
    const ids=new Map(p.aufgaben.map(a=>[a.id,a])), themes=new Map(p.themen.map(t=>[t.id,t])), sources=new Set(p.quellen.map(q=>q.id));
    check(p.demo===p.id.startsWith('demo-'),'$.id','Demo-Kennung muss mit demo- beginnen; echte Kennung darf das nicht');
    check(!ids.has(p.abschluss.id),'$.abschluss.id','Abschluss-ID darf keine Aufgaben-ID wiederverwenden');
    p.quellen.forEach((q,i)=>safePath(q.datei,'$.quellen['+i+'].datei'));
    p.themen.forEach((t,i)=>{check(sources.has(t.quelle),'$.themen['+i+'].quelle','unbekannter Quellenverweis '+t.quelle);check(t.art!=='neu'||!!t.einstieg,'$.themen['+i+'].einstieg','neues Thema braucht Einstieg mit Alltagsbeispiel');});
    for(const [k,s] of Object.entries(p.skizzen)) {
      check(s.aus_modell===p.modell?.id,'$.skizzen.'+k+'.aus_modell','Skizze muss das vorhandene Modell referenzieren');
      // Zusätzliche Früherkennung, KEIN HTML/SVG-Sanitizer für den späteren Browser.
      check(!/<\s*(?:script|foreignObject|a|image|use|style|animate|set)\b|\son\w+\s*=|(?:href|style)\s*=|url\s*\(|<!/i.test(s.svg),'$.skizzen.'+k+'.svg','nur statisches SVG ohne ausführbare Elemente/Links/Styles erwartet');
    }
    for(const [i,a] of p.aufgaben.entries()) {
      const path='$.aufgaben['+i+']';await pruefnachweis(p,a,path,check);
      check(a.demo_aufgabe===p.demo,path+'.demo_aufgabe','Demo-Kennzeichen muss dem Paket entsprechen; Demo-Aufgabe nie in echte Einheit übernehmen');
      check(themes.has(a.thema),path+'.thema','unbekanntes Thema '+a.thema);
      check(!a.skizze || own(p.skizzen,a.skizze),path+'.skizze','unbekannte Skizze '+a.skizze);
      check(!a.klausurniveau || a.stufe===5,path+'.klausurniveau','nur bei Stufe 5 erlaubt');
      for(const b of a.braucht) check(ids.has(b)&&b!==a.id,path+'.braucht','Voraussetzung '+b+' muss eine andere vorhandene Aufgabe sein');
      if(['mc','formelwahl'].includes(a.typ)) check(a.richtig<a.optionen.length,path+'.richtig','Optionsindex außerhalb der vorhandenen Optionen');
      if(a.typ==='zahl') for(const [k] of Object.entries(a.fehlerbild??{})) {
        check(numericText(k),path+'.fehlerbild.'+k,'Fehlerbild-Schlüssel muss eine endliche Dezimalzahl sein');
        if(numericText(k)) check(!innerhalb(Number(k.replace(',','.')),a.antwort),path+'.fehlerbild.'+k,'falsche Antwort liegt innerhalb der Toleranz der richtigen Antwort');
      }
      if(a.typ==='luecken') {
        check(a.schritte.some(s=>s.luecke),path+'.schritte','mindestens eine Zahlenlücke erwartet');
        a.schritte.forEach((s,j)=>check((s.text.match(/___/g)??[]).length===(s.luecke?1:0),path+'.schritte['+j+'].text','genau ein ___ pro luecke, ohne luecke kein ___ erwartet'));
        check(a.braucht.some(id=>ids.get(id)?.typ==='beispiel'),path+'.braucht','Lückenaufgabe braucht ein durchgerechnetes Beispiel');
      }
      if(a.typ==='code_fehler') check(a.richtig_zeilen.every(n=>n<=a.code.split(/\r?\n/).length),path+'.richtig_zeilen','Zeilennummer liegt außerhalb des Codes');
    }
    const done=new Set(),active=new Set();
    function visit(id) {if(active.has(id)){check(false,'$.aufgaben','Voraussetzungszyklus bei Aufgabe '+id);return;}if(done.has(id)||!ids.has(id))return;active.add(id);ids.get(id).braucht.forEach(visit);active.delete(id);done.add(id);}
    ids.forEach(a=>visit(a.id));
    const first=ids.get(p.auswahl.erste_aufgabe);
    check(!!first,'$.auswahl.erste_aufgabe','erste Aufgabe fehlt');
    if(first) check(first.sekunden<=60&&first.braucht.length===0,'$.auswahl.erste_aufgabe','erste Aufgabe höchstens 60 Sekunden und ohne Voraussetzungen');
    const sw=sum(p.aufgaben.filter(a=>a.art!=='neu').map(a=>a.sekunden)), sn=sum(p.aufgaben.filter(a=>a.art==='neu').map(a=>a.sekunden));
    for(const [k,v] of Object.entries({sekunden_wiederholung:sw,sekunden_neu:sn,sekunden_abschluss:p.abschluss.sekunden,summe_minuten:(sw+sn+p.abschluss.sekunden)/60})) check(near(p.vorrat[k],v),'$.vorrat.'+k,'Summe falsch: erwartet '+v+', erhalten '+p.vorrat[k]);
    const points=p.aufgaben.map(a=>a.punkte);
    check(points.every(x=>x===null)||points.every(x=>x!==null),'$.aufgaben.punkte','Punkte entweder für alle Aufgaben numerisch oder für alle null');
    const total=points.every(x=>x===null)?null:sum(points);
    check(total===null?p.vorrat.summe_punkte===null:near(total,p.vorrat.summe_punkte),'$.vorrat.summe_punkte','erwartete Punktesumme '+total+', erhalten '+p.vorrat.summe_punkte);
  }

  if(p.format==='ereignisse/1') {
    unique(p.ereignisse,'$.ereignisse');check((p.einheit===null)===(p.einheit_version===null),'$.einheit_version','einheit und einheit_version müssen gemeinsam null oder gesetzt sein');
    check(!p.einheit?.startsWith('demo-')||p.demo,'$.demo','Demo-Einheit erfordert demo=true');
    let last=-Infinity;
    for(const [i,v] of p.ereignisse.entries()) {
      const path='$.ereignisse['+i+']';
      check(uuid(v.id)||(v.id.startsWith(p.sitzung+'-')&&/^[1-9]\d*$/.test(v.id.slice(p.sitzung.length+1))),path+'.id','volle Sitzungs-UUID mit positivem Zähler oder eigene UUID v4 erwartet');
      check(Date.parse(v.zeit)>=last,path+'.zeit','Ereignisse müssen zeitlich aufsteigend sein');last=Date.parse(v.zeit);
      if(['antwort','gelesen','selbsteinschaetzung','erklaerung','fehler_gemeldet','abbruch'].includes(v.art)) check(p.einheit!==null,path+'.art','Lernereignis braucht eine Einheit und Version');
      if(v.art==='befragung') {check(p.einheit===null,path+'.art','Befragung hat keine Lerneinheit');check(new Set(v.antworten.map(a=>a.frage)).size===v.antworten.length,path+'.antworten','Fragen-IDs müssen eindeutig sein');}
      if(v.art==='todo'&&v.aktion==='neu')check(!!v.text,path+'.text','neues To-do braucht Text');
      if(v.art==='upload') {check(!!v.text_inhalt||!!v.ablage_pfad,path,'Upload braucht Text oder privaten Ablagepfad');safePath(v.ablage_pfad,path+'.ablage_pfad');}
      if(v.art==='einstellung')check(v.schluessel==='gewicht'?!!v.fach&&Number.isInteger(v.wert)&&v.wert>=1&&v.wert<=5:['25/5','45/10','Wechsel'].includes(v.wert),path+'.wert','Gewicht braucht Fach und Zahl 1–5; Timer braucht 25/5, 45/10 oder Wechsel');
    }
  }

  if(p.format==='tagesplan/1') {
    const z=p.zeitbudget_abend,w=p.tageswunsch,over=w?.ueberschreibt;
    if(w) {
      check(w.gilt_nur_fuer===p.datum,'$.tageswunsch.gilt_nur_fuer','muss dem Datum des Tagesplans entsprechen');
      for(const [k,actual] of [['kern_minuten',z.kern_minuten],['abend_gesamt_minuten',z.gesamt_minuten],['regler_wiederholung',p.regler_wiederholung]]) if(over[k]!==null)check(over[k]===actual,'$.tageswunsch.ueberschreibt.'+k,'Überschreibung und aktiver Wert müssen übereinstimmen');
      check(!(over.nur_faecher??[]).some(f=>(over.ausgeschlossene_faecher??[]).includes(f)),'$.tageswunsch.ueberschreibt','Fach darf nicht gleichzeitig gewählt und ausgeschlossen sein');
    }
    check(over?.abend_gesamt_minuten!=null||z.gesamt_minuten===90,'$.zeitbudget_abend.gesamt_minuten','ohne expliziten Tageswunsch 90 Minuten erwartet');
    check(over?.kern_minuten!=null||(z.kern_minuten>=25&&z.kern_minuten<=30),'$.zeitbudget_abend.kern_minuten','ohne expliziten Tageswunsch 25–30 Minuten erwartet');
    check(z.kern_minuten<=z.gesamt_minuten,'$.zeitbudget_abend.kern_minuten','Kern darf Gesamtbudget nicht überschreiten');
    const [work,pause]=z.timer.split('/').map(Number);
    let used=0,n=0;while(used+(n?(n%3===0?20:pause):0)+work<=z.gesamt_minuten){used+=(n?(n%3===0?20:pause):0)+work;n++;}
    check(z.reine_lernzeit_max_minuten===n*work,'$.zeitbudget_abend.reine_lernzeit_max_minuten','erwartet '+n*work+' Minuten in vollständigen '+z.timer+'-Blöcken');
    unique(p.prioritaeten,'$.prioritaeten','fach');unique(p.todos_heute,'$.todos_heute');
    const complete=p.prioritaeten.every(x=>x.rueckstand!==null),total=sum(p.prioritaeten.map(x=>x.gewicht*(1+(x.rueckstand??0))*x.dringlichkeit));
    p.prioritaeten.forEach((v,i)=>{const points=v.rueckstand===null?null:v.gewicht*(1+v.rueckstand)*v.dringlichkeit;check(points===null?v.punkte===null:near(v.punkte,points),'$.prioritaeten['+i+'].punkte','erwartet Gewicht × (1 + Rückstand) × Dringlichkeit; unbekannter Rückstand ergibt null');check(!complete?v.anteil===null:near(v.anteil,points/total),'$.prioritaeten['+i+'].anteil','erwartet normierten Anteil; bei unvollständiger Einstufung null');});
    const blocks=p.bloecke_abend;
    check(sum(blocks.map(b=>b.minuten))<=z.gesamt_minuten,'$.bloecke_abend','Summe einschließlich Pausen überschreitet Abendbudget');
    check(sum(blocks.filter(b=>b.art==='kern').map(b=>b.minuten))===z.kern_minuten,'$.bloecke_abend','Kernblöcke müssen zusammen kern_minuten ergeben');
    check(sum(blocks.filter(b=>b.art==='verlaengerung').map(b=>b.minuten))===z.freiwillig_und_aufholen_minuten,'$.zeitbudget_abend.freiwillig_und_aufholen_minuten','muss Summe der geplanten Verlängerungsblöcke entsprechen');
    pausenPruefen(blocks,pause,check,'$.bloecke_abend');
    for(const [i,b] of blocks.entries()) if(!['pause','lange_pause'].includes(b.art)&&b.fach) {
      check(!over?.nur_faecher||over.nur_faecher.includes(b.fach),'$.bloecke_abend['+i+'].fach','Fach nicht im Tageswunsch gewählt');
      check(!over?.ausgeschlossene_faecher?.includes(b.fach),'$.bloecke_abend['+i+'].fach','Fach ist im Tageswunsch ausgeschlossen');
    }
  }

  if(p.format==='wochenendplan/1') {
    check(new Date(p.samstag).getUTCDay()===6,'$.samstag','Datum muss ein Samstag sein');
    check(p.sonntag===addDays(p.samstag,1),'$.sonntag','Sonntag muss Tag nach Samstag sein');
    check(p.id==='wochenende-'+p.samstag,'$.id','erwartet wochenende-'+p.samstag);
    check(p.abfrage.frage_tag===addDays(p.samstag,-1),'$.abfrage.frage_tag','Freitag vor dem Wochenende erwartet');
    check((p.aktiver_modus==='simon_wahl')===(p.wahl_simon!==null),'$.wahl_simon','simon_wahl braucht eine tatsächliche Wahl, Standard/Warten haben keine Wahl');
    unique(p.vorschlag.begruendung,'$.vorschlag.begruendung','fach');
    check(equal([...p.vorschlag.empfohlene_faecher].sort(),p.vorschlag.begruendung.map(b=>b.fach).sort()),'$.vorschlag','empfohlene Fächer und Begründungen müssen zusammenpassen');
    if(p.vorschlag.begruendung.length)check(near(sum(p.vorschlag.begruendung.map(b=>b.anteil)),1),'$.vorschlag.begruendung','Anteile müssen zusammen 1 ergeben');
    for(const key of ['sa','so']) {
      const day=p.tage[key],path='$.tage.'+key,blocks=day.bloecke.map(b=>({...b,minuten:minute(b.bis)-minute(b.von)}));
      check(day.datum===p[key==='sa'?'samstag':'sonntag'],path+'.datum','Datum muss zum Wochenendtag passen');
      check(day.frei===(blocks.filter(b=>b.art==='block').length===0),path+'.frei','frei muss dem Fehlen von Arbeitsblöcken entsprechen');
      check(sum(blocks.filter(b=>b.art==='block').map(b=>b.minuten))===day.lern_minuten,path+'.lern_minuten','Lernminuten stimmen nicht mit Arbeitsblöcken überein');
      check(!blocks.length||minute(blocks.at(-1).bis)-minute(blocks[0].von)<=day.verfuegbare_minuten,path+'.verfuegbare_minuten','Zeitspanne einschließlich Pausen überschreitet Budget');
      blocks.forEach((b,i)=>{check(b.minuten>0,path+'.bloecke['+i+']','Ende muss am selben Tag nach Beginn liegen');if(i)check(b.von===blocks[i-1].bis,path+'.bloecke['+i+'].von','Blöcke lückenlos ohne Überlappung planen');if(b.art==='block')check(b.minuten===25,path+'.bloecke['+i+']','Wochenendarbeit in 25-Minuten-Blöcken erwartet');});
      pausenPruefen(blocks,5,check,path+'.bloecke');
      if(p.aktiver_modus==='standard_25min')check(day.verfuegbare_minuten===25&&day.lern_minuten===25&&blocks.length===1,path,'Standard ohne Antwort verlangt genau eine 25-Minuten-Einheit');
      if(p.wahl_simon)check(near(day.verfuegbare_minuten,p.wahl_simon['stunden_'+key]*60),path+'.verfuegbare_minuten','Budget muss Simons Stundenwahl entsprechen');
      check(!echt||!p.standard_ohne_antwort[key+'_einheit'].startsWith('demo-'),'$.standard_ohne_antwort.'+key+'_einheit','Demo-Einheit als echter Wochenendstandard gesperrt');
    }
  }

  if(p.format==='auffrischung/2') {
    unique(p.eintraege,'$.eintraege');
    for(const [i,a] of p.eintraege.entries()) {
      const path='$.eintraege['+i+']';await pruefnachweis(p,a,path,check);
      check(a.demo_eintrag===p.demo,path+'.demo_eintrag','Demo-Kennzeichen muss dem Paket entsprechen');
      check(!echt||!a.ist_technik_test,path+'.ist_technik_test','Technik-Test im echten Betrieb gesperrt');
      check(a.ziel_thema===(a.ist_technik_test?'meldungen':a.fach),path+'.ziel_thema','erwartet '+(a.ist_technik_test?'meldungen (Technik-Test)':a.fach+' (Fachthema)'));
      const begin=Date.parse(a.beginn);
      check(dateBerlin(a.beginn)===p.fuer_tag,path+'.beginn','Berliner Vorlesungstag muss fuer_tag entsprechen');
      check(Date.parse(a.ende)>begin,path+'.ende','Ende muss nach Beginn liegen');
      for(const [k,delta] of [['karte_ab',-30],['senden_ab',-10],['verwerfen_ab',0]])check(Date.parse(a[k])===begin+delta*60000,path+'.'+k,'erwartet Beginn '+delta+' Minuten');
      if(p.zustellweg==='loesung_2') {
        check(!a.mit_ton,path+'.mit_ton','Lösung 2 muss leise sein');
        check(!!a.vorabend_senden_ab,path+'.vorabend_senden_ab','Lösung 2 braucht konkreten Versandzeitpunkt am Vorabend');
        if(a.vorabend_senden_ab)check(dateBerlin(a.vorabend_senden_ab)===addDays(p.fuer_tag,-1),path+'.vorabend_senden_ab','muss am vorigen Berliner Kalendertag liegen');
      }
      check(!/<(?!\/?(?:b|i|u|s|code|pre)>)/.test(a.text_html),path+'.text_html','nur b/i/u/s/code/pre ohne Attribute als Telegram-HTML erlaubt; sonst < als &lt; schreiben');
      safePath(a.bild,path+'.bild');
    }
    check(p.eintraege.filter(a=>a.mit_ton).length<=3,'$.eintraege.mit_ton','höchstens drei mit Ton in dieser Datei; globale Tagesgrenze zusätzlich im Versanddienst prüfen');
  }
  return fehler;
}

function pausenPruefen(blocks,kurz,check,path) {
  let work=0;
  blocks.forEach((b,i)=>{
    check(b.nr===i+1,path+'['+i+'].nr','lückenlose Nummerierung ab 1 erwartet');
    const pause=['pause','lange_pause'].includes(b.art);
    if(pause) {
      check(i>0&&i<blocks.length-1&&!['pause','lange_pause'].includes(blocks[i-1].art)&&!['pause','lange_pause'].includes(blocks[i+1].art),path+'['+i+']','Pause nur zwischen zwei Arbeitsblöcken');
      const long=work>0&&work%3===0;
      check(b.art===(long?'lange_pause':'pause')&&b.minuten===(long?20:kurz),path+'['+i+']','nach jedem dritten Arbeitsblock 20 Minuten, sonst '+kurz+' Minuten Pause erwartet');
      check(b.fach===null,path+'['+i+'].fach','Pause hat kein Fach (null)');
    } else {if(i)check(['pause','lange_pause'].includes(blocks[i-1].art),path+'['+i+']','zwischen Arbeitsblöcken fehlt eine Pause');work++;}
  });
}

