// build.js – gör data.json till AH-sidan (index.html) ur spelfrågesessionens scanloggar.
// Kör: node dashboard/ah-sida/build.js   (läser bara; ändrar inget i ah-mappen)
// Källor (mappen AH nedan): scans.jsonl (lägsta pris + antal per vara och scan), djup.jsonl (snitt för 20/100 billigaste
// per replicate-scan, och prissteg från enskilda sökningar), full.jsonl (hela prisstegen per scan, från addonet efter
// 2026-11-15), ref.txt (namn). Varudata (namn, kvalitet, nivåkrav, handlarpris, ikon-id) ur addonets sparfil
// (WhippitPanelDB.ahItems, 11 fält sedan 2026-11-16) och Blizzards API (blizzard-meta.json, hamta-blizzard-meta.js);
// tooltips ur addonets ahTips (spelets egna). Sålda per dag ur timhämtningen (api/<hus>/, hamta-blizzard.js).
// Wowhead och goldcap används inte längre (Joakim 2026-11-16); de gamla filerna meta.json och tooltips.json läses bara
// som reserv tills addonet fyllt på, och ingenting hämtas därifrån.
const fs = require("fs");
const path = require("path");
// Mappar: på Joakims dator standardvärdena; i molnet (GitHub Actions, ah-data) pekar miljön på grenen egna (scans,
// spel.json), repots rot (api-data), meta/ (blizzard-meta.json) och klonen av ragequitit/ah (publik).
const AH = process.env.AH_SCANS_DIR || "C:/Users/joaki/AppData/Roaming/Claude/side-session-notes/local_3be9e71d-9f4a-4a6c-b95f-a4395b2cbe0e/ah";
const API_DIR = process.env.AH_API_DIR || path.join(__dirname, "api");
const PUB_DIR = process.env.AH_PUB_DIR || path.join(__dirname, "publik");
const spelfil = require("./spelfil.js");
// Marknad (Blizzards hus, hamta-blizzard.js): AH_HOUSE i miljön, 113 = EU PvP Horde är huvudmarknaden (Joakims egna
// scans finns bara där; sidan, tooltiparna och ikonerna skrivs bara i den körningen). publicera.js kör alla fyra.
// Alla marknader (markets.js, 2026-11-18): EU = hus-id, US 1000+, KR 2000+, TW 3000+.
const MK = require("./markets.js");
const MARKETS = MK.MARKETS;
const LASTX = process.env.AH_LASTX_DIR || path.join(API_DIR, "lastx");   // senaste-filen för icke-CORE (gzip)
const HOUSE = +process.env.AH_HOUSE || 113;
if (MK.BY_KEY[HOUSE] && MK.BY_KEY[HOUSE].hidden) { console.log(MK.MARKETS[HOUSE] + ": dold på sidan, byggs inte"); process.exit(0); }
if (HOUSE === 113) for (const m of MK.LIST) if (m.hidden) {   // städa bort det som redan publicerats av dolda marknader
  fs.rmSync(path.join(PUB_DIR, "data-" + m.key + ".json"), { force: true });
  fs.rmSync(path.join(PUB_DIR, "hist", String(m.key)), { recursive: true, force: true });
}
const MAIN = HOUSE === 113;
if (!MARKETS[HOUSE]) throw new Error("okänt hus " + HOUSE);
const OUT = path.join(__dirname, MAIN ? "data.json" : "data-" + HOUSE + ".json");

const lines = f => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean) : []);
const json = l => { try { return JSON.parse(l); } catch (e) { return null; } };

// --- scans: en per tidpunkt, äldst först. Addonets scans (bara huvudmarknaden) och Blizzards timvisa snapshots
// (api/<hus>/, en rad per timme: items[id] = [lägsta, riktpris, antal, listningar, sålda, bortplockade]). Timsnapshots
// äldre än 3 dygn glesas till en per 6 timmar (grafen Månad behöver inte mer, och historiken ska hållas liten). Äldre än
// 30 dagar finns inte (hamta-blizzard.js raderar, Blizzards villkor). ---
const seen = new Set();
const scans = [];
if (MAIN) for (const l of lines(AH + "/scans.jsonl")) {
  const o = json(l);
  if (!o || !o.t || !o.items || seen.has(o.t)) continue;
  seen.add(o.t);
  scans.push(o);
}
{
  const hd = path.join(API_DIR, String(HOUSE));
  const now = Math.floor(Date.now() / 1000), dense = now - 3 * 86400;
  const snaps = [];
  if (fs.existsSync(hd)) for (const f of fs.readdirSync(hd).sort()) {
    if (!f.endsWith(".jsonl")) continue;
    for (const l of lines(path.join(hd, f))) { const o = json(l); if (o && o.t && o.items) snaps.push(o); }
  }
  snaps.sort((a, b) => a.t - b.t);
  let lastKept = 0, nApi = 0;
  for (const o of snaps) {
    if (seen.has(o.t)) continue;
    if (o.t < dense && o.t - lastKept < 6 * 3600 - 300) continue;
    lastKept = o.t;
    seen.add(o.t);
    const items = {}, api = {};
    for (const [id, v] of Object.entries(o.items)) { items[id] = [v[0], v[2]]; api[id] = [v[1], v[5] || 0]; }
    scans.push({ t: o.t, items, api });
    nApi++;
  }
  console.log(MARKETS[HOUSE] + ": " + nApi + " timsnapshots" + (MAIN ? " + " + (scans.length - nApi) + " egna scans" : ""));
  if (!MAIN && !nApi) { console.log(MARKETS[HOUSE] + ": ingen data än, hoppar över"); process.exit(0); }
}
scans.sort((a, b) => a.t - b.t);
if (!scans.length) throw new Error("inga scans");
const latest = scans[scans.length - 1];
const scanIdx = t => {   // närmaste scan inom 10 min
  let best = -1, bd = 601;
  scans.forEach((s, i) => { const d = Math.abs(s.t - t); if (d < bd) { bd = d; best = i; } });
  return best;
};

// --- djup: p20/p100 per replicate-scan, och senaste prisstegen från en enskild sökning ---
const p20h = {};      // id -> [p20 per scanindex]
const depthNow = {};  // id -> { p20, p100, n } vid senaste scannen
const steps = {};     // id -> { t, steg, total, src }
for (const l of MAIN ? lines(AH + "/djup.jsonl") : []) {
  const o = json(l);
  if (!o || !o.id || !o.t) continue;
  if (o.scan) {
    const i = scanIdx(o.t);
    if (i < 0 || !o.p20) continue;
    (p20h[o.id] = p20h[o.id] || [])[i] = o.p20;
    if (i === scans.length - 1) depthNow[o.id] = { p20: o.p20, p100: o.p100 || 0, n: o.n || 0 };
  } else if (Array.isArray(o.steg) && o.steg.length && (!steps[o.id] || steps[o.id].t < o.t)) {
    steps[o.id] = { t: o.t, steg: o.steg.slice(0, 25), total: o.n || 0, src: "sok" };
  }
}

// --- full: hela prisstegen från addonets scan (inga säljarnamn finns i datan, bara antal säljare) ---
function parseFull(str) {
  const m = /^(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)\/(.*)$/.exec(str);
  if (!m) return null;
  const steg = m[10] ? m[10].split(",").map(s => s.split(":").map(Number)).filter(a => a.length === 2 && a[0] > 0) : [];
  return { total: +m[1], sellers: +m[3], topPct: +m[4], tid: [+m[5], +m[6], +m[7], +m[8]], stack: +m[9], steg };
}
let fullInfo = null;
const fullAt = {};   // scanindex -> full-posten (hela prisstegen), för riktpriset per scan
for (const l of MAIN ? lines(AH + "/full.jsonl") : []) {
  const o = json(l);
  if (!o || !o.t || !o.full) continue;
  if (!fullInfo || o.t > fullInfo.t) fullInfo = o;
  const i = scanIdx(o.t);
  if (i >= 0) fullAt[i] = o;
}

// Riktpriset: riktpris.js (samma regel som timhämtningen hamta-blizzard.js).
const { riktOf } = require("./riktpris.js");
if (fullInfo) {
  for (const id of Object.keys(fullInfo.full)) {
    const f = parseFull(fullInfo.full[id]);
    if (!f || !f.steg.length) continue;
    steps[id] = { t: fullInfo.t, steg: f.steg, total: f.total, src: "scan", stack: f.stack,
      sellers: (fullInfo.ownerPct || 0) > 50 ? f.sellers : 0, tid: (fullInfo.timePct || 0) > 50 ? f.tid : null };
  }
}
// Gear per exakt suffix (hamta-blizzard.js gear-<hus>.json i LASTX, bara i molnet): till sidan som gear-<hus>.json för
// Trading → Horde ⇄ Alliance. Finns filen inte (datorns bygge) rörs den publicerade inte.
{
  const gf = path.join(LASTX, "gear-" + HOUSE + ".json");
  if (fs.existsSync(gf)) { fs.mkdirSync(PUB_DIR, { recursive: true }); fs.copyFileSync(gf, path.join(PUB_DIR, "gear-" + HOUSE + ".json")); }
}
// Senaste timsnapshotens prissteg (api/last/<hus>.json, högst 60 steg per vara) när den är nyare än addonets scan.
{
  const lf = path.join(API_DIR, "last", HOUSE + ".json"), lx = path.join(LASTX, HOUSE + ".json.gz");
  let last = null;
  if (MK.CORE.has(HOUSE)) last = fs.existsSync(lf) ? json(fs.readFileSync(lf, "utf8")) : null;
  else try { last = fs.existsSync(lx) ? JSON.parse(require("zlib").gunzipSync(fs.readFileSync(lx)).toString("utf8")) : null; } catch (e) { last = null; }
  if (last && last.steg && (!fullInfo || last.t > fullInfo.t)) {
    for (const [id, steg] of Object.entries(last.steg)) {
      if (!steg.length) continue;
      steps[id] = { t: last.t, steg, total: steg.reduce((a, x) => a + x[1], 0), src: "api", stack: 0, sellers: 0, tid: null };
    }
  }
}

// --- namn: goldcap, ref.txt, och addonets ahItems ("namn|kvalitet") ---
const names = {}, quality = {}, perDay = {}, gameCat = {}, level = {}, sellPrice = {}, iconFd = {}, gameTips = {}, stackOf = {};
// Nivåkrav ur Classic-databasen (nivaer.json); Wowheads Forever-data (meta.json) går före där den finns.
const nivFile = path.join(__dirname, "nivaer.json");
if (fs.existsSync(nivFile)) Object.assign(level, JSON.parse(fs.readFileSync(nivFile, "utf8")));
for (const l of lines(AH + "/ref.txt")) { const a = l.split("|"); if (a[0] && a[1]) names[a[0]] = a[1]; }
// Sålda per dag: ur Blizzards timvisa snapshots (hamta-blizzard.js). Per snapshot räknas listningar som försvann fast de
// hade lång tid kvar, och minskat antal på stapelbara auktioner, som sålda (avbrutna och omlistade räknas tyvärr med:
// uppskattning). Summan de senaste 7 dagarna delat med antalet timmar, gånger 24. Visas först efter ett dygns data.
const soldSum = {}, soldHours = {};
{
  const hd = path.join(API_DIR, String(HOUSE));
  const from = Math.floor(Date.now() / 1000) - 7 * 86400;
  let hours = 0;
  if (fs.existsSync(hd)) for (const f of fs.readdirSync(hd).sort()) {
    if (!f.endsWith(".jsonl")) continue;
    for (const l of lines(path.join(hd, f))) {
      const o = json(l);
      if (!o || o.t < from) continue;
      let any = false;
      for (const [id, v] of Object.entries(o.items)) { if (v[4] >= 0) { any = true; soldSum[id] = (soldSum[id] || 0) + v[4]; } }
      if (any) hours++;
    }
  }
  if (hours >= 24) for (const id of Object.keys(soldSum)) perDay[id] = Math.round(soldSum[id] / hours * 24);
  console.log("sålda/dag: " + hours + " timmar underlag, " + Object.keys(perDay).length + " varor");
}
{
  // Spelets data (spelfil.js): ahItems "namn|kvalitet|typ|undertyp|plats|ikon|nivåkrav|handlarpris|stapel|itemlevel|bindning"
  // (äldre rader kortare) och ahTips (spelets egna tooltips, "vänster\thöger\n…" med |cffRRGGBB-färgkoder).
  const spel = spelfil.load();
  for (const [id, str] of Object.entries(spel.ahItems || {})) {
    const parts = str.split("|");
    if (parts[0]) names[id] = parts[0];
    if (/^\d$/.test(parts[1] || "")) quality[id] = +parts[1];
    if (parts[2]) gameCat[id] = [parts[2], parts[3] || "", parts[4] || ""];
    if (/^\d+$/.test(parts[5] || "")) iconFd[id] = parts[5];
    if (/^\d+$/.test(parts[6] || "") && +parts[6] > 0) level[id] = +parts[6];
    if (/^\d+$/.test(parts[7] || "")) sellPrice[id] = +parts[7];
    if (/^\d+$/.test(parts[8] || "") && +parts[8] > 0) stackOf[id] = +parts[8];
  }
  Object.assign(gameTips, spel.ahTips || {});
  // Bossloot loggad i spelet (addonets BossLoot.lua, 2026-11-16): Forevers riktiga loot till Dungeons-fliken.
  // forever-loot.json = { t, bosses: { npcId (eller -encounterID): { name, inst, map, kills, loots, items: { id: [kills där sett, namn, kvalitet] } } } }
  const bl = spel.bossLoot || {}, bosses = {};
  for (const [k, e] of Object.entries(bl)) {
    if (!e || !e.kills) continue;
    const items = {};
    for (const [id, it] of Object.entries(e.items || {})) items[id] = [it.n || 0, it.name || "", typeof it.quality === "number" ? it.quality : -1];
    bosses[k] = { name: e.name || "", inst: e.inst || "", map: e.map || 0, kills: e.kills, loots: e.loots || 0, items };   // procent = n / loots
  }
  fs.writeFileSync(path.join(PUB_DIR, "forever-loot.json"), JSON.stringify({ t: Date.now(), bosses }));
  console.log("forever-loot.json: " + Object.keys(bosses).length + " bossar loggade i spelet");
}

// Blizzards API (hamta-blizzard-meta.js): { id: { n, q, lv, il, sp, st, cls, sub, inv, fd } eller { miss: 1 } }. Går före
// addonets rad där Blizzard har varan (grundnamnet, inte "… of the Monkey"); addonet täcker de 43 % Blizzard saknar.
const icon = {};
const bmFile = process.env.AH_META_FILE || path.join(__dirname, "blizzard-meta.json");
const bmeta = fs.existsSync(bmFile) ? JSON.parse(fs.readFileSync(bmFile, "utf8")) : {};
for (const id of Object.keys(bmeta)) {
  const e = bmeta[id];
  if (!e || e.miss) continue;
  if (e.n) names[id] = e.n;
  if (typeof e.q === "number" && e.q >= 0) quality[id] = e.q;
  if (e.lv > 0) level[id] = e.lv;
  if (e.sp > 0 && !sellPrice[id]) sellPrice[id] = e.sp;
  if (e.fd && !iconFd[id]) iconFd[id] = String(e.fd);
}
// Ikon = fileDataId (publik/icons/<id>.jpg från Blizzards bildserver). Reserv tills allt hämtats: de gamla ikonerna
// från Wowhead (meta.json, bara läst, aldrig hämtad igen).
const oldMetaFile = path.join(__dirname, "meta.json");
const oldMeta = fs.existsSync(oldMetaFile) ? JSON.parse(fs.readFileSync(oldMetaFile, "utf8")) : {};
for (const id of new Set([...Object.keys(iconFd), ...Object.keys(oldMeta)])) {
  const fd = iconFd[id];
  if (fd && fs.existsSync(path.join(PUB_DIR, "icons", fd + ".jpg"))) icon[id] = fd;
  else {
    const ic = oldMeta[id] && oldMeta[id][2];
    if (ic && fs.existsSync(path.join(PUB_DIR, "icons", ic + ".jpg"))) icon[id] = ic;
  }
}
// --- kategorier: samma träd som AH-fönstret i WoW Forever (Blizzard_AuctionData.lua, Camelot) ---
// Varje vara får en sökväg [topp, under, under-under] (index i TREE). Underlag: spelets egen klass/underklass/plats
// (addonets ahItems, GetItemInfoInstant) och annars Classic-databasen (klasser.json + plats ur itemdb-exporten).
const TREE = [
  ["Weapons", [
    ["One-Handed", ["One-Handed Axes", "One-Handed Maces", "One-Handed Swords", "Daggers", "Fist Weapons", "Wands"]],
    ["Two-Handed", ["Two-Handed Axes", "Two-Handed Maces", "Two-Handed Swords", "Polearms", "Staves"]],
    ["Ranged", ["Bows", "Crossbows", "Guns", "Thrown"]],
    ["Miscellaneous", ["Fishing Pole", "Other"]]]],
  ["Armor", [
    ["Plate", ["Head", "Shoulder", "Chest", "Waist", "Legs", "Feet", "Wrist", "Hands"]],
    ["Mail", ["Head", "Shoulder", "Chest", "Waist", "Legs", "Feet", "Wrist", "Hands"]],
    ["Leather", ["Head", "Shoulder", "Chest", "Waist", "Legs", "Feet", "Wrist", "Hands"]],
    ["Cloth", ["Head", "Shoulder", "Chest", "Waist", "Legs", "Feet", "Wrist", "Hands"]],
    ["Relic", ["Idols", "Librams", "Totems"]],
    ["Miscellaneous", ["Neck", "Cloak", "Finger", "Trinket", "Held In Off-hand", "Shields", "Shirt", "Tabard"]]]],
  ["Containers", [
    ["Regular Bags", ["Bag", "Soul Bag"]],
    ["Ammo", ["Quiver", "Ammo Pouch"]],
    ["Trade Bags", ["Herb Bag", "Enchanting Bag", "Engineering Bag", "Mining Bag", "Leatherworking Bag", "Tackle Box", "Cooking Bag", "Reagent Bag"]]]],
  ["Consumables", [["Explosives", []], ["Potions", []], ["Elixirs", []], ["Flasks", []], ["Scrolls", []], ["Food & Drink", []], ["Bandages", []],
    ["Item Enhancements", ["Permanent", "Temporary"]], ["Draughts", []], ["Devices", []], ["Other", []]]],
  ["Trade Goods", [["Parts", []], ["Cloth", []], ["Leather", []], ["Metal & Stone", []], ["Cooking", []], ["Herb", []], ["Enchanting", []], ["Elemental", []], ["Other", []]]],
  ["Ammo", [["Arrow", []], ["Bullet", []]]],
  ["Recipes", [["Leatherworking", []], ["Tailoring", []], ["Engineering", []], ["Blacksmithing", []], ["Cooking", []], ["Alchemy", []],
    ["First Aid", []], ["Enchanting", []], ["Fishing", []], ["Book", []]]],
  ["Quest Items", []],
  ["Gems", []],   // finns inte i Forevers AH-lista, men varorna finns på AH: egen rad sist före Diverse
  ["Miscellaneous", [["Junk", []], ["Reagent", []], ["Pet", []], ["Holiday", []], ["Other", []], ["Mount", []]]],
];
// Klass/underklass (som GetItemInfo/klasser.json skriver dem) -> plats i trädet. Vapen delas på en-/tvåhand via
// underklassen; rustning via platsen (slot). null = ingen AH-kategori (Key, Reagent-klassen).
const WEAPON = { Axe: ["One-Handed", "One-Handed Axes"], "One-Handed Axes": ["One-Handed", "One-Handed Axes"], "Two-Handed Axes": ["Two-Handed", "Two-Handed Axes"],
  Mace: ["One-Handed", "One-Handed Maces"], "One-Handed Maces": ["One-Handed", "One-Handed Maces"], "Two-Handed Maces": ["Two-Handed", "Two-Handed Maces"],
  Sword: ["One-Handed", "One-Handed Swords"], "One-Handed Swords": ["One-Handed", "One-Handed Swords"], "Two-Handed Swords": ["Two-Handed", "Two-Handed Swords"],
  Dagger: ["One-Handed", "Daggers"], Daggers: ["One-Handed", "Daggers"], "Fist Weapon": ["One-Handed", "Fist Weapons"], "Fist Weapons": ["One-Handed", "Fist Weapons"],
  Wand: ["One-Handed", "Wands"], Wands: ["One-Handed", "Wands"], Polearm: ["Two-Handed", "Polearms"], Polearms: ["Two-Handed", "Polearms"],
  Staff: ["Two-Handed", "Staves"], Staves: ["Two-Handed", "Staves"], Bow: ["Ranged", "Bows"], Bows: ["Ranged", "Bows"], Crossbow: ["Ranged", "Crossbows"],
  Crossbows: ["Ranged", "Crossbows"], Gun: ["Ranged", "Guns"], Guns: ["Ranged", "Guns"], Thrown: ["Ranged", "Thrown"],
  "Fishing Pole": ["Miscellaneous", "Fishing Pole"], "Fishing Poles": ["Miscellaneous", "Fishing Pole"], Miscellaneous: ["Miscellaneous", "Other"], Exotic: ["Miscellaneous", "Other"] };
const ARMOR_SLOT = { Head: "Head", Shoulder: "Shoulder", Chest: "Chest", Robe: "Chest", Waist: "Waist", Legs: "Legs", Feet: "Feet", Wrist: "Wrist", Hands: "Hands" };
const ARMOR_MISC = { Neck: "Neck", Back: "Cloak", Cloak: "Cloak", Finger: "Finger", Trinket: "Trinket", "Held In Off-hand": "Held In Off-hand", "Off Hand": "Held In Off-hand",
  Shield: "Shields", Shirt: "Shirt", Tabard: "Tabard" };
const CONTAINER = { Bag: ["Regular Bags", "Bag"], "Soul Bag": ["Regular Bags", "Soul Bag"], Quiver: ["Ammo", "Quiver"], "Ammo Pouch": ["Ammo", "Ammo Pouch"],
  "Herb Bag": ["Trade Bags", "Herb Bag"], "Enchanting Bag": ["Trade Bags", "Enchanting Bag"], "Engineering Bag": ["Trade Bags", "Engineering Bag"],
  "Mining Bag": ["Trade Bags", "Mining Bag"], "Leatherworking Bag": ["Trade Bags", "Leatherworking Bag"], "Tackle Box": ["Trade Bags", "Tackle Box"],
  "Cooking Bag": ["Trade Bags", "Cooking Bag"], "Reagent Bag": ["Trade Bags", "Reagent Bag"], "Gem Bag": ["Trade Bags", "Reagent Bag"], "Inscription Bag": ["Trade Bags", "Reagent Bag"] };
const CONSUMABLE = { Explosives: "Explosives", "Explosives and Devices": "Explosives", Potion: "Potions", Potions: "Potions", Elixir: "Elixirs", Elixirs: "Elixirs",
  Flask: "Flasks", Flasks: "Flasks", Scroll: "Scrolls", Scrolls: "Scrolls", "Food & Drink": "Food & Drink", Bandage: "Bandages", Bandages: "Bandages",
  "Item Enhancement": ["Item Enhancements", "Permanent"], "Item Enhancements": ["Item Enhancements", "Permanent"], "Item Enhancement (Temporary)": ["Item Enhancements", "Temporary"],
  Draught: "Draughts", Draughts: "Draughts", Devices: "Devices", Other: "Other", Consumable: "Other", Consumables: "Other" };
const TRADE = { Parts: "Parts", Cloth: "Cloth", Leather: "Leather", "Metal & Stone": "Metal & Stone", Cooking: "Cooking", Herb: "Herb", Enchanting: "Enchanting",
  Elemental: "Elemental", Other: "Other", Meat: "Cooking", Devices: "Parts", Explosives: "Parts", Jewelcrafting: "Other", Materials: "Other" };
const RECIPE = { Leatherworking: 1, Tailoring: 1, Engineering: 1, Blacksmithing: 1, Cooking: 1, Alchemy: 1, "First Aid": 1, Enchanting: 1, Fishing: 1, Book: 1, Jewelcrafting: 0, Mining: 0 };
const MISC = { Junk: "Junk", Reagent: "Reagent", Pet: "Pet", Holiday: "Holiday", Other: "Other", Mount: "Mount", "Companion Pets": "Pet" };
const TOP_ALIAS = { Weapon: "Weapons", Weapons: "Weapons", Armor: "Armor", Container: "Containers", Containers: "Containers", Consumable: "Consumables", Consumables: "Consumables",
  "Trade Goods": "Trade Goods", Tradegoods: "Trade Goods", Tradeskill: "Trade Goods", Projectile: "Ammo", Projectiles: "Ammo", Ammo: "Ammo", Quiver: "Containers",
  Recipe: "Recipes", Recipes: "Recipes", Quest: "Quest Items", "Quest Items": "Quest Items", Questitem: "Quest Items", Miscellaneous: "Miscellaneous",
  Gem: "Gems", Gems: "Gems" };
const slotOf = {};   // plats per vara ur Classic-exporten (bara rustning)
const slotFile = path.join(__dirname, "platser.json");
if (fs.existsSync(slotFile)) Object.assign(slotOf, JSON.parse(fs.readFileSync(slotFile, "utf8")));
const cat = {};
const klasserFile = path.join(__dirname, "klasser.json");
if (fs.existsSync(klasserFile)) Object.assign(cat, JSON.parse(fs.readFileSync(klasserFile, "utf8")));
for (const id of Object.keys(gameCat)) cat[id] = gameCat[id];
for (const id of Object.keys(bmeta)) {   // Blizzards klass/underklass/plats för varor addonet inte sett (andra marknader)
  const e = bmeta[id];
  if (e && !e.miss && e.cls && !cat[id]) cat[id] = [e.cls, e.sub || "", e.inv || ""];
}
function pathOf(id) {
  const c = cat[id];
  if (!c || !c[0]) return null;
  const top = TOP_ALIAS[c[0]];
  const sub = c[1] || "";
  const slot = slotOf[id] || (c[2] || "");
  if (!top) return null;
  switch (top) {
    case "Weapons": { const w = WEAPON[sub]; return w ? ["Weapons", w[0], w[1]] : ["Weapons"]; }
    case "Armor": {
      if (sub === "Idol" || sub === "Idols") return ["Armor", "Relic", "Idols"];
      if (sub === "Libram" || sub === "Librams") return ["Armor", "Relic", "Librams"];
      if (sub === "Totem" || sub === "Totems") return ["Armor", "Relic", "Totems"];
      if (sub === "Shield" || sub === "Shields") return ["Armor", "Miscellaneous", "Shields"];
      if (sub === "Plate" || sub === "Mail" || sub === "Leather" || sub === "Cloth") {
        if (ARMOR_SLOT[slot]) return ["Armor", sub, ARMOR_SLOT[slot]];
        if (ARMOR_MISC[slot]) return ["Armor", "Miscellaneous", ARMOR_MISC[slot]];
        return ["Armor", sub];
      }
      if (ARMOR_MISC[slot]) return ["Armor", "Miscellaneous", ARMOR_MISC[slot]];
      return ["Armor", "Miscellaneous"];
    }
    case "Containers": { const k = CONTAINER[sub]; return k ? ["Containers", k[0], k[1]] : ["Containers"]; }
    case "Consumables": { const k = CONSUMABLE[sub]; return Array.isArray(k) ? ["Consumables", k[0], k[1]] : k ? ["Consumables", k] : ["Consumables", "Other"]; }
    case "Trade Goods": return ["Trade Goods", TRADE[sub] || "Other"];
    case "Ammo": return ["Ammo", sub === "Bullet" || sub === "Bullets" ? "Bullet" : "Arrow"];
    case "Recipes": return RECIPE[sub] ? ["Recipes", sub] : ["Recipes"];
    case "Quest Items": return ["Quest Items"];
    case "Gems": return ["Gems"];
    case "Miscellaneous": return ["Miscellaneous", MISC[sub] || "Other"];
  }
  return null;
}
// Sökväg -> index [topp, under, under-under] (-1 där nivån saknas). Okända namn under en topp läggs till sist.
const treeIdx = TREE.map(([name, subs]) => [name, subs.map(([sn, subsub]) => [sn, subsub.slice()])]);
function idxOf(pth) {
  if (!pth) return [-1, -1, -1];
  let ti = treeIdx.findIndex(x => x[0] === pth[0]);
  if (ti < 0) return [-1, -1, -1];
  if (pth.length < 2) return [ti, -1, -1];
  let si = treeIdx[ti][1].findIndex(x => x[0] === pth[1]);
  if (si < 0) si = treeIdx[ti][1].push([pth[1], []]) - 1;
  if (pth.length < 3) return [ti, si, -1];
  let ui = treeIdx[ti][1][si][1].indexOf(pth[2]);
  if (ui < 0) ui = treeIdx[ti][1][si][1].push(pth[2]) - 1;
  return [ti, si, ui];
}

// --- varorna i senaste scannen ---
const N = scans.length;
const items = [];
const extra = {};   // id -> { gear, usual, best } (läggs sist på raden, efter dygnshandeln)
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
for (const id of Object.keys(latest.items)) {
  const [min, qty] = latest.items[id];
  if (!(min > 0)) continue;
  const mh = new Array(N).fill(0), qh = new Array(N).fill(0), ph = new Array(N).fill(0);
  scans.forEach((s, i) => { const v = s.items[id]; if (v) { mh[i] = v[0] || 0; qh[i] = v[1] || 0; } });
  (p20h[id] || []).forEach((v, i) => { if (v) ph[i] = v; });
  const d = latest.api ? { n: qty } : (depthNow[id] || {});   // timsnapshot: antalet är exakt
  const pth = pathOf(id);
  const st = steps[id];
  // Gear = inte stapelbart: addonets stapel (ahItems), annars Blizzards is_stackable, annars scannens stapel, annars
  // kategorin (vapen, rustning, recept och väskor säljs styckvis).
  const bm = bmeta[id];
  const gear = stackOf[id] ? stackOf[id] === 1
    : bm && !bm.miss ? !bm.st
    : st && st.src === "scan" && st.stack ? st.stack === 1
    : !!(pth && ["Weapons", "Armor", "Recipes", "Containers"].includes(pth[0]));
  // Riktpris per scan: ur prisstegen när scannen har dem. Äldre scans har bara lägsta pris: det används, utom när det
  // ligger långt under snittet för 20 st (då snittet) eller långt under samma varas pris i scans runt omkring (då hoppas
  // scannen över, 0). Gear: lägsta pris rakt av.
  const rh = new Array(N).fill(0);
  let lo = 0, loN = 0, fullNow = false;
  for (let i = 0; i < N; i++) {
    if (scans[i].api) {   // timsnapshot: riktpriset är redan räknat (hamta-blizzard.js, samma regel)
      const a = scans[i].api[id];
      if (a) { rh[i] = a[0]; if (i === N - 1) { fullNow = true; if (a[1]) { lo = mh[i]; loN = a[1]; } } }
      continue;
    }
    const fa = fullAt[i] && fullAt[i].full[id];
    const f = fa ? parseFull(fa) : null;
    if (f && f.steg.length) {
      const rk = gear ? { price: f.steg[0][0], drop: 0, low: f.steg[0][0] } : riktOf(f.steg, f.total);
      rh[i] = rk.price;
      if (i === N - 1) { fullNow = true; if (rk.drop) { lo = rk.low; loN = rk.drop; } }
      continue;
    }
    if (!(mh[i] > 0)) continue;
    if (gear) { rh[i] = mh[i]; continue; }
    if (ph[i] > 0) { rh[i] = mh[i] < ph[i] * 0.7 ? ph[i] : mh[i]; continue; }
    const near = [];
    for (let j = 0; j < N; j++) if (j !== i && mh[j] > 0 && Math.abs(scans[j].t - scans[i].t) <= 36 * 3600) near.push(mh[j]);
    rh[i] = near.length >= 2 && mh[i] < median(near) * 0.6 ? 0 : mh[i];
  }
  let rikt = rh[N - 1];
  for (let i = N - 1; !(rikt > 0) && i >= 0; i--) rikt = rh[i];
  if (!(rikt > 0)) rikt = min;
  if (!fullNow && !gear && min < rikt) lo = min;   // senaste scannen utan prissteg: lägsta priset räknades bort
  extra[id] = { gear: gear ? 1 : 0, usual: 0, best: 0 };
  items.push([+id, names[id] || "", quality[id] === undefined ? -1 : quality[id], rikt, qty || 0, lo, loN,
    d.n || 0, perDay[id] || 0, rh, qh, [], icon[id] || "", ...idxOf(pth), level[id] || 0]);
}
items.sort((a, b) => (b[8] - a[8]) || (b[4] - a[4]));
// Billigt just nu: riktpriset nu mot medianen av riktpriset de senaste 3 dygnens scans (en vecka blev för lång när hela
// marknaden faller, första veckan på servern). Index 17 = procent under medianen (positivt = billigare än vanligt), 20 =
// medianen (det vanliga priset). Riktpriset räknar redan bort ensamma billiga listningar (REGELBOK, Joakim 2026-11-13).
// Kräver minst 20 ute och minst 4 tidigare scans. Gear får ingen procent.
const weekAgo = latest.t - 3 * 86400;   // (namnet kvar: fönstret bakåt)
for (const r of items) {
  const rh = r[9], prev = [], x = extra[r[0]];
  for (let i = 0; i < N - 1; i++) if (rh[i] > 0 && scans[i].t >= weekAgo) prev.push(rh[i]);
  let dip = 0;
  if (!x.gear && prev.length >= 4 && r[4] >= 20 && r[3] > 0) {
    const med = median(prev);
    if (med > 0) { dip = Math.round((1 - r[3] / med) * 100); x.usual = Math.round(med); }
  }
  r.push(dip);
}
const cats = treeIdx;   // [[topp, [[under, [under-under, ...]], ...]], ...]; varje vara har index 13, 14, 15 (-1 = saknas)
// Dygnshandeln: samma regler som addonets Trading. Per dag morgon (05–12) och kväll (17–24), riktpriset i blocket. Par A = köp morgon, sälj samma kväll;
// B = köp kväll, sälj nästa morgon. Vinst = sälj × 0,95 − köp. Mönster = vinst minst 10 % av köpet minst 3 dagar och i
// alla utom högst en, de senaste 7 dagarna, och minst 50 ute just nu; spikdagar och det pågående blocket räknas inte; vinsten som visas är den sämsta vinstdagens (inga gissningar).
// Index 18 = vinst per st i koppar (0 = inget mönster), 19 = 1 för A (morgon→kväll), 2 för B (kväll→morgon).
const blockOf = ts => { const h = new Date(ts * 1000).getHours(); return h >= 5 && h < 12 ? "m" : h >= 17 ? "e" : null; };
const dayOf = ts => { const d = new Date(ts * 1000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const nextDayKey = k => { const d = new Date(Math.floor(k / 10000), Math.floor(k / 100 % 100) - 1, k % 100 + 1, 12); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const weekFrom = latest.t - 7 * 86400;
const todayKey = dayOf(latest.t), curBlock = blockOf(latest.t);   // blocket scannen gjordes i är inte slut: dess par räknas inte (som addonet)
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
for (const r of items) {
  const rh = r[9], days = {};
  for (let i = 0; i < N; i++) {
    if (!(rh[i] > 0) || scans[i].t < weekFrom) continue;
    const b = blockOf(scans[i].t);
    if (!b) continue;
    const k = dayOf(scans[i].t);
    const dd = days[k] || (days[k] = { m: [], e: [] });
    dd[b].push(rh[i]);
  }
  const pair = (buyD, buyB, sellD, sellB) => {
    const buy = buyD ? avg(buyD[buyB]) : 0, sell = sellD ? avg(sellD[sellB]) : 0;
    if (!buy || !sell) return null;
    return { buy, g: sell * 0.95 - buy };
  };
  const pairs = { A: [], B: [] };
  for (const k of Object.keys(days)) {
    const pa = pair(days[k], "m", days[k], "e");
    if (pa && !(+k === todayKey && curBlock === "e")) pairs.A.push(pa);
    const nk = nextDayKey(+k);
    const pb = pair(days[k], "e", days[nk], "m");
    if (pb && !(nk === todayKey && curBlock === "m")) pairs.B.push(pb);
  }
  let best = { g: 0, dir: 0 };
  for (const dir of r[4] >= 50 ? ["A", "B"] : []) {   // minst 50 ute, som addonets Trading: annars är det en ensam listning som "svänger"
    // Spikdagar bort (vinst över 3 × medianen av de andra dagarnas), som addonet: en engångsspik ger aldrig "3/3".
    const t = pairs[dir].filter((x, i, all) => { const mo = median(all.filter((_, j) => j !== i).map(y => y.g)); return !(mo > 0 && x.g > 3 * mo); });
    const ok = t.filter(x => x.g >= x.buy * 0.10);
    if (ok.length >= 3 && ok.length >= t.length - 1) {
      const worst = Math.min(...ok.map(x => x.g));
      if (worst > best.g) best = { g: worst, dir: dir === "A" ? 1 : 2 };
    }
  }
  r.push(Math.round(best.g), best.dir);
}

// Bästa tid att köpa och sälja (Joakim 2026-11-16). Scannerna är för glesa för en exakt timme, så dygnet delas i fyra
// block: 0 natt (00–05), 1 morgon (05–12), 2 eftermiddag (12–17), 3 kväll (17–24). Per dag jämförs blockens riktpris med
// dagens snitt (så en vecka då hela marknaden faller inte styr), och sedan tas medianen per block över de senaste 7
// dagarna. Ett block behöver minst 3 dagar. Köp = billigaste blocket, sälj = dyraste. Vinst i procent efter AH:s 5 %, och
// hur många dagar (av de dagar båda blocken scannats) det faktiskt gick plus. Bara stapelbart med minst 50 ute.
// Index 22 = [köpblock, säljblock, vinst %, dagar plus, dagar] eller 0.
const block4 = ts => { const h = new Date(ts * 1000).getHours(); return h < 5 ? 0 : h < 12 ? 1 : h < 17 ? 2 : 3; };
for (const r of items) {
  const x = extra[r[0]], rh = r[9];
  if (x.gear || r[4] < 50) continue;
  const days = {};
  for (let i = 0; i < N; i++) {
    if (!(rh[i] > 0) || scans[i].t < weekFrom) continue;
    const k = dayOf(scans[i].t), b = block4(scans[i].t);
    ((days[k] = days[k] || [[], [], [], []])[b]).push(rh[i]);
  }
  const rel = [[], [], [], []], perDay = [];
  for (const k of Object.keys(days)) {
    const bl = days[k].map(a => avg(a));
    const have = bl.filter(v => v > 0);
    if (have.length < 2) continue;
    const mean = avg(have);
    bl.forEach((v, b) => { if (v > 0) rel[b].push(v / mean); });
    perDay.push(bl);
  }
  const med = rel.map(a => a.length >= 3 ? median(a) : 0);
  let buy = -1, sell = -1;
  med.forEach((v, b) => { if (v > 0 && (buy < 0 || v < med[buy])) buy = b; if (v > 0 && (sell < 0 || v > med[sell])) sell = b; });
  if (buy < 0 || sell < 0 || buy === sell) continue;
  const gain = Math.round((med[sell] * 0.95 / med[buy] - 1) * 100);
  let ok = 0, n = 0;
  for (const bl of perDay) if (bl[buy] > 0 && bl[sell] > 0) { n++; if (bl[sell] * 0.95 > bl[buy]) ok++; }
  if (n >= 3) x.best = [buy, sell, gain, ok, n];
}
for (const r of items) { const x = extra[r[0]]; r.push(x.usual, x.gear, x.best, sellPrice[r[0]] || 0); }

// Historiken (riktpris och antal per scan) ligger inte på raden (med en scan i timmen blev data.json 20 gånger större)
// utan i dagsfiler: publik/hist/<hus>/<ÅÅÅÅMMDD>/<id % 100>.json = { t: [scantider], i: { [id]: [[riktpris...], [antal...]] } }.
// Sidan hämtar de dagar grafen visar. På raden ligger bara en veckograf: 14 värden, två per dag (00–12 och 12–24) de
// senaste 7 dagarna, snitt av riktpriset (0 = ingen scan).
const HIST = path.join(PUB_DIR, "hist", String(HOUSE));
const byDay = {};
scans.forEach((sc, i) => { const k = dayOf(sc.t); (byDay[k] = byDay[k] || []).push(i); });
const days = Object.keys(byDay).map(Number).sort((a, b) => a - b);
fs.mkdirSync(HIST, { recursive: true });
for (const f of fs.readdirSync(HIST)) if (/^\d{8}$/.test(f) && !byDay[+f]) fs.rmSync(path.join(HIST, f), { recursive: true, force: true });
for (const k of days) {
  const idx = byDay[k], dir = path.join(HIST, String(k));
  fs.mkdirSync(dir, { recursive: true });
  const buckets = Array.from({ length: 100 }, () => ({ t: idx.map(i => scans[i].t), i: {} }));
  for (const r of items) {
    const rh = r[9], qh = r[10];
    if (!idx.some(i => rh[i] > 0 || qh[i] > 0)) continue;
    buckets[r[0] % 100].i[r[0]] = [idx.map(i => rh[i] || 0), idx.map(i => qh[i] || 0)];
  }
  buckets.forEach((b, i) => fs.writeFileSync(path.join(dir, i + ".json"), JSON.stringify(b)));
}
const todayStart = (() => { const d = new Date(latest.t * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; })();
for (const r of items) {
  const rh = r[9], sp = new Array(14).fill(0), cnt = new Array(14).fill(0);
  for (let i = 0; i < N; i++) {
    if (!(rh[i] > 0)) continue;
    const slot = Math.floor((scans[i].t - (todayStart - 6 * 86400)) / 43200);   // 12-timmarsrutor från 6 dagar bakåt
    if (slot < 0 || slot > 13) continue;
    sp[slot] += rh[i]; cnt[slot]++;
  }
  r[9] = sp.map((v, i) => cnt[i] ? Math.round(v / cnt[i]) : 0);
  r[10] = 0; r[11] = 0;
}

const out = {
  made: Math.floor(Date.now() / 1000),
  t: latest.t,
  src: latest.api ? "api" : "scan",   // senaste: Blizzards timsnapshot eller egen scan
  house: HOUSE, market: MARKETS[HOUSE], markets: (() => {   // bara marknader som har data (sidans väljare)
    const o = {};
    for (const m of MK.LIST) { if (m.hidden) continue; const d = path.join(API_DIR, String(m.key)); if (m.key === HOUSE || (fs.existsSync(d) && fs.readdirSync(d).some(x => x.endsWith(".jsonl")))) o[m.key] = m.name; }
    return o;
  })(),
  days,   // dagar med historik (publik/hist/<hus>/<dag>/<id % 100>.json)
  named: items.filter(r => r[1]).length,
  fullScan: fullInfo ? { t: fullInfo.t, n: fullInfo.n || 0 } : null,
  cats,   // kategoriträdet som AH i Forever, se ovan
  // rad: [id, namn, kvalitet (-1 okänd), riktpris (gear: lägsta pris), antal ute (dagens högsta), billigaste priset om det
  //       räknades bort (0 = nej), hur många st som räknades bort (0 = okänt eller nej), ute nu (exakt), sålda/dag
  //       (uppskattning ur timdatan), veckograf (14 värden, se ovan), 0, 0 (förr serier per scan), ikonens namn (fil i icons/),
  //       kategori, underkategori, under-underkategori, nivåkrav (0 = inget), dipp i procent mot de senaste dagarnas
  //       median (0 = ingen eller för lite underlag), dygnshandel: vinst per st i koppar (0 = inget mönster), riktning
  //       (1 = köp morgon sälj kväll, 2 = köp kväll sälj morgon), vanligt pris (medianen dippen räknas mot, 0 = inget),
  //       gear (1 = inte stapelbart: ingen procent eller riktpris), bästa tid [köpblock, säljblock, vinst %, dagar plus, dagar] eller 0,
  //       handlarpris i koppar (0 = okänt)]
  items,
  // Kartknappen på AH-raden (Joakim 2026-11-21): föremål → åder/ört där det är huvudfyndet (nodes.json, hamta-noder.js),
  // flest spawns vinner (Silver Ore → Silver Vein, inte Ooze Covered). { item: [nod-id, namn] }
  nodeIx: (() => {
    const o = {};
    try {
      for (const nd of JSON.parse(fs.readFileSync(path.join(__dirname, "nodes.json"), "utf8")).nodes) {
        const l = nd.loot[0];
        if (!l || l[1] < 99 || !nd.n) continue;
        if (!o[l[0]] || o[l[0]][2] < nd.n) o[l[0]] = [nd.id, nd.name, nd.n];
      }
    } catch (e) { /* utan nodes.json: inga knappar */ }
    for (const k of Object.keys(o)) o[k] = o[k].slice(0, 2);
    return o;
  })(),
  // Prissteg bara för varor i listan och bara fälten sidan läser (t, steg, src, sellers): döda steg från gamla scans och
  // total/stack/tid (oanvända) gjorde data.json 1 MB större (granskning 2026-11-18).
  steps: (function () {
    const keep = new Set(items.map(r => String(r[0]))), o = {};
    for (const [id, st] of Object.entries(steps)) if (keep.has(id)) o[id] = st.sellers ? { t: st.t, steg: st.steg, src: st.src, sellers: st.sellers } : { t: st.t, steg: st.steg, src: st.src };
    return o;
  })(),
};
fs.writeFileSync(OUT, JSON.stringify(out));
// Guld i omlopp (Joakim 2026-11-18): per hus och dag – värdet av allt som ligger ute (riktpris × antal), uppskattad
// omsättning per dygn (sålda/dag × riktpris), antal listningar och varor. publik/ekonomi.json växer en punkt per dag
// och hus (senaste 90 dagarna); filen ligger i sidrepot så molnet och datorn bygger vidare på samma serie.
try {
  const EKO = path.join(PUB_DIR, "ekonomi.json");
  const eko = fs.existsSync(EKO) ? JSON.parse(fs.readFileSync(EKO, "utf8")) : { houses: {} };
  let listed = 0, turn = 0, nL = 0, nI = 0;
  // Bara namngivna stapelbara varor med rimligt riktpris (en namnlös vara med 10 miljoner guld i riktpris förstörde summan)
  for (const r of items) { if (!(r[3] > 0) || r[21] === 1 || !r[1] || r[3] > 1e8) continue; const q = r[7] || r[4] || 0; listed += r[3] * q; turn += (r[8] || 0) * r[3]; nL += q; nI++; }
  const day = new Date((out.t || Date.now() / 1000) * 1000).toISOString().slice(0, 10);
  const hs = eko.houses[HOUSE] = eko.houses[HOUSE] || [];
  const pt = [day, Math.round(listed), Math.round(turn), nL, nI];
  const i = hs.findIndex(p => p[0] === day);
  if (i >= 0) hs[i] = pt; else hs.push(pt);
  hs.sort((x, y) => x[0] < y[0] ? -1 : 1);
  eko.houses[HOUSE] = hs.slice(-90);
  eko.t = Date.now();
  fs.writeFileSync(EKO, JSON.stringify(eko));
  console.log("ekonomi.json: hus " + HOUSE + " " + day + ": " + Math.round(listed / 1e4) + "g ute, " + Math.round(turn / 1e4) + "g/dygn");
} catch (e) { console.log("ekonomi.json hoppades över: " + e.message); }
fs.mkdirSync(PUB_DIR, { recursive: true });
fs.copyFileSync(OUT, path.join(PUB_DIR, path.basename(OUT)));
// News och Blue posts till startsidan ur Blizzards forum (hamta-nyheter.js). Bara huvudmarknaden och högst var 10:e minut,
// molnet kör build.js en gång per marknad. Ett fel här stoppar aldrig bygget.
if (MAIN && fs.existsSync(path.join(__dirname, "hamta-nyheter.js"))) try {
  const nf = path.join(PUB_DIR, "news.json");
  // Tiden inne i filen, inte filens datum: molnet checkar ut news.json på nytt vid varje bygge (då ser den alltid ny ut)
  let nt = 0; try { nt = JSON.parse(fs.readFileSync(nf, "utf8")).t || 0; } catch (e) {}
  if (Date.now() - nt > 10 * 60e3)
    console.log(require("child_process").execFileSync(process.execPath, [path.join(__dirname, "hamta-nyheter.js"), PUB_DIR], { encoding: "utf8", timeout: 90e3 }).trim());
} catch (e) { console.log("news hoppades över: " + String(e.message).slice(0, 120)); }
if (fs.existsSync(path.join(__dirname, "recept.json"))) fs.copyFileSync(path.join(__dirname, "recept.json"), path.join(PUB_DIR, "recept.json"));   // Crafting-fliken (recept-db.js)
if (fs.existsSync(path.join(__dirname, "forever-recept.json"))) fs.copyFileSync(path.join(__dirname, "forever-recept.json"), path.join(PUB_DIR, "forever-recept.json"));   // Armory: kända recept (hamta-forever-recept.js)
// Quests (hamta-forever-quests.js) och Dungeons (dungeon-db.js) med questtexterna i quest-text/<id % 50>.json.
for (const f of ["quests.json", "dungeons.json", "item-icons.json", "atlasloot-forever.json", "talents.json", "hunter.json", "collections.json", "disenchant.json", "suffix.json", "classes.json", "boss-abilities.json", "nodes.json", "skillup.json", "fishing.json", "klassguide.json", "farm.json", "item-ilvl.json", "sets.json"]) if (fs.existsSync(path.join(__dirname, f))) fs.copyFileSync(path.join(__dirname, f), path.join(PUB_DIR, f));
// 3D-modeller (modeller/krymp.js → publik/assets/models/<displayId>.glb, models.json): djur med modell får m3 = höjd,
// så sidan visar 3D-knappen bara där det finns något att visa.
if (fs.existsSync(path.join(__dirname, "models.json")) && fs.existsSync(path.join(__dirname, "hunter.json"))) {
  const M3 = JSON.parse(fs.readFileSync(path.join(__dirname, "models.json"), "utf8"));
  const H = JSON.parse(fs.readFileSync(path.join(__dirname, "hunter.json"), "utf8"));
  // Forevers egna djur (hunter-forever.json, manuell: Felblood Scar-katten m.fl.) läggs till om de inte redan finns.
  if (fs.existsSync(path.join(__dirname, "hunter-forever.json"))) { const FV = JSON.parse(fs.readFileSync(path.join(__dirname, "hunter-forever.json"), "utf8")).beasts || []; const have = new Set(H.beasts.map(x => x.id)); for (const x of FV) if (!have.has(x.id)) H.beasts.push(x); console.log("Forever-djur:", FV.length); }
  let n = 0;
  for (const b of H.beasts) { delete b.m3; if (b.disp && M3[b.disp]) { b.m3 = M3[b.disp][1] || 1; n++; } }
  // Skinning (hamta-skinning.js): b.skin = [[item, chans %, min, max]], namnen för föremål utanför AH i H.skinItems.
  let ns = 0;
  if (fs.existsSync(path.join(__dirname, "skinning.json"))) {
    const S = JSON.parse(fs.readFileSync(path.join(__dirname, "skinning.json"), "utf8"));
    for (const b of H.beasts) { delete b.skin; if (S.beasts[b.id]) { b.skin = S.beasts[b.id]; ns++; } }
    H.skinItems = S.items;
  }
  fs.writeFileSync(path.join(PUB_DIR, "hunter.json"), JSON.stringify(H));
  console.log("3D:", n, "djur med modell;", ns, "djur med skinning");
}
// Bossarna i Dungeons: 3D-höjd (m3) när modellen finns, som djuren.
if (fs.existsSync(path.join(__dirname, "models.json")) && fs.existsSync(path.join(__dirname, "dungeons.json"))) {
  const M3 = JSON.parse(fs.readFileSync(path.join(__dirname, "models.json"), "utf8"));
  const G = JSON.parse(fs.readFileSync(path.join(__dirname, "dungeons.json"), "utf8"));
  let n = 0;
  for (const d of G.dungeons) for (const b of d.bosses) { delete b.m3; if (b.disp && M3[b.disp]) { b.m3 = M3[b.disp][1] || 1; n++; } }
  fs.writeFileSync(path.join(PUB_DIR, "dungeons.json"), JSON.stringify(G));
  console.log("3D:", n, "bossar med modell");
}
if (fs.existsSync(path.join(__dirname, "models.json")) && fs.existsSync(path.join(__dirname, "collections.json"))) {
  const M3 = JSON.parse(fs.readFileSync(path.join(__dirname, "models.json"), "utf8"));
  const C = JSON.parse(fs.readFileSync(path.join(__dirname, "collections.json"), "utf8"));
  let n = 0;
  for (const m of C.mounts || []) { delete m.m3; const d = +(((m.img || "").match(/display-(\d+)/) || [])[1] || 0); if (d && M3[d]) { m.m3 = M3[d][1] || 1; n++; } }
  fs.writeFileSync(path.join(PUB_DIR, "collections.json"), JSON.stringify(C));
  console.log("3D:", n, "mounts med modell");
}
// Topplistornas katalog (hamta-katalog.js): molnets i AH_KATALOG_FILE eller filen här.
{
  // Den med flest spelare vinner (molnets dygnskörning slår ihop båda, så den är normalt störst).
  const n = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")).players.length; } catch (e) { return -1; } };
  // api/meta/katalog.json = molnets katalog synkad till datorn (synka.js): annars publicerade datorn en gammal katalog (2026-11-28)
  const cands = [process.env.AH_KATALOG_FILE, path.join(__dirname, "api", "meta", "katalog.json"), path.join(__dirname, "katalog.json")].filter(f => f && fs.existsSync(f));
  const nn = new Map(cands.map(f => [f, n(f)]));   // läs varje kandidat en gång, inte en gång per jämförelse
  const kf = cands.sort((a, b) => nn.get(b) - nn.get(a))[0];
  // Sidans kopia utan fälten bara snöbollen behöver (senaste inloggning, hämtad, sedd; ras behålls): 9 MB → ca 6 MB (granskning 2026-11-18).
  if (kf) {
    const k = JSON.parse(fs.readFileSync(kf, "utf8"));
    for (const p of k.players) {
      if (p.t60 && !p.u60 && k.start && p.t60 > k.start) p.t60 = k.start;   // 60-datum bara när katalogen sett spelaren under 60 (hamta-katalog.js)
      delete p.last; delete p.got; delete p.seen; delete p.u60;   // p.r (ras) och p.ge behålls: ras-kolumnen i topplistorna (Joakim 2026-11-19)
    }
    delete k.miss;   // 404-minnet är bara för hamta-katalog.js
    fs.writeFileSync(path.join(PUB_DIR, "katalog.json"), JSON.stringify(k));
  }
}
// NPC-sidorna (hamta-questplatser.js): npc/<id % 50>.json, laddas när en NPC öppnas.
if (fs.existsSync(path.join(__dirname, "npc"))) {
  fs.mkdirSync(path.join(PUB_DIR, "npc"), { recursive: true });
  // 3D (modeller/krymp.js): NPC med modell får höjden som index 12, så sidan visar 3D-knappen.
  const M3N = fs.existsSync(path.join(__dirname, "models.json")) ? JSON.parse(fs.readFileSync(path.join(__dirname, "models.json"), "utf8")) : {};
  let n3 = 0;
  const sokNpc = [];
  for (const f of fs.readdirSync(path.join(__dirname, "npc"))) {
    const o = JSON.parse(fs.readFileSync(path.join(__dirname, "npc", f), "utf8"));
    for (const v of Object.values(o)) { v.length = Math.min(v.length, 12); if (v[11] && M3N[v[11]]) { v[12] = M3N[v[11]][1] || 1; n3++; } }
    fs.writeFileSync(path.join(PUB_DIR, "npc", f), JSON.stringify(o));
    for (const [id, v] of Object.entries(o)) sokNpc.push([+id, v[0], v[1] || "", v[2] || 0, v[4] || 0, v[11] || 0]);   // 4: rank (1 elite, 2 rare, 4 rare-elite) till drakramen i sökrutan
  }
  // Namnindex till sökrutan (Sök överallt): [id, namn, titel, minlevel], laddas vid första sökningen.
  sokNpc.sort((x, y) => x[1].localeCompare(y[1]));
  fs.writeFileSync(path.join(PUB_DIR, "sok-npc.json"), JSON.stringify(sokNpc));
  console.log("3D:", n3, "NPC:er med modell; sok-npc.json:", sokNpc.length, "namn");
}
// Questkartan (hamta-questplatser.js): var givare, mål och inlämning finns, laddas när en quest öppnas.
if (fs.existsSync(path.join(__dirname, "questmap"))) {
  fs.mkdirSync(path.join(PUB_DIR, "questmap"), { recursive: true });
  for (const f of fs.readdirSync(path.join(__dirname, "questmap"))) fs.copyFileSync(path.join(__dirname, "questmap", f), path.join(PUB_DIR, "questmap", f));
}
// Var föremålen finns (hamta-varukallor.js): kallor/<id % 100>.json, laddas när ett föremål öppnas.
if (fs.existsSync(path.join(__dirname, "kallor"))) {
  fs.mkdirSync(path.join(PUB_DIR, "kallor"), { recursive: true });
  for (const f of fs.readdirSync(path.join(__dirname, "kallor"))) fs.copyFileSync(path.join(__dirname, "kallor", f), path.join(PUB_DIR, "kallor", f));
}
// Zonsidorna (hamta-zoner.js, Joakim 2026-11-27): zoner/<zon>.json och index.json, laddas när en zon öppnas. Molnet har
// inte mappen och rör den inte, så det som publicerats härifrån ligger kvar i repot.
if (fs.existsSync(path.join(__dirname, "zoner"))) {
  fs.mkdirSync(path.join(PUB_DIR, "zoner"), { recursive: true });
  for (const f of fs.readdirSync(path.join(__dirname, "zoner"))) fs.copyFileSync(path.join(__dirname, "zoner", f), path.join(PUB_DIR, "zoner", f));
}
if (fs.existsSync(path.join(__dirname, "quest-text"))) {
  fs.mkdirSync(path.join(PUB_DIR, "quest-text"), { recursive: true });
  for (const f of fs.readdirSync(path.join(__dirname, "quest-text"))) fs.copyFileSync(path.join(__dirname, "quest-text", f), path.join(PUB_DIR, "quest-text", f));
}
if (!MAIN) {
  console.log(path.basename(OUT) + ": " + (fs.statSync(OUT).size / 1024).toFixed(0) + " kB, " + items.length + " varor, " + days.length + " dagar historik");
  process.exit(0);
}

// Fristående kopia för en vanlig webbplats (GitHub Pages): publik/index.html är hela dokumentet runt samma innehåll som
// artifact-sidan (index.html har inget <html>/<head>, det lägger Claude till vid publicering), plus samma data.json.
const ICON_LOCAL = `var ICON_BASE = "";`;
function withIcons(html, base) {
  if (!html.includes(ICON_LOCAL)) throw new Error("index.html: hittar inte ICON_BASE");
  return html.replace(ICON_LOCAL, `var ICON_BASE = "${base}";`);
}
const PUB = PUB_DIR;

// Tooltipen som i spelet (Joakim 2026-11-15: "den klassiska tooltipen"). Sedan 2026-11-16 ur spelets egna tooltipdata
// (addonets ahTips): rad för rad, vänster och höger, med spelets färger; handlarpriset läggs till ur ahItems/Blizzard.
// Sparas i 100 filer (id % 100) så sidan bara hämtar en liten fil när musen hamnar på en vara, inte allt på en gång.
// Reserv tills addonet fyllt på: de gamla Wowhead-tooltiparna (tooltips.json, bara läst), rensade som förut.
const escT = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function colorText(t) {   // |cffRRGGBB … |r → span med färg (bara giltiga hexfärger släpps igenom)
  const re = /\|c[0-9a-fA-F]{8}|\|r/g;
  let out = "", last = 0, open = false, m;
  while ((m = re.exec(t))) {
    out += escT(t.slice(last, m.index));
    last = re.lastIndex;
    if (m[0] === "|r") { if (open) { out += "</span>"; open = false; } }
    else { if (open) out += "</span>"; out += '<span style="color:#' + m[0].slice(4).toLowerCase() + '">'; open = true; }
  }
  out += escT(t.slice(last));
  return open ? out + "</span>" : out;
}
function moneyHtml(c) {
  c = Math.round(c);
  const g = Math.floor(c / 10000), sv = Math.floor(c % 10000 / 100), k = c % 100, o = [];
  if (g) o.push('<span class="moneygold">' + g + "</span>");
  if (sv || g) o.push('<span class="moneysilver">' + sv + "</span>");
  o.push('<span class="moneycopper">' + k + "</span>");
  return o.join(" ");
}
function gameTip(str, sp) {
  // Transmog-samlingen gäller kontot som läste, inte varan (äldre rader från före addonets fv 2).
  const ln = str.split("\n").filter(line => !/collected this appearance|collected the appearance|appearance from another item/i.test(line));
  let html = "";
  ln.forEach((line, i) => {
    const [l, r] = line.split("\t");
    if (i === 0) html += '<div class="ln"><b>' + colorText(l || "") + "</b></div>";
    else html += '<div class="ln"><span>' + colorText(l || "") + "</span>" + (r ? '<span class="r">' + colorText(r) + "</span>" : "") + "</div>";
  });
  if (sp > 0) html += '<div class="ln"><span>Sell Price: ' + moneyHtml(sp) + "</span></div>";
  return html;
}
const TIP_TAGS = new Set(["table", "tbody", "tr", "td", "th", "b", "br", "span", "div", "small", "i"]);
function cleanTip(h) {
  h = String(h || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");
  const txt = t => t.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&(?![a-zA-Z]+;|#\d+;)/g, "&amp;").replace(/[\r\n]+/g, "");
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/g;
  let out = "", last = 0, m;
  while ((m = re.exec(h))) {
    out += txt(h.slice(last, m.index));
    last = re.lastIndex;
    let name = m[2].toLowerCase();
    if (name === "a") name = "span";   // länkar (t.ex. besvärjelser) blir vanlig text
    if (!TIP_TAGS.has(name)) continue;
    if (m[1]) { if (name !== "br") out += "</" + name + ">"; continue; }
    const c = /\bclass="([a-zA-Z0-9 _-]*)"/.exec(m[3]);
    out += "<" + name + (c ? ' class="' + c[1] + '"' : "") + (name === "table" && /width="100%"/.test(m[3]) ? ' width="100%"' : "") + ">";
  }
  return out + txt(h.slice(last));
}
{
  const TIPS = path.join(__dirname, "tooltips.json");
  const raw = fs.existsSync(TIPS) ? JSON.parse(fs.readFileSync(TIPS, "utf8")) : {};
  const TIPDIR = path.join(PUB, "tips");
  fs.mkdirSync(TIPDIR, { recursive: true });
  const buckets = Array.from({ length: 100 }, () => ({}));
  let n = 0;
  let nGame = 0;
  for (const r of items) {
    const g = gameTips[r[0]];
    if (g) { buckets[r[0] % 100][r[0]] = gameTip(g, sellPrice[r[0]] || 0); n++; nGame++; continue; }
    const h = raw[r[0]];
    if (h) { buckets[r[0] % 100][r[0]] = cleanTip(h); n++; }
  }
  // Föremål som inte finns på AH men som addonet läst tooltip för (ExtraTipIds.lua: Dungeons- och Quests-flikarnas
  // föremål, även nya Forever-föremål som Blizzards API döljer): samma tooltip, och kvaliteten ur namnradens färg
  // till game-quality.json { id: kvalitet } så sidan kan färga namnet innan musen hamnar på det.
  const QCOL = { "9d9d9d": 0, "1eff00": 2, "0070dd": 3, "0070de": 3, "a335ee": 4, "ff8000": 5, "e6cc80": 6 };
  const inAh = new Set(items.map(r => String(r[0]))), gq = {};
  let nExtra = 0;
  for (const [id, g] of Object.entries(gameTips)) {
    if (inAh.has(id)) continue;
    buckets[id % 100][id] = gameTip(g, sellPrice[id] || 0); nExtra++;
    const c = /^\|c[0-9a-fA-F]{2}([0-9a-fA-F]{6})/.exec(g.split("\n")[0] || "");
    gq[id] = c ? (QCOL[c[1].toLowerCase()] ?? 1) : 1;
  }
  fs.writeFileSync(path.join(PUB, "game-quality.json"), JSON.stringify(gq));
  buckets.forEach((b, i) => fs.writeFileSync(path.join(TIPDIR, i + ".json"), JSON.stringify(b)));
  console.log("tips: " + n + " varor med tooltip (" + nGame + " från spelet, " + (n - nGame) + " gammal reserv), " + nExtra + " utanför AH (dungeons/quests)");
}
// gear.json till Armorys "Upgrade gear" (Joakim 2026-11-17): varje rustning och vapen på AH med plats, typ, nivåkrav och
// stats, tolkade ur spelets egen tooltip (ahTips). Föremål med "<Random additional stats>" (… of the Monkey) har samma
// id för alla varianter: de får r = 1 och sidan uppskattar statsen ur rb = median stats per nivå för gröna föremål med
// fasta stats på samma plats. { t, rb: { plats: tal }, items: { id: [plats, typ, nivåkrav, { stat: värde }, r, krav, klasser] } }
{
  // En "Equip:"-rad till stats. Samma regler som equipStat i index.html (föremålen karaktären har på sig), håll dem lika.
  const equipStat = (e, add) => {
    let m;
    if ((m = /healing done by up to (\d+) and damage done by up to (\d+)/i.exec(e))) { add("heal", +m[1]); add("sp", +m[2]); }
    else if ((m = /damage and healing done by magical spells and effects by up to (\d+)/i.exec(e))) add("sp", +m[1]);
    else if ((m = /healing done by (?:magical )?spells and effects by up to (\d+)/i.exec(e))) add("heal", +m[1]);
    else if ((m = /damage done by magical spells and effects by up to (\d+)/i.exec(e))) add("sp", +m[1]);
    else if ((m = /damage done by (Shadow|Fire|Frost|Nature|Arcane|Holy) spells and effects by up to (\d+)/i.exec(e))) add("sp_" + m[1].toLowerCase(), +m[2]);
    else if ((m = /critical strike with spells by ([\d.]+)%/i.exec(e))) add("scrit", +m[1]);
    else if ((m = /critical strike by ([\d.]+)%/i.exec(e))) add("crit", +m[1]);
    else if ((m = /chance to hit with spells by ([\d.]+)%/i.exec(e))) add("shit", +m[1]);
    else if ((m = /chance to hit with ranged weapons by ([\d.]+)%/i.exec(e))) add("rhit", +m[1]);
    else if ((m = /chance to hit by ([\d.]+)%/i.exec(e))) add("hit", +m[1]);
    else if ((m = /^\+(\d+) ranged Attack Power\.?$/i.exec(e))) add("rap", +m[1]);
    else if ((m = /^\+(\d+) Attack Power\.?$/i.exec(e))) add("ap", +m[1]);
    else if ((m = /Restores (\d+) Mana per 5 sec/i.exec(e))) add("mp5", +m[1]);
    else if ((m = /Increased Defense \+(\d+)/i.exec(e))) add("def", +m[1]);
    else if ((m = /chance to Dodge an attack by ([\d.]+)%/i.exec(e))) add("dodge", +m[1]);
    else if ((m = /chance to Parry an attack by ([\d.]+)%/i.exec(e))) add("parry", +m[1]);
    else if ((m = /chance to Block attacks with a shield by ([\d.]+)%/i.exec(e))) add("block", +m[1]);
    else if ((m = /Block Value of your shield by (\d+)/i.exec(e))) add("blockv", +m[1]);
    else add("fx", 1);   // annan effekt (mot Beasts, procs, fiske …): visas som "+ effekt", räknas inte
  };
  const statsOf = tip => {
    const s = {}, add = (k, v) => { s[k] = Math.round(((s[k] || 0) + v) * 10) / 10; };
    for (const raw of tip.split("\n")) {
      const l = raw.replace(/\|c[0-9a-fA-F]{8}/g, "").replace(/\|r/g, "").split("\t")[0].trim();
      let m;
      if ((m = /^\+(\d+) (Strength|Agility|Stamina|Intellect|Spirit)$/.exec(l))) add({ Strength: "str", Agility: "agi", Stamina: "sta", Intellect: "int", Spirit: "spi" }[m[2]], +m[1]);
      else if ((m = /^(\d+) Armor$/.exec(l))) add("armor", +m[1]);
      else if ((m = /^\(([\d.]+) damage per second\)$/.exec(l))) add("dps", +m[1]);
      else if ((m = /^Block$/.exec(l))) { /* sköldens blockvärde läses nedan */ }
      else if ((m = /^(\d+) Block$/.exec(l))) add("blockv", +m[1]);
      else if (/^Equip: /.test(l)) equipStat(l.slice(7), add);
    }
    return s;
  };
  const spel = spelfil.load(), inAh = new Set(items.map(r => String(r[0]))), out = {}, per = {};
  for (const [id, str] of Object.entries(spel.ahItems || {})) {
    if (!inAh.has(id)) continue;
    const p = str.split("|"), inv = (p[4] || "").replace("INVTYPE_", "");
    if (!(p[2] === "Armor" || p[2] === "Weapon") || !inv || /NON_EQUIP|BODY|TABARD|BAG|AMMO|RELIC/.test(inv)) continue;
    const tip = gameTips[id];
    if (!tip) continue;
    const rq = /Requires Level (\d+)/.exec(tip), req = rq ? +rq[1] : (+p[6] || 0);
    // Slumpade stats: tooltipen säger det ibland ("<Random additional stats>"), annars ett grönt eller bättre föremål utan
    // några stats alls (spelet visar basföremålet utan suffix).
    const st = statsOf(tip), bare = !Object.keys(st).some(k => !/^(armor|dps|blockv)$/.test(k));
    const rnd = /<Random (additional stats|enchantment)>/.test(tip) || (+p[1] >= 2 && bare && inv !== "TRINKET" && !/Use:|Chance on hit/.test(tip)) ? 1 : 0;
    // Andra krav: yrke med nivå ("Engineering:225"), annat krav sidan inte kan kontrollera ("?"), klasslista ("Mage,Priest").
    let need = "", classes = "";
    for (const raw of tip.split("\n")) {
      const l = raw.replace(/\|c[0-9a-fA-F]{8}/g, "").split("\t")[0].trim();
      let m;
      if ((m = /^Requires ([A-Za-z ]+) \((\d+)\)$/.exec(l))) need = m[1] + ":" + m[2];
      else if (/^Requires /.test(l) && !/^Requires Level/.test(l)) need = "?";
      else if ((m = /^Classes: (.+)$/.exec(l))) classes = m[1].replace(/\s+/g, "");
    }
    out[id] = need || classes ? [inv, p[3] || "", req, st, rnd, need, classes] : [inv, p[3] || "", req, st, rnd];
    const prim = (st.str || 0) + (st.agi || 0) + (st.sta || 0) + (st.int || 0) + (st.spi || 0);
    if (!rnd && +p[1] === 2 && prim > 0 && req > 0) (per[inv] = per[inv] || []).push(prim / (req + 5));
  }
  const rb = {};
  for (const [inv, a] of Object.entries(per)) { a.sort((x, y) => x - y); rb[inv] = Math.round(a[Math.floor(a.length / 2)] * 1000) / 1000; }
  fs.writeFileSync(path.join(PUB, "gear.json"), JSON.stringify({ t: Date.now(), rb, items: out }));
  console.log("gear.json: " + Object.keys(out).length + " rustningar och vapen, " + Object.values(out).filter(x => x[4]).length + " med slumpade stats");
}
// Disenchant-loggen (Disenchant.lua, Joakim 2026-11-17) till "Worth disenchanting": per föremål hur många gånger och vad
// det gav. delog.json = { t, n, items: { id: [antal, { material: [gånger, totalt antal] }] } }. Aktiviteten (spelare per
// klocktimme och dag, SiteNames.lua) till topplistornas kurva: activity.json = { hours: { "YYYY-MM-DD HH": n }, days }.
{
  // Också per grupp (samma band som addonets SiteDisenchant.lua: kvalitet, vapen/rustning, itemlevel), så hemsidan,
  // de-lista.js och addonet väger ihop egna utfall med databasen på samma sätt och även Forevers nya föremål räknas.
  // groups: { grupp: [antal, { material: [gånger, totalt antal] }] }
  let bands = null;
  try { bands = JSON.parse(fs.readFileSync(path.join(__dirname, "disenchant.json"), "utf8")).bands; } catch (e) { bands = null; }
  const NOT_GEAR = new Set(["INVTYPE_NON_EQUIP_IGNORE", "INVTYPE_BAG", "INVTYPE_TABARD", "INVTYPE_BODY", "INVTYPE_AMMO", "INVTYPE_QUIVER"]);
  const groupOf = (q, ilvl, loc, cls) => {
    q = +q; ilvl = +ilvl; cls = +cls;
    if (!bands || !(q >= 2 && q <= 4) || !ilvl || (cls !== 2 && cls !== 4) || !loc || NOT_GEAR.has(loc)) return 0;
    const b = (bands[q] || {})[cls === 2 || loc === "INVTYPE_SHIELD" || loc === "INVTYPE_HOLDABLE" ? "w" : "a"];
    if (!b || !b.length) return 0;
    for (const [hi, g] of b) if (ilvl <= hi) return g;
    return b[b.length - 1][1];
  };
  const spel = spelfil.load(), items = {}, groups = {};
  let n = 0;
  const add = (e, out) => {
    e[0]++;
    for (const part of out.split(",")) {
      const [m, q] = part.split(":").map(Number);
      if (!m) continue;
      const x = e[1][m] = e[1][m] || [0, 0];
      x[0]++; x[1] += q || 1;
    }
  };
  for (const row of spel.deLog || []) {
    const f = String(row).split("|"), id = f[1], out = f[8] || "";
    if (!/^\d+$/.test(id || "") || !out) continue;
    n++;
    add(items[id] = items[id] || [0, {}], out);
    const g = groupOf(f[2], f[3], f[5], f[6]);
    if (g) add(groups[g] = groups[g] || [0, {}], out);
  }
  fs.writeFileSync(path.join(PUB, "delog.json"), JSON.stringify({ t: Date.now(), n, items, groups }));
  fs.writeFileSync(path.join(PUB, "activity.json"), JSON.stringify(Object.assign({ t: Date.now() }, spel.activity || { hours: {}, days: {} })));
  console.log("delog.json: " + n + " disenchants, " + Object.keys(items).length + " föremål");
}
const page = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const split = /^([\s\S]*?<\/style>)([\s\S]*)$/.exec(page);
if (!split) throw new Error("index.html: hittar inte </style>");
fs.writeFileSync(path.join(PUB, "index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="WoW Forever auction house prices, updated every hour: market price, listed, day trade and best time to buy and sell.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Auction House Forever">
<meta property="og:title" content="Auction House Forever">
<meta property="og:description" content="Live auction house prices for WoW Forever, updated every hour: market price, listed, day trade and the best time to buy and sell.">
<meta property="og:url" content="https://ragequitit.github.io/ah/">
<meta property="og:image" content="https://ragequitit.github.io/ah/assets/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#130F0D">
<link rel="icon" type="image/png" href="https://ragequitit.github.io/ah/assets/icons/auction-house-logo.png">
<link rel="apple-touch-icon" href="https://ragequitit.github.io/ah/assets/icons/auction-house-logo.png">
<meta name="apple-mobile-web-app-title" content="Azeroth Atlas">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<link rel="manifest" href='data:application/manifest+json,{"name":"Azeroth Atlas","short_name":"Atlas","start_url":"https://ragequitit.github.io/ah/","scope":"https://ragequitit.github.io/ah/","display":"standalone","background_color":"%23130F0D","theme_color":"%23130F0D","icons":[{"src":"https://ragequitit.github.io/ah/assets/icons/auction-house-logo.png","sizes":"384x384","type":"image/png"}]}'>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>html{color-scheme:dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${split[1]}
</head>
<body>${withIcons(split[2], "icons/")}</body>
</html>
`);

// Kopian för chriswhippit.com/ah (repot ragequitit/chriswhippit, mappen ah/): samma sida, men priserna hämtas från
// GitHub-sidan (ragequitit.github.io/ah/data.json), så hemsidans repo inte växer med 2 MB per scan. Filen behöver bara
// läggas upp igen när själva sidan ändrats.
const SITE = path.join(__dirname, "hemsida");
fs.mkdirSync(SITE, { recursive: true });
const DATA_LOCAL = `var DATA_URL = "data.json";`;
if (!split[2].includes(DATA_LOCAL)) throw new Error("index.html: hittar inte DATA_URL");
fs.writeFileSync(path.join(SITE, "index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="WoW Forever auction house prices, updated every hour: market price, listed, day trade and best time to buy and sell.">
<link rel="canonical" href="https://www.chriswhippit.com/ah/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Auction House Forever">
<meta property="og:title" content="Auction House Forever">
<meta property="og:description" content="Live auction house prices for WoW Forever, updated every hour: market price, listed, day trade and the best time to buy and sell.">
<meta property="og:url" content="https://www.chriswhippit.com/ah/">
<meta property="og:image" content="https://ragequitit.github.io/ah/assets/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#130F0D">
<link rel="icon" type="image/png" href="https://ragequitit.github.io/ah/assets/icons/auction-house-logo.png">
<link rel="apple-touch-icon" href="https://ragequitit.github.io/ah/assets/icons/auction-house-logo.png">
<meta name="apple-mobile-web-app-title" content="Azeroth Atlas">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<link rel="manifest" href='data:application/manifest+json,{"name":"Azeroth Atlas","short_name":"Atlas","start_url":"https://www.chriswhippit.com/ah/","scope":"https://www.chriswhippit.com/ah/","display":"standalone","background_color":"%23130F0D","theme_color":"%23130F0D","icons":[{"src":"https://ragequitit.github.io/ah/assets/icons/auction-house-logo.png","sizes":"384x384","type":"image/png"}]}'>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>html{color-scheme:dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${split[1]}
</head>
<body>${withIcons(split[2], "https://ragequitit.github.io/ah/icons/").replace(DATA_LOCAL, `var DATA_URL = "https://ragequitit.github.io/ah/data.json";`)}</body>
</html>
`);
console.log("data.json:", (fs.statSync(OUT).size / 1024).toFixed(0) + " kB,", items.length, "varor,", out.named, "med namn,",
  Object.keys(steps).length, "med prissteg, senaste scan", new Date(latest.t * 1000).toLocaleString("sv-SE"));
