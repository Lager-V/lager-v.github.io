/**
 * San-Lager DLRG – E-Mail-Benachrichtigung
 * Läuft als Google Apps Script (script.google.com) im eigenen Google-Konto.
 * Prüft stündlich die Lager-Datenbank und schickt eine Mail, sobald
 *  - ein Artikel neu nachbestellt werden muss oder
 *  - ein Artikel neu abgelaufen ist bzw. in den nächsten 3 Monaten abläuft.
 *
 * Einrichtung: Code einfügen, oben „einrichten“ auswählen, ▶ Ausführen, Zugriff erlauben. Fertig.
 */

// Die Empfänger werden in der App eingestellt (Admin → Einstellungen → E-Mail).
// Ist dort niemand eingetragen, geht die Mail an das eigene Google-Konto.

const DB = "https://lager-52f88-default-rtdb.europe-west1.firebasedatabase.app/sanlager";
const APP = "https://lager-v.github.io";

/* ---------- Berechnung (gleiche Regeln wie in der App) ---------- */
function liste_(x) {
  if (Array.isArray(x)) return x.filter(v => v != null);
  if (x && typeof x === "object") return Object.keys(x).sort((a, b) => a - b).map(k => x[k]).filter(v => v != null);
  return [];
}
function monat_(plus) {
  const d = new Date(); d.setMonth(d.getMonth() + (plus || 0));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function auswerten(daten) {
  const cfg = daten.cfg; if (!cfg) return { bestellen: [], verfall: [] };
  const items = cfg.items || {}, bags = cfg.bags || {}, types = cfg.types || {};
  // Bestände
  const st = {};
  const add = (l, i, d) => { st[l] = st[l] || {}; st[l][i] = (st[l][i] || 0) + d; };
  const base = daten.base || {};
  for (const l in (base.stock || {})) for (const i in base.stock[l]) add(l, i, base.stock[l][i]);
  const skip = new Set(base.incl || []);
  for (const id in (daten.bookings || {})) {
    if (skip.has(id)) continue;
    for (const z of liste_(daten.bookings[id].lines)) add(z.l, z.i, z.d);
  }
  // Fehlmengen in den Rucksäcken
  const fehlt = {};
  for (const b in bags) {
    const t = types[bags[b].t]; if (!t) continue;
    const soll = {};
    for (const s of liste_(t.sec)) for (const z of liste_(s.l)) soll[z.i] = (soll[z.i] || 0) + (z.s || 0);
    for (const i in soll) fehlt[i] = (fehlt[i] || 0) + Math.max(0, soll[i] - ((st[b] || {})[i] || 0));
  }
  // Nachbestellen
  const bestellen = [];
  for (const i in items) {
    const it = items[i], lg = (st.lager || {})[i] || 0, def = fehlt[i] || 0, rest = lg - def;
    const mel = it.min || 0, ziel = Math.max(it.ziel || 0, mel);
    if (rest <= mel) { const menge = Math.max(0, ziel - rest); if (menge > 0) bestellen.push({ key: "b:" + i, name: it.n + (it.d ? " " + it.d : ""), lager: lg, rucksack: def, menge, einheit: it.u || "" }); }
  }
  // Verfall
  const verfall = [], jetzt = monat_(0), bald = monat_(3);
  for (const l in (daten.exp || {})) for (const i in daten.exp[l]) {
    const e = daten.exp[l][i]; if (!items[i] || (l !== "lager" && !bags[l])) continue;
    const ort = l === "lager" ? "Lager" : bags[l].n;
    if (e < jetzt) verfall.push({ key: "v:" + l + ":" + i + ":x", name: items[i].n + (items[i].d ? " " + items[i].d : ""), ort, datum: e, abgelaufen: true });
    else if (e <= bald) verfall.push({ key: "v:" + l + ":" + i + ":b", name: items[i].n + (items[i].d ? " " + items[i].d : ""), ort, datum: e, abgelaufen: false });
  }
  verfall.sort((a, b) => a.datum.localeCompare(b.datum));
  const m = cfg.mail || {};
  const an = String(m.an || "").split(/[\s,;]+/).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  return { bestellen: m.best === false ? [] : bestellen, verfall: m.exp === false ? [] : verfall, an };
}

/* ---------- Mail ---------- */
function mailText_(r, neu) {
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const mark = k => neu.has(k) ? ' <b style="color:#d4111b">NEU</b>' : "";
  const fmt = ym => ym.slice(5) + "/" + ym.slice(0, 4);
  let h = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a">';
  if (r.bestellen.length) {
    h += '<h2 style="color:#d4111b;margin:0 0 8px">Nachbestellen</h2><table cellpadding="6" style="border-collapse:collapse">';
    h += '<tr style="background:#ffcc00"><th align="left">Artikel</th><th>Menge</th><th>im Lager</th><th>fehlt in Rucksäcken</th></tr>';
    for (const x of r.bestellen) h += `<tr style="border-bottom:1px solid #ddd"><td>${esc(x.name)}${mark(x.key)}</td><td align="center"><b>${x.menge}</b> ${esc(x.einheit)}</td><td align="center">${x.lager}</td><td align="center">${x.rucksack}</td></tr>`;
    h += "</table>";
  }
  if (r.verfall.length) {
    h += '<h2 style="color:#d4111b;margin:18px 0 8px">Verfall</h2><table cellpadding="6" style="border-collapse:collapse">';
    for (const x of r.verfall) h += `<tr style="border-bottom:1px solid #ddd"><td>${esc(x.name)}${mark(x.key)}</td><td>${esc(x.ort)}</td><td style="color:${x.abgelaufen ? "#d4111b" : "#a86400"}">${x.abgelaufen ? "abgelaufen" : "läuft ab"} ${fmt(x.datum)}</td></tr>`;
    h += "</table>";
  }
  return h + `<p style="margin-top:18px"><a href="${APP}">San-Lager öffnen</a></p></div>`;
}

/* ---------- Ablauf ---------- */
function pruefen() {
  const res = UrlFetchApp.fetch(DB + ".json", { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("Datenbank nicht erreichbar: " + res.getResponseCode());
  const r = auswerten(JSON.parse(res.getContentText()) || {});
  const props = PropertiesService.getScriptProperties();
  const vorher = new Set(JSON.parse(props.getProperty("gemeldet") || "[]"));
  const jetzt = r.bestellen.map(x => x.key).concat(r.verfall.map(x => x.key));
  const neu = new Set(jetzt.filter(k => !vorher.has(k)));
  if (neu.size) {
    const nb = r.bestellen.filter(x => neu.has(x.key)).length, nv = r.verfall.filter(x => neu.has(x.key)).length;
    const betreff = "San-Lager: " + [nb ? nb + " Artikel nachbestellen" : "", nv ? nv + " × Verfall" : ""].filter(Boolean).join(", ");
    MailApp.sendEmail({ to: r.an.join(",") || Session.getEffectiveUser().getEmail(), subject: betreff, htmlBody: mailText_(r, neu), name: "San-Lager DLRG" });
  }
  props.setProperty("gemeldet", JSON.stringify(jetzt));
}

function einrichten() {
  for (const t of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(t);
  ScriptApp.newTrigger("pruefen").timeBased().everyHours(1).create();
  PropertiesService.getScriptProperties().deleteProperty("gemeldet");
  pruefen(); // sofort einmal prüfen – die erste Mail enthält alles, was gerade fällig ist
}

// Zum Ausprobieren: schickt die aktuelle Liste sofort, auch wenn nichts neu ist.
function testmail() {
  const r = auswerten(JSON.parse(UrlFetchApp.fetch(DB + ".json").getContentText()) || {});
  MailApp.sendEmail({ to: r.an.join(",") || Session.getEffectiveUser().getEmail(), subject: "San-Lager: Testmail", htmlBody: r.bestellen.length || r.verfall.length ? mailText_(r, new Set()) : "<p>Aktuell muss nichts bestellt werden und nichts läuft ab.</p>", name: "San-Lager DLRG" });
}
