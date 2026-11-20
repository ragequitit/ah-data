// hamta-blizzard.js – hämtar WoW Forevers auktionshus från Blizzards API varje timme, för fyra marknader, och sparar en
// kompakt rad per timme och hus. Sedan 2026-11-16 em körs den i molnet: GitHub Actions i det privata repot
// ragequitit/ah-data (= mappen api/, workflow .github/workflows/hamta.yml, kopior av skripten i cloud/) två gånger i
// timmen, med AH_NO_PUBLISH=1 och AH_API_DIR=repots rot, och skriver tillbaka med en enda commit (amend + force).
// Joakims dator hämtar inte längre själv utan synkar repot (synka.js) och publicerar. Blizzard uppdaterar ungefär en
// gång i timmen och If-Modified-Since gör att oförändrade snapshots inte laddas ner igen.
//   node dashboard/ah-sida/hamta-blizzard.js
// Två rutter per hus: /auctions/{hus} (bara icke-stapelbart, buyout för 1 st) och /auctions/{hus}/commodities
// (stapelbart, unit_price). Per vara sparas lägsta pris, riktpris (riktpris.js), antal ute, antal listningar och en
// uppskattning av sålda sedan förra snapshoten. Blizzards villkor: API-data högst 30 dagar (vi håller 29), så dagsfiler äldre än så
// raderas här. Hela prisstegen sparas bara för den senaste snapshoten (last/), som nästa körning jämför mot.
// Mapp: dashboard/ah-sida/api/<hus>/<ÅÅÅÅMMDD>.jsonl, en rad per snapshot:
//   { t, lm, items: { [id]: [lägsta, riktpris, antal, listningar, sålda, bortplockade] } }   (sålda = -1 första gången)
const fs = require("fs");
const path = require("path");
const B = require("./blizzard.js");
const { riktOf } = require("./riktpris.js");

const zlib = require("zlib");
// Alla marknader (markets.js, Joakim 2026-11-18): EU, US, KR, TW × PvP/Normal/RP/RP-PvP × Alliance/Horde/Blackwater.
// AH_MARKETS = "1113,2113" begränsar (test). De fyra ursprungliga (CORE) sparas som förut; övriga glesas och har
// senaste-filen gzippad i LASTX (i molnet GitHubs cache, inte git).
const MK = require("./markets.js");
const ONLY = (process.env.AH_MARKETS || "").split(",").map(Number).filter(Boolean);
const MARKETS = {};
for (const m of MK.LIST) if (!ONLY.length || ONLY.includes(m.key)) MARKETS[m.key] = m.name;
const DIR = process.env.AH_API_DIR || path.join(__dirname, "api");   // i molnet: repots rot (AH_API_DIR)
const LAST = path.join(DIR, "last");
const LASTX = process.env.AH_LASTX_DIR || path.join(DIR, "lastx");
const DENSE_DAYS = 3;   // icke-CORE: timrader de senaste 3 dygnen, sedan en per 6 timmar (grafen Månad använder inte fler)
fs.mkdirSync(LASTX, { recursive: true });
function readPrev(id) {
  if (MK.CORE.has(id)) { const f = path.join(LAST, id + ".json"); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; }
  const f = path.join(LASTX, id + ".json.gz");
  try { return fs.existsSync(f) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")) : null; } catch (e) { return null; }
}
function writePrev(id, o) {
  if (MK.CORE.has(id)) fs.writeFileSync(path.join(LAST, id + ".json"), JSON.stringify(o));
  else fs.writeFileSync(path.join(LASTX, id + ".json.gz"), zlib.gzipSync(JSON.stringify(o), { level: 6 }));
}
// Gles en dagsfil till en rad per 6 timmar (första raden i varje sextimmarsruta, räknat i UTC).
function thinDay(file) {
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  if (rows.length <= 4) return;
  const keep = [], seen = new Set();
  for (const r of rows) { const m = /"t":(\d+)/.exec(r); if (!m) continue; const b = Math.floor((+m[1] % 86400) / 21600); if (!seen.has(b)) { seen.add(b); keep.push(r); } }
  fs.writeFileSync(file, keep.join("\n") + "\n");
}
const KEEP_DAYS = 29;   // Blizzards villkor säger högst 30 dagar; 29 för säkerhets skull (Joakim 2026-11-16)
const MAX_GAP = 2.5 * 3600;   // sålda räknas bara när förra snapshoten är högst så här gammal
fs.mkdirSync(LAST, { recursive: true });
const log = s => { const line = new Date().toISOString().slice(0, 19) + " " + s; console.log(line); fs.appendFileSync(path.join(DIR, "logg.txt"), line + "\n"); };

async function fetchHouse(id) {
  const mk = MK.BY_KEY[id], reg = mk.region, hid = mk.house;
  const prev = readPrev(id);
  const hdr = prev && prev.lm ? { "If-Modified-Since": prev.lm } : {};
  const a = await getWith(reg, "/data/wow/ruleset/1/auctions/" + hid, hdr);
  if (a.status === 304) return { skipped: true };
  if (a.status !== 200) throw new Error("hus " + id + ": HTTP " + a.status);
  const c = await getWith(reg, "/data/wow/ruleset/1/auctions/" + hid + "/commodities", {});
  if (c.status !== 200) throw new Error("hus " + id + " commodities: HTTP " + c.status);
  const lm = a.lastModified || c.lastModified;
  if (prev && prev.lm === lm) return { skipped: true };
  // Tomt hus (finns i listan men ingen handlar där): kom ihåg tidpunkten, skriv inga rader.
  if (!(a.json.auctions || []).length && !(c.json.auctions || []).length) { writePrev(id, { t: 0, lm, steg: {}, auc: {}, empty: true }); return { empty: true }; }
  const t = lm ? Math.floor(new Date(lm).getTime() / 1000) : Math.floor(Date.now() / 1000);
  // per vara: prissteg (pris -> antal), listningar, och råa auktioner för såldräkningen
  const by = {}, auc = {};
  const add = (x, unit) => {
    const iid = x.item && x.item.id;
    if (!iid || !(unit > 0)) return;
    const q = x.quantity || 1;
    const b = by[iid] || (by[iid] = { steg: {}, n: 0, stack: false });
    b.steg[unit] = (b.steg[unit] || 0) + q;
    b.n++;
    auc[x.id] = [iid, q, unit, x.time_left || ""];
  };
  for (const x of a.json.auctions || []) if (x.buyout != null) add(x, x.buyout / (x.quantity || 1));
  // Gear per exakt suffix (Joakim 2026-11-18: "jämför exakt suffix"): bonus_lists är spelets kod för suffixet ("of the
  // Monkey" m.m., namnen i assets/suffix.json). gear-<hus>.json i LASTX (molnets cache): { id: { "bonus.bonus" (eller "0" = utan suffix): [lägsta, antal] } }.
  const gear = {};
  for (const x of a.json.auctions || []) {
    const bl = x.item && x.item.bonus_lists;
    if (x.buyout == null || !x.item || (x.quantity || 1) > 1) continue;
    const k = bl && bl.length ? bl.slice().sort((p, q) => p - q).join(".") : "0", unit = x.buyout / (x.quantity || 1);
    const g = (gear[x.item.id] = gear[x.item.id] || {}), v = g[k];
    if (!v) g[k] = [unit, 1]; else { v[1]++; if (unit < v[0]) v[0] = unit; }
  }
  fs.writeFileSync(path.join(LASTX, "gear-" + id + ".json"), JSON.stringify(gear));
  for (const x of c.json.auctions || []) { add(x, x.unit_price); if (by[x.item.id]) by[x.item.id].stack = true; }
  // sålda sedan förra snapshoten: försvunna auktioner som hade LONG/VERY_LONG kvar (kan inte ha gått ut), och minskat
  // antal på samma stapelbara auktion. SHORT/MEDIUM hoppas över (kan ha gått ut). Omlistningar dras av (2026-11-16):
  // en försvunnen auktion som dyker upp igen som NY auktion med samma vara, antal och styckpris räknas som avbruten och
  // omlistad, inte såld. Avbrutna utan omlistning räknas tyvärr med: därför "uppskattning".
  const sold = {};
  let soldOk = false, relisted = 0;
  if (prev && prev.auc && t - prev.t <= MAX_GAP && t > prev.t) {
    soldOk = true;
    const fresh = {};   // nya auktioner (id som inte fanns förut): "vara|antal|pris" -> antal sådana
    for (const [aid, v] of Object.entries(auc)) if (!prev.auc[aid]) { const k = v[0] + "|" + v[1] + "|" + v[2]; fresh[k] = (fresh[k] || 0) + 1; }
    for (const [aid, [iid, q, unit, tl]] of Object.entries(prev.auc)) {
      const cur = auc[aid];
      if (!cur) {
        if (tl !== "LONG" && tl !== "VERY_LONG") continue;
        const k = iid + "|" + q + "|" + unit;
        if (fresh[k] > 0) { fresh[k]--; relisted++; continue; }   // omlistad: samma vara, antal och pris som ny auktion
        sold[iid] = (sold[iid] || 0) + q;
      } else if (cur[1] < q) sold[iid] = (sold[iid] || 0) + (q - cur[1]);
    }
  }
  const items = {};
  for (const [iid, b] of Object.entries(by)) {
    const steg = Object.entries(b.steg).map(([p, q]) => [+p, q]).sort((x, y) => x[0] - y[0]);
    const total = steg.reduce((s, x) => s + x[1], 0);
    const rk = b.stack ? riktOf(steg, total) : { price: steg[0][0], drop: 0 };
    items[iid] = [steg[0][0], rk.price, total, b.n, soldOk ? (sold[iid] || 0) : -1, rk.drop];
  }
  const day = new Date(t * 1000);
  const dayKey = day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate();
  const hd = path.join(DIR, String(id));
  fs.mkdirSync(hd, { recursive: true });
  fs.appendFileSync(path.join(hd, dayKey + ".jsonl"), JSON.stringify({ t, lm, items }) + "\n");
  // senaste snapshoten med hela prisstegen (till sidan) och råa auktioner (till nästa såldräkning)
  const steg = {};
  for (const [iid, b] of Object.entries(by)) steg[iid] = Object.entries(b.steg).map(([p, q]) => [+p, q]).sort((x, y) => x[0] - y[0]).slice(0, 60);
  writePrev(id, { t, lm, steg, auc });
  // städa: dagsfiler äldre än KEEP_DAYS
  const cutoff = Date.now() - KEEP_DAYS * 86400 * 1000;
  for (const f of fs.readdirSync(hd)) {
    const m = /^(\d{4})(\d{2})(\d{2})\.jsonl$/.exec(f);
    if (m && new Date(+m[1], +m[2] - 1, +m[3]).getTime() < cutoff) fs.unlinkSync(path.join(hd, f));
    else if (m && !MK.CORE.has(id) && new Date(+m[1], +m[2] - 1, +m[3]).getTime() < Date.now() - DENSE_DAYS * 86400 * 1000) thinDay(path.join(hd, f));
  }
  return { t, lm, items: Object.keys(items).length, listings: (a.json.auctions || []).length + (c.json.auctions || []).length, sold: soldOk ? Object.values(sold).reduce((s, v) => s + v, 0) : null, relisted };
}

// GET med extra headers (If-Modified-Since). 304 = oförändrad sedan sist.
async function getWith(reg, p, headers) {
  const tkn = await B.token();   // samma OAuth-token gäller alla regioner
  const url = "https://" + reg + ".api.blizzard.com" + p + "?namespace=dynamic-forever-" + reg + "&locale=en_GB";
  const r = await fetch(url, { headers: Object.assign({ Authorization: "Bearer " + tkn }, headers) });
  return { status: r.status, lastModified: r.headers.get("last-modified"), json: r.ok ? await r.json() : null };
}

(async () => {
  let changed = 0;
  // Fyra hus åt gången (36 hus: ~70 anrop per körning, långt under Blizzards 36 000 i timmen).
  const queue = Object.entries(MARKETS);
  await Promise.all(Array.from({ length: 4 }, async () => { for (;;) { const job = queue.shift(); if (!job) return; const [id, name] = job;
    try {
      const r = await fetchHouse(+id);
      if (r.skipped) log(name + " (" + id + "): oförändrad");
      else if (r.empty) log(name + " (" + id + "): tomt hus");
      else { changed++; log(name + " (" + id + "): " + r.listings + " listningar, " + r.items + " varor, snapshot " + r.lm + (r.sold == null ? "" : ", ~" + r.sold + " st sålda sedan sist, " + r.relisted + " omlistningar bortdragna")); }
    } catch (e) { log(name + " (" + id + "): FEL " + e.message); }
  } }));
  // Larm (2026-11-16): om den nyaste snapshoten (oavsett hus) är äldre än AH_ALERT_HOURS timmar avslutas körningen med
  // felkod, så GitHub Actions markerar den som misslyckad och mejlar. Så märks det om Blizzard ändrar API:t igen.
  const alertH = +process.env.AH_ALERT_HOURS || 0;
  if (alertH) {
    let newest = 0;
    for (const id of Object.keys(MARKETS)) {
      if (!MK.CORE.has(+id)) continue;   // larmet gäller de fyra ursprungliga
      try { const lf = path.join(LAST, id + ".json"); if (fs.existsSync(lf)) newest = Math.max(newest, JSON.parse(fs.readFileSync(lf, "utf8")).t || 0); } catch (e) { /* ignorera */ }
    }
    const age = (Date.now() / 1000 - newest) / 3600;
    if (!newest || age > alertH) { log("LARM: ingen ny snapshot på " + age.toFixed(1) + " timmar"); process.exitCode = 2; }
  }
  // Ny timsnapshot: bygg om och publicera sidan (publicera.js: alla fyra marknader, GitHub Pages). Inte om inget ändrats.
  if (changed && !process.env.AH_NO_PUBLISH) {
    try {
      const out = require("child_process").execFileSync("node", [path.join(__dirname, "publicera.js")], { cwd: __dirname, encoding: "utf8", timeout: 15 * 60 * 1000 });
      log("publicerat: " + out.trim().split("\n").pop());
    } catch (e) { log("publicering FEL " + String(e.message).slice(0, 300)); }
  }
})();
