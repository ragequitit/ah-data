// hamta-varukallor.js – var ett föremål kommer ifrån, till hemsidans föremålsruta (Joakim 2026-11-18: "alla herbs borde
// vara klickbara ... vart man hittar den, till vilka recept den används", "clickar jag på en ore så borde en karta komma
// upp med vart man hittar just den oren"). Ur den öppna Classic-databasen (cmangos classic-db, GPL,
// data/classicdb/classicmangos.sqlite):
//   g  plockas/bryts från (gameobject: malmådror, örter, kistor): [namn, chans %, antal i världen, sort (0 nod, 1 kista),
//      [[zon, antal, [[x, y], …]], …] (zonprocent, samma kartor som questkartan), [[instans, antal], …]]
//   d  droppar från (creature_loot_template, även via referenstabeller): [[npc-id, namn, chans %, minlvl, maxlvl], …]
//      högst MAXD, flest chans först; dn = hur många olika mobs totalt
//   s  flås från (skinning), p ficktjuvas från (pickpocket): samma form som d
//   v  säljs av (npc_vendor och försäljarmallar): [[npc-id, namn, begränsat antal 0/1], …]
//   c  finns i (item_loot_template: lådor, säckar, musslor): [[föremåls-id, namn, chans %], …]
//   n, q  föremålets namn och kvalitet (för föremål som inte finns på AH)
// Platserna räknas om från världskoordinater till zonprocent med zonkartor/granser.json, som i hamta-questplatser.js.
// Ut: kallor/<id % 100>.json { id: {...} } för varorna på AH och allt i recepten. build.js kopierar till publik/kallor.
// Kör: node dashboard/ah-sida/hamta-varukallor.js
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const DB = path.join(__dirname, "..", "..", "data", "classicdb", "classicmangos.sqlite");
const OUT = path.join(__dirname, "kallor");
const MAXD = 15, MAXV = 10, MAXC = 10, MAXG = 6, MAXZ = 10, MAXPIN = 160;
const db = new DatabaseSync(DB, { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const B = JSON.parse(fs.readFileSync(path.join(__dirname, "zonkartor", "granser.json"), "utf8"));
let dungeons = {};
try { for (const d of JSON.parse(fs.readFileSync(path.join(__dirname, "dungeons.json"), "utf8")).dungeons) dungeons[d.map] = d.name; } catch (e) { dungeons = {}; }
const CITY = new Set(["Orgrimmar", "Undercity", "Thunder Bluff", "Stormwind City", "Ironforge", "Darnassus"]);

// Zonen för en världspunkt: staden om punkten ligger i en stads karta, annars den karta där punkten ligger mest centralt
// (kartorna överlappar; punkten hamnar rätt geografiskt på vilken som helst av dem). Forevers nya zoner (uiMap > 2000)
// hoppas över: databasen har inga spawns där.
function zoneOf(map, wx, wy) {
  for (const z of Object.values(B)) {
    if (z.map !== map || !CITY.has(z.name)) continue;
    const u = (z.left - wy) / (z.left - z.right), v = (z.top - wx) / (z.top - z.bottom);
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { z, u, v };
  }
  let best = null, bs = -1;
  for (const [mid, z] of Object.entries(B)) {
    if (z.map !== map || +mid > 2000) continue;
    const u = (z.left - wy) / (z.left - z.right), v = (z.top - wx) / (z.top - z.bottom);
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    const c = Math.min(u, 1 - u, v, 1 - v);
    if (c > bs) { bs = c; best = { z, u, v }; }
  }
  return best;
}
const r1 = v => Math.round(v * 1000) / 10;
const r2 = v => Math.round(v * 100) / 100;

// Varorna: allt på AH (sidans data-filer) och allt som ingår i ett recept.
const want = new Set();
for (const f of ["data.json", "data-110.json", "data-114.json", "data-111.json"]) {
  try { for (const r of JSON.parse(fs.readFileSync(path.join(__dirname, "publik", f), "utf8")).items) want.add(r[0]); } catch (e) { /* filen saknas */ }
}
try {
  const R = JSON.parse(fs.readFileSync(path.join(__dirname, "recept.json"), "utf8"));
  for (const r of R.recipes) { if (r.item) want.add(r.item); for (const g of r.reagents || []) want.add(g[0]); }
} catch (e) { /* inga recept */ }

// Lootchans: chans 0 i en grupp = lika delar av det som blir över i gruppen (cmangos regel). Negativ = questföremål.
function lootTable(t) {
  const rows = q("SELECT entry, item, ChanceOrQuestChance c, groupid g, mincountOrRef m FROM " + t);
  const grp = {};
  for (const r of rows) if (r.m >= 0 && r.g > 0) { const k = r.entry + ":" + r.g; const o = grp[k] || (grp[k] = { s: 0, z: 0 }); if (r.c > 0) o.s += r.c; else if (r.c === 0) o.z++; }
  const byItem = new Map(), refs = new Map();   // föremål → [[entry, chans]], referens → [[entry, chans för referensen]]
  for (const r of rows) {
    if (r.m < 0) { const k = -r.m; if (!refs.has(k)) refs.set(k, []); refs.get(k).push([r.entry, Math.abs(r.c) || 100]); continue; }
    let c = Math.abs(r.c);
    if (c === 0 && r.g > 0) { const o = grp[r.entry + ":" + r.g]; c = o && o.z ? Math.max(0, 100 - o.s) / o.z : 0; }
    if (!byItem.has(r.item)) byItem.set(r.item, []);
    byItem.get(r.item).push([r.entry, c]);
  }
  return { byItem, refs };
}
const REF = lootTable("reference_loot_template");
// Källorna i en tabell för ett föremål: direkt och via referenser (en nivå, referens i referens räknas också en gång).
function sources(T, item) {
  const out = new Map();
  const add = (e, c) => { if (!out.has(e) || out.get(e) < c) out.set(e, c); };
  for (const [e, c] of T.byItem.get(item) || []) add(e, c);
  const viaRef = (refEntry, c, depth) => {
    for (const [e, rc] of T.refs.get(refEntry) || []) add(e, c * rc / 100);
    if (depth < 1) for (const [e2, rc2] of REF.refs.get(refEntry) || []) viaRef(e2, c * rc2 / 100, depth + 1);
  };
  for (const [refEntry, c] of REF.byItem.get(item) || []) viaRef(refEntry, c, 0);
  return out;
}
const CL = lootTable("creature_loot_template"), GL = lootTable("gameobject_loot_template"), SL = lootTable("skinning_loot_template");
const PL = lootTable("pickpocketing_loot_template"), IL = lootTable("item_loot_template");

// Mobs: loot-id → mallar (flera mobs kan dela loot).
const ctByLoot = { d: new Map(), s: new Map(), p: new Map() };
for (const c of q("SELECT Entry id, Name n, MinLevel a, MaxLevel b, LootId l, SkinningLootId s, PickpocketLootId p FROM creature_template")) {
  for (const [k, col] of [["d", "l"], ["s", "s"], ["p", "p"]]) if (c[col]) { const m = ctByLoot[k]; if (!m.has(c[col])) m.set(c[col], []); m.get(c[col]).push(c); }
}
// Antal spawns per mob: listan sorteras på chans gånger hur vanlig moben är (en ensam boss med 100 % är sämre att farma
// än en vanlig mob med 40 %), chansen visas.
const spawnN = new Map();
for (const r of q("SELECT id, COUNT(*) n FROM creature GROUP BY id UNION ALL SELECT entry, COUNT(*) FROM creature_spawn_entry GROUP BY entry")) spawnN.set(r.id, (spawnN.get(r.id) || 0) + r.n);
const spawned = { has: id => spawnN.has(id) };
function mobs(T, k, item) {
  const res = [];
  for (const [lootId, c] of sources(T, item)) for (const ct of ctByLoot[k].get(lootId) || []) if (spawned.has(ct.id) && c > 0) res.push([ct.id, ct.n, r2(c), ct.a, ct.b]);
  const sc = r => r[2] * Math.log2(1 + Math.min(spawnN.get(r[0]) || 1, 40));
  res.sort((a, b) => sc(b) - sc(a) || a[3] - b[3]);
  return res;
}
// Världsobjekt: loot-id (data1 för typ 3) → mallar; spawns per mall.
const goByLoot = new Map();
for (const g of q("SELECT entry, name, data1 FROM gameobject_template WHERE type = 3 AND data1 > 0")) { if (!goByLoot.has(g.data1)) goByLoot.set(g.data1, []); goByLoot.get(g.data1).push(g); }
const goSpawns = new Map();
for (const s of q("SELECT id, map, position_x x, position_y y FROM gameobject UNION ALL SELECT e.entry id, g.map, g.position_x, g.position_y FROM gameobject_spawn_entry e JOIN gameobject g ON g.guid = e.guid")) {
  if (!goSpawns.has(s.id)) goSpawns.set(s.id, []);
  goSpawns.get(s.id).push(s);
}
const CHEST = /chest|crate|box|trunk|coffer|cache|barrel|footlocker|strongbox|sack|bag|pile|stash|basket|supplies/i;
const gzCache = new Map();
function nodes(item) {
  const byName = new Map();
  for (const [lootId, c] of sources(GL, item)) for (const g of goByLoot.get(lootId) || []) {
    const sp = goSpawns.get(g.entry) || [];
    if (!sp.length || c <= 0) continue;
    const o = byName.get(g.name) || { c: 0, rows: [] };
    o.c = Math.max(o.c, c); o.rows.push(...sp); byName.set(g.name, o);
  }
  const res = [];
  for (const [name, o] of byName) {
    const zs = {}, inst = {};
    for (const s of o.rows) {
      if (s.map !== 0 && s.map !== 1) { const nm = dungeons[s.map] || "Instance " + s.map; inst[nm] = (inst[nm] || 0) + 1; continue; }
      const key = s.map + ":" + Math.round(s.x) + ":" + Math.round(s.y);
      let z = gzCache.get(key);
      if (z === undefined) { z = zoneOf(s.map, s.x, s.y); gzCache.set(key, z); }
      if (!z) continue;
      const e = zs[z.z.name] || (zs[z.z.name] = { n: 0, pts: [] });
      e.n++; e.pts.push([r1(z.u), r1(z.v)]);
    }
    const zl = Object.entries(zs).sort((a, b) => b[1].n - a[1].n).slice(0, MAXZ).map(([zn, e]) => {
      let pts = e.pts;
      if (pts.length > MAXPIN) { const st = pts.length / MAXPIN; pts = Array.from({ length: MAXPIN }, (_, i) => e.pts[Math.floor(i * st)]); }
      return [zn, e.n, CHEST.test(name) ? [] : pts];   // kistor: bara zon och antal
    });
    res.push([name, r2(o.c), o.rows.length, CHEST.test(name) ? 1 : 0, zl, Object.entries(inst).sort((a, b) => b[1] - a[1])]);
  }
  // Noder först (malm/ört), sedan efter hur vanligt det är (chans × antal).
  res.sort((a, b) => a[3] - b[3] || b[1] * b[2] - a[1] * a[2]);
  // Finns det noder (malm, örter) skymmer kistorna bara: de tas med först från 10 % chans. Annars högst tre kistor.
  const hasNode = res.some(r => r[3] === 0);
  return res.filter(r => r[3] === 0 || (hasNode ? r[1] >= 10 : true)).slice(0, hasNode ? MAXG : 3);
}
// Försäljare: direkt och via försäljarmall.
const venByItem = new Map();
const ctAll = new Map(q("SELECT Entry id, Name n, VendorTemplateId vt FROM creature_template").map(c => [c.id, c]));
const vtUsers = new Map();
for (const c of ctAll.values()) if (c.vt) { if (!vtUsers.has(c.vt)) vtUsers.set(c.vt, []); vtUsers.get(c.vt).push(c); }
const addV = (item, c, lim) => { if (!spawned.has(c.id)) return; if (!venByItem.has(item)) venByItem.set(item, new Map()); venByItem.get(item).set(c.id, [c.id, c.n, lim ? 1 : 0]); };
for (const v of q("SELECT entry, item, maxcount FROM npc_vendor")) { const c = ctAll.get(v.entry); if (c) addV(v.item, c, v.maxcount > 0); }
for (const v of q("SELECT entry, item, maxcount FROM npc_vendor_template")) for (const c of vtUsers.get(v.entry) || []) addV(v.item, c, v.maxcount > 0);
const itemName = new Map(), itemQ = new Map();
for (const r of q("SELECT entry, name, Quality FROM item_template")) { itemName.set(r.entry, r.name); itemQ.set(r.entry, r.Quality); }

// NPC-sidor finns för mobs i quests (hamta-questplatser.js, npc/): de får länk (sista fältet 1).
const npcPage = new Set();
try { for (const f of fs.readdirSync(path.join(__dirname, "npc"))) for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, "npc", f), "utf8")))) npcPage.add(+k); } catch (e) { /* inga NPC-sidor */ }
const linkNpc = a => a.map(r => r.concat(npcPage.has(r[0]) ? 1 : 0));
fs.mkdirSync(OUT, { recursive: true });
const shards = {};
let n = 0, withG = 0;
for (const id of want) {
  const o = {};
  const g = nodes(id); if (g.length) { o.g = g; withG++; }
  const d = mobs(CL, "d", id); if (d.length) { o.d = linkNpc(d.slice(0, MAXD)); o.dn = d.length; }
  const s = mobs(SL, "s", id); if (s.length) o.s = linkNpc(s.slice(0, MAXD));
  const p = mobs(PL, "p", id); if (p.length) o.p = linkNpc(p.slice(0, 8));
  const v = venByItem.get(id); if (v) o.v = linkNpc([...v.values()].slice(0, MAXV));
  const c = [...sources(IL, id)].filter(([e, ch]) => ch > 0 && itemName.has(e)).sort((a, b) => b[1] - a[1]).slice(0, MAXC).map(([e, ch]) => [e, itemName.get(e), r2(ch)]);
  if (c.length) o.c = c;
  if (!Object.keys(o).length) continue;
  o.n = itemName.get(id) || ""; o.q = itemQ.has(id) ? itemQ.get(id) : 1;   // namn och kvalitet för föremål som inte finns på AH
  (shards[id % 100] = shards[id % 100] || {})[id] = o; n++;
}
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
let bytes = 0;
for (const [k, v] of Object.entries(shards)) { const s = JSON.stringify(v); bytes += s.length; fs.writeFileSync(path.join(OUT, k + ".json"), s); }
console.log("kallor/: " + n + " av " + want.size + " föremål med källa (" + withG + " med karta), " + Math.round(bytes / 1024) + " kB i " + Object.keys(shards).length + " filer");
