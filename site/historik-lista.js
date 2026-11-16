// historik-lista.js – hemsidans prishistorik till addonet (Joakim 2026-11-21: "plockar inte vårt addon priser från vår
// hemsida? ... jag har ingen kontext längre i priserna på ah då jag inte spelat ... dag/natt-priserna finns inte").
// Läser api/113/<dag>.jsonl (Blizzards timsnapshots för EU PvP Horde, en rad per timme: items[id] = [lägsta, riktpris,
// antal, …]) och skriver addon/WhippitAH/SiteHistory.lua: per vara och dag snittet av LÄGSTA priset i addonets fyra
// tidsblock (natt 00–05, morgon 05–12, eftermiddag 12–17, kväll 17–24, svensk tid) och dagens högsta antal ute.
// Lägsta pris, samma sorts pris som addonets egna scans (data-granskare 2026-11-21: riktpris och lägsta får inte blandas).
// Bara hela dagar före i dag: AuctionHistory.MergeSite fyller bara dagar som saknas helt i din egen historik.
// Varor: de som finns i addonets egen AH-historik (sparfilen), så hemsidan fyller luckor i det du följer.
// Körs av synka.js och publicera.js, som också kopierar filen till spelet.
//
// Kör: node dashboard/ah-sida/historik-lista.js
process.env.TZ = "Europe/Stockholm";   // samma dygn och block som spelet, även när skriptet körs någon annanstans
const fs = require("fs"), path = require("path");
const HOUSE = 113, MARKET = "pvp-horde";
const DAYS = 7;            // addonet räknar normalpris på 7 dagar
const MAX_ITEMS = 1500;    // samma tak som addonets AH-historik
const MIN_QTY = 20;        // samma gräns som addonet (AuctionHistory MIN_QTY)
const API = path.join(__dirname, "api", String(HOUSE));
const OUT = path.join(__dirname, "..", "..", "addon", "WhippitAH", "SiteHistory.lua");   // Whippit AH sedan 2026-11-22

// Varorna i addonets egen AH-historik (alla marknadsnycklar för den här marknaden), annars inget att fylla.
const sp = require("./spelfil.js");
let own = new Set();
try {
  const h = sp.ahTable("ahHistory") || {};   // Whippit AH:s sparfil, annars WhippitPanels
  for (const mk of Object.keys(h)) if (/PvP-Horde$|^-Horde$/.test(mk)) for (const id of Object.keys(h[mk] || {})) if (/^\d+$/.test(id)) own.add(+id);
} catch (e) { own = new Set(); }
if (!own.size) { console.log("historik-lista: ingen egen AH-historik i sparfilen, skriver inget"); process.exit(0); }

const block = (t) => { const h = new Date(t * 1000).getHours(); return h < 5 ? 0 : h < 12 ? 1 : h < 17 ? 2 : 3; };
const dayKey = (t) => { const d = new Date(t * 1000); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); };
const today = dayKey(Date.now() / 1000);
const files = fs.existsSync(API) ? fs.readdirSync(API).filter((f) => /^\d{8}\.jsonl$/.test(f)).sort().slice(-(DAYS + 2)) : [];
if (!files.length) { console.log("historik-lista: ingen timdata i " + API); process.exit(0); }

const per = {};   // id -> dag -> { s[4], n[4], q }
let lastT = 0;
for (const f of files) {
  for (const line of fs.readFileSync(path.join(API, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch (e) { continue; }
    const t = j.t; if (!t || !j.items) continue;
    if (t > lastT) lastT = t;
    const day = dayKey(t); if (day >= today) continue;   // i dag: ofullständig, och dina egna scans i dag går först
    const b = block(t);
    for (const id in j.items) {
      if (!own.has(+id)) continue;
      const v = j.items[id], p = v[0], q = v[2];
      if (!(p > 0)) continue;
      const e = ((per[id] = per[id] || {})[day] = per[id][day] || { s: [0, 0, 0, 0], n: [0, 0, 0, 0], q: 0 });
      e.s[b] += p; e.n[b]++;
      if (q > e.q) e.q = q;
    }
  }
}
const keep = new Set([...new Set(Object.values(per).flatMap((o) => Object.keys(o)))].sort().slice(-DAYS));
const rows = Object.keys(per).map((id) => {
  const ds = Object.keys(per[id]).filter((d) => keep.has(d)).sort();
  return { id: +id, ds, qmax: Math.max(0, ...ds.map((d) => per[id][d].q)) };
}).filter((r) => r.ds.length && r.qmax >= MIN_QTY).sort((a, b) => b.qmax - a.qmax).slice(0, MAX_ITEMS).sort((a, b) => a.id - b.id);

const lines = rows.map((r) => {
  const parts = r.ds.map((d) => { const e = per[r.id][d]; return d + "=" + e.s.map((s, i) => (e.n[i] ? Math.round(s / e.n[i]) : "")).join(",") + "/" + e.q; });
  return "  [" + r.id + "] = \"" + parts.join(";") + "\",";
});
const lua = "-- SiteHistory.lua – GENERERAD av dashboard/ah-sida/historik-lista.js vid varje synk/publicering, ändra inte för hand.\n" +
  "-- Hemsidans prishistorik (Blizzards timdata, lägsta pris) per vara och dag före i dag:\n" +
  "-- \"ÅÅÅÅMMDD=natt,morgon,eftermiddag,kväll/högst ute\". AuctionHistory.MergeSite fyller bara dagar som saknas helt\n" +
  "-- i din egen historik, bara för varor du redan följer och bara på samma marknad.\n" +
  "local _, ns = ...\n" +
  "ns.SiteHistMarket = \"" + MARKET + "\"   -- hus " + HOUSE + " = EU PvP Horde\n" +
  "ns.SiteHistT = " + lastT + "\n" +
  "ns.SiteHist = {\n" + lines.join("\n") + "\n}\n";
const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
if (old !== lua) fs.writeFileSync(OUT, lua);
const ks = [...keep].sort();
console.log("historik-lista: " + rows.length + " varor, " + ks[0] + "–" + ks[ks.length - 1] + ", " + (lua.length / 1024).toFixed(0) + " kB" + (old === lua ? " (oförändrad)" : ""));
