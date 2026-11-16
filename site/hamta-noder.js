// hamta-noder.js – malmådrorna till hemsidans sök och egna sidor (Joakim 2026-11-20: "Silver Vein" gav ingen träff; han
// vill ha en sida per åder som Wowheads objektsida: zonerna med antal spawns och en zonkarta med alla platser).
// Ur den öppna Classic-databasen (cmangos classic-db, GPL, data/classicdb/classicmangos.sqlite): gameobject_template
// (typ 3 med gruvlås), gameobject (+ gameobject_spawn_entry och spawn_group för platser som slumpar mellan flera ådror) och
// gameobject_loot_template (vad ådern ger). Världskoordinaterna räknas om till zonprocent med zonkartor/zon.js
// (granser.json, samma omräkning som questkartorna och djurplatserna).
// Örterna (Herbalism, Joakim 2026-11-21: "gör samma sak för alla herbs") är samma sorts objekt med andra lås, se HERB.
// Ut: nodes.json { t, source, nodes: [{ id, ids, name, prof, skill, n, zones: [[zon, antal, [x, y, x, y ...]]],
//   inst: [[instans, antal]], loot: [[item, chans %, min, max]] }], items: { id: [namn, kvalitet] } }
// Kör: node dashboard/ah-sida/hamta-noder.js   (sedan node build.js)
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { zoneOf } = require("./zonkartor/zon.js");
const DB = path.join(__dirname, "..", "..", "data", "classicdb", "classicmangos.sqlite");
const OUT = path.join(__dirname, "nodes.json");
// Gruvlåsen (Lock.dbc) med skill som krävs, Classic 1.12.
const MINE = { 38: 1, 39: 65, 40: 75, 41: 125, 42: 155, 379: 175, 380: 230, 719: 230, 400: 245, 939: 275, 25: 150 };
// Örtlåsen med skill (Classic 1.12). Peacebloom och Silverleaf delar lås 29.
const HERB = { 29: 1, 30: 15, 9: 50, 31: 70, 519: 85, 11: 100, 32: 115, 33: 120, 45: 125, 27: 150, 47: 160, 521: 170, 49: 185, 51: 195, 50: 205, 439: 210,
  440: 220, 441: 230, 442: 235, 443: 245, 444: 250, 1119: 260, 1120: 270, 1121: 280, 1122: 285, 1123: 290, 1124: 300 };
const LOCKS = {};
for (const [l, s] of Object.entries(MINE)) LOCKS[l] = ["Mining", s];
for (const [l, s] of Object.entries(HERB)) LOCKS[l] = ["Herbalism", s];
const db = new DatabaseSync(DB, { readOnly: true });
let dungeons = {};
try { for (const d of JSON.parse(fs.readFileSync(path.join(__dirname, "dungeons.json"), "utf8")).dungeons) dungeons[d.map] = d.name; } catch (e) { dungeons = {}; }

const tpl = db.prepare("SELECT entry, name, data0, data1 FROM gameobject_template WHERE type = 3 AND data0 IN (" + Object.keys(LOCKS).join(",") + ")").all();
const spawnQ = db.prepare("SELECT map, position_x x, position_y y FROM gameobject WHERE id = ? UNION ALL SELECT g.map, g.position_x, g.position_y FROM gameobject_spawn_entry e JOIN gameobject g ON g.guid = e.guid WHERE e.entry = ?" +
  // Spawngrupper (Un'Goro, Silithus …: platsen slumpar mellan ådrorna i gruppen). Typ 1 = föremål (guid delas med varelser).
  " UNION ALL SELECT g.map, g.position_x, g.position_y FROM spawn_group_entry se JOIN spawn_group sg ON sg.Id = se.Id AND sg.Type = 1 JOIN spawn_group_spawn ss ON ss.Id = se.Id JOIN gameobject g ON g.guid = ss.Guid WHERE se.Entry = ?");
const lootQ = db.prepare("SELECT item, ChanceOrQuestChance c, groupid g, mincountOrRef mn, maxcount mx FROM gameobject_loot_template WHERE entry = ?");
const refQ = db.prepare("SELECT item, ChanceOrQuestChance c, groupid g, mincountOrRef mn, maxcount mx FROM reference_loot_template WHERE entry = ?");
const itemQ = db.prepare("SELECT name, Quality q FROM item_template WHERE entry = ?");

// Samma namn = samma åder på sidan (Copper Vein finns som flera mallar): spawns och loot slås ihop.
const byName = {};
for (const t of tpl) (byName[t.name] = byName[t.name] || []).push(t);
const items = {};
function lootOf(entry) {
  const out = {};
  const add = (rows, depth) => {
    // Grupper (groupid > 0) delar på chansen: rader med 0 % i en grupp får gruppens rest jämnt fördelad.
    const grp = {};
    for (const r of rows) if (r.g > 0 && r.mn > 0) (grp[r.g] = grp[r.g] || []).push(r);
    for (const r of rows) {
      if (r.mn < 0) { if (depth < 3) add(refQ.all(-r.mn), depth + 1); continue; }
      let c = Math.abs(r.c);
      if (r.g > 0 && !c) { const G = grp[r.g], fixed = G.reduce((a, x) => a + Math.abs(x.c), 0), zero = G.filter(x => !x.c).length; c = zero ? Math.max(0, 100 - fixed) / zero : 0; }
      if (!c) continue;
      const o = out[r.item] = out[r.item] || [r.item, 0, r.mn, r.mx];
      o[1] = Math.max(o[1], c); o[2] = Math.min(o[2], r.mn); o[3] = Math.max(o[3], r.mx);
    }
  };
  add(lootQ.all(entry), 0);
  return Object.values(out);
}
const r1 = v => Math.round(v * 1000) / 10;
const nodes = [];
for (const [name, list] of Object.entries(byName)) {
  const seen = new Set(), zones = {}, inst = {};
  let n = 0;
  for (const t of list) for (const s of spawnQ.all(t.entry, t.entry, t.entry)) {
    const k = s.map + ":" + Math.round(s.x) + ":" + Math.round(s.y);
    if (seen.has(k)) continue;   // samma plats i flera mallar/pooler räknas en gång
    seen.add(k); n++;
    if (s.map !== 0 && s.map !== 1) { const dn = dungeons[s.map] || "Instance " + s.map; inst[dn] = (inst[dn] || 0) + 1; continue; }
    const z = zoneOf(s.map, s.x, s.y, null, true);
    if (!z) { inst["?"] = (inst["?"] || 0) + 1; continue; }
    const e = zones[z.z.name] = zones[z.z.name] || [];
    e.push(r1(z.u), r1(z.v));
  }
  const lootMap = {};
  for (const t of list) for (const l of lootOf(t.data1)) { const o = lootMap[l[0]]; if (!o || o[1] < l[1]) lootMap[l[0]] = l; }
  const loot = Object.values(lootMap).sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(l => [l[0], Math.round(l[1] * 10) / 10, l[2], l[3]]);
  for (const l of loot) if (!items[l[0]]) { const it = itemQ.get(l[0]); if (it) items[l[0]] = [it.name, it.q]; }
  // Huvudmallen (flest spawns, annars lägsta id) ger sidans adress #node=<id>.
  const main = list.map(t => ({ t, c: spawnQ.all(t.entry, t.entry, t.entry).length })).sort((a, b) => b.c - a.c || a.t.entry - b.t.entry)[0].t;
  delete inst["?"];
  nodes.push({ id: main.entry, ids: list.map(t => t.entry).sort((a, b) => a - b), name, prof: LOCKS[main.data0][0], skill: LOCKS[main.data0][1], n,
    zones: Object.entries(zones).map(([z, p]) => [z, p.length / 2, p]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    inst: Object.entries(inst).sort((a, b) => b[1] - a[1]), loot });
}
nodes.sort((a, b) => a.prof.localeCompare(b.prof) || a.skill - b.skill || a.name.localeCompare(b.name));
fs.writeFileSync(OUT, JSON.stringify({ t: Date.now(), source: "cmangos classic-db (GPL), 1.12", nodes, items }));
for (const x of nodes) console.log(x.prof.slice(0, 4), String(x.skill).padStart(3), x.name.padEnd(32), String(x.n).padStart(5), x.zones.slice(0, 4).map(z => z[0] + " " + z[1]).join(", "), x.inst.length ? "| inst " + x.inst.map(i => i.join(" ")).join(", ") : "");
console.log("ådror och örter:", nodes.length, "→", OUT, Math.round(fs.statSync(OUT).size / 1024) + " kB");
