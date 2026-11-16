// hamta-skinning.js – vad man får när man flår djuren i hunterguiden (Joakim 2026-11-18: "skinning i hunterguiden ...
// med AH-pris"). Ur den öppna Classic-databasen (cmangos classic-db, GPL, data/classicdb/classicmangos.sqlite):
// creature_template.SkinningLootId → skinning_loot_template (grupper: chans 0 i en grupp = lika delar av resten,
// referenser via reference_loot_template). Skriver skinning.json { beasts: { npcId: [[item, chans %, min, max], …] },
// items: { id: [namn, kvalitet] } }; build.js lägger in det i hunter.json (b.skin) och hunter-fliken visar det med AH-pris.
// Kör: node dashboard/ah-sida/hamta-skinning.js
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const DB = path.join(__dirname, "..", "..", "data", "classicdb", "classicmangos.sqlite");
const OUT = path.join(__dirname, "skinning.json");
const db = new DatabaseSync(DB, { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const H = JSON.parse(fs.readFileSync(path.join(__dirname, "hunter.json"), "utf8"));

const refRows = q("SELECT entry, item, ChanceOrQuestChance c, groupid g, mincountOrRef m, maxcount mx FROM reference_loot_template");
const refBy = new Map();
for (const r of refRows) { if (!refBy.has(r.entry)) refBy.set(r.entry, []); refBy.get(r.entry).push(r); }
// En loottabell → [[item, chans, min, max]]: grupper med lika delning, referenser (en nivå) med sin chans.
function expand(rows, scale, out, depth) {
  const grp = {};
  for (const r of rows) if (r.m >= 0 && r.g > 0) { const o = grp[r.g] || (grp[r.g] = { s: 0, z: 0 }); if (r.c > 0) o.s += Math.abs(r.c); else o.z++; }
  for (const r of rows) {
    if (r.m < 0) { if (depth < 2) expand(refBy.get(-r.m) || [], scale * (Math.abs(r.c) || 100) / 100, out, depth + 1); continue; }
    let c = Math.abs(r.c);
    if (c === 0 && r.g > 0) { const o = grp[r.g]; c = o && o.z ? Math.max(0, 100 - o.s) / o.z : 0; }
    if (c <= 0) continue;
    const prev = out.get(r.item);
    out.set(r.item, [r.item, Math.min(100, (prev ? prev[1] : 0) + c * scale / 100), r.m || 1, r.mx || 1]);
  }
}
const lootOf = db.prepare("SELECT item, ChanceOrQuestChance c, groupid g, mincountOrRef m, maxcount mx FROM skinning_loot_template WHERE entry = ?");
const skinId = new Map(q("SELECT Entry e, SkinningLootId s FROM creature_template WHERE SkinningLootId > 0").map(r => [r.e, r.s]));
const itemOf = new Map(q("SELECT entry, name, Quality FROM item_template").map(r => [r.entry, r]));
const beasts = {}, items = {};
let n = 0;
for (const b of H.beasts) {
  const sid = skinId.get(b.id);
  if (!sid) continue;
  const out = new Map();
  expand(lootOf.all(sid), 100, out, 0);
  const rows = [...out.values()].filter(l => itemOf.has(l[0])).sort((a, b2) => b2[1] - a[1]).map(l => [l[0], Math.round(l[1] * 10) / 10, l[2], l[3]]);
  if (!rows.length) continue;
  beasts[b.id] = rows; n++;
  for (const l of rows) { const x = itemOf.get(l[0]); items[l[0]] = [x.name, x.Quality]; }
}
fs.writeFileSync(OUT, JSON.stringify({ t: Date.now(), source: "cmangos classic-db (GPL), 1.12", beasts, items }));
console.log("skinning.json: " + n + " av " + H.beasts.length + " djur kan flås, " + Object.keys(items).length + " olika föremål");
