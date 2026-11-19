/* grafik/1: Daten prüfen, Terme interpretieren, ausschließlich eigene SVG-Knoten. */
(function (root) {
  'use strict';
  const LIMIT = Object.freeze({ bytes: 4096, kurven: 5, punkte: 200, elemente: 30, term: 512, tokens: 256, tiefe: 48 });
  const FARBEN = Object.freeze(['blau', 'rot', 'grün', 'orange', 'violett', 'grau']);
  const FUN = Object.freeze(Object.assign(Object.create(null), {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
    atan: Math.atan, exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs
  }));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function fehler() { throw new Error('Ungültige Grafik oder ungültiger Term'); }
  function parser(term, variable = 'x') {
    if (typeof term !== 'string' || term.length > LIMIT.term || !/^[a-zA-Z]$/.test(variable) || variable === 'e') fehler();
    const tokens = []; let pos = 0;
    while (pos < term.length) {
      if (/\s/.test(term[pos])) { pos++; continue; }
      const rest = term.slice(pos);
      const m = rest.match(/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-zA-Z]+|[+\-*/^()])/);
      if (!m || tokens.length >= LIMIT.tokens) fehler();
      tokens.push(m[0]); pos += m[0].length;
    }
    let at = 0, tiefe = 0;
    function tief(fn) { if (++tiefe > LIMIT.tiefe) fehler(); const v = fn(); tiefe--; return v; }
    function atom() {
      const t = tokens[at++];
      if (t === '(') { const n = sum(); if (tokens[at++] !== ')') fehler(); return n; }
      if (t === variable) return ['v'];
      if (t === 'pi') return ['n', Math.PI];
      if (t === 'e') return ['n', Math.E];
      if (t && own(FUN, t)) {
        if (tokens[at++] !== '(') fehler(); const n = sum();
        if (tokens[at++] !== ')') fehler(); return ['f', t, n];
      }
      if (t && /^(?:\d|\.)/.test(t) && Number.isFinite(Number(t))) return ['n', Number(t)];
      fehler();
    }
    // Potenz bindet stärker als Vorzeichen; rechtsassoziativ: -2^2=-4, 2^3^2=512.
    function potenz() { let n = atom(); if (tokens[at] === '^') { at++; n = ['^', n, unary()]; } return n; }
    function unary() { return tief(() => {
      if (tokens[at] === '+' || tokens[at] === '-') { const op = tokens[at++]; return ['u', op, unary()]; }
      return potenz();
    }); }
    function produkt() { let n = unary(); while (tokens[at] === '*' || tokens[at] === '/') { const op = tokens[at++]; n = [op, n, unary()]; } return n; }
    function sum() { let n = produkt(); while (tokens[at] === '+' || tokens[at] === '-') { const op = tokens[at++]; n = [op, n, produkt()]; } return n; }
    const ast = sum(); if (at !== tokens.length) fehler();
    function wert(n, x) {
      switch (n[0]) {
        case 'n': return n[1]; case 'v': return x;
        case 'u': return (n[1] === '-' ? -1 : 1) * wert(n[2], x);
        case 'f': return FUN[n[1]](wert(n[2], x));
        case '+': return wert(n[1], x) + wert(n[2], x);
        case '-': return wert(n[1], x) - wert(n[2], x);
        case '*': return wert(n[1], x) * wert(n[2], x);
        case '/': return wert(n[1], x) / wert(n[2], x);
        case '^': return Math.pow(wert(n[1], x), wert(n[2], x));
        default: fehler();
      }
    }
    return x => wert(ast, x);
  }
  function obj(o, erlaubt, pflicht = erlaubt) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.getPrototypeOf(o) !== Object.prototype) fehler();
    if (Object.keys(o).some(k => !erlaubt.includes(k)) || pflicht.some(k => !own(o, k))) fehler();
  }
  function zahl(n) { if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e9) fehler(); }
  function text(s, max = 120) { if (typeof s !== 'string' || s.length > max) fehler(); }
  function punkt(p) { if (!Array.isArray(p) || p.length !== 2) fehler(); p.forEach(zahl); }
  function farbe(o) { if (own(o, 'farbe') && !FARBEN.includes(o.farbe)) fehler(); }
  function achse(a) {
    obj(a, ['min', 'max', 'name', 'einheit']); zahl(a.min); zahl(a.max); text(a.name, 60); text(a.einheit, 30);
    if (a.max <= a.min || a.max - a.min < 1e-9) fehler();
  }
  function pruefen(raw) {
    if (typeof raw !== 'string' || raw.length > LIMIT.bytes || new TextEncoder().encode(raw).length > LIMIT.bytes) fehler();
    const g = JSON.parse(raw);
    obj(g, ['format', 'titel', 'x', 'y', 'kurven', 'elemente']);
    if (g.format !== 'grafik/1') fehler(); text(g.titel); achse(g.x); achse(g.y);
    if (!Array.isArray(g.kurven) || g.kurven.length > LIMIT.kurven || !Array.isArray(g.elemente) || g.elemente.length > LIMIT.elemente) fehler();
    let anzahl = 0;
    g.kurven.forEach(k => {
      if (k.art === 'funktion') {
        obj(k, ['art', 'term', 'variable', 'name', 'farbe'], ['art', 'term', 'variable', 'name']); text(k.name); parser(k.term, k.variable);
      } else if (k.art === 'punkte') {
        obj(k, ['art', 'punkte', 'verbinden', 'name', 'farbe'], ['art', 'punkte', 'verbinden', 'name']); text(k.name);
        if (!Array.isArray(k.punkte) || typeof k.verbinden !== 'boolean') fehler();
        anzahl += k.punkte.length; if (anzahl > LIMIT.punkte) fehler(); k.punkte.forEach(punkt);
      } else fehler();
      farbe(k);
    });
    g.elemente.forEach(e => {
      switch (e.art) {
        case 'linie': case 'pfeil': obj(e, ['art', 'von', 'bis', 'name', 'farbe'], ['art', 'von', 'bis', 'name']); punkt(e.von); punkt(e.bis); text(e.name); farbe(e); break;
        case 'punkt': obj(e, ['art', 'bei', 'text', 'farbe'], ['art', 'bei', 'text']); punkt(e.bei); text(e.text); farbe(e); if (++anzahl > LIMIT.punkte) fehler(); break;
        case 'winkel':
          obj(e, ['art', 'mitte', 'von', 'bis', 'radius', 'text']); punkt(e.mitte); zahl(e.von); zahl(e.bis); zahl(e.radius); text(e.text);
          if (e.radius <= 0 || Math.abs(e.von) > 360 || Math.abs(e.bis) > 360 || e.von === e.bis || Math.abs(e.bis - e.von) > 360) fehler(); break;
        case 'kreis': obj(e, ['art', 'mitte', 'radius']); punkt(e.mitte); zahl(e.radius); if (e.radius <= 0) fehler(); break;
        case 'text': obj(e, ['art', 'bei', 'text']); punkt(e.bei); text(e.text); break;
        default: fehler();
      }
    });
    return g;
  }
  // Linien am Rechteck abschneiden (Liang–Barsky), bevor SVG-Koordinaten entstehen.
  function clip(a, b, g) {
    const dx = b[0] - a[0], dy = b[1] - a[1]; let lo = 0, hi = 1;
    const p = [-dx, dx, -dy, dy], q = [a[0] - g.x.min, g.x.max - a[0], a[1] - g.y.min, g.y.max - a[1]];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      const r = q[i] / p[i]; if (p[i] < 0) lo = Math.max(lo, r); else hi = Math.min(hi, r);
      if (lo > hi) return null;
    }
    return [[a[0] + lo * dx, a[1] + lo * dy], [a[0] + hi * dx, a[1] + hi * dy]];
  }
  function segmente(fn, g, n = 720) {
    const ergebnis = [], dy = g.y.max - g.y.min;
    let a = [g.x.min, fn(g.x.min)];
    for (let i = 1; i <= n; i++) {
      const x = g.x.min + (g.x.max - g.x.min) * i / n, b = [x, fn(x)];
      const mid = fn((a[0] + b[0]) / 2);
      // Große Sprünge / starke Krümmung unterbrechen, damit keine Linie über Polstellen läuft.
      const abweichung = Math.abs(mid - (a[1] + b[1]) / 2);
      if ([a[1], b[1], mid].every(Number.isFinite) && Math.abs(b[1] - a[1]) < dy * 0.5
          && abweichung < dy * 0.1 && abweichung < Math.max(1, Math.abs(a[1]), Math.abs(b[1])) * 0.25) {
        const s = clip(a, b, g); if (s) ergebnis.push(s);
      }
      a = b;
    }
    return ergebnis;
  }
  let id = 0;
  // Etwa fünf Skalenmarken; Schritte ausschließlich 1, 2 oder 5 × 10^n.
  function skala(min, max) {
    const roh = (max - min) / 4, potenz = 10 ** Math.floor(Math.log10(roh));
    const faktor = roh / potenz, schritt = (faktor <= 1 ? 1 : faktor <= 2 ? 2 : faktor <= 5 ? 5 : 10) * potenz;
    const start = Math.ceil(min / schritt - 1e-10), ende = Math.floor(max / schritt + 1e-10), werte = [];
    for (let i = start; i <= ende && werte.length < 10; i++) {
      const wert = Number((i * schritt).toPrecision(15));
      if (wert >= min && wert <= max) werte.push(Object.is(wert, -0) ? 0 : wert);
    }
    return werte;
  }
  const beobachter = new WeakMap();
  function aufraeumen(ziel) {
    for (const el of [ziel, ...ziel.querySelectorAll('.inhalt-grafik')]) {
      beobachter.get(el)?.disconnect(); beobachter.delete(el);
    }
  }
  function zeichnen(ziel, raw) {
    aufraeumen(ziel);
    const d = ziel.ownerDocument; ziel.replaceChildren(); ziel.classList.add('inhalt-grafik');
    try {
      const g = pruefen(raw), ns = 'http://www.w3.org/2000/svg';
      const svg = (tag, attrs = {}, str) => {
        const e = d.createElementNS(ns, tag);
        Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, String(v)));
        if (str !== undefined) e.textContent = str; return e;
      };
      const inline = (el, str) => { if (root.Inhalt?.inlineAnzeigen) root.Inhalt.inlineAnzeigen(el, str); else el.textContent = str; };
      const fig = d.createElement('figure'), caption = d.createElement('figcaption'); inline(caption, g.titel);
      const bild = svg('svg', { viewBox: '0 0 640 400', role: 'img', 'aria-label': g.titel, preserveAspectRatio: 'xMidYMid meet' });
      bild.append(svg('title', {}, g.titel));
      // Skizzen mit gleichen Einheiten behalten Winkel und Kreisformen bei.
      // Funktionsdiagramme dürfen unterschiedliche Achsenmaßstäbe haben.
      let l = 112, r = 612, t = 24, b = 330;
      if (!g.kurven.some(k => k.art === 'funktion') && g.x.einheit === g.y.einheit) {
        const s = Math.min((r - l) / (g.x.max - g.x.min), (b - t) / (g.y.max - g.y.min));
        const w = s * (g.x.max - g.x.min), h = s * (g.y.max - g.y.min);
        l += (r - l - w) / 2; r = l + w; t += (b - t - h) / 2; b = t + h;
      }
      const px = x => l + (x - g.x.min) / (g.x.max - g.x.min) * (r - l);
      const py = y => b - (y - g.y.min) / (g.y.max - g.y.min) * (b - t);
      const inside = p => p[0] >= g.x.min && p[0] <= g.x.max && p[1] >= g.y.min && p[1] <= g.y.max;
      const clipId = 'grafik-clip-' + (++id), defs = svg('defs'), cp = svg('clipPath', { id: clipId });
      cp.append(svg('rect', { x: l, y: t, width: r - l, height: b - t })); defs.append(cp); bild.append(defs);
      const feld = svg('g', { 'clip-path': 'url(#' + clipId + ')' });
      function linie(parent, a, z, cls) {
        const s = clip(a, z, g); if (!s) return;
        const el = svg('line', { x1: px(s[0][0]), y1: py(s[0][1]), x2: px(s[1][0]), y2: py(s[1][1]), class: cls }); parent.append(el); return el;
      }
      const fmt = n => n.toLocaleString('de-DE', { maximumSignificantDigits: 12 });
      for (const x of skala(g.x.min, g.x.max)) {
        linie(feld, [x, g.y.min], [x, g.y.max], 'grafik-raster');
        bild.append(svg('text', { x: px(x), y: b + 23, 'text-anchor': 'middle', class: 'grafik-zahl grafik-zahl-x' }, fmt(x)));
      }
      for (const y of skala(g.y.min, g.y.max)) {
        linie(feld, [g.x.min, y], [g.x.max, y], 'grafik-raster');
        bild.append(svg('text', { x: l - 10, y: py(y) + 5, 'text-anchor': 'end', class: 'grafik-zahl' }, fmt(y)));
      }
      const ax = Math.max(g.x.min, Math.min(g.x.max, 0)), ay = Math.max(g.y.min, Math.min(g.y.max, 0));
      linie(feld, [g.x.min, ay], [g.x.max, ay], 'grafik-achse');
      linie(feld, [ax, g.y.min], [ax, g.y.max], 'grafik-achse');
      // Achsennamen stehen zusätzlich außerhalb des SVG; lange Namen bleiben auf Handys lesbar.
      const labels = d.createElement('p'); labels.className = 'grafik-beschriftung';
      labels.textContent = 'x: ' + g.x.name + (g.x.einheit ? ' [' + g.x.einheit + ']' : '') + ' · y: ' + g.y.name + (g.y.einheit ? ' [' + g.y.einheit + ']' : '');
      labels.hidden = g.x.name === 'x' && !g.x.einheit && g.y.name === 'y' && !g.y.einheit;
      const legende = d.createElement('ul'); legende.className = 'grafik-legende';
      g.kurven.forEach((k, i) => {
        const farbklasse = 'grafik-farbe-' + (k.farbe || i), cls = 'grafik-kurve ' + farbklasse;
        if (k.art === 'funktion') {
          const segments = segmente(parser(k.term, k.variable), g);
          const path = segments.map(s => 'M' + px(s[0][0]).toFixed(2) + ',' + py(s[0][1]).toFixed(2) + 'L' + px(s[1][0]).toFixed(2) + ',' + py(s[1][1]).toFixed(2)).join(' ');
          feld.append(svg('path', { d: path, class: cls }));
        } else {
          k.punkte.forEach((p, j) => {
            if (k.verbinden && j) linie(feld, k.punkte[j - 1], p, cls);
            if (inside(p)) feld.append(svg('circle', { cx: px(p[0]), cy: py(p[1]), r: 3.5, class: cls + ' grafik-punkt' }));
          });
        }
        if (k.name) { const li = d.createElement('li'); li.className = farbklasse; inline(li, k.name); legende.append(li); }
      });
      // Volle Beschriftungen stehen in einer festen Schriftgröße unter dem Bild.
      // Im Bild verbinden kurze Nummern die Legende mit der jeweiligen Position.
      const beschriftungen = [];
      function beschriften(bei, str, farbklasse = '') {
        if (!str || !inside(bei)) return;
        beschriftungen.push({ bei, str, farbklasse });
      }
      let pfeilNummer = 0;
      const farbklassen = new Map(g.elemente.map(e => [e, e.farbe ? 'grafik-farbe-' + e.farbe : e.art === 'pfeil' ? 'grafik-farbe-' + FARBEN[pfeilNummer++ % FARBEN.length] : '']));
      const pfeile = [];
      function ueberlappt(e, a) {
        const dx = e.bis[0] - e.von[0], dy = e.bis[1] - e.von[1], laenge = Math.hypot(dx, dy);
        if (!laenge) return false;
        const cross = p => Math.abs(dx * (p[1] - e.von[1]) - dy * (p[0] - e.von[0])) / laenge;
        if (cross(a.von) > 1e-8 || cross(a.bis) > 1e-8) return false;
        const proj = p => ((p[0] - e.von[0]) * dx + (p[1] - e.von[1]) * dy) / laenge;
        return Math.min(laenge, Math.max(proj(a.von), proj(a.bis))) > Math.max(0, Math.min(proj(a.von), proj(a.bis))) + 1e-8;
      }
      g.elemente.forEach(e => {
        const farbklasse = farbklassen.get(e);
        const cls = 'grafik-skizze ' + farbklasse;
        if (e.art === 'linie' || e.art === 'pfeil') {
          const doppelt = e.art === 'pfeil' && pfeile.some(a => ueberlappt(e, a));
          const el = linie(feld, e.von, e.bis, cls + (e.art === 'pfeil' ? ' grafik-pfeil' : '') + (doppelt ? ' grafik-ueberlagert' : ''));
          if (e.art === 'pfeil') pfeile.push(e);
          if (e.art === 'pfeil' && el && inside(e.bis) && (e.von[0] !== e.bis[0] || e.von[1] !== e.bis[1])) {
            // Größen in Strichstärken: auch bei einer späteren CSS-Anpassung proportional.
            const markerId = 'grafik-pfeil-' + (++id);
            const marker = svg('marker', { id: markerId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, markerUnits: 'strokeWidth', orient: 'auto' });
            marker.append(svg('path', { d: 'M0,0 L10,5 L0,10 L2,5 Z', class: 'grafik-pfeilspitze ' + farbklasse }));
            defs.append(marker); el.setAttribute('marker-end', 'url(#' + markerId + ')');
          }
          // Ein explizites text-Element mit demselben Inhalt ersetzt den automatischen Namen.
          if (!g.elemente.some(a => a.art === 'text' && a.text === e.name)) beschriften(e.bis, e.name, farbklasse);
        } else if (e.art === 'punkt') {
          if (inside(e.bei)) feld.append(svg('circle', { cx: px(e.bei[0]), cy: py(e.bei[1]), r: 4, class: cls + ' grafik-punkt' }));
          beschriften(e.bei, e.text, farbklasse);
        } else if (e.art === 'winkel') {
          const rad = grad => grad * Math.PI / 180;
          const bei = (grad, faktor = 1) => [e.mitte[0] + e.radius * faktor * Math.cos(rad(grad)), e.mitte[1] + e.radius * faktor * Math.sin(rad(grad))];
          const delta = e.bis - e.von, schritte = Math.ceil(Math.abs(delta) / 3);
          let path = '';
          for (let i = 1; i <= schritte; i++) {
            const s = clip(bei(e.von + delta * (i - 1) / schritte), bei(e.von + delta * i / schritte), g);
            if (s) path += 'M' + px(s[0][0]) + ',' + py(s[0][1]) + 'L' + px(s[1][0]) + ',' + py(s[1][1]);
          }
          feld.append(svg('path', { d: path, class: 'grafik-skizze grafik-winkel' }));
          const ort = bei(e.von + delta / 2, 1.35);
          if (inside(ort)) feld.append(svg('text', { x: px(ort[0]), y: py(ort[1]), 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'grafik-winkel-text' }, e.text));
        } else if (e.art === 'kreis') {
          // Ein Kreis in Datenkoordinaten wird bei unterschiedlichen Achsenmaßstäben zur Ellipse.
          feld.append(svg('ellipse', { cx: px(e.mitte[0]), cy: py(e.mitte[1]), rx: e.radius / (g.x.max - g.x.min) * (r - l), ry: e.radius / (g.y.max - g.y.min) * (b - t), class: 'grafik-skizze' }));
        } else {
          const quelle = g.elemente.find(a => (a.art === 'pfeil' || a.art === 'linie') && a.name === e.text);
          beschriften(e.bei, e.text, farbklassen.get(quelle) || '');
        }
      });
      const texte = d.createElement('ol'); texte.className = 'grafik-texte';
      beschriftungen.forEach(({ bei, str, farbklasse }) => {
        const li = d.createElement('li'); li.className = farbklasse; inline(li, str);
        const ort = d.createElement('span'); ort.className = 'grafik-position';
        ort.textContent = ' (' + fmt(bei[0]) + ' | ' + fmt(bei[1]) + ')';
        li.append(ort); texte.append(li);
      });
      const marken = svg('g', { class: 'grafik-marken' });
      bild.append(feld, marken); fig.append(caption, bild, labels, legende);
      if (beschriftungen.length) fig.append(texte);
      ziel.append(fig);
      function anpassen() {
        const breite = bild.getBoundingClientRect().width;
        if (!breite) return;
        const faktor = 640 / breite, radius = 11 * faktor;
        // Eine SVG-Einheit skaliert mit dem Bild: Gegenfaktor hält Text bei 13 CSS-px.
        bild.style.setProperty('--grafik-schrift', (13 * faktor) + 'px');
        bild.querySelectorAll('.grafik-zahl-x').forEach((el, i) => { el.style.display = (r - l) / faktor < 240 && i % 2 ? 'none' : ''; });
        const hilfen = svg('g'), vordergrund = svg('g');
        marken.replaceChildren(hilfen, vordergrund);
        const spalten = Math.max(1, Math.floor((r - l - 2 * radius) / (2.4 * radius)) + 1);
        const zeilen = Math.max(1, Math.floor((b - t - 2 * radius) / (2.4 * radius)) + 1), plaetze = [];
        for (let row = 0; row < zeilen; row++) for (let col = 0; col < spalten; col++) {
          plaetze.push([spalten === 1 ? (l + r) / 2 : l + radius + col * (r - l - 2 * radius) / (spalten - 1),
            zeilen === 1 ? (t + b) / 2 : t + radius + row * (b - t - 2 * radius) / (zeilen - 1)]);
        }
        beschriftungen.forEach(({ bei, str }, i) => {
          const ax = px(bei[0]), ay = py(bei[1]);
          plaetze.sort((a, z) => Math.hypot(a[0] - ax, a[1] - ay) - Math.hypot(z[0] - ax, z[1] - ay));
          const ort = plaetze.shift();
          // Bei extrem dichter Belegung bleibt die exakte Position in der Legende.
          if (!ort) return;
          const [x, y] = ort;
          hilfen.append(svg('line', { x1: ax, y1: ay, x2: x, y2: y, class: 'grafik-hilfslinie' }));
          vordergrund.append(svg('circle', { cx: x, cy: y, r: radius, class: 'grafik-marke' }));
          const label = svg('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'grafik-marke-text' }, String(i + 1));
          label.append(svg('title', {}, str)); vordergrund.append(label);
        });
      }
      anpassen();
      if (root.ResizeObserver) {
        const observer = new root.ResizeObserver(anpassen); observer.observe(bild); beobachter.set(ziel, observer);
      }
      return true;
    } catch (_) {
      const p = d.createElement('p'); p.className = 'grafik-fehler'; p.textContent = 'Grafik konnte nicht gezeichnet werden';
      const pre = d.createElement('pre'); pre.textContent = String(raw); ziel.append(p, pre); return false;
    }
  }
  const api = Object.freeze({ LIMIT, FARBEN, parser, pruefen, clip, segmente, skala, zeichnen, aufraeumen });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Grafik = api;
})(typeof window === 'undefined' ? globalThis : window);
