// hamta-blizzard-meta.js – varudata och ikoner från Blizzard i stället för Wowhead (Joakim 2026-11-16).
//   node dashboard/ah-sida/hamta-blizzard-meta.js
// För varje vara på AH (data.json och de fyra marknadernas senaste snapshot i api/last/): /data/wow/item/{id} (namn,
// kvalitet, nivåkrav, itemlevel, handlarpris, stapelbar, klass) och /data/wow/media/item/{id} (ikonens fileDataId), i
// static-forever-eu. Sparas i blizzard-meta.json. Ca 43 % av varorna ger 404 hos Blizzard (statisk data låst vid
// förlanseringen): de får sina uppgifter från addonet (ahItems) i stället, och 404 provas om efter 7 dagar. Lyckade svar
// hämtas om efter 30 dagar (Blizzards villkor: högst 30 dagars lagring).
// Ikonerna: render.worldofwarcraft.com/forever-eu/icons/56/<fileDataId>.jpg → publik/icons/<fileDataId>.jpg, både för
// fileDataId från Blizzard och från addonet (ahItems fält 6, samma id). Lugnt tempo, avbrytbart: fortsätter där det slutade.
const fs = require("fs");
const path = require("path");
const B = require("./blizzard.js");
const DIR = __dirname;
const META = process.env.AH_META_FILE || path.join(DIR, "blizzard-meta.json");
const ICONS = path.join(process.env.AH_PUB_DIR || path.join(DIR, "publik"), "icons");
const API_DIR = process.env.AH_API_DIR || path.join(DIR, "api");
const spelfil = require("./spelfil.js");
const PARALLEL = 4, SAVE_EVERY = 200;
const RETRY_404_DAYS = 7, REFRESH_DAYS = 29;   // villkoren: högst 30 dagar, 29 för säkerhets skull
const QUALITY = { POOR: 0, COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5, ARTIFACT: 6, HEIRLOOM: 7 };
fs.mkdirSync(ICONS, { recursive: true });
const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, "utf8")) : {};
const now = Math.floor(Date.now() / 1000);

// Alla varu-id: data.json (Joakims marknad) + api/last (alla marknader)
const ids = new Set();
const dataFile = path.join(DIR, "data.json");
if (fs.existsSync(dataFile)) for (const r of JSON.parse(fs.readFileSync(dataFile, "utf8")).items) ids.add(String(r[0]));
const lastDir = path.join(API_DIR, "last");
if (fs.existsSync(lastDir)) for (const f of fs.readdirSync(lastDir)) {
  if (!f.endsWith(".json")) continue;
  for (const id of Object.keys(JSON.parse(fs.readFileSync(path.join(lastDir, f), "utf8")).steg || {})) ids.add(id);
}
// Ikon-id från addonet (ahItems fält 6)
const addonIcons = new Set();
for (const str of Object.values(spelfil.load().ahItems || {})) { const ic = str.split("|")[5]; if (/^\d+$/.test(ic || "")) addonIcons.add(ic); }
const todo = [...ids].filter(id => {
  const e = meta[id];
  if (!e) return true;
  if (e.miss) return now - e.t > RETRY_404_DAYS * 86400;
  return now - e.t > REFRESH_DAYS * 86400;
});
console.log(ids.size + " varor, " + todo.length + " att hämta från Blizzard, " + addonIcons.size + " ikon-id från addonet");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchIcon(fd) {
  const out = path.join(ICONS, fd + ".jpg");
  if (fs.existsSync(out)) return true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch("https://render.worldofwarcraft.com/forever-eu/icons/56/" + fd + ".jpg");
      if (r.status === 404 || r.status === 403) return false;
      if (r.ok) { fs.writeFileSync(out, Buffer.from(await r.arrayBuffer())); return true; }
    } catch (e) { /* försök igen */ }
    await sleep(1000 * attempt);
  }
  return false;
}

async function one(id) {
  const it = await B.get("/data/wow/item/" + id, "stat");
  if (it.status === 404) { meta[id] = { miss: 1, t: now }; return; }
  if (it.status !== 200 || !it.json) throw new Error("item " + id + ": HTTP " + it.status);
  const j = it.json;
  const e = { t: now, n: j.name || "", q: QUALITY[j.quality && j.quality.type] ?? -1, lv: j.required_level || 0, il: j.level || 0,
    sp: j.sell_price || 0, st: j.is_stackable ? 1 : 0, cls: (j.item_class && j.item_class.name) || "", sub: (j.item_subclass && j.item_subclass.name) || "",
    inv: (j.inventory_type && j.inventory_type.name) || "", fd: 0 };
  const md = await B.get("/data/wow/media/item/" + id, "stat");
  if (md.status === 200 && md.json && md.json.assets) {
    const a = md.json.assets.find(x => x.key === "icon");
    if (a && a.file_data_id) e.fd = a.file_data_id;
  }
  meta[id] = e;
}

(async () => {
  let done = 0, fail = 0;
  const list = todo.slice();
  async function worker() {
    while (list.length) {
      const id = list.shift();
      try { await one(id); } catch (err) { fail++; await sleep(2000); }
      done++;
      if (done % SAVE_EVERY === 0) { fs.writeFileSync(META, JSON.stringify(meta)); console.log("  " + done + " / " + todo.length); }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  fs.writeFileSync(META, JSON.stringify(meta));
  // ikoner: Blizzards fileDataId och addonets
  const fds = new Set(addonIcons);
  for (const id of ids) { const e = meta[id]; if (e && e.fd) fds.add(String(e.fd)); }
  const need = [...fds].filter(fd => !fs.existsSync(path.join(ICONS, fd + ".jpg")));
  let got = 0, miss = 0;
  async function iconWorker() { while (need.length) { if (await fetchIcon(need.shift())) got++; else miss++; } }
  await Promise.all(Array.from({ length: PARALLEL }, iconWorker));
  let ok = 0, m404 = 0;
  for (const id of ids) { const e = meta[id]; if (e && !e.miss) ok++; else if (e) m404++; }
  console.log("Klart: " + ok + " varor med Blizzard-data, " + m404 + " saknas hos Blizzard (404), " + fail + " misslyckade anrop, ikoner: " + got + " nya, " + miss + " saknas, " + fds.size + " totalt.");
})().catch(e => { console.error("FEL:", e.message); process.exit(1); });
