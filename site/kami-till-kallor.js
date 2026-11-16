// kami-till-kallor.js – gör kami-kallor.json ur receptdatan som ligger inbäddad i kami-labs Forever-guider
// (kami-labs.fr/en/guide-<yrke>-wow-forever/, uttagen 2026-11-21 av en faktagranskare till en JSON-fil per yrke:
// [{ e: engelskt namn, k: [lär, gul, grön, grå], o: källa, h: källtext, sc: specialisering, s: c ändrad / n ny / s samma }]).
// Kör: node kami-till-kallor.js <sökväg till kami.json>
// Används bara som KORSKONTROLL i hamta-skillup.js: wikin (wiki-kallor.txt) och spelklientens trösklar går först, kami avgör
// när wikin har två rader för samma recept (gammalt Classic-värde och nytt Forever-värde), fyller i okänd källa och märker
// ryktesrecept, Merchant's Favor-recept, specialiseringar och handlare som bara den ena fraktionen når.
// Rad i filen: "yrkesid|namn (gemener)": [lär, gul, grå, källa, specialisering 0/1, handlartext, fraktion "A"/"H"/"", status].
const fs = require("fs"), path = require("path");
const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error("ange sökvägen till kami.json"); process.exit(1); }
const K = JSON.parse(fs.readFileSync(src, "utf8"));
const PROF = { alchimie: 171, couture: 197, cuisine: 185, ench: 333, forge: 164, ingenierie: 202, secourisme: 129, "travail-du-cuir": 165 };
const out = {}, ids = {}; let n = 0, dup = 0;
for (const p in K) {
  if (!PROF[p]) { console.error("okänt yrke i kami.json:", p); continue; }
  for (const r of K[p]) {
    if (!r.e || !Array.isArray(r.k)) continue;
    const key = PROF[p] + "|" + r.e.toLowerCase(), h = r.h || "";
    const m = h.match(/Buy the recipe from ([^()]+?) \(([^)]+)\)/);
    const row = [r.k[0] || 0, r.k[1] || 0, r.k[3] || 0, r.o || "unknown", r.sc ? 1 : 0, m ? m[1].trim() + ", " + m[2].trim() : "", /Alliance only/.test(h) ? "A" : /Horde only/.test(h) ? "H" : "", r.s || ""];
    if (r.id) ids[r.id] = row;   // spell-id: exakt träff även när ett gammalt och ett nytt recept heter likadant
    if (out[key]) { dup++; if (out[key][0] && row[0] && out[key][0] <= row[0]) continue; }   // samma namn två gånger: den lägre lär-skillen (Forevers)
    out[key] = row; n++;
  }
}
fs.writeFileSync(path.join(__dirname, "kami-kallor.json"), JSON.stringify({ t: Date.now(), source: "kami-labs.fr WoW Forever profession guides (embedded recipe data), extracted 2026-11-21", recipes: out, ids }));
console.log("kami-kallor.json:", Object.keys(out).length, "recept (" + dup + " dubbletter),", Math.round(fs.statSync(path.join(__dirname, "kami-kallor.json")).size / 1024), "kB");
