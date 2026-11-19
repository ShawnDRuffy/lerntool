// Validierung nutzt die vorhandenen Renderer-Parser, keine zweite Formelsprache.
let modulePromise;
export async function medienLaden() {
  return modulePromise ??= (async () => {
    const katex = globalThis.katex ?? (await import('./katex/katex.min.js?v=2026-11-18-r3')).default ?? globalThis.katex;
    const Inhalt = globalThis.Inhalt ?? (await import('./inhalt.js?v=2026-11-18-r3')).default ?? globalThis.Inhalt;
    const Grafik = globalThis.Grafik ?? (await import('./grafik.js?v=2026-11-18-r3')).default ?? globalThis.Grafik;
    if (!katex?.renderToString || !Inhalt?.zerteilen || !Grafik?.pruefen) throw Error('Lokale Formel-/Grafikprüfung fehlt.');
    return {katex, Inhalt, Grafik};
  })();
}

export async function medienPruefen(p) {
  const {katex, Inhalt, Grafik} = await medienLaden(), errors = [];
  const fail = (path,msg) => errors.push({path,msg});
  function grafik(g,path,raw=JSON.stringify(g)) {
    try { Grafik.pruefen(raw); }
    catch { fail(path,'Ungültige grafik/1: höchstens 4096 UTF-8-Bytes, 5 Kurven, 200 Punkte insgesamt und 30 Elemente; Pflichtfelder und erlaubte Terme prüfen.'); return; }
    // Beschriftungen können mit t1 Inline-LaTeX enthalten; Terme bleiben Datensprache.
    for (const [k,v] of Object.entries(g)) {
      if (k==='titel') text(v,path+'.titel');
      else if (k==='x'||k==='y') for(const f of ['name','einheit']) text(v[f],path+'.'+k+'.'+f);
      else if (k==='kurven'||k==='elemente') v.forEach((e,i)=>{for(const f of ['name','text']) if(typeof e[f]==='string') text(e[f],`${path}.${k}[${i}].${f}`);});
    }
  }
  function text(s,path) {
    if (s.length>200000) {fail(path,'Text überschreitet 200000 Zeichen.');return;}
    let formeln=0,grafiken=0;
    // Maskiertes Dollarzeichen vor dem gemeinsamen Parser erhalten, damit ein
    // ungeschlossenes/unzulässiges $ im Resttext eindeutig erkennbar bleibt.
    const protectedText=s.replace(/(\\+)\$/g,(m,slashes)=>slashes.length%2?slashes.slice(0,-1)+'\uE000':m);
    function dollar(teile){for(const t of teile){if(t.art==='betonung')dollar(t.teile);else if(t.art==='text'&&t.text.includes('$'))fail(path,'Unvollständige Formel oder unmaskiertes Dollarzeichen: $…$ ohne Rand-Leerzeichen, $$…$$ für einen Block, \\$ für Geldbeträge verwenden.');}}
    dollar(Inhalt.zerteilen(protectedText));
    function parts(teile) { for (const t of teile) {
      if(t.art==='betonung') parts(t.teile);
      else if(t.art==='formel') {
        if(++formeln>200) {if(formeln===201)fail(path,'Höchstens 200 Formeln je Textfeld erlaubt.');continue;}
        if(!Inhalt.formelErlaubt(t.text)) {fail(path,'Verbotener LaTeX-Befehl: keine Links, HTML-/Bilderweiterungen oder eigenen Makros.');continue;}
        try { katex.renderToString(t.text,{...Inhalt.KATEX_OPTIONEN,throwOnError:true,displayMode:t.display,trust:false,macros:Object.create(null)}); }
        catch(e) { fail(path,'Ungültige LaTeX-Formel: '+e.message); }
      } else if(t.art==='grafik') {
        if(++grafiken>20) {fail(path,'Höchstens 20 Grafiken je Textfeld erlaubt.');continue;}
        try { grafik(JSON.parse(t.text),path+' (grafik-Block '+grafiken+')',t.text); }
        catch { fail(path,'Ungültiges JSON im grafik-Block '+grafiken+'.'); }
      }
      // Code und Codeblöcke bleiben wörtlicher Text, auch bei Dollarzeichen.
    }}
    parts(Inhalt.zerteilen(s));
  }
  const keys=new Set(['hinweis','text','titel','frage','erklaerung','hinweise','optionen','kernpunkte','zeichen','wann','alltag','beschreibung','massstab','einheit','fehlerbild','start','positiv','annahmen','klausurniveau','verknuepft','begruendung','reihenfolge','bei_mangel','zaehlt_nicht','notiz','seiten','test']);
  function walk(v,path,key='',visible=false) {
    if(typeof v==='string') {if(visible||keys.has(key))text(v,path);return;}
    if(!v||typeof v!=='object')return;
    if(Array.isArray(v)){v.forEach((x,i)=>walk(x,path+'['+i+']',key,visible||keys.has(key)||key==='schritte'));return;}
    if(['code_ausgabe','code_fehler','eclipse'].includes(v.typ))return;
    for(const [k,x] of Object.entries(v)) {
      if(['pruefung','code','erwartete_ausgabe','testfaelle','svg','term','parameter','abgeleitet'].includes(k))continue;
      if(k==='grafik')grafik(x,path+'.grafik');
      else walk(x,path+'.'+k,k,visible||keys.has(k));
    }
  }
  walk(p,'$');return errors;
}
