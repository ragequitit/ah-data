// husvecka.js – veckans priser i båda husen till addonet (Joakim 2026-11-22: "köprekommendationen måste bygga på att
// priset på Hordes Auction House har varit stabilt högre än vad den är på Blackwater House under en längre tid").
// Läser Blizzards timsnapshots (api/<hus>/<dag>.jsonl, items[id] = [lägsta, riktpris, antal, …]) för de senaste 7 dygnen
// och skriver addon/WhippitAH/SiteWeek.lua: per realmtyp, hus och vara hur det LÄGSTA priset fördelat sig över
// veckans timmar, som tiondelar (10 %, 20 % … 90 % av timmarna låg under priset). Addonets Jämför räknar ut hur stor del
// av veckan det andra huset betalat mer än du köper för nu (AuctionHistory.WeekShare).
// Hus: Horde, Alliance och Blackwater (det tredje huset visas som egen kolumn i Jämför), för de realmtyper (PvP /
// Normal) du har AH-historik på.
// Varor: de i addonets egen AH-historik på den realmtypen (sparfilen), så filen bara har det Jämför kan visa.
// Körs av synka.js och publicera.js, som också kopierar filen till spelet.
//
// Kör: node dashboard/ah-sida/husvecka.js
const fs = require("fs"), path = require("path");
const HOURS = 7 * 24;       // en vecka bakåt från senaste snapshot
const MIN_HOURS = 24;       // färre timmar med varan ute = för lite för att säga något om veckan
const MIN_COVER = 0.5;      // varan ute minst halva veckan, annars säger tiondelarna inget om "stabilt"
const MAX_GAP = 6 * 3600;   // en snapshot gäller fram till nästa, högst 6 h (molnet glesar Blackwater till var 6:e timme
                            // efter 3 dygn: utan vikt blev "veckan" i praktiken de två senaste dygnen, data-granskare 2026-11-22)
const API = path.join(__dirname, "api");
const OUT = path.join(__dirname, "..", "..", "addon", "WhippitAH", "SiteWeek.lua");   // Whippit AH sedan 2026-11-22
// realmtyp → hus-id (markets.js: EU = hus-id). PvP: 110 Alliance, 113 Horde, 116 Blackwater. Normal: 111/114/117.
const HOUSES = { pvp: { Alliance: 110, Horde: 113, Blackwater: 116 }, normal: { Alliance: 111, Horde: 114, Blackwater: 117 } };

// Addonets marknader och varor: "Realm-Hus" → realmtyp (PvP står i realmnamnet) och fraktion.
const sp = require("./spelfil.js");
const want = {};   // rs → { houses: Set(namn), ids: Set }
try {
  const h = sp.ahTable("ahHistory") || {};   // Whippit AH:s sparfil, annars WhippitPanels
  for (const mk of Object.keys(h)) {
    const m = /^(.*)-(Horde|Alliance|Blackwater)$/.exec(mk);
    if (!m || !m[1]) continue;   // "-Horde" (tomt realmnamn) slås ihop av addonet, räknas inte
    const rs = /PvP/i.test(m[1]) ? "pvp" : "normal";
    const w = (want[rs] = want[rs] || { houses: new Set(["Alliance", "Blackwater", "Horde"]), ids: new Set() });   // alla tre: Jämförs tredje kolumn
    for (const id of Object.keys(h[mk] || {})) if (/^\d+$/.test(id)) w.ids.add(+id);
  }
} catch (e) { /* ingen sparfil: inget att skriva */ }
if (!Object.keys(want).length) { console.log("husvecka: ingen AH-historik i sparfilen, skriver inget"); process.exit(0); }

// Ett hus: varje varas lägsta pris per snapshot de senaste HOURS timmarna, med vikt = tiden snapshoten gäller.
function readHouse(hid, ids) {
  const dir = path.join(API, String(hid));
  if (!fs.existsSync(dir)) return { t: 0, per: {} };
  const files = fs.readdirSync(dir).filter((f) => /^\d{8}\.jsonl$/.test(f)).sort().slice(-9);
  const snaps = [];
  for (const f of files) for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch (e) { continue; }
    if (j.t && j.items) snaps.push(j);
  }
  const lastT = Math.max(0, ...snaps.map((s) => s.t));
  const seen = new Set(), use = [];
  for (const s of snaps.sort((a, b) => b.t - a.t)) {   // nyast först: samma timme hämtad två gånger -> den senare gäller
    if (s.t < lastT - HOURS * 3600) continue;
    const hourKey = Math.floor(s.t / 3600);
    if (seen.has(hourKey)) continue;
    seen.add(hourKey);
    use.push(s);
  }
  use.reverse();   // äldst först igen: vikten = tiden fram till nästa
  const per = {}, last = {};   // id → [[pris, vikt]]; id → lägsta pris senaste timmen
  let total = 0;
  use.forEach((s, i) => {
    const w = Math.min(MAX_GAP, i + 1 < use.length ? use[i + 1].t - s.t : 3600);
    total += w;
    for (const id in s.items) {
      if (!ids.has(+id)) continue;
      const p = s.items[id][0];
      if (p > 0) { (per[id] = per[id] || []).push([p, w]); if (i === use.length - 1) last[id] = p; }
    }
  });
  return { t: lastT, per, total, last };
}
// Viktade tiondelar: q[k] = priset som k*10 % av tiden låg under (k = 1..9).
function deciles(arr) {
  const a = arr.slice().sort((x, y) => x[0] - y[0]), q = [];
  const W = a.reduce((s, x) => s + x[1], 0);
  let k = 1, cum = 0;
  for (const [p, w] of a) {
    cum += w;
    while (k <= 9 && cum >= W * k / 10) { q.push(p); k++; }
  }
  while (q.length < 9) q.push(a[a.length - 1][0]);
  return q;
}
const weightOf = (arr) => arr.reduce((s, x) => s + x[1], 0);
// Sålda per dygn ur hemsidans data för huset (publik/data.json = 113, annars data-<hus>.json): rad r[8].
function soldOf(hid, ids) {
  const f = path.join(__dirname, "publik", hid === 113 ? "data.json" : "data-" + hid + ".json");
  const o = {};
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    // Fel hus eller äldre än 2 dygn: okänd volym (tom = ingen rad i Lua = filtret stoppar inget), datagranskning 2026-11-23.
    if (j.house && +j.house !== hid) return {};
    if (!j.t || Date.now() / 1000 - j.t > 2 * 86400) return {};
    for (const r of j.items) {
      const n = Math.round(r[8] || 0);
      if (n > 0 && ids.has(+r[0])) o[r[0]] = n;
    }
  } catch (e) { /* ingen fil för huset: okänd volym */ }
  return o;
}

const out = ["-- SiteWeek.lua – GENERERAD av dashboard/ah-sida/husvecka.js vid varje synk/publicering, ändra inte för hand.",
  "-- Veckans lägsta pris i båda husen (Blizzards timdata, varje mätning viktad med tiden den gäller, högst 6 h), per realmtyp",
  "-- och hus: [id] = \"timmar ute:p10,p20,…,p90:senaste timmen\" (p20 = priset som 20 % av tiden låg under, 0 = inte ute",
  "-- senaste timmen). Bara varor ute minst halva",
  "-- veckan. AuctionHistory.WeekShare: hur stor del av veckan huset betalat mer.",
  "-- ns.SiteSold[realmtyp][hus][id] = sålda per dygn (hemsidans uppskattning ur Blizzards timdata).",
  "local _, ns = ...", "ns.SiteWeek = {}", "ns.SiteSold = {}", "ns.SiteWeekT = {}   -- per realmtyp: senaste timmen (den äldsta av husen)"];
const counts = [];
for (const rs of Object.keys(want).sort()) {
  const w = want[rs];
  out.push("ns.SiteWeek." + rs + " = {}");
  let tMin = Infinity;
  out.push("ns.SiteSold." + rs + " = {}");
  for (const house of [...w.houses].sort()) {
    const { t, per, total, last } = readHouse(HOUSES[rs][house], w.ids);
    if (!t) { counts.push(rs + " " + house + ": ingen timdata"); continue; }
    tMin = Math.min(tMin, t);
    // Timmar = hur länge varan låg ute i veckan; minst MIN_HOURS och minst halva tiden huset mätts.
    const rows = Object.keys(per).map(Number).sort((a, b) => a - b)
      .filter((id) => weightOf(per[id]) >= MIN_HOURS * 3600 && weightOf(per[id]) >= total * MIN_COVER)
      .map((id) => "  [" + id + "] = \"" + Math.round(weightOf(per[id]) / 3600) + ":" + deciles(per[id]).join(",") + ":" + (last[id] || 0) + "\",");
    out.push("ns.SiteWeek." + rs + "." + house + " = {", ...rows, "}");
    counts.push(rs + " " + house + " " + rows.length);
    // Sålda per dygn i huset (hemsidans data, Blizzard-diffen; räknar med avbrutna, så en uppskattning). Andra AH kräver
    // att varan går undan där du säljer (Joakim 2026-11-23: "det är inte ett klipp om det säljs 25 varor om dagen").
    const sold = soldOf(HOUSES[rs][house], w.ids);
    const parts = Object.keys(sold).map(Number).sort((a, b) => a - b).map((id) => "[" + id + "]=" + sold[id]);
    const lines = [];
    for (let i = 0; i < parts.length; i += 12) lines.push("  " + parts.slice(i, i + 12).join(", ") + ",");
    if (lines.length) out.push("ns.SiteSold." + rs + "." + house + " = {", ...lines, "}");   // ingen fil: okänt, inte 0
  }
  out.push("ns.SiteWeekT." + rs + " = " + (isFinite(tMin) ? tMin : 0));
}
const lua = out.join("\n") + "\n";
const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
if (old !== lua) fs.writeFileSync(OUT, lua);
console.log("husvecka: " + counts.join(", ") + ", " + (lua.length / 1024).toFixed(0) + " kB" + (old === lua ? " (oförändrad)" : ""));
