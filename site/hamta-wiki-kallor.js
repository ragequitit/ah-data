// hamta-wiki-kallor.js – var Forevers recept lärs (tränare, handlare, drop …) ur Warcraft Wiki (warcraft.wiki.gg, CC BY-SA 4.0):
// sidorna "Forever <yrke> recipes/patterns/plans/…" har en tabell per yrke: | [[Namn]] || skill || … || Old/NEW || Källa.
// Skriver wiki-kallor.txt (yrke|recept|skill|ny|källa), som hamta-skillup.js läser: skillguiden tar bara recept som
// tränaren lär ut (buggjakt 2026-11-21: de nya Forever-recepten är mest köpta hos handlare). Kör: node hamta-wiki-kallor.js
const fs = require("fs"), path = require("path");
const PAGES = { 171: "Forever alchemy recipes", 164: "Forever blacksmithing plans", 185: "Forever cooking recipes", 333: "Forever enchanting formulas",
  202: "Forever engineering schematics", 129: "Forever first aid recipes", 165: "Forever leatherworking patterns", 197: "Forever tailoring patterns" };   // Mining-sidan är ingen receptlista
const clean = s => s.replace(/\{\{[^{}|]*\|[^{}|]*\|([^{}]*)\}\}/g, "$1").replace(/\{\{[^{}]*\}\}/g, "").replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/'''?/g, "").replace(/<[^>]+>/g, "").trim();
(async () => {
  const out = ["# Källa per Forever-recept ur Warcraft Wiki (warcraft.wiki.gg, CC BY-SA 4.0), hämtat " + new Date().toISOString().slice(0, 10) + ".", "# Format: yrkesid|recept|skill|NEW eller Old|källa. Läses av hamta-skillup.js."];
  for (const [prof, title] of Object.entries(PAGES)) {
    const r = await fetch("https://warcraft.wiki.gg/api.php?action=parse&page=" + encodeURIComponent(title) + "&prop=wikitext&format=json", { headers: { "User-Agent": "Mozilla/5.0 (compatible; recipe-source-check)" } });
    if (!r.ok) { console.error(title, r.status); continue; }
    const w = (await r.json()).parse.wikitext["*"];
    let n = 0; const src = {};
    for (const row0 of w.split(/\n\|-/)) {
      const row = row0.split(/\n\|\}/)[0];   // tabellens slut: resten av sidan hör inte till raden
      const line = row.replace(/\n/g, " ").trim();
      if (!line.startsWith("|") || line.indexOf("||") < 0) continue;
      const cells = line.replace(/^\|/, "").split("||").map(clean);
      const name = cells[0], skill = parseInt(cells[1], 10);
      if (!name || !(skill >= 0)) continue;
      const isNew = cells.some(c => /^NEW$/i.test(c)), source = cells[cells.length - 1] || "?";
      out.push(prof + "|" + name + "|" + skill + "|" + (isNew ? "NEW" : "Old") + "|" + source);
      src[source] = (src[source] || 0) + 1; n++;
    }
    console.log(title + ": " + n + " recept", JSON.stringify(src));
  }
  fs.writeFileSync(path.join(__dirname, "wiki-kallor.txt"), out.join("\n") + "\n");
})();
