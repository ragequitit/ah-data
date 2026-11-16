// api-koll.js – veckans genomsökning av Blizzards Forever-API (Joakim 2026-11-28: "kör den här genomsökningen automatiskt en
// gång i veckan"). Provar ~170 vägar (speldata, auktionsindex, profil för två kända spelare, guild), jämför med förra
// körningen och skriver vad som tillkommit och försvunnit:
//   api-koll.json      senaste svaret per väg { väg: { s: status, k: [nycklar], n: { lista: antal } } }
//   api-koll.txt       senaste rapporten (läsbar)
//   api-koll-logg.txt  alla rapporter, nyast sist
// Ändring → notis till telefonen via samma ntfy-ämne som klippen (tools/klipp-notis.json; av = true stänger av båda).
// Körs av synka.js när api-koll.json är äldre än 7 dygn (i bakgrunden), eller för hand: node api-koll.js [--tyst]
// Listornas antal jämförs bara för speldata (index: mounts, set, recept …); profilernas listor växer av sig själva.
// Rutterna med 9–19 MB auktioner hämtas inte: bara husindexet. Vi använder-listan står i minnet (reference-blizzard-api-forever).
const fs = require("fs");
const path = require("path");
const B = require("./blizzard.js");
const OUT = path.join(__dirname, "api-koll.json"), TXT = path.join(__dirname, "api-koll.txt"), LOGG = path.join(__dirname, "api-koll-logg.txt");
const CFG = path.join(__dirname, "..", "..", "tools", "klipp-notis.json");
const TYST = process.argv.includes("--tyst");
const S = "stat", D = "dyn", P = "prof";
const CHS = ["/profile/wow/character/alisee-alistar", "/profile/wow/character/zonen-crash"];
const G = "/data/wow/guild/egentid";
const d = p => "/data/wow/" + p;
const PATHS = [
  ...["achievement-category/index", "achievement/index", "achievement/63969", "media/achievement/63969",
    "creature-family/index", "creature-family/1", "creature-type/index", "creature/30", "creature/448", "search/creature?name.en_GB=wolf", "search/creature?name.en_US=Hogger", "media/creature-display/30",
    "guild-crest/index", "item-class/index", "item-class/2", "item-class/2/item-subclass/0", "item-subclass/index", "item/4306", "item/720", "item/19019", "media/item/4306",
    "search/item?name.en_GB=silk&_pageSize=5", "item-set/index", "item-set/1671", "search/media?tags=item&_pageSize=5",
    "item-appearance/set/index", "item-appearance/slot/index", "item-appearance/1",
    "mount/index", "mount/6", "search/mount?name.en_US=wolf", "pet/index", "pet-ability/index", "toy/index", "title/index", "heirloom/index",
    "playable-class/index", "playable-class/9", "media/playable-class/9", "playable-race/index", "playable-race/5", "playable-specialization/index", "power-type/index",
    "profession/index", "profession/164", "profession/164/skill-tier/2938", "recipe/1631", "media/recipe/1631", "media/profession/164",
    "quest/index", "quest/category/index", "quest/area/index", "quest/type/index", "quest/783", "search/quest?name.en_US=wolf",
    "reputation-faction/index", "reputation-faction/76", "reputation-tiers/index",
    "spell/17123", "spell/133", "media/spell/17123", "search/spell?name.en_GB=fireball",
    "talent-tree/index", "talent/index", "talent/134370", "tech-talent-tree/index", "tech-talent/index", "pvp-talent/index", "pvp-tier/index",
    "journal-expansion/index", "journal-instance/index", "journal-instance/230", "journal-encounter/index", "search/journal-encounter?name.en_GB=hogger",
    "covenant/index", "conduit/index", "soulbind/index", "keystone-affix/index", "azerite-essence/index", "modified-crafting/index", "mythic-keystone/dungeon/index",
    "decor/index", "search/decor?name.en_US=chair", "fixture/index", "fixture-hook/index", "room/index", "search/achievement?name.en_US=level",
  ].map(p => [S, d(p)]),
  ...["ruleset/index", "ruleset/1/auctions/", "ruleset/1", "auctions/commodities", "connected-realm/index", "search/connected-realm?status.type=UP", "realm/index", "region/index",
    "token/index", "wow-token/index", "pvp-season/index", "pvp-region/index", "pvp-season/1/leaderboard/index", "mythic-keystone/index", "leaderboard/index"].map(p => [D, d(p)]),
  ...CHS.flatMap(CH => ["", "/status", "/equipment", "/professions", "/reputations", "/statistics", "/character-media", "/appearance", "/titles", "/specializations", "/hunter-pets",
    "/achievements", "/achievements/statistics", "/collections", "/collections/mounts", "/collections/pets", "/collections/toys", "/collections/heirlooms", "/collections/transmogs", "/collections/decor",
    "/quests", "/quests/completed", "/pvp-summary", "/pvp-bracket/2v2", "/encounters", "/encounters/dungeons", "/encounters/raids", "/soulbinds", "/mythic-keystone-profile", "/house", "/professions/crafting-orders"].map(s => [P, CH + s])),
  ...["", "/roster", "/achievements", "/activity"].map(s => [P, G + s]),
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const nu = {};
  for (const [ns, p] of PATHS) {
    let r = null;
    for (let f = 0; f < 3; f++) { try { r = await B.get(p, ns); } catch (e) { r = { status: 0, json: null }; } if (r.status !== 429 && r.status !== 0) break; await sleep(3000); }
    const j = r.json, o = { s: r.status };
    if (j && typeof j === "object") {
      o.k = Object.keys(j).filter(k => k !== "_links" && k !== "character").sort();
      const n = {}; for (const k of o.k) if (Array.isArray(j[k])) n[k] = j[k].length;
      if (Object.keys(n).length) o.n = n;
    }
    nu[p] = o;
  }
  // namespace: pekar static-forever-eu fortfarande på förlanseringsbygget?
  try { const it = await B.get("/data/wow/item/4306", S); nu._static = (String(it.json && it.json._links && it.json._links.self.href || "").match(/namespace=([^&]+)/) || [])[1] || "?"; } catch (e) { nu._static = "?"; }
  // husen (namn per id)
  try { const ah = await B.get(d("ruleset/1/auctions/"), D); nu._hus = (ah.json && ah.json.auctions || []).map(a => a.id + " " + a.name).sort(); } catch (e) { nu._hus = []; }
  // antal recept (alla yrken)
  try {
    let tot = 0; const pi = await B.get(d("profession/index"), S);
    for (const pr of (pi.json && pi.json.professions) || []) { const pp = await B.get(d("profession/" + pr.id), S); for (const st of (pp.json && pp.json.skill_tiers) || []) { const t = await B.get(d("profession/" + pr.id + "/skill-tier/" + st.id), S); tot += ((t.json && t.json.categories) || []).reduce((a, c) => a + (c.recipes || []).length, 0); } }
    nu._recept = tot;
  } catch (e) { nu._recept = -1; }

  let fore = null; try { fore = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) { /* första körningen */ }
  const ny = [], borta = [], andrat = [];
  const ok = o => o && o.s === 200 && o.k && o.k.length > 0 && !(o.k.length === 0);
  if (fore) {
    for (const [p, o] of Object.entries(nu)) {
      if (p[0] === "_") continue;
      const f = fore[p]; if (!f) continue;
      const kort = p.replace(/^\/profile\/wow\/character\/[^/]+/, "karaktär").replace(/^\/data\/wow\//, "");
      if (ok(o) && !ok(f)) { ny.push(kort + " svarar nu (" + (o.k || []).slice(0, 6).join(", ") + ")"); continue; }
      if (!ok(o) && ok(f)) { borta.push(kort + " svarar inte längre (" + o.s + (o.k && !o.k.length ? ", tomt" : "") + ")"); continue; }
      if (ok(o) && ok(f)) {
        const plus = o.k.filter(k => !f.k.includes(k)), minus = f.k.filter(k => !o.k.includes(k));
        if (plus.length) ny.push(kort + ": nya fält " + plus.join(", "));
        if (minus.length && !p.startsWith("/profile")) borta.push(kort + ": fält borta " + minus.join(", "));
        if (!p.startsWith("/profile")) for (const [k, n] of Object.entries(o.n || {})) { const m = f.n && f.n[k]; if (m != null && m !== n) andrat.push(kort + " " + k + ": " + m + " → " + n); }
      }
    }
    // samma väg kan ge nya fält hos en karaktär men inte den andra: räkna bara fält som ingen av dem hade förut
    if (nu._static !== fore._static) andrat.push("speldatans bygge: " + fore._static + " → " + nu._static);
    const h0 = new Set(fore._hus || []), h1 = new Set(nu._hus || []);
    for (const h of h1) if (!h0.has(h)) ny.push("auktionshus " + h);
    for (const h of h0) if (!h1.has(h)) borta.push("auktionshus " + h);
    if (fore._recept > 0 && nu._recept > 0 && fore._recept !== nu._recept) andrat.push("recept: " + fore._recept + " → " + nu._recept);
  }
  const dag = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).slice(0, 16);
  const svarar = Object.entries(nu).filter(([p, o]) => p[0] !== "_" && ok(o)).length, alla = Object.keys(nu).filter(p => p[0] !== "_").length;
  const rap = ["Blizzards Forever-API " + dag + ": " + svarar + " av " + alla + " vägar svarar med innehåll · bygge " + nu._static + " · " + (nu._hus || []).length + " auktionshus · " + nu._recept + " recept",
    !fore ? "Första körningen: nästa vecka jämförs mot den här." : !(ny.length || borta.length || andrat.length) ? "Inget har ändrats sedan " + new Date(fore._t).toLocaleDateString("sv-SE") + "." : "",
    ...(ny.length ? ["Tillkommet:", ...ny.map(x => "  + " + x)] : []), ...(borta.length ? ["Försvunnet:", ...borta.map(x => "  - " + x)] : []), ...(andrat.length ? ["Ändrat:", ...andrat.map(x => "  ~ " + x)] : [])].filter(Boolean).join("\n");
  nu._t = Date.now();
  fs.writeFileSync(OUT, JSON.stringify(nu));
  fs.writeFileSync(TXT, rap + "\n");
  fs.appendFileSync(LOGG, rap + "\n\n");
  console.log(rap);
  // notis bara vid ändring
  if (fore && (ny.length || borta.length || andrat.length) && !TYST) {
    let cfg = null; try { cfg = JSON.parse(fs.readFileSync(CFG, "utf8")); } catch (e) { /* ingen notis */ }
    if (cfg && cfg.topic && !cfg.av) {
      const body = { topic: cfg.topic, title: "Blizzards API: " + ny.length + " nya, " + borta.length + " borta, " + andrat.length + " ändrade", message: [...ny.map(x => "+ " + x), ...borta.map(x => "- " + x), ...andrat.map(x => "~ " + x)].slice(0, 8).join("\n"), tags: ["satellite"], priority: 3 };
      try { const r = await fetch("https://ntfy.sh/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); console.log(r.ok ? "Notis skickad." : "Notisen gick inte fram: HTTP " + r.status); } catch (e) { console.log("Notisen gick inte fram: " + e.message); }
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
