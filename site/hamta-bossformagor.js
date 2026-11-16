// hamta-bossformagor.js – bossarnas förmågor till Dungeons-flikens bossruta (Joakim 2026-11-20).
// Vilka spells en boss har: cmangos 1.12 (creature_template_spells, creature_spell_list och EventAI-skriptens cast-
// händelser). Namn, ikon och beskrivning med ifyllda värden: Forevers klientdata från wago.tools (samma tabeller och
// samma $-formatering som hamta-klasser.js, som läses in härifrån utan att ändras). Bossar som bara är skriptade i C++
// (t.ex. Lucifron) har inga spells i databasen och får inga förmågor. Forevers nya bossar saknar NPC-id och ingår inte.
// Skriver boss-abilities.json: { "<npc-id>": [[spell-id, namn, ikon-fil-id, beskrivning], ...] }
//   node dashboard/ah-sida/hamta-bossformagor.js
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const WAGO_DIR = path.join(__dirname, "..", "..", "data", "wago");
const BUILD = fs.existsSync(WAGO_DIR) ? fs.readdirSync(WAGO_DIR).filter(d => /^\d/.test(d)).sort().pop() : "";
const WAGO = path.join(WAGO_DIR, BUILD || "");
const DB = path.join(__dirname, "..", "..", "data", "classicdb", "classicmangos.sqlite");
if (!BUILD) { console.error("ingen klientdata i " + WAGO_DIR); process.exit(1); }

// Tabellerna och format() ur hamta-klasser.js (avsnittet mellan "wago-tabellerna" och "cmangos")
const src = fs.readFileSync(path.join(__dirname, "hamta-klasser.js"), "utf8");
const a = src.indexOf("// ---------- wago-tabellerna ----------"), b = src.indexOf("// ---------- cmangos ----------");
if (a < 0 || b < 0) { console.error("hittar inte tabellavsnittet i hamta-klasser.js"); process.exit(1); }
const T = new Function("fs", "path", "WAGO", "BUILD", src.slice(a, b) + "\nreturn { NAME, SPELL, MISC, format };")(fs, path, WAGO, BUILD);

const db = new DatabaseSync(DB, { readOnly: true });
const G = JSON.parse(fs.readFileSync(path.join(__dirname, "dungeons.json"), "utf8"));
const tmpl = db.prepare("SELECT * FROM creature_template_spells WHERE entry = ?");
const ctq = db.prepare("SELECT SpellList FROM creature_template WHERE Entry = ?");
const slq = db.prepare("SELECT SpellId FROM creature_spell_list WHERE Id = ? ORDER BY Position");
const aiq = db.prepare("SELECT action1_type a1, action1_param1 p1, action2_type a2, action2_param1 p2, action3_type a3, action3_param1 p3 FROM creature_ai_scripts WHERE creature_id = ?");
const SKIP = /dummy|\[dnt\]|visual|trigger|test|quest|credit|despawn|^summon .* (effect|visual)|transform|spawn|clone|kill credit|teleport|root self|stun self|immun|^cosmetic/i;

const out = {};
let nb = 0, ns = 0;
for (const d of G.dungeons) for (const boss of d.bosses) {
  if (!(boss.id > 0) || out[boss.id]) continue;
  const ids = [];
  const add = (id) => { id = +id; if (id > 0 && ids.indexOf(id) < 0) ids.push(id); };
  for (const r of tmpl.all(boss.id)) for (let i = 1; i <= 10; i++) add(r["spell" + i]);
  const ct = ctq.get(boss.id);
  if (ct && ct.SpellList) for (const r of slq.all(ct.SpellList)) add(r.SpellId);
  for (const r of aiq.all(boss.id)) { if (r.a1 === 11) add(r.p1); if (r.a2 === 11) add(r.p2); if (r.a3 === 11) add(r.p3); }
  const list = [], seenName = {};
  for (const id of ids) {
    const nm = T.NAME.get(id), sp = T.SPELL.get(id), mi = T.MISC.get(id);
    const name = nm ? nm.Name_lang : "";
    if (!name || SKIP.test(name) || seenName[name]) continue;
    let desc = sp ? T.format(id, sp.Description_lang || sp.AuraDescription_lang || "", 60) : "";
    if (/\$/.test(desc)) desc = desc.replace(/\$\S+/g, "").replace(/  +/g, " ").trim();   // okända variabler bort hellre än skräp
    seenName[name] = 1;
    list.push([id, name, mi ? +mi.SpellIconFileDataID || 0 : 0, desc]);
    if (list.length >= 8) break;
  }
  if (list.length) { out[boss.id] = list; nb++; ns += list.length; }
}
fs.writeFileSync(path.join(__dirname, "boss-abilities.json"), JSON.stringify(out));
console.log("boss-abilities.json: " + nb + " bossar med förmågor, " + ns + " förmågor (klientdata " + BUILD + ")");
