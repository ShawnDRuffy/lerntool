// Lerntool: Startseite. Spricht direkt mit Supabase (Anmeldung und REST), ohne Bibliothek.
// Die Daten kommen aus der Tabelle "dateien" (gleicht das Agentic OS mit projekte/studium/daten ab),
// Fragen gehen in die Tabelle "nachrichten"; das Agentic OS beantwortet sie über dein KI-Abo.

const C = window.LERNTOOL || {};
const $ = (id) => document.getElementById(id);
const SITZUNG = "lerntool-sitzung";
let sitzung = null;
let daten = { faecher: [], lernplan: null };
let fachOffen = null;
let warten = null;

function zeige(id) {
  for (const x of ["anmelden", "start", "chat"]) $(x).hidden = x !== id;
}

function hinweis(text) {
  $("hinweis").textContent = text || "";
  $("hinweis").hidden = !text;
}

function knoten(tag, klasse, text) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (text !== undefined) el.textContent = String(text ?? "");
  return el;
}

// --- Supabase -----------------------------------------------------------------

async function auth(art, rumpf) {
  const r = await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=${art}`, {
    method: "POST", headers: { apikey: C.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify(rumpf),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error_description || d.msg || "Anmeldung fehlgeschlagen");
  sitzung = { token: d.access_token, erneuern: d.refresh_token, bis: Date.now() + (d.expires_in - 60) * 1000 };
  try { localStorage.setItem(SITZUNG, JSON.stringify(sitzung)); } catch (e) { /* privat surfen */ }
}

async function token() {
  if (sitzung && Date.now() > sitzung.bis) await auth("refresh_token", { refresh_token: sitzung.erneuern });
  return sitzung.token;
}

async function rest(pfad, optionen = {}) {
  const r = await fetch(`${C.supabaseUrl}/rest/v1/${pfad}`, {
    ...optionen,
    headers: { apikey: C.supabaseKey, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...(optionen.headers || {}) },
  });
  if (r.status === 401) { abmelden(); throw new Error("Bitte neu anmelden."); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `Fehler ${r.status}`);
  const text = await r.text();   // return=minimal liefert 201 ohne Inhalt
  return text ? JSON.parse(text) : null;
}

function abmelden() {
  sitzung = null;
  try { localStorage.removeItem(SITZUNG); } catch (e) { /* egal */ }
  $("abmelden").hidden = true;
  zeige("anmelden");
}

// --- Laden und Zeichnen ----------------------------------------------------------

async function laden() {
  const zeilen = await rest("dateien?select=pfad,inhalt&pfad=in.(faecher.json,lernplan.json)");
  for (const z of zeilen) {
    if (z.pfad === "faecher.json") daten.faecher = z.inhalt;
    if (z.pfad === "lernplan.json") daten.lernplan = z.inhalt;
  }
  if (!daten.faecher.length && daten.lernplan) daten.faecher = daten.lernplan.faecher || [];
  zeichnen();
}

function tageBis(iso) {
  const ziel = new Date(iso); ziel.setHours(0, 0, 0, 0);
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  return Math.round((ziel - heute) / 86400000);
}

function wann(iso, ganztag) {
  const d = new Date(iso);
  const tag = d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
  return ganztag ? tag : `${tag}, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

function fachName(id) {
  return (daten.faecher.find((f) => f.id === id) || {}).name || "";
}

function zeichnen() {
  const plan = daten.lernplan || {};
  const termine = [...(plan.pruefungen || [])].sort((a, b) => new Date(a.start) - new Date(b.start));
  function countdown(p) {
    const t = tageBis(p.start);
    const el = knoten("div", "pruefung" + (t <= 7 ? " bald" : ""));
    el.append(knoten("span", "tage", t <= 0 ? "heute" : t === 1 ? "morgen" : `in ${t} Tagen`),
      knoten("span", "was", p.titel), knoten("span", "klein", wann(p.start, p.ganztag) + (p.typ === "testat" ? " · Testat" : "")));
    return el;
  }
  // Klausuren werden vollständig angezeigt; Testate belegen keine Klausurplätze.
  const pruefungen = termine.filter(p => p.typ === "pruefung"), testate = termine.filter(p => p.typ === "testat");
  $("pruefungen").replaceChildren(...pruefungen.map(countdown));
  $("testate").replaceChildren(...testate.map(countdown));
  $("klausuren-titel").hidden = pruefungen.length === 0;
  $("testate-titel").hidden = testate.length === 0;
  const jetzt = Date.now();
  const naechste = (plan.vorlesungen || []).filter((v) => new Date(v.ende || v.start).getTime() > jetzt).slice(0, 5);
  $("naechstes").replaceChildren(...(naechste.length ? naechste.map((v) => {
    const el = knoten("li"); el.append(knoten("time", "", wann(v.start)), knoten("span", "", v.titel), knoten("span", "klein", v.ort || "")); return el;
  }) : [knoten("li", "leer", "In den nächsten Tagen steht nichts im Stundenplan.")]));
  const faecher = daten.faecher.map((f) => {
    const el = knoten("button", "fach"); el.dataset.fach = String(f.id ?? "");
    const prioritaet = ["hoch", "mittel", "niedrig"].includes(f.prioritaet) ? " prio-" + f.prioritaet : "";
    el.append(knoten("span", "", f.name), knoten("span", "prio" + prioritaet, f.prioritaet)); return el;
  });
  const allgemein = knoten("button", "fach"); allgemein.dataset.fach = "";
  allgemein.append(knoten("span", "", "Allgemein"), knoten("span", "prio", "ohne Fach"));
  $("faecher").replaceChildren(...faecher, allgemein);
  zeige("start");
}

async function chatOeffnen(fach) {
  fachOffen = fach;
  $("chat-titel").textContent = fachName(fach) || "Allgemein";
  zeige("chat");
  await verlauf();
}

async function verlauf() {
  const filter = fachOffen ? `fach=eq.${encodeURIComponent(fachOffen)}` : "fach=is.null";
  const liste = (await rest(`nachrichten?select=id,erstellt,text,status,antwort,wer&${filter}&order=erstellt.desc&limit=30`)).reverse();
  const fragmente = document.createDocumentFragment();
  for (const n of liste) {
    fragmente.append(knoten("div", "frage", n.text));
    const status = ["neu", "in_arbeit", "fertig", "fehler"].includes(n.status) ? n.status : "";
    const antwort = knoten("div", "antwort" + (status ? " " + status : ""));
    if (n.status === "fertig" || n.status === "fehler") {
      if (window.Inhalt) window.Inhalt.anzeigen(antwort, n.antwort);
      else antwort.textContent = String(n.antwort ?? "");
      antwort.append(knoten("span", "wer", n.wer || ""));
    } else antwort.append(knoten("span", "denkt", n.status === "neu" ? "Wartet auf das Agentic OS …" : "Wird beantwortet …"));
    fragmente.append(antwort);
  }
  if (!liste.length) fragmente.append(knoten("p", "klein", "Noch keine Fragen in diesem Fach."));
  $("verlauf").replaceChildren(fragmente);
  $("verlauf").scrollTop = $("verlauf").scrollHeight;
  clearTimeout(warten);
  if (liste.some((n) => n.status === "neu" || n.status === "in_arbeit")) warten = setTimeout(verlauf, 4000);
}

// --- Ereignisse ----------------------------------------------------------------------

$("anmelden").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("anmelden-fehler").textContent = "";
  try {
    await auth("password", { email: f.get("email"), password: f.get("passwort") });
    $("abmelden").hidden = false;
    await laden();
  } catch (fehler) {
    $("anmelden-fehler").textContent = fehler.message;
  }
});

$("abmelden").addEventListener("click", abmelden);
$("zurueck").addEventListener("click", () => { clearTimeout(warten); fachOffen = null; zeichnen(); });
$("faecher").addEventListener("click", (e) => {
  const knopf = e.target.closest("[data-fach]");
  if (knopf) chatOeffnen(knopf.dataset.fach).catch((f) => hinweis(f.message));
});

$("frage").addEventListener("submit", async (e) => {
  e.preventDefault();
  const feld = e.target.elements.text;
  const text = feld.value.trim();
  if (!text) return;
  feld.disabled = true;
  try {
    await rest("nachrichten", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ fach: fachOffen || null, text }) });
    feld.value = "";
    await verlauf();
  } catch (fehler) {
    hinweis(fehler.message);
  } finally {
    feld.disabled = false;
    feld.focus();
  }
});

$("frage").elements.text.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("frage").requestSubmit();
});

(async function start() {
  if (!C.supabaseUrl || !C.supabaseKey) {
    hinweis("Supabase ist noch nicht eingetragen. Das machst du im Agentic OS auf der Seite Studium.");
    return;
  }
  try { sitzung = JSON.parse(localStorage.getItem(SITZUNG) || "null"); } catch (e) { sitzung = null; }
  if (!sitzung) return zeige("anmelden");
  $("abmelden").hidden = false;
  try { await laden(); } catch (fehler) { hinweis(fehler.message); zeige("anmelden"); }
})();
