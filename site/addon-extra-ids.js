// addon-extra-ids.js – skriver addon/WhippitPanel/ExtraTipIds.lua: föremål på hemsidans Dungeons- och Quests-flikar
// (dungeons.json, atlasloot-forever.json, quests.json) som addonet ska läsa spelets egen tooltip för (AuctionTips.lua),
// så sidan får kvalitetsfärg och riktig tooltip även för föremål Blizzards API döljer (nya Forever-föremål).
// Kör efter dungeon-db.js / atlasloot-forever.js / hamta-forever-quests.js:  node dashboard/ah-sida/addon-extra-ids.js
const fs = require("fs");
const path = require("path");
const ids = new Set();
for (const f of ["dungeons.json", "atlasloot-forever.json", "quests.json"]) {
  const p = path.join(__dirname, f);
  if (fs.existsSync(p)) for (const id of Object.keys(JSON.parse(fs.readFileSync(p, "utf8")).items || {})) if (+id > 0) ids.add(+id);
}
const list = [...ids].sort((a, b) => a - b), rows = [];
for (let i = 0; i < list.length; i += 14) rows.push("  " + list.slice(i, i + 14).join(", ") + ",");
const lua = "-- ExtraTipIds.lua – föremål på hemsidans Dungeons- och Quests-flikar som AuctionTips.lua läser spelets tooltip för\n" +
  "-- (genererad av dashboard/ah-sida/addon-extra-ids.js, ändra inte för hand). Ger hemsidan kvalitetsfärg och tooltip även\n" +
  "-- för föremål som Blizzards API döljer (nya Forever-föremål).\nlocal ADDON, ns = ...\nns.EXTRA_TIP_IDS = {\n" + rows.join("\n") + "\n}\n";
fs.writeFileSync(path.join(__dirname, "..", "..", "addon", "WhippitPanel", "ExtraTipIds.lua"), lua);
console.log("ExtraTipIds.lua:", list.length, "föremål");
