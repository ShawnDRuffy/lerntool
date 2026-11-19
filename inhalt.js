/* Gemeinsame Darstellung für Chat und Einheit. Keine HTML-Eingabe. */
(function (root) {
  'use strict';
  const KATEX_OPTIONEN = Object.freeze({ trust: false, throwOnError: false, strict: 'ignore', maxExpand: 100,
    maxSize: 10, output: 'htmlAndMathml', globalGroup: false, errorColor: '#b42318' });
  const MAX_TEXT = 200000, MAX_FORMEL = 4096, MAX_FORMELN = 200, MAX_GRAFIKEN = 20;
  const beobachter = new WeakMap();
  // Die Autorenregel verbietet Links, HTML-Erweiterungen und eigene Makros zusätzlich.
  function formelErlaubt(tex) { return !/\\(?:href|url|includegraphics|html[A-Za-z]*|[gex]?def|(?:new|renew|provide)command|let|futurelet|global|csname|catcode)\b/.test(tex); }
  function maskiert(s, pos) { let n = 0; while (pos > 0 && s[--pos] === '\\') n++; return n % 2 === 1; }
  function zerteilen(eingabe) {
    const s = String(eingabe ?? '').replace(/\r\n?/g, '\n');
    // Überlange Antworten bleiben vollständig als Text zugänglich, ohne Parser-/Renderarbeit.
    if (s.length > MAX_TEXT) return [{ art: 'codeblock', text: s }];
    const teile = []; let i = 0, plain = '';
    const flush = () => { if (plain) { teile.push({ art: 'text', text: plain }); plain = ''; } };
    while (i < s.length) {
      if (i === 0 || s[i - 1] === '\n') {
        const m = s.slice(i).match(/^ {0,3}(`{3,})([^\n`]*)\n/);
        if (m) {
          const beginn = i + m[0].length;
          const re = new RegExp('^ {0,3}`{' + m[1].length + ',}[ \\t]*(?:\\n|$)', 'gm'); re.lastIndex = beginn;
          const ende = re.exec(s); flush();
          teile.push({ art: m[2].trim() === 'grafik' ? 'grafik' : 'codeblock', text: s.slice(beginn, ende ? ende.index : s.length).replace(/\n$/, '') });
          i = ende ? re.lastIndex : s.length; continue;
        }
      }
      if (s[i] === '`') {
        let anzahl = 1; while (s[i + anzahl] === '`') anzahl++;
        const close = s.indexOf('`'.repeat(anzahl), i + anzahl);
        if (close >= 0 && !s.slice(i + anzahl, close).includes('\n')) {
          flush(); teile.push({ art: 'code', text: s.slice(i + anzahl, close) }); i = close + anzahl; continue;
        }
      }
      if (s[i] === '\\' && s[i + 1] === '$' && !maskiert(s, i)) { plain += '$'; i += 2; continue; }
      if (s[i] === '$' && !maskiert(s, i)) {
        const display = s[i + 1] === '$', delim = display ? '$$' : '$';
        const start = i + delim.length; let ende = -1;
        if (display || (s[start] && !/\s|\$/.test(s[start]))) {
          for (let j = start; j < Math.min(s.length, start + MAX_FORMEL + 1); j++) {
            if (!display && s[j] === '\n') break;
            if (s.startsWith(delim, j) && !maskiert(s, j) && (display || (!/\s/.test(s[j - 1]) && s[j + 1] !== '$'))) { ende = j; break; }
          }
        }
        if (ende > start) { flush(); teile.push({ art: 'formel', text: s.slice(start, ende), display, raw: s.slice(i, ende + delim.length) }); i = ende + delim.length; continue; }
      }
      plain += s[i++];
    }
    flush(); return betonungen(teile);
  }
  // Nur Textmarker auswerten: Formeln und Code bleiben unteilbare Knoten.
  // Ein Paar darf eine ganze Zeile umschließen, aber nie einen Block oder Zeilenumbruch.
  function betonungen(teile) {
    const ausgabe = []; let zeile = [];
    function flush() {
      const stapel = [{ teile: [] }];
      for (let i = 0; i < zeile.length; i++) {
        const teil = zeile[i], oben = stapel[stapel.length - 1];
        if (teil.art !== 'marker') { oben.teile.push(teil); continue; }
        const vorher = zeile[i - 1], nachher = zeile[i + 1];
        const ende = vorher && (vorher.art !== 'text' || /\S$/.test(vorher.text));
        const start = nachher && (nachher.art !== 'text' || /^\S/.test(nachher.text));
        if (oben.marker === teil.text && ende) {
          stapel.pop(); stapel[stapel.length - 1].teile.push({ art: 'betonung', tag: teil.text === '**' ? 'strong' : 'em', teile: oben.teile });
        } else if (start && !stapel.some(s => s.marker === teil.text)) stapel.push({ marker: teil.text, teile: [] });
        else oben.teile.push({ art: 'text', text: teil.text });
      }
      while (stapel.length > 1) {
        const offen = stapel.pop(), ziel = stapel[stapel.length - 1].teile;
        ziel.push({ art: 'text', text: offen.marker });
        for (const teil of offen.teile) ziel.push(teil);
      }
      for (const teil of stapel[0].teile) ausgabe.push(teil);
      zeile = [];
    }
    for (const teil of teile) {
      if (teil.art === 'text') {
        let start = 0; const re = /\n|\*\*|\*/g; let treffer;
        while ((treffer = re.exec(teil.text))) {
          if (maskiert(teil.text, treffer.index)) continue;
          if (treffer.index > start) zeile.push({ art: 'text', text: teil.text.slice(start, treffer.index) });
          if (treffer[0] === '\n') { flush(); ausgabe.push({ art: 'text', text: '\n' }); }
          else zeile.push({ art: 'marker', text: treffer[0] });
          start = re.lastIndex;
        }
        if (start < teil.text.length) zeile.push({ art: 'text', text: teil.text.slice(start) });
      } else if (teil.art === 'code' || (teil.art === 'formel' && !teil.display)) zeile.push(teil);
      else { flush(); ausgabe.push(teil); }
    }
    flush();
    const verbunden = [];
    for (const teil of ausgabe) {
      const letzter = verbunden[verbunden.length - 1];
      if (teil.art === 'text' && letzter?.art === 'text') letzter.text += teil.text;
      else verbunden.push(teil);
    }
    return verbunden;
  }
  function anzeigen(element, eingabe) {
    beobachter.get(element)?.disconnect(); beobachter.delete(element);
    if (root.Grafik?.aufraeumen) root.Grafik.aufraeumen(element);
    const d = element.ownerDocument; element.replaceChildren(); element.classList.add('inhalt-text');
    let absatz = null, liste = null, formeln = 0, grafiken = 0;
    function neu() { if (!absatz) { absatz = d.createElement('p'); element.append(absatz); } return absatz; }
    function formel(ziel, teil) {
      const el = d.createElement(teil.display ? 'div' : 'span'); el.className = teil.display ? 'inhalt-formel-block' : 'inhalt-formel';
      if (teil.display) {
        const rahmen = d.createElement('div'), hinweis = d.createElement('span');
        rahmen.className = 'inhalt-formel-rahmen'; hinweis.className = 'inhalt-formel-hinweis';
        hinweis.textContent = 'Seitlich wischen ↔'; hinweis.hidden = true;
        rahmen.append(el, hinweis); ziel.append(rahmen);
      } else ziel.append(el);
      formeln++;
      if (formelErlaubt(teil.text) && root.katex && typeof root.katex.render === 'function' && formeln <= MAX_FORMELN) {
        try { root.katex.render(teil.text, el, { ...KATEX_OPTIONEN, displayMode: teil.display, macros: Object.create(null) }); }
        catch (_) { el.textContent = teil.raw; el.classList.add('inhalt-formel-roh'); }
      } else { el.textContent = teil.raw; el.classList.add('inhalt-formel-roh'); }
    }
    function inline(ziel, teil) {
      if (teil.art === 'text') ziel.append(d.createTextNode(teil.text));
      else if (teil.art === 'formel') formel(ziel, teil);
      else if (teil.art === 'code') { const code = d.createElement('code'); code.textContent = teil.text; ziel.append(code); }
      else {
        const el = d.createElement(teil.tag); ziel.append(el);
        for (const kind of teil.teile) inline(el, kind);
      }
    }
    for (const teil of zerteilen(eingabe)) {
      if (teil.art === 'text') {
        teil.text.split('\n').forEach((zeile, i) => {
          if (i) absatz = null;
          if (!zeile) { if (i) liste = null; return; }
          if (!absatz) {
            const punkt = zeile.match(/^\s*[-*•]\s+(.*)/), titel = zeile.match(/^#{1,4}\s+(.*)/);
            if (punkt) {
              if (!liste) { liste = d.createElement('ul'); element.append(liste); }
              absatz = d.createElement('li'); liste.append(absatz); zeile = punkt[1];
            } else {
              liste = null; neu();
              if (titel) { const strong = d.createElement('strong'); absatz.append(strong); absatz = strong; zeile = titel[1]; }
            }
          }
          neu().append(d.createTextNode(zeile));
        });
      } else if (teil.art === 'code' || teil.art === 'betonung') {
        inline(neu(), teil);
      } else if (teil.art === 'formel') {
        if (teil.display) { absatz = null; liste = null; formel(element, teil); }
        else formel(neu(), teil);
      } else {
        absatz = null; liste = null;
        if (teil.art === 'grafik' && root.Grafik && ++grafiken <= MAX_GRAFIKEN) {
          const el = d.createElement('div'); element.append(el); root.Grafik.zeichnen(el, teil.text);
        } else {
          if (teil.art === 'grafik') { const p = d.createElement('p'); p.textContent = 'Grafik konnte nicht gezeichnet werden'; element.append(p); }
          const pre = d.createElement('pre'); pre.textContent = teil.text; element.append(pre);
        }
      }
    }
    if (root.ResizeObserver) {
      const anpassen = () => {
        for (const el of element.querySelectorAll('.inhalt-formel-block')) {
          const ueberlauf = el.scrollWidth > el.clientWidth + 1;
          el.nextElementSibling.hidden = !ueberlauf;
          if (ueberlauf) { el.tabIndex = 0; el.setAttribute('aria-label', 'Formel, horizontal scrollbar'); }
          else { el.removeAttribute('tabindex'); el.removeAttribute('aria-label'); }
        }
      };
      anpassen(); const observer = new root.ResizeObserver(anpassen);
      observer.observe(element); beobachter.set(element, observer);
      // Die lokalen Webfonts können die Breite nach dem ersten Layout ändern.
      d.fonts?.ready.then(() => { if (beobachter.get(element) === observer) anpassen(); });
    }
  }
  // Titel/Legenden: ausschließlich Inline-Inhalt, niemals Grafik- oder HTML-Blöcke.
  function inlineAnzeigen(element, eingabe) {
    const d = element.ownerDocument; element.replaceChildren(); let anzahl = 0;
    function teil(ziel, t) {
      if (t.art === 'betonung') {
        const el = d.createElement(t.tag); ziel.append(el); t.teile.forEach(k => teil(el, k));
      } else if (t.art === 'formel' && !t.display) {
        const el = d.createElement('span'); el.className = 'inhalt-formel'; ziel.append(el);
        if (++anzahl <= MAX_FORMELN && formelErlaubt(t.text) && typeof root.katex?.render === 'function') {
          try { root.katex.render(t.text, el, { ...KATEX_OPTIONEN, displayMode: false, macros: Object.create(null) }); }
          catch (_) { el.textContent = t.raw; }
        } else el.textContent = t.raw;
      } else ziel.append(d.createTextNode(t.raw ?? t.text ?? ''));
    }
    zerteilen(eingabe).forEach(t => teil(element, t));
  }
  const api = Object.freeze({ anzeigen, inlineAnzeigen, zerteilen, formelErlaubt, KATEX_OPTIONEN });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Inhalt = api;
})(typeof window === 'undefined' ? globalThis : window);
