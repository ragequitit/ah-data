// hamta-skillup.js – underlaget till skillguiderna 1–300 på sajten (Joakim 2026-11-21: "en skillguide ska gå till så här").
// Skriver skillup.json:
//   th[receptId] = [gul, grå]: var receptet blir gult och grått, ur Forevers egen klientdata på wago.tools
//     (data/wago/<build>/SkillLineAbility.csv + SpellName.csv, samma tabeller som hamta-klasser.js). recept.json har
//     Blizzards recept-id, inte spell-id, så raden hittas på namn + skill line. Grönt = mitt emellan gult och grått
//     (så räknar cmangos: orange 100 %, gult 75 %, grönt 25 %, grått 0 % chans till skill per tillverkning).
//   trainers[skillId] = [[npc, namn, titel, zon, x, y, fraktion]]: yrkestränarna ur Classic-databasen (creature_template
//     TrainerType 2 + npc_trainer/npc_trainer_template med reqskill = yrket), platser via zonkartor/zon.js.
//   vendors[item] = samma form: handlarna som säljer Mining Pick (2901), Skinning Knife (7005) och Blacksmith Hammer (5956).
// Fraktion: H/A ur NPC:ns faction template (Classic-databasens vanliga id:n), annars "" = båda. Kör: node hamta-skillup.js
const fs = require("fs"), path = require("path");
const { DatabaseSync } = require("node:sqlite");
const WAGO_DIR = path.join(__dirname, "..", "..", "data", "wago");
const BUILD = fs.existsSync(WAGO_DIR) ? fs.readdirSync(WAGO_DIR).filter(d => /^\d/.test(d)).sort().pop() : "";
if (!BUILD) { console.error("ingen klientdata i " + WAGO_DIR); process.exit(1); }
const db = new DatabaseSync(path.join(__dirname, "..", "..", "data", "classicdb", "classicmangos.sqlite"), { readOnly: true });
const { zoneOf } = require("./zonkartor/zon.js");
const R = JSON.parse(fs.readFileSync(path.join(__dirname, "recept.json"), "utf8"));

function csv(f) {
  const L = fs.readFileSync(path.join(WAGO_DIR, BUILD, f), "utf8").split(/\r?\n/).filter(Boolean), H = L[0].split(",");
  return L.slice(1).map(l => {
    const c = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; continue; }   // "" inne i ett citat är ett citattecken (Goblin "Boom" Box)
      if (ch === "," && !q) { c.push(cur); cur = ""; } else cur += ch;
    }
    c.push(cur); const o = {}; H.forEach((h, i) => { o[h] = c[i]; }); return o;
  });
}
// ---------- trösklarna ----------
const SN = {}; csv("SpellName.csv").forEach(r => { SN[r.ID] = r.Name_lang; });
const byKey = {}, SLAID = {};   // SLAID: SkillLineAbility.ID -> rad; recept.json "spell" är just det id:t (1 997 av 1 997 recept)
csv("SkillLineAbility.csv").forEach(r => { if (+r.TrivialSkillLineRankHigh > 0) { SLAID[r.ID] = { spell: +r.Spell, line: +r.SkillLine, lo: +r.TrivialSkillLineRankLow, hi: +r.TrivialSkillLineRankHigh }; const k = r.SkillLine + "|" + (SN[r.Spell] || "").toLowerCase(); (byKey[k] = byKey[k] || []).push([+r.MinSkillLineRank, +r.TrivialSkillLineRankLow, +r.TrivialSkillLineRankHigh]); } });
// ---------- var receptet lärs i Forever, och vid vilken skill ----------
// Tre källor (faktagranskning 2026-11-21):
//   wikin (wiki-kallor.txt, hamta-wiki-kallor.js): skill och källa per recept. Tio Tailoring-recept med flera står TVÅ gånger,
//     med Classic-värdet och Forevers sänkta värde (Black Mageweave Leggings 205 och 170).
//   klienten (SkillLineAbility): gul och grå tröskel, färskast (hotfixar), men samma namn kan ha två rader.
//   kami (kami-kallor.json, kami-till-kallor.js): lär/gul/grå per spell-id, källa med ryktesrecept, Merchant's Favor,
//     specialiseringar och fraktionslåsta handlare. Korskontroll: avgör dubbla rader och fyller i okänd källa.
// wk[receptId] = [skill, källa]: T tränare, A automatiskt, V handlare, R rykte/Favor krävs, D drop, Q quest, S specialisering,
// C tillverkas, ? okänd. Guiden tar T och A, V som andra val, inget annat. kx[receptId] = [handlartext, fraktion] där kami vet.
const th = {}, wk = {}, kx = {}; let hit = 0, wkHit = 0; const miss = [];
const WROWS = {};   // yrkesid|namn -> [[skill, källa], …], alla wikins rader
const WALL = {};    // yrkesid|namn -> [skill, källa] efter sammanvägningen (även förtrollningarna)
let KAMI = {}, KAMIID = {};
try { const kj = JSON.parse(fs.readFileSync(path.join(__dirname, "kami-kallor.json"), "utf8")); KAMI = kj.recipes || {}; KAMIID = kj.ids || {}; } catch (e) { console.error("kami-kallor.json saknas: ingen korskontroll"); }
try {
  for (const l of fs.readFileSync(path.join(__dirname, "wiki-kallor.txt"), "utf8").split(/\r?\n/)) {
    if (!l || l[0] === "#") continue;
    const c = l.split("|"); if (c.length < 5) continue;
    const t = c[4].trim();
    const code = /^Trainer/i.test(t) ? "T" : /^Automatic/i.test(t) ? "A" : /^Special trainer/i.test(t) ? "S" : /^(Friendly|Honored|Revered|Exalted)/i.test(t) ? "R" : /^Vendor/i.test(t) ? "V" : /^Drop/i.test(t) ? "D" : /^Quest/i.test(t) ? "Q" : /^Crafted/i.test(t) ? "C" : "?";
    const k = c[0] + "|" + c[1].replace(/#.*$/, "").replace(/ \(Forever\)$/i, "").trim().toLowerCase();   // "X (Forever)" är det nya receptet med samma namn
    (WROWS[k] = WROWS[k] || []).push([+c[2] || 0, code]);
  }
} catch (e) { console.error("wiki-kallor.txt saknas (kör hamta-wiki-kallor.js): guiden faller tillbaka på Classic-databasens källor"); }
function resolve(prof, name, sla) {   // -> [skill, källa] eller null när ingen källa känner receptet. sla: klientens rad för just det här receptet
  const key = prof + "|" + name.toLowerCase(), rows = WROWS[key] || [], k = (sla && KAMIID[sla.spell]) || KAMI[key] || null;
  if (!rows.length && !k) return null;
  const ye = sla ? sla.lo : k ? k[1] : 0;
  // flera wikirader med samma namn (Classic-värdet och Forevers, eller ett gammalt och ett nytt recept): den som ligger närmast
  // kamis lär-skill, annars den högsta som inte ligger över klientens gula tröskel, annars den lägsta
  let row = rows[0] || null;
  if (rows.length > 1) {
    const withSkill = rows.filter(r => r[0] > 0);
    if (withSkill.length) {
      if (k && k[0] > 0) row = withSkill.slice().sort((x, y) => Math.abs(x[0] - k[0]) - Math.abs(y[0] - k[0]))[0];
      else { const under = withSkill.filter(r => !ye || r[0] <= ye); row = (under.length ? under : withSkill).slice().sort((x, y) => under.length ? y[0] - x[0] : x[0] - y[0])[0]; }
    }
  }
  let skill = row && row[0] > 0 ? row[0] : k && k[0] > 0 ? k[0] : 0, code = row ? row[1] : "?";
  if (ye && skill > ye && k && k[0] > 0 && k[0] <= ye) skill = k[0];   // lär-skill över gult: wikins tal är Classic-värdet, kami har Forevers
  if (k) {
    if (k[3] === "reputation" || k[3] === "favor" || k[3] === "token") code = "R";
    else if (code === "?") code = { trainer: "T", auto: "A", vendor: "V", drop: "D", quest: "Q" }[k[3]] || "?";
    if (k[4]) code = "S";
  }
  return [skill, code];
}
function pickTh(a, prof, name, target) {   // reserv när receptets id saknas i klienten: en rad med namnet = den; flera = närmast kamis gul/grå, annars närmast över lär-skillen
  if (a.length === 1) return a[0];
  const k = KAMI[prof + "|" + name.toLowerCase()];
  if (k && k[1] > 0 && k[2] > 0) return a.slice().sort((x, y) => Math.abs(x[1] - k[1]) + Math.abs(x[2] - k[2]) - Math.abs(y[1] - k[1]) - Math.abs(y[2] - k[2]))[0];
  return a.slice().sort((x, y) => (x[1] >= target ? x[1] - target : 1000 + target - x[1]) - (y[1] >= target ? y[1] - target : 1000 + target - y[1]))[0];
}
for (const k in WROWS) { const i = k.indexOf("|"), w = resolve(k.slice(0, i), k.slice(i + 1), null); if (w) WALL[k] = w; }
for (const k in KAMI) if (!WALL[k]) { const i = k.indexOf("|"), w = resolve(k.slice(0, i), k.slice(i + 1), null); if (w) WALL[k] = w; }
let byId = 0;
for (const rc of R.recipes) {
  const key = rc.prof + "|" + rc.name.toLowerCase(), sla = SLAID[rc.spell] && SLAID[rc.spell].line === rc.prof ? SLAID[rc.spell] : null;
  const w = resolve(rc.prof, rc.name, sla), kk = (sla && KAMIID[sla.spell]) || KAMI[key];
  if (w) { wk[rc.spell] = w; wkHit++; }
  if (kk && (kk[5] || kk[6])) kx[rc.spell] = [kk[5], kk[6]];
  // Klientens gul/grå gäller som de står: Forever har sänkt dem på hundratals gamla recept, och receptlistans skill (Classic)
  // ligger då över (Runecloth Belt: receptlistan 255, klienten 225/255, lärs vid 210).
  if (sla) { th[rc.spell] = [sla.lo, sla.hi]; hit++; byId++; continue; }
  const a = byKey[key];
  if (!a) { miss.push(rc.name); continue; }
  const best = pickTh(a, rc.prof, rc.name, w && w[0] > 0 ? w[0] : rc.skill);
  th[rc.spell] = [best[1], best[2]];
  hit++;
}
console.log("trösklar på recept-id:", byId, "på namn:", hit - byId);
// ---------- tränare och handlare ----------
const HORDE_FT = new Set([29, 68, 81, 104, 105, 106, 126, 530, 1494, 1610, 1611, 1612]);   // Orgrimmar, Undercity, Thunder Bluff, Horde, Darkspear, Revantusk …
const ALLY_FT = new Set([11, 12, 55, 57, 79, 80, 84, 85, 123, 694, 875, 894, 1534]);   // 694 Aerie Peak, 894 Theramore; 120 är Booty Bay (båda)
const HOSTILE_FT = new Set([76]);   // fientliga mobbar som råkar sälja något (Dalaran Miner)
const NAME_F = {};
const H_ZONES = new Set(["Orgrimmar", "Undercity", "Thunder Bluff", "Durotar", "Mulgore", "Tirisfal Glades", "Silverpine Forest"]);
const A_ZONES = new Set(["Stormwind City", "Ironforge", "Darnassus", "Elwynn Forest", "Dun Morogh", "Teldrassil", "Westfall", "Loch Modan", "Darkshore", "Redridge Mountains", "Duskwood", "Wetlands"]);
const spawnC = db.prepare("SELECT map, position_x x, position_y y FROM creature WHERE id = ? AND map IN (0, 1) ORDER BY guid LIMIT 1");
const ct = db.prepare("SELECT Entry e, Name n, SubName s, Faction f, TrainerType tt, TrainerTemplateId tid, VendorTemplateId vid FROM creature_template WHERE Entry = ?");
const r1 = x => Math.round(x * 10) / 10;
function place(entry) {
  const c = ct.get(entry); if (!c || HOSTILE_FT.has(c.f)) return null;
  const s = spawnC.get(entry); if (!s) return null;
  const z = zoneOf(s.map, s.x, s.y, null, false); if (!z) return null;
  const f = NAME_F[c.n] ? NAME_F[c.n] : HORDE_FT.has(c.f) ? "H" : ALLY_FT.has(c.f) ? "A" : H_ZONES.has(z.z.name) ? "H" : A_ZONES.has(z.z.name) ? "A" : "";
  return [c.e, c.n, c.s || "", z.z.name, r1(z.u * 100), r1(z.v * 100), f, c.f];
}
const trDirect = db.prepare("SELECT DISTINCT t.entry e FROM npc_trainer t JOIN creature_template c ON c.Entry = t.entry WHERE t.reqskill = ? AND c.TrainerType = 2");
const trTmpl = db.prepare("SELECT DISTINCT c.Entry e FROM creature_template c JOIN npc_trainer_template t ON t.entry = c.TrainerTemplateId WHERE t.reqskill = ? AND c.TrainerType = 2");
const SKILLS = { 129: "First Aid", 164: "Blacksmithing", 165: "Leatherworking", 171: "Alchemy", 182: "Herbalism", 185: "Cooking", 186: "Mining", 197: "Tailoring", 202: "Engineering", 333: "Enchanting", 356: "Fishing", 393: "Skinning" };
// Tränarens tak: 300 om hen lär ut Artisan (raden med reqskillvalue 200 vars spell heter "Artisan …"), 225 Expert, 150 Journeyman, annars 75.
const rankRows = db.prepare("SELECT spell, reqskillvalue v FROM npc_trainer WHERE entry = ? AND reqskill = ? UNION ALL SELECT t.spell, t.reqskillvalue FROM npc_trainer_template t JOIN creature_template c ON c.TrainerTemplateId = t.entry WHERE c.Entry = ? AND t.reqskill = ?");
function capOf(entry, sk) {
  let cap = 75;
  for (const r of rankRows.all(entry, sk, entry, sk)) { const n = SN[r.spell] || ""; if (/^Artisan /.test(n) && r.v === 200) cap = 300; else if (/^Expert /.test(n) && r.v === 125) cap = Math.max(cap, 225); else if (/^Journeyman /.test(n) && r.v === 50) cap = Math.max(cap, 150); }
  return cap;
}
const trainers = {}, facts = {};
for (const sk of Object.keys(SKILLS)) {
  const ids = new Set(); trDirect.all(+sk).forEach(r => ids.add(r.e)); trTmpl.all(+sk).forEach(r => ids.add(r.e));
  const list = [];
  for (const id of ids) { const p = place(id); if (p) { list.push(p.slice(0, 7).concat(capOf(id, +sk))); facts[p[7]] = (facts[p[7]] || 0) + 1; } }
  list.sort((a, b) => a[3].localeCompare(b[3]) || a[1].localeCompare(b[1]));
  trainers[sk] = list;
}
const veDirect = db.prepare("SELECT DISTINCT entry e FROM npc_vendor WHERE item = ?");
const veTmpl = db.prepare("SELECT DISTINCT c.Entry e FROM creature_template c JOIN npc_vendor_template v ON v.entry = c.VendorTemplateId WHERE v.item = ?");
const vendors = {};
for (const item of [2901, 7005, 5956, 16072, 16084, 6256, 16083]) {   // + Expert Cookbook, Expert First Aid - Under Wraps (Expert lärs ur en bok), Fishing Pole, Expert Fishing - The Bass and You
  const ids = new Set(); veDirect.all(item).forEach(r => ids.add(r.e)); veTmpl.all(item).forEach(r => ids.add(r.e));
  const list = [];
  for (const id of ids) { const p = place(id); if (p) list.push(p.slice(0, 7)); }
  list.sort((a, b) => a[3].localeCompare(b[3]) || a[1].localeCompare(b[1]));
  vendors[item] = list;
}
// rv[receptId] = handlarna som säljer själva receptet (Classic-databasen, receptföremålet i recept.json), samma form som tränarna:
// guiden visar var receptet köps och hoppar över handlarrecept som bara motståndarfraktionen kommer åt (granskning 2026-11-21).
const rv = {};
for (const rc of R.recipes) {
  if (!rc.recipeItem) continue;
  const ids = new Set(); veDirect.all(rc.recipeItem).forEach(r => ids.add(r.e)); veTmpl.all(rc.recipeItem).forEach(r => ids.add(r.e));
  const list = [];
  for (const id of ids) { const p = place(id); if (p) list.push(p.slice(0, 7)); }
  if (list.length) rv[rc.spell] = list;
}
console.log("recepthandlare:", Object.keys(rv).length, "recept");
// ench = förtrollningarna: Enchanting-recept utan tillverkad vara står inte i recept.json (Crafting-listan visar varor), men det är
// dem man levlar yrket på (buggsvep 2026-11-21: stegen bestod av wands, oljor och 63 Runed Truesilver Rod). Ur Blizzards
// receptlista (forever-recept.json: material), wikin (skill att lära, källa) och klienten (gul, grå).
// Rad: [receptId, namn, skill, gul, grå, källa, [[material, antal]]].
const ench = [];
try {
  const FR = JSON.parse(fs.readFileSync(path.join(__dirname, "forever-recept.json"), "utf8")), listed = new Set(R.recipes.map(r => r.spell));
  for (const id in FR.recipes) {
    const [name, prof, item, reagents] = FR.recipes[id];
    if (prof !== 333 || item || listed.has(+id) || !reagents || !reagents.length) continue;
    const sla = SLAID[id] && SLAID[id].line === 333 ? SLAID[id] : null;
    const a = sla ? [[0, sla.lo, sla.hi]] : byKey["333|" + name.toLowerCase()], w = resolve(333, name, sla);
    if (!a || !w || !(w[0] > 0)) continue;
    const best = pickTh(a, 333, name, w[0]), kk = (sla && KAMIID[sla.spell]) || KAMI["333|" + name.toLowerCase()];
    ench.push([+id, name, w[0], best[1], best[2], w[1], reagents, kk ? kk[5] : "", kk ? kk[6] : ""]);
  }
  ench.sort((x, y) => x[2] - y[2] || x[1].localeCompare(y[1]));
} catch (e) { console.error("förtrollningarna kunde inte läsas:", e.message); }
console.log("förtrollningar:", ench.length, JSON.stringify(ench.reduce((a, e) => { a[e[5]] = (a[e[5]] || 0) + 1; return a; }, {})));
const out = { t: Date.now(), build: BUILD, rv, ench, kx, source: "Skill thresholds from the WoW Forever client data (wago.tools); trainers and vendors from cmangos classic-db (GPL) 1.12; where recipes are learned from Warcraft Wiki (warcraft.wiki.gg, CC BY-SA 4.0), cross-checked against kami-labs.fr", th, wk, trainers, vendors };
console.log("wiki-källor:", wkHit, "av", R.recipes.length, "recept;", JSON.stringify(Object.values(wk).reduce((a, w) => { a[w[1]] = (a[w[1]] || 0) + 1; return a; }, {})));
console.log("tak per tränare:", JSON.stringify(Object.values(trainers).flat().reduce((a, t) => { a[t[7]] = (a[t[7]] || 0) + 1; return a; }, {})));
fs.writeFileSync(path.join(__dirname, "skillup.json"), JSON.stringify(out));
console.log("trösklar:", hit, "av", R.recipes.length, "recept; saknas:", miss.join(", ") || "–");
for (const sk of Object.keys(SKILLS)) console.log(SKILLS[sk] + ": " + trainers[sk].length + " tränare (" + trainers[sk].filter(x => x[6] === "H").length + " H, " + trainers[sk].filter(x => x[6] === "A").length + " A, " + trainers[sk].filter(x => !x[6]).length + " båda)");
for (const it of Object.keys(vendors)) console.log("handlare " + it + ": " + vendors[it].length);
console.log("faction templates:", JSON.stringify(facts));
console.log("okända fraktioner:", Object.values(trainers).flat().filter(x => !x[6]).map(x => x[1] + " (" + x[3] + ")").join("; "));
