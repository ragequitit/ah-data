// hamta-fiske.js – underlaget till Fishing i skillguiden (Joakim 2026-11-22: "lägg till Fishing som de andra yrkena").
// Ur den öppna Classic-databasen (cmangos classic-db, GPL, data/classicdb/classicmangos.sqlite):
//   skill_fishing_base_level  zonens fiskekrav (zon-id → krav; fångstchans = skill − krav + 5 %, cmangos GameObject.cpp)
//   fishing_loot_template     vad man fångar per zon (via reference_loot_template)
//   gameobject_template typ 25 + gameobject/spawn_group  fiskepoolerna (Oily Blackmouth School …) med platser och fångst
// Zonnamn och kontinent ur Forevers klient (data/wago/<build>/AreaTable.csv, wago.tools). Platser räknas om till zonprocent
// med zonkartor/zon.js, samma som malmådrorna.
// Ut: fishing.json { t, source, zones: { namn: { id, skill, loot: [[item, chans %]], pools: [[pool, antal, [x, y, ...]]] } },
//   pools: { namn: [[item, chans %]] }, items: { id: [namn, kvalitet] } }
// Kör: node dashboard/ah-sida/hamta-fiske.js   (sedan node build.js)
const fs = require("fs"), path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { zoneOf } = require("./zonkartor/zon.js");
const db = new DatabaseSync(path.join(__dirname, "..", "..", "data", "classicdb", "classicmangos.sqlite"), { readOnly: true });
const WAGO_DIR = path.join(__dirname, "..", "..", "data", "wago");
const BUILD = fs.readdirSync(WAGO_DIR).filter(d => /^\d/.test(d)).sort().pop();
const OUT = path.join(__dirname, "fishing.json");

// AreaTable: id → { namn, kontinent, förälder }
const AREA = {};
{
  const L = fs.readFileSync(path.join(WAGO_DIR, BUILD, "AreaTable.csv"), "utf8").split(/\r?\n/).filter(Boolean);
  const H = L[0].split(",");
  const parse = line => { const out = []; let cur = "", q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
  const ix = n => H.indexOf(n);
  for (const l of L.slice(1)) { const f = parse(l); AREA[f[ix("ID")]] = { name: f[ix("AreaName_lang")], cont: +f[ix("ContinentID")], parent: +f[ix("ParentAreaID")] }; }
}

const itemQ = db.prepare("SELECT name, Quality q FROM item_template WHERE entry = ?");
const items = {};
const item = id => { if (!items[id]) { const r = itemQ.get(id); items[id] = r ? [r.name, r.q] : ["#" + id, 1]; } return id; };
const refQ = db.prepare("SELECT item, ChanceOrQuestChance c, groupid g, mincountOrRef mn FROM reference_loot_template WHERE entry = ?");
// Fångsten som sannolikhet per kast: raderna med 0 % i en grupp delar gruppens rest; en referens med chans c gäller c % av kasten.
function lootRows(rows, mult, out, depth) {
  const grp = {};
  for (const r of rows) if (r.g > 0 && r.mn > 0) (grp[r.g] = grp[r.g] || []).push(r);
  for (const r of rows) {
    if (r.mn < 0) { if (depth < 3) lootRows(refQ.all(-r.mn), mult * Math.abs(r.c || 100) / 100, out, depth + 1); continue; }
    if (r.c < 0) continue;   // negativ chans = questföremål, fångas bara med questen
    let c = r.c;
    if (r.g > 0 && !c) { const G = grp[r.g], fixed = G.reduce((a, x) => a + Math.max(0, x.c), 0), zero = G.filter(x => !x.c).length; c = zero ? Math.max(0, 100 - fixed) / zero : 0; }
    if (!c) continue;
    out[r.item] = (out[r.item] || 0) + c * mult;
  }
  return out;
}
const fishQ = db.prepare("SELECT item, ChanceOrQuestChance c, groupid g, mincountOrRef mn FROM fishing_loot_template WHERE entry = ?");
const goLootQ = db.prepare("SELECT item, ChanceOrQuestChance c, groupid g, mincountOrRef mn FROM gameobject_loot_template WHERE entry = ?");
const top = o => Object.entries(o).map(([id, c]) => [item(+id), Math.round(c * 10) / 10]).filter(x => x[1] >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 8);

// Zonerna: fiskekravet står på zonen (förälder 0) eller på ett område; zonen tar sitt eget krav.
const zones = {};
for (const b of db.prepare("SELECT entry, skill FROM skill_fishing_base_level").all()) {
  const a = AREA[b.entry];
  if (!a || a.parent !== 0 || (a.cont !== 0 && a.cont !== 1)) continue;   // bara zoner i den öppna världen
  const loot = top(lootRows(fishQ.all(b.entry), 1, {}, 0));
  if (loot.length) zones[a.name] = { id: b.entry, skill: b.skill, loot, pools: [] };   // instanser och zoner utan fångst tas inte med
}

// Fiskepoolerna med platser (spawngrupper slumpar mellan platserna i gruppen).
const spawnQ = db.prepare("SELECT map, position_x x, position_y y FROM gameobject WHERE id = ? UNION ALL SELECT g.map, g.position_x, g.position_y FROM spawn_group_entry se JOIN spawn_group sg ON sg.Id = se.Id AND sg.Type = 1 JOIN spawn_group_spawn ss ON ss.Id = se.Id JOIN gameobject g ON g.guid = ss.Guid WHERE se.Entry = ?");
const pools = {}, r1 = v => Math.round(v * 1000) / 10;
for (const t of db.prepare("SELECT entry, name, data1 FROM gameobject_template WHERE type = 25").all()) {
  pools[t.name] = pools[t.name] || top(lootRows(goLootQ.all(t.data1), 1, {}, 0));
  const seen = new Set(), per = {};
  for (const s of spawnQ.all(t.entry, t.entry)) {
    if (s.map !== 0 && s.map !== 1) continue;
    const k = s.map + ":" + Math.round(s.x) + ":" + Math.round(s.y); if (seen.has(k)) continue; seen.add(k);
    const z = zoneOf(s.map, s.x, s.y, null, true); if (!z || !zones[z.z.name]) continue;
    (per[z.z.name] = per[z.z.name] || []).push(r1(z.u), r1(z.v));
  }
  for (const [zn, P] of Object.entries(per)) {
    const ex = zones[zn].pools.find(p => p[0] === t.name);
    if (ex) { ex[2] = ex[2].concat(P); ex[1] = ex[2].length / 2; } else zones[zn].pools.push([t.name, P.length / 2, P]);
  }
}
for (const z of Object.values(zones)) z.pools.sort((a, b) => b[1] - a[1]);
fs.writeFileSync(OUT, JSON.stringify({ t: Date.now(), source: "cmangos classic-db (GPL) 1.12: fishing skill per zone, catches and fishing pools; zone names from the WoW Forever client (wago.tools)", zones, pools, items }));
for (const [n, z] of Object.entries(zones).sort((a, b) => a[1].skill - b[1].skill || a[0].localeCompare(b[0])))
  console.log(String(z.skill).padStart(4), n.padEnd(22), z.loot.slice(0, 3).map(l => items[l[0]][0] + " " + l[1]).join(", ").padEnd(80), z.pools.map(p => p[0] + " " + p[1]).join(", "));
console.log("zoner:", Object.keys(zones).length, "pooler:", Object.keys(pools).length, "→", OUT, Math.round(fs.statSync(OUT).size / 1024) + " kB");
