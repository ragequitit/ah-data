// recept-merge.js – gör recept.json för Professions-fliken med Blizzards Forever-recept som stomme (forever-recept.json,
// hamta-forever-recept.js: alla recept i spelet, Blizzards recept-id = profilens kända recept) och Classic-databasens
// uppgifter där de finns (recept-cmangos.json = gamla recept.json från recept-db.js: kravnivå, tränarpris, antal, recept-
// föremål, källor), matchade på tillverkad vara. Kör: node dashboard/ah-sida/recept-merge.js
//   Forever-nya recept får skill 0 (okänd), inga källor och Blizzards kategori som ledtråd.
const fs = require("fs");
const path = require("path");
const DIR = __dirname;
const FR = JSON.parse(fs.readFileSync(path.join(DIR, "forever-recept.json"), "utf8"));
const CM = JSON.parse(fs.readFileSync(path.join(DIR, "recept-cmangos.json"), "utf8"));
const SKIP_PROF = { 2933: 1 };   // "Test Profession [DNT]"
const SKIP_CAT = { "SEASON OF DISCOVERY": 1, Camping: 1 };

const byItem = {};   // tillverkad vara -> cmangos-recept (flera vid samma vara: samma namn vinner)
for (const r of CM.recipes) (byItem[r.item] = byItem[r.item] || []).push(r);
const items = Object.assign({}, CM.items);   // { id: [namn, kvalitet, handlarpris] }
for (const id in FR.items) if (!items[id]) items[id] = [FR.items[id], -1, 0];

// Skillkrav ur AtlasLoot Classic Forever (atlasloot-recept.js), där Classic-databasen saknar nivå (Forever-nya recept,
// och startrecept som cmangos sparar som 0). Samma yrke krävs; samma reagenser som Blizzards recept går först.
const ALF = path.join(DIR, "recept-atlasloot.json");
const AL = fs.existsSync(ALF) ? JSON.parse(fs.readFileSync(ALF, "utf8")) : { items: {} };
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
function alSkill(item, prof, reagents) {
  const cands = (AL.items[item] || []).filter(c => c.prof === prof && c.skill > 0);
  const ids = reagents.map(r => r[0]);
  const c = cands.find(x => sameSet(x.reagents, ids)) || cands[0];
  return c ? c.skill : 0;
}

// Sist: Warcraft Wiki (CC BY-SA 4.0), wiki-skill.txt "yrke|recept|skill", för det som varken cmangos eller AtlasLoot har.
const WPROF = { "first aid": 129, blacksmithing: 164, leatherworking: 165, alchemy: 171, cooking: 185, mining: 186,
  tailoring: 197, engineering: 202, enchanting: 333 };
const WIKI = {};
const WF = path.join(DIR, "wiki-skill.txt");
if (fs.existsSync(WF)) for (const line of fs.readFileSync(WF, "utf8").split(/\r?\n/)) {
  if (!line || line[0] === "#") continue;
  const [p, n, sk] = line.split("|");
  if (!(WPROF[p] && +sk > 0)) continue;
  const k = WPROF[p] + "|" + n;
  if (WIKI[k] != null && WIKI[k] !== +sk) WIKI[k] = -1;   // samma namn med olika nivå: osäkert, används inte
  else if (WIKI[k] == null) WIKI[k] = +sk;
}
for (const k in WIKI) if (WIKI[k] < 0) delete WIKI[k];

// Forevers egna skillkrav (Joakim 2026-11-21: "om det är något som är fel i skillkraven ska du rätta dem"). Forever har sänkt
// kravet på hundratals gamla recept (Runecloth Belt lärs vid 210, Classic 255), så Classic-databasens och AtlasLoots nivå
// stämmer inte längre. wiki-kallor.txt (hamta-wiki-kallor.js: Warcraft Wikis Forever-sidor, yrkesid|recept|skill|NEW/Old|källa)
// går därför före när wikin vet var receptet lärs (tränare, handlare, drop, quest). Rader utan känd källa ("?" eller
// Automatic) upprepar ibland bara klientens gula tröskel i stället för lär-skillen (Bolt of Linen Cloth står som 25): de
// gäller bara när talet ligger under gult (skillup.json th, hamta-skillup.js). Körordning: hamta-wiki-kallor.js,
// hamta-skillup.js, recept-merge.js.
const WK = {}, WKF = path.join(DIR, "wiki-kallor.txt");
if (fs.existsSync(WKF)) for (const line of fs.readFileSync(WKF, "utf8").split(/\r?\n/)) {
  if (!line || line[0] === "#") continue;
  const c = line.split("|"); if (c.length < 5 || !(+c[2] > 0)) continue;
  const k = c[0] + "|" + c[1].replace(/#.*$/, "").trim().toLowerCase(), known = !/^(\?|Automatic)/i.test(c[4].trim());
  if (WK[k] && WK[k][0] !== +c[2]) WK[k] = [0, false];   // samma namn med olika nivå: osäkert, används inte
  else if (!WK[k]) WK[k] = [+c[2], known];
}
const SKF = path.join(DIR, "skillup.json");
const SKJ = fs.existsSync(SKF) ? JSON.parse(fs.readFileSync(SKF, "utf8")) : {};
const TH = SKJ.th || {};
const WKS = SKJ.wk || {};   // hamta-skillup.js sammanvägning av wikin och kami: [skill, källa] per recept-id (löser wikins dubbla rader)
let fromForever = 0, lowered = 0, raised = 0; const doubted = [];
function foreverSkill(id, prof, name, skill) {
  if (prof === 186) return name === "Smelt Copper" ? 1 : skill;   // smältningen står inte i wikins receptlistor; Smelt Copper följer med Apprentice Mining
  const ws = WKS[id], w = ws ? [ws[0], ws[1] !== "?" && ws[1] !== "A"] : WK[prof + "|" + name.toLowerCase()], th = TH[id];
  if (!w || !(w[0] > 0)) return skill;
  if (!w[1] && !(th && w[0] < th[0]) && skill > 0) return skill;   // okänd källa och talet ligger inte under gult: listans nivå står kvar
  // Rimlighet mot klientens trösklar: wikins tal på eller över grått när listans ligger under (Elixir of Fortitude 165 mot
  // gul/grå 155/160), eller långt under en gul tröskel som listans nivå redan stämmer med (Elixir of Defense 130 mot 215):
  // då är det wikin som har fel, och listans nivå står kvar.
  if (th && skill > 0 && ((w[0] >= th[1] && skill < th[1]) || (w[0] < skill && skill <= th[0] && th[0] - w[0] > 50))) { doubted.push(name + " (lista " + skill + ", wiki " + w[0] + ", gul/grå " + th.join("/") + ")"); return skill; }
  if (w[0] !== skill) { fromForever++; if (w[0] < skill) lowered++; else if (skill) raised++; }
  return w[0];
}

const recipes = [];
let matched = 0, fromAL = 0, fromWiki = 0;
for (const id in FR.recipes) {
  const [name, prof, item, reagents, cat, n] = FR.recipes[id];
  if (!item || SKIP_PROF[prof] || SKIP_CAT[cat]) continue;
  const cands = byItem[item] || [], cm = cands.find(c => c.name === name) || cands[0] || null;
  if (cm) matched++;
  let skill = cm ? cm.skill : 0;
  if (!skill) { skill = alSkill(item, prof, reagents); if (skill) fromAL++; }
  if (!skill && WIKI[prof + "|" + name]) { skill = WIKI[prof + "|" + name]; fromWiki++; }
  skill = foreverSkill(id, prof, name, skill);
  recipes.push({ spell: +id, name, prof, skill, item, n: n || (cm ? cm.n : 1), reagents, cat,
    cost: cm ? cm.cost : 0, recipeItem: cm ? cm.recipeItem : 0, src: cm ? cm.src : { trainer: [], trainers: 0, vendor: [], drop: [], quest: [] } });
}
recipes.sort((a, b) => a.prof - b.prof || a.skill - b.skill || a.name.localeCompare(b.name));
// Recept som inte står i listan (förtrollningar och tinkers utan vara, lägerföremål, Blizzards "Season of Discovery"-
// kategori) men som Armory visar bland kända recept: skillkrav per Blizzard-recept-id, ur wikin.
const skills = {};
const listed = new Set(recipes.map(r => r.spell));
for (const id in FR.recipes) {
  if (listed.has(+id)) continue;
  const [name, prof] = FR.recipes[id];
  const w = WK[prof + "|" + name.toLowerCase()], sk = w && w[0] > 0 && w[1] ? w[0] : WIKI[prof + "|" + name] || (w && w[0] > 0 ? w[0] : 0);
  if (sk) skills[id] = sk;
}
const profs = {};
for (const r of recipes) profs[r.prof] = FR.profs[r.prof];
const out = { made: Date.now(), source: "Blizzard Game Data API (forever-eu) + cmangos classic-db (GPL) 1.12"
  + (fromAL ? " + skill levels from AtlasLoot Classic Forever " + AL.version + " (GPL-2.0)" : "")
  + (fromWiki || fromForever ? " and Warcraft Wiki (warcraft.wiki.gg, CC BY-SA 4.0)" : ""), profs, items, recipes, skills };
console.log("Forevers skillkrav ur wikin:", fromForever, "recept ändrade (" + lowered, "sänkta,", raised, "höjda);", doubted.length, "wikital avvisade mot klientens trösklar:", doubted.join("; ") || "–");
fs.writeFileSync(path.join(DIR, "recept.json"), JSON.stringify(out));
console.log("recept.json:", recipes.length, "recept (" + matched + " med Classic-data,", recipes.length - matched, "Forever-nya,",
  fromAL, "skillkrav från AtlasLoot,", fromWiki, "från wikin,", recipes.filter(r => !r.skill).length, "okända,", Object.keys(skills).length, "utanför listan),", Object.keys(items).length, "varor,",
  Math.round(fs.statSync(path.join(DIR, "recept.json")).size / 1024), "kB");
