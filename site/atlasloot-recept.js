// atlasloot-recept.js – skillkrav för recepten ur AtlasLoot Classic Forever (GPL-2.0, Sliccer; samma nedladdning som
// atlasloot-forever.js). AtlasLootClassic/Data/Profession.lua har [spellID] = { tillverkad vara, yrke, kravnivå, gul, grön,
// { reagenser }, { antal }, st } även för Forever-nya recept (nya spell-id, men samma vara och reagenser som Blizzards data).
// Blizzards Game Data API ger inga kravnivåer, så recept-merge.js använder den här filen när Classic-databasen saknar nivå.
// Kör: node dashboard/ah-sida/atlasloot-recept.js <sökväg till Profession.lua> <AtlasLoot-version>
//   → recept-atlasloot.json { version, items: { vara: [ { spell, prof (Blizzards skill-id), skill, reagents: [id...] } ] } }
const fs = require("fs");
const path = require("path");
const [file, version] = process.argv.slice(2);
if (!file) { console.error("Ange Profession.lua"); process.exit(1); }
const src = fs.readFileSync(file, "utf8").split("PROFESSION_DATA.BCC")[0];   // bara Classic/Forever-delen
// AtlasLoots yrkesnummer -> Blizzards skill-id (som recept.json använder).
const PROF = { 1: 129, 2: 164, 3: 165, 4: 171, 6: 185, 7: 186, 8: 197, 9: 202, 10: 333 };
const items = {};
let n = 0;
for (const m of src.matchAll(/\[(\d+)\] = \{ (nil|\d+), (\d+), (\d+), (\d+), (\d+), \{([^}]*)\}/g)) {
  const [, spell, item, prof, skill, , , reag] = m;
  if (item === "nil" || !PROF[prof]) continue;
  const reagents = reag.split(",").map(s => +s.trim()).filter(Boolean);
  (items[item] = items[item] || []).push({ spell: +spell, prof: PROF[prof], skill: +skill, reagents });
  n++;
}
const out = { version: version || "?", source: "AtlasLoot Classic Forever (GPL-2.0)", items };
fs.writeFileSync(path.join(__dirname, "recept-atlasloot.json"), JSON.stringify(out));
console.log("recept-atlasloot.json:", n, "recept,", Object.keys(items).length, "varor");
