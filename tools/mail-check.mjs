// San-Lager: stündliche Prüfung und E-Mail über FormSubmit (läuft in GitHub Actions)
const DB = "https://lager-52f88-default-rtdb.europe-west1.firebasedatabase.app/sanlager";
const APP = "https://lager-v.github.io";
const TEST = process.env.TEST === "true";

const liste = x => Array.isArray(x) ? x.filter(v => v != null) : (x && typeof x === "object" ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]).filter(v => v != null) : []);
const monat = plus => { const d = new Date(); d.setMonth(d.getMonth() + (plus || 0)); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };

export function auswerten(daten) {
  const cfg = daten.cfg; if (!cfg) return { bestellen: [], verfall: [], an: [] };
  const items = cfg.items || {}, bags = cfg.bags || {}, types = cfg.types || {};
  const st = {}, add = (l, i, d) => { st[l] = st[l] || {}; st[l][i] = (st[l][i] || 0) + d; };
  const base = daten.base || {};
  for (const l in (base.stock || {})) for (const i in base.stock[l]) add(l, i, base.stock[l][i]);
  const skip = new Set(base.incl || []);
  for (const id in (daten.bookings || {})) { if (skip.has(id)) continue; for (const z of liste(daten.bookings[id].lines)) add(z.l, z.i, z.d); }
  const fehlt = {};
  for (const b in bags) {
    const t = types[bags[b].t]; if (!t) continue; const soll = {};
    for (const s of liste(t.sec)) for (const z of liste(s.l)) soll[z.i] = (soll[z.i] || 0) + (z.s || 0);
    for (const i in soll) fehlt[i] = (fehlt[i] || 0) + Math.max(0, soll[i] - ((st[b] || {})[i] || 0));
  }
  const name = i => items[i].n + (items[i].d ? " " + items[i].d : "");
  const bestellen = [];
  for (const i in items) {
    const it = items[i], lg = (st.lager || {})[i] || 0, def = fehlt[i] || 0, rest = lg - def, mel = it.min || 0, ziel = Math.max(it.ziel || 0, mel);
    if (rest <= mel) { const menge = Math.max(0, ziel - rest); if (menge > 0) bestellen.push({ key: "b:" + i, text: `${menge} ${it.u || ""} ${name(i)} (Lager ${lg}, fehlt in Rucksäcken ${def})` }); }
  }
  const verfall = [], jetzt = monat(0), bald = monat(3);
  for (const l in (daten.exp || {})) for (const i in daten.exp[l]) {
    const e = daten.exp[l][i]; if (!items[i] || (l !== "lager" && !bags[l])) continue;
    const ort = l === "lager" ? "Lager" : bags[l].n, mm = e.slice(5) + "/" + e.slice(0, 4);
    if (e < jetzt) verfall.push({ key: `v:${l}:${i}:x`, d: e, text: `ABGELAUFEN ${mm}: ${name(i)} – ${ort}` });
    else if (e <= bald) verfall.push({ key: `v:${l}:${i}:b`, d: e, text: `läuft ab ${mm}: ${name(i)} – ${ort}` });
  }
  verfall.sort((a, b) => a.d.localeCompare(b.d));
  const fuell = [], FN = { "14": "noch ca. ¼", leer: "LEER" };
  for (const b in bags) for (const i in ((daten.fill || {})[b] || {})) {
    const v = daten.fill[b][i].v; if (!items[i] || !FN[v]) continue;
    fuell.push({ key: `f:${b}:${i}:${v}`, text: `${FN[v]}: ${name(i)} – ${bags[b].n}` });
  }
  const m = cfg.mail || {};
  const an = String(m.an || "").split(/[\s,;]+/).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  return { bestellen: m.best === false ? [] : bestellen, verfall: m.exp === false ? [] : verfall, fuell: m.fill === false ? [] : fuell, an };
}

async function main() {
  const res = await fetch(DB + ".json"); if (!res.ok) throw new Error("Datenbank nicht erreichbar: " + res.status);
  const daten = (await res.json()) || {};
  const r = auswerten(daten);
  if (!r.an.length) { console.log("Keine Empfänger eingetragen (Admin → Einstellungen)."); return; }
  const vorher = new Set(liste((daten.mailstate || {}).keys));
  const jetzt = [...r.bestellen, ...r.verfall, ...r.fuell].map(x => x.key);
  const neu = new Set(jetzt.filter(k => !vorher.has(k)));
  console.log(`Nachbestellen: ${r.bestellen.length}, Verfall: ${r.verfall.length}, neu: ${neu.size}`);
  if (neu.size || TEST) {
    const mark = x => (neu.has(x.key) ? "NEU · " : "") + x.text;
    const nb = r.bestellen.filter(x => neu.has(x.key)).length, nv = r.verfall.filter(x => neu.has(x.key)).length, nf = r.fuell.filter(x => neu.has(x.key)).length;
    const betreff = TEST ? "San-Lager: Testmail" : "San-Lager: " + [nb ? nb + " Artikel nachbestellen" : "", nv ? nv + " × Verfall" : "", nf ? nf + " × Füllstand niedrig" : ""].filter(Boolean).join(", ");
    const body = { _subject: betreff, _template: "box", _captcha: "false" };
    if (r.an.length > 1) body._cc = r.an.slice(1).join(",");
    body["Nachbestellen"] = r.bestellen.length ? r.bestellen.map(mark).join("\n") : "nichts";
    if ((daten.cfg.mail || {}).exp !== false) body["Verfall"] = r.verfall.length ? r.verfall.map(mark).join("\n") : "nichts";
    if ((daten.cfg.mail || {}).fill !== false) body["Füllstand"] = r.fuell.length ? r.fuell.map(mark).join("\n") : "alles ok";
    body["San-Lager öffnen"] = APP;
    const m = await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(r.an[0]), {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Referer: APP + "/", Origin: APP },
      body: JSON.stringify(body)
    });
    const txt = await m.text(); console.log("FormSubmit:", m.status, txt);
    if (!m.ok || /"success"\s*:\s*"?false/.test(txt)) throw new Error("Mail nicht verschickt");
  }
  const s = await fetch(DB + "/mailstate.json", { method: "PUT", body: JSON.stringify({ keys: jetzt, at: Date.now() }) });
  if (!s.ok) throw new Error("Status nicht gespeichert: " + s.status);
}
if (process.argv[1] && process.argv[1].endsWith("mail-check.mjs")) main().catch(e => { console.error(e.message); process.exit(1); });
