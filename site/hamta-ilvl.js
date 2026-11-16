// hamta-ilvl.js – item level per utrustningsbart föremål till Armoryn: item-ilvl.json = { id: itemlevel }.
// Joakim 2026-11-27: Nasty Licker visade "Item level 0" – Blizzards profil-API ger 0 för vissa karaktärer, både på
// karaktären (equipped_item_level) och på varje plagg (level.value). Sidan fyller då i från den här listan.
// Källor, sist vinner: 1) cmangos 1.12 (classicmangos.sqlite, item_template, om filen finns), 2) Forevers klient
// (wago ItemSparse.csv, även Forevers nya föremål), 3) spelets egen GetItemInfo i Whippit AH-sparfilen (ahItems fält 9).
// Befintliga värden i item-ilvl.json behålls när en källa saknas, så skriptet kan köras om utan sqlite-filen.
// node hamta-ilvl.js [sökväg till classicmangos.sqlite]
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "item-ilvl.json");
const SQLITE = process.argv[2] || "C:/Users/joaki/AppData/Local/Temp/claude/b5d1d19d2ed4b16a/c08c448a-d6ba-4088-b82e-9c11aac1ee98/scratchpad/classicdb/dump/classicmangos.sqlite";
const WAGO = "C:/Users/joaki/wow/data/wago";
const out = {};
try { Object.assign(out, JSON.parse(fs.readFileSync(OUT, "utf8"))); } catch (e) {}
const n0 = Object.keys(out).length;
const put = (id, lv, src) => { if (id > 0 && lv > 0) { out[id] = lv; cnt[src] = (cnt[src] || 0) + 1; } };
const cnt = {};
// 1) cmangos 1.12
if (fs.existsSync(SQLITE)) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(SQLITE, { readOnly: true });
    for (const r of db.prepare("select entry, ItemLevel from item_template where InventoryType > 0").all()) put(r.entry, r.ItemLevel, "cmangos");
  } catch (e) { console.log("cmangos: " + e.message); }
} else console.log("cmangos: ingen fil (" + SQLITE + "), behåller tidigare värden");
// 2) Forevers klient (senaste builden)
function parseLine(l) { const a = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ",") { a.push(cur); cur = ""; } else cur += c; } a.push(cur); return a; }
const builds = fs.existsSync(WAGO) ? fs.readdirSync(WAGO).filter(d => fs.existsSync(path.join(WAGO, d, "ItemSparse.csv"))).sort() : [];
if (builds.length) {
  const lines = fs.readFileSync(path.join(WAGO, builds[builds.length - 1], "ItemSparse.csv"), "utf8").split(/\r?\n/);
  const h = parseLine(lines[0]), iID = h.indexOf("ID"), iL = h.indexOf("ItemLevel"), iInv = h.indexOf("InventoryType");
  for (let k = 1; k < lines.length; k++) { if (!lines[k]) continue; const p = parseLine(lines[k]); if (+p[iInv] > 0) put(+p[iID], +p[iL], "klient"); }
}
// 3) spelets GetItemInfo (namn|kvalitet|klass|underklass|plats|ikon|krav|säljpris|stack|itemlevel|…)
try {
  const spel = require("./spelfil").load();
  for (const [id, s] of Object.entries(spel.ahItems || {})) {
    const p = String(s).split("|");
    if (p[4] && !/NON_EQUIP/.test(p[4])) put(+id, +p[9], "spelet");
  }
} catch (e) { console.log("spelet: " + e.message); }
fs.writeFileSync(OUT, JSON.stringify(out));
console.log("item-ilvl.json: " + Object.keys(out).length + " föremål (förut " + n0 + ") " + JSON.stringify(cnt));
