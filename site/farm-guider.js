// farm-guider.js – farmguider per level till hemsidans Gold per hour (Joakim 2026-11-24: "level 1, 5, 10, 15 ... hela vägen
// upp till 60, vart man ska vara och farma ... kanske 4 rutter för varje levelförslag", "klickar man på raden ... vart man
// ska vara, vem man ska döda, en liten karta, en liten route").
// Datorn väljer ställena ur den öppna Classic-databasen (cmangos, data/classicdb); hemsidan räknar guld per timme med AH:ts
// priser just nu (varje vara × antal per kill × marknadens pris efter 5 %, annars handlarpris), så guiden följer marknaden.
// Per spelarlevel L (10, 15 … 60): normala mobs (inte elit, inga handlare/kritters/vakter) på level L−4 … L−1 ("2 levlar
// under"), ett ställe = en mob i en zon. Kills per timme = 3600 / (strid + leta + loota): strid per moblevel ur Joakims
// uppmätta tider (WhippitPanel 2026-11-21: ~13,5 s level 1–9, 19 s 10–19, 21 s 20–24, 23 s 25–29; högre uppskattat),
// leta efter hur tätt mobsen står (antal spawns i zonen), loota 3 s. Rangordnat på dagens priser, SPOTS per level och
// fraktion (zoner bara den andra fraktionen har: bort), högst en per zon. Sidan sorterar om på det valda husets priser.
// Ut: farm.json { t, source, bands: [{ lvl, lo, hi, h: [ställe…], a: [ställe…] }] }, ställe = { mob, disp (visnings-id: bild/3D), name, lvl, zone, n
// (spawns), kh (kills/h), coin (koppar/kill), items: [[id, st/kill, handlarpris, ah 0/1]], skin: [[…]], also: [namn…],
// pts: [x, y, …] (zonprocent, samma som nodes.json) }, names: { id: [namn, kvalitet] }. build.js kopierar till publik/.
// Kör: node dashboard/ah-sida/farm-guider.js
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(path.join(__dirname, "..", "..", "data", "classicdb", "classicmangos.sqlite"), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
// Zonen: sidans gemensamma zoneOf (zonkartor/zon.js, spelets egna zonsvar nära NPC:er, inga städer), som malmen och fisket.
// Den förra egna (mest centrala kartan) lade mobs nära zongränser i fel zon (Ravenous Darkhound i Western Plaguelands).
const ZON = require("./zonkartor/zon.js");
const LEVELS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];   // Joakim 2026-11-24: från 10, var femte level
const SPOTS = 8, MAXPTS = 90, MIN_SPAWNS = 8, MIN_DAG = 30, RESPAWN_USE = 0.5;
// Den andra fraktionens hemland: dit går man inte och farmar.
const NO_H = new Set(["Elwynn Forest", "Dun Morogh", "Teldrassil", "Westfall", "Loch Modan", "Darkshore", "Redridge Mountains", "Stormwind City", "Ironforge", "Darnassus"]);
const NO_A = new Set(["Durotar", "Mulgore", "Tirisfal Glades", "The Barrens", "Silverpine Forest", "Orgrimmar", "Thunder Bluff", "Undercity"]);
const CITY = new Set(["Orgrimmar", "Undercity", "Thunder Bluff", "Stormwind City", "Ironforge", "Darnassus"]);
const NOT_MOB = /Guard|Grunt|Sentinel|Defender|Watcher|Peasant|Citizen|Trainer|Merchant|Vendor|Innkeeper|Protector|Peon|Laborer\b|Kodo Calf|Squirrel|Rabbit|Deer|Sheep|Cow|Chicken|Rat\b|Toad|Frog|Cat\b|Fawn|Prairie Dog|Hare|Snake\b/;
const fight = (l) => (l < 10 ? 13.5 : l < 20 ? 19 : l < 25 ? 21 : l < 30 ? 23 : l < 40 ? 25 : l < 50 ? 27 : 30);
const seek = (n) => (n >= 80 ? 10 : n >= 40 ? 15 : n >= 20 ? 22 : 30);

// Dagens priser (bara för att välja ställen; sidan räknar själv): Horde = data.json, Alliansen = data-110.json.
function prices(fil) {
  const m = {};
  try {
    for (const r of JSON.parse(fs.readFileSync(path.join(__dirname, "publik", fil), "utf8")).items) {
      const w = (r[9] || []).filter((x) => x > 0).sort((a, b) => a - b);
      const p25 = w.length >= 4 ? w[Math.floor(w.length * 0.25)] : null, now = r[3] > 0 ? r[3] : null;
      const p = now && p25 ? Math.min(now, p25) : (p25 || now);
      m[r[0]] = { net: p ? p * 0.95 : 0, day: r[8] || 0, gear: r[21] === 1 };
    }
  } catch (e) { console.error("farm-guider: " + fil + ": " + e.message); }
  return m;
}
const PH = prices("data.json"), PA = prices("data-110.json");
const items = {};
for (const it of q("SELECT entry, name, class, Quality, SellPrice FROM item_template")) items[it.entry] = it;
const isGear = (id) => { const it = items[id]; return it && (it.class === 2 || it.class === 4); };
function val(id, P) {
  const it = items[id] || {}, a = P[id];
  if (a && !a.gear && !isGear(id) && a.day >= MIN_DAG && a.net > (it.SellPrice || 0)) return a.net;
  return it.SellPrice || 0;
}

// Lootchanser: chans 0 i en grupp = lika delar av resten i gruppen; negativ = questföremål; referenser (världsdropp) bort.
function loot(table, entry) {
  const rows = q("SELECT item, ChanceOrQuestChance c, groupid g, mincountOrRef m, maxcount x FROM " + table + " WHERE entry = ?", entry);
  const grp = {};
  for (const r of rows) if (r.m >= 0 && r.g > 0) { const o = grp[r.g] || (grp[r.g] = { s: 0, z: 0 }); if (r.c > 0) o.s += r.c; else if (r.c === 0) o.z++; }
  const out = [];
  for (const r of rows) {
    if (r.m < 0 || r.c < 0) continue;
    let c = r.c;
    if (c === 0 && r.g > 0) { const o = grp[r.g]; c = o && o.z ? Math.max(0, 100 - o.s) / o.z : 0; }
    if (c <= 0) continue;
    const per = (c / 100) * (Math.max(1, r.m) + Math.max(1, r.x)) / 2;
    const it = items[r.item] || {};
    out.push([r.item, Math.round(per * 1000) / 1000, it.SellPrice || 0, isGear(r.item) ? 0 : 1]);
  }
  return out.filter((x) => x[1] >= 0.005).sort((a, b) => b[1] * (b[2] || 1) - a[1] * (a[2] || 1)).slice(0, 14);
}

function zoneOf(map, wx, wy) {
  const z = ZON.zoneOf(map, wx, wy, null, true);
  return z ? { name: z.z.name, u: z.u, v: z.v } : null;
}
const r1 = (v) => Math.round(v * 1000) / 10;

// Alla kandidater: en per (mob, zon) med minst MIN_SPAWNS spawns i zonen.
const cand = [];
const mobs = q("SELECT Entry, Name, MinLevel, MaxLevel, CreatureType, DisplayId1, MinLootGold, MaxLootGold, LootId, SkinningLootId FROM creature_template WHERE Rank = 0 AND NpcFlags = 0 AND MaxLevel <= 62 AND CreatureType <> 8");
for (const m of mobs) {
  if (NOT_MOB.test(m.Name)) continue;
  const sp = q("SELECT map, position_x x, position_y y, spawntimesecsmin rs FROM creature WHERE id = ? AND map IN (0, 1)", m.Entry);
  if (sp.length < MIN_SPAWNS) continue;
  const byZone = {};
  for (const s of sp) {
    const z = zoneOf(s.map, s.x, s.y);
    if (!z || CITY.has(z.name)) continue;
    (byZone[z.name] = byZone[z.name] || []).push([r1(z.u), r1(z.v)]);
  }
  const it = m.LootId ? loot("creature_loot_template", m.LootId) : [];
  const sk = m.SkinningLootId ? loot("skinning_loot_template", m.SkinningLootId) : [];
  const coin = Math.round(((m.MinLootGold || 0) + (m.MaxLootGold || 0)) / 2);
  for (const [zone, pts] of Object.entries(byZone)) {
    if (pts.length < MIN_SPAWNS) continue;
    const lv = (m.MinLevel + m.MaxLevel) / 2;
    // Tak (Joakim 2026-11-24: "hur många av just den mobben finns på det stället?"): aldrig fler kills än mobsen hinner
    // spawna om, n × (3600 / respawn), och av dem hinner man ungefär RESPAWN_USE (resten står långt bort eller tas av andra).
    const rs = sp.reduce((t, x) => t + (x.rs || 300), 0) / sp.length;
    const kh = Math.round(Math.min(3600 / (fight(lv) + seek(pts.length) + 3), pts.length * 3600 / Math.max(60, rs) * RESPAWN_USE));
    cand.push({ mob: m.Entry, name: m.Name, disp: m.DisplayId1 || 0, rs: Math.round(rs), min: m.MinLevel, max: m.MaxLevel, lvl: m.MinLevel === m.MaxLevel ? "" + m.MinLevel : m.MinLevel + "-" + m.MaxLevel,
      zone, n: pts.length, kh, coin, items: it, skin: sk, pts });
  }
}
const gph = (c, P) => c.kh * (c.coin + c.items.reduce((s, x) => s + x[1] * (x[3] ? val(x[0], P) : x[2]), 0));

const bands = [];
for (const L of LEVELS) {
  const lo = Math.max(1, L - 4), hi = Math.max(L === 1 ? 2 : L - 1, 1);
  const inBand = cand.filter((c) => c.min <= hi && c.max >= lo);
  const pick = (P, no) => {
    const sorted = inBand.filter((c) => !no.has(c.zone)).map((c) => ({ c, g: gph(c, P) })).filter((x) => x.g > 0).sort((a, b) => b.g - a.g);
    const out = [], zones = new Set();
    for (const { c } of sorted) {
      if (zones.has(c.zone)) continue;
      zones.add(c.zone);
      // Andra mobs på samma ställe och level (samma zon): namnen, som "också här".
      const also = sorted.filter((x) => x.c.zone === c.zone && x.c.mob !== c.mob).slice(0, 3).map((x) => x.c.name);
      const pts = [];
      const step = Math.max(1, Math.ceil(c.pts.length / MAXPTS));
      for (let i = 0; i < c.pts.length; i += step) pts.push(c.pts[i][0], c.pts[i][1]);
      out.push({ mob: c.mob, disp: c.disp, rs: c.rs, name: c.name, lvl: c.lvl, zone: c.zone, n: c.n, kh: c.kh, coin: c.coin, items: c.items, skin: c.skin, also, pts });
      if (out.length >= SPOTS) break;
    }
    return out;
  };
  bands.push({ lvl: L, lo, hi, h: pick(PH, NO_H), a: pick(PA, NO_A) });
}
// names: { id: [namn, kvalitet] } för allt loot i filen (sidan saknar en del varor i sin data, granskningen 2026-11-24).
const names = {};
for (const b of bands) for (const side of [b.h, b.a]) for (const sp of side) for (const x of sp.items.concat(sp.skin)) {
  const it = items[x[0]];
  if (it && !names[x[0]]) names[x[0]] = [it.name, it.Quality];
}
const out = { t: Math.floor(Date.now() / 1000), source: "cmangos classic-db (GPL), 1.12", bands, names };
fs.writeFileSync(path.join(__dirname, "farm.json"), JSON.stringify(out));
for (const b of bands) {
  const top = b.h[0];
  console.log("lvl " + String(b.lvl).padStart(2) + " (mobs " + b.lo + "-" + b.hi + "): " + b.h.slice(0, 4).map((s) => s.name + " i " + s.zone + " " + Math.round(gph(s, PH) / 100) / 100 + "s/h").join(" | "));
  if (!top) console.log("   inga ställen");
}
console.log("farm.json: " + Math.round(fs.statSync(path.join(__dirname, "farm.json")).size / 1024) + " kB");
