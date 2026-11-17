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

function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z]);
}

// Kleines Markdown: Absätze, Listen, **fett**, `code`, Überschriften
function markdown(text) {
  const zeilen = esc(text).split("\n");
  let html = "", liste = false;
  for (const z of zeilen) {
    const punkt = z.match(/^\s*[-*•]\s+(.*)/);
    if (punkt && !liste) { html += "<ul>"; liste = true; }
    if (!punkt && liste) { html += "</ul>"; liste = false; }
    const inhalt = (punkt ? punkt[1] : z)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    if (punkt) html += `<li>${inhalt}</li>`;
    else if (/^#{1,4}\s/.test(z)) html += `<p><strong>${inhalt.replace(/^#+\s*/, "")}</strong></p>`;
    else if (z.trim()) html += `<p>${inhalt}</p>`;
  }
  return html + (liste ? "</ul>" : "");
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
  const pruefungen = (plan.pruefungen || []).slice(0, 4);
  $("pruefungen").innerHTML = pruefungen.map((p) => {
    const t = tageBis(p.start);
    return `<div class="pruefung ${t <= 7 ? "bald" : ""}">
      <span class="tage">${t <= 0 ? "heute" : t === 1 ? "morgen" : `in ${t} Tagen`}</span>
      <span class="was">${esc(p.titel)}</span>
      <span class="klein">${esc(wann(p.start, p.ganztag))}${p.typ === "testat" ? " · Testat" : ""}</span></div>`;
  }).join("");
  const jetzt = Date.now();
  const naechste = (plan.vorlesungen || []).filter((v) => new Date(v.ende || v.start).getTime() > jetzt).slice(0, 5);
  $("naechstes").innerHTML = naechste.map((v) => `<li><time>${esc(wann(v.start))}</time>
      <span>${esc(v.titel)}</span><span class="klein">${esc(v.ort || "")}</span></li>`).join("")
    || `<li class="leer">In den nächsten Tagen steht nichts im Stundenplan.</li>`;
  $("faecher").innerHTML = daten.faecher.map((f) => `<button class="fach" data-fach="${esc(f.id)}">
      <span>${esc(f.name)}</span><span class="prio prio-${esc(f.prioritaet)}">${esc(f.prioritaet)}</span></button>`).join("")
    + `<button class="fach" data-fach=""><span>Allgemein</span><span class="prio">ohne Fach</span></button>`;
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
  $("verlauf").innerHTML = liste.map((n) => `<div class="frage">${esc(n.text)}</div>
    <div class="antwort ${n.status}">${n.status === "fertig" || n.status === "fehler"
      ? markdown(n.antwort) + `<span class="wer">${esc(n.wer || "")}</span>`
      : `<span class="denkt">${n.status === "neu" ? "Wartet auf das Agentic OS …" : "Wird beantwortet …"}</span>`}</div>`).join("")
    || `<p class="klein">Noch keine Fragen in diesem Fach.</p>`;
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
