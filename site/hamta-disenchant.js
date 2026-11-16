// hamta-disenchant.js – grunddatan till "Worth disenchanting" (Joakim 2026-11-17): vad varje föremål kan ge när det
// disenchantas, ur den öppna Classic-databasen (cmangos classic-db, GPL, data/classicdb/classicmangos.sqlite):
// item_template.DisenchantID → disenchant_loot_template (en grupp per kvalitet och itemlevel-band). Chansen: angivna
// procent, och rader med 0 % delar på resten i gruppen (cmangos regel för "equal chance"). Addonets egna loggar (deLog)
// visar sedan vad Forever faktiskt ger; hemsidan väger ihop dem.
// { t, mats: { id: namn }, groups: { gruppId: [[föremål, sannolikhet 0–1, snittantal, min, max]] }, items: { id: [grupp, kvalitet, itemlevel] } }
// Kör: node dashboard/ah-sida/hamta-disenchant.js (en gång; databasen ändras inte)
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(path.join(__dirname, "..", "..", "data", "classicdb", "classicmangos.sqlite"), { readOnly: true });
const rows = db.prepare("SELECT entry, item, ChanceOrQuestChance c, groupid g, mincountOrRef mn, maxcount mx, comments FROM disenchant_loot_template").all();
const groups = {}, mats = {}, byGroup = {};
for (const r of rows) (byGroup[r.entry] = byGroup[r.entry] || []).push(r);
for (const [gid, list] of Object.entries(byGroup)) {
  const out = [];
  const sets = {};
  for (const r of list) (sets[r.g] = sets[r.g] || []).push(r);
  for (const [g, set] of Object.entries(sets)) {
    const fixed = set.filter(r => r.c > 0).reduce((a, r) => a + r.c, 0), zero = set.filter(r => r.c === 0);
    const share = +g > 0 && zero.length ? Math.max(0, 100 - fixed) / zero.length : 0;
    for (const r of set) {
      const p = (r.c > 0 ? r.c : share) / 100;
      out.push([r.item, Math.round(p * 1000) / 1000, (r.mn + r.mx) / 2, r.mn, r.mx]);
      mats[r.item] = (r.comments || "").trim() || mats[r.item] || "";
    }
  }
  groups[gid] = out.sort((a, b) => b[1] - a[1]);
}
for (const id of Object.keys(mats)) if (!mats[id]) { const n = db.prepare("SELECT name FROM item_template WHERE entry = ?").get(+id); mats[id] = n ? n.name : ""; }
const items = {};
for (const r of db.prepare("SELECT entry, DisenchantID d, Quality q, ItemLevel il FROM item_template WHERE DisenchantID > 0").all()) items[r.entry] = [r.d, r.q, r.il];
// Grupp 50 (blå, itemlevel 71–74) saknar Large Brilliant Shard i cmangos och har bara Nexus 0,5 %: samma som grupp 49.
if (groups[49] && groups[50] && !groups[50].some(x => x[0] === 14344)) groups[50] = groups[49].map(x => x.slice());

// Addonets tabell (SiteDisenchant.lua): grupperna och banden (kvalitet → vapen/rustning → högsta itemlevel → grupp), så
// addonet kan räkna fram DE-värdet för vilket föremål som helst, även Forevers nya. Vapen-tabellen gäller också sköldar
// och off-hand (InventoryType 14/23). Banden byggs ur databasen: högsta itemlevel per grupp.
{
  const bands = {};
  for (const r of db.prepare("SELECT DisenchantID d, Quality q, CASE WHEN class = 2 OR InventoryType IN (14, 23) THEN 'w' ELSE 'a' END k, max(ItemLevel) hi, count(*) n FROM item_template WHERE DisenchantID > 0 AND Quality BETWEEN 2 AND 4 GROUP BY d, q, k HAVING n >= 3 ORDER BY q, k, hi").all()) {
    const b = (bands[r.q] = bands[r.q] || {})[r.k] = (bands[r.q] || {})[r.k] || [];
    if (!b.some(x => x[1] === r.d)) b.push([r.hi, r.d]);
  }
  for (const q of Object.keys(bands)) for (const k of Object.keys(bands[q])) bands[q][k].sort((a, b) => a[0] - b[0]);
  const lua = ["-- SiteDisenchant.lua – GENERERAD av dashboard/ah-sida/hamta-disenchant.js, ändra inte för hand.",
    "-- Vad disenchant ger (cmangos classic-db, GPL): g[grupp] = { material, chans, snittantal, … }; bands[kvalitet].w/.a =",
    "-- { högsta itemlevel, grupp, … } för vapen (även sköld/off-hand) och rustning. Disenchant.lua räknar värdet.",
    "local _, ns = ...", "ns.SITE_DE = {", "  g = {"];
  for (const [gid, list] of Object.entries(groups)) lua.push("    [" + gid + "] = { " + list.map(x => x[0] + ", " + x[1] + ", " + x[2]).join(", ") + " },");
  lua.push("  },", "  bands = {");
  for (const q of Object.keys(bands)) lua.push("    [" + q + "] = { " + Object.keys(bands[q]).map(k => k + " = { " + bands[q][k].map(x => x[0] + ", " + x[1]).join(", ") + " }").join(", ") + " },");
  lua.push("  },", "}", "");
  fs.writeFileSync(path.join(__dirname, "..", "..", "addon", "WhippitPanel", "SiteDisenchant.lua"), lua.join("\n"));
  console.log("SiteDisenchant.lua: " + Object.keys(groups).length + " grupper, band för kvalitet " + Object.keys(bands).join("/"));
  // disenchant.json med banden (build.js grupperar Joakims loggar likadant som addonet).
  fs.writeFileSync(path.join(__dirname, "disenchant.json"), JSON.stringify({ t: Date.now(), source: "cmangos classic-db (GPL), 1.12", mats, groups, items, bands }));
  console.log("disenchant.json: " + Object.keys(groups).length + " grupper, " + Object.keys(items).length + " föremål, " + Object.keys(mats).length + " material");
}
