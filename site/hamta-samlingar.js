// hamta-samlingar.js – Collections-fliken (Joakim 2026-11-17: "mounts, pets, toys, titlar … vem som droppar vilken mount,
// vilken zon"). Listorna, namnen och bilderna kommer från Blizzards API för Forever (static-forever-eu). Var de går att få
// tag på ur den öppna Classic-databasen (cmangos classic-db, GPL, data/classicdb/classicmangos.sqlite): föremålet som lär
// ut mounten eller kallar på husdjuret (spellen har samma namn), säljare (npc_vendor), drop (creature_loot_template, även
// via referenstabellen) och questbelöningar. Platsen är närmaste kyrkogård (world_safe_locs: "Zon, Plats") eller
// dungeonnamnet. Forevers egna nya mounts finns inte i databasen och märks "New on Forever".
// Blizzards villkor: data högst 30 dagar, så kör om minst en gång i månaden (synka.js tar med filen).
// Kör: node dashboard/ah-sida/hamta-samlingar.js
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const B = require("./blizzard.js");
const DB = path.join(__dirname, "..", "..", "data", "classicdb", "classicmangos.sqlite");
const OUT = path.join(__dirname, "collections.json");

const db = new DatabaseSync(DB, { readOnly: true });
let dungeons = {};
try { for (const d of JSON.parse(fs.readFileSync(path.join(__dirname, "dungeons.json"), "utf8")).dungeons) dungeons[d.map] = d.name; } catch (e) { dungeons = {}; }
const graves = db.prepare("SELECT map, x, y, name FROM world_safe_locs WHERE map IN (0, 1)").all().filter(g => !/Exit|GM |Programmer|TEST|AQ Only/.test(g.name));
function placeOf(map, x, y) {
  if (map !== 0 && map !== 1) return dungeons[map] || "";
  let best = null, bd = Infinity;
  for (const g of graves) { if (g.map !== map) continue; const d = (g.x - x) ** 2 + (g.y - y) ** 2; if (d < bd) { bd = d; best = g; } }
  return best ? best.name.replace(/ - .*$/, "") : "";
}
const spawnOf = db.prepare("SELECT map, position_x x, position_y y FROM creature WHERE id = ? LIMIT 1");
const npcOf = db.prepare("SELECT Entry, Name, SubName, MinLevel, MaxLevel, Rank FROM creature_template WHERE Entry = ?");
const vendorsOf = db.prepare("SELECT entry FROM npc_vendor WHERE item = ?");
const dropsOf = db.prepare("SELECT entry, ChanceOrQuestChance c, groupid g FROM creature_loot_template WHERE item = ? AND mincountOrRef >= 0");
const refsOf = db.prepare("SELECT entry, ChanceOrQuestChance c FROM reference_loot_template WHERE item = ? AND mincountOrRef >= 0");
const dropsByRef = db.prepare("SELECT entry, ChanceOrQuestChance c FROM creature_loot_template WHERE mincountOrRef = ?");
const questsOf = db.prepare("SELECT entry, Title, MinLevel, QuestLevel FROM quest_template WHERE ? IN (RewChoiceItemId1, RewChoiceItemId2, RewChoiceItemId3, RewChoiceItemId4, RewChoiceItemId5, RewChoiceItemId6, RewItemId1, RewItemId2, RewItemId3, RewItemId4)");
const itemOf = db.prepare("SELECT entry, name, Quality, BuyPrice, RequiredLevel, RequiredSkill, RequiredSkillRank, RequiredReputationFaction, RequiredReputationRank, requiredhonorrank FROM item_template WHERE entry = ?");
const itemsBySpell = db.prepare("SELECT entry FROM item_template WHERE (spellid_1 = ? OR spellid_2 = ?) AND name NOT LIKE '%Deprecated%' AND name NOT LIKE '%Test%' AND name NOT LIKE '[PH]%'");
const mountSpells = db.prepare("SELECT Id FROM spell_template WHERE SpellName = ? AND ((Effect1 = 6 AND EffectApplyAuraName1 = 78) OR (Effect2 = 6 AND EffectApplyAuraName2 = 78) OR (Effect3 = 6 AND EffectApplyAuraName3 = 78))");
const critterSpells = db.prepare("SELECT s.Id FROM spell_template s JOIN creature_template c ON c.Entry = s.EffectMiscValue1 WHERE s.Effect1 = 97 AND (c.Name = ? OR c.Name = ?)");
const SKILL = { 762: "Riding", 148: "Horse Riding", 149: "Wolf Riding", 150: "Tiger Riding", 152: "Ram Riding", 533: "Raptor Riding", 553: "Mechanostrider Piloting", 554: "Undead Horsemanship", 713: "Kodo Riding" };
const REP_RANK = ["Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];
let factions = {};
try { for (const f of db.prepare("SELECT ID, Name FROM faction").all()) factions[f.ID] = f.Name; } catch (e) { factions = {}; }

// Var ett föremål kommer ifrån: säljare, drop (högst 6, störst chans först), quest.
function sourcesOf(itemId) {
  const out = [];
  for (const v of vendorsOf.all(itemId)) {
    const n = npcOf.get(v.entry), s = spawnOf.get(v.entry);
    if (n) out.push({ k: "vendor", npc: n.Name, sub: n.SubName || "", where: s ? placeOf(s.map, s.x, s.y) : "" });
  }
  const drops = [];
  for (const d of dropsOf.all(itemId)) drops.push({ npc: d.entry, c: d.c });
  for (const r of refsOf.all(itemId)) for (const d of dropsByRef.all(-r.entry)) drops.push({ npc: d.entry, c: r.c * (d.c || 100) / 100 });
  const seen = new Set();
  drops.sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
  for (const d of drops) {
    if (seen.has(d.npc) || seen.size >= 6) continue;
    const n = npcOf.get(d.npc), s = spawnOf.get(d.npc);
    if (!n) continue;
    seen.add(d.npc);
    out.push({ k: "drop", npc: n.Name, lvl: n.MaxLevel, rank: n.Rank, chance: Math.round(Math.abs(d.c) * 100) / 100, where: s ? placeOf(s.map, s.x, s.y) : "" });
  }
  for (const q of questsOf.all(itemId)) out.push({ k: "quest", id: q.entry, title: q.Title, lvl: q.QuestLevel > 0 ? q.QuestLevel : q.MinLevel });
  return out;
}
function itemInfo(id) {
  const it = itemOf.get(id);
  if (!it) return null;
  const o = { id, name: it.name, q: it.Quality, req: it.RequiredLevel || 0, price: it.BuyPrice || 0, src: sourcesOf(id) };
  if (it.RequiredSkill && SKILL[it.RequiredSkill]) o.skill = SKILL[it.RequiredSkill] + (it.RequiredSkillRank ? " " + it.RequiredSkillRank : "");
  if (it.RequiredReputationFaction) o.rep = (factions[it.RequiredReputationFaction] || "Reputation") + " · " + (REP_RANK[it.RequiredReputationRank] || "");
  if (it.requiredhonorrank) o.pvp = it.requiredhonorrank;
  return o;
}
function pickItem(spellIds) {
  const ids = [];
  for (const s of spellIds) for (const r of itemsBySpell.all(s, s)) if (!ids.includes(r.entry)) ids.push(r.entry);
  // Flera föremål för samma djur (Horn of the Red Wolf finns två gånger): det som går att få tag på, annars det första.
  const infos = ids.map(itemInfo).filter(Boolean);
  return infos.find(i => i.src.length) || infos[0] || null;
}

(async () => {
  const idx = async k => ((await B.get("/data/wow/" + k + "/index", "stat")).json || {})[k + "s"] || [];
  const [mounts, pets, toys, titles] = await Promise.all(["mount", "pet", "toy", "title"].map(idx));
  // Högst 8 anrop åt gången (Blizzards gräns är 100/s; här räcker det gott).
  async function each(list, fn) { const out = []; for (let i = 0; i < list.length; i += 8) out.push(...await Promise.all(list.slice(i, i + 8).map(fn))); return out; }
  const outMounts = (await each(mounts, async m => {
    if (/^\[PH\]/.test(m.name)) return null;
    const d = (await B.get("/data/wow/mount/" + m.id, "stat")).json || {};
    let img = "";
    const disp = (d.creature_displays || [])[0];
    if (disp) { const md = (await B.get("/data/wow/media/creature-display/" + disp.id, "stat")).json; const a = md && (md.assets || [])[0]; if (a) img = a.value; }
    // Blizzards namn kan ha ett tillägg ("Rivendare's Deathcharger", "Summon … ", "… Mount"): prova kortare former.
    const tries = [m.name, m.name.replace(/^Summon /, "").replace(/ Mount$/, ""), m.name.split(" ").slice(-2).join(" ")];
    let spells = [];
    for (const n of tries) { spells = mountSpells.all(n).map(r => r.Id); if (spells.length) break; }
    const cls = /^Summon (Felsteed|Warhorse|Dreadsteed|Charger)$/.test(m.name) ? (/Felsteed|Dreadsteed/.test(m.name) ? "Warlock" : "Paladin") : "";
    return { id: m.id, name: m.name, img, desc: d.description || "", faction: d.faction && d.faction.type || "", cls, item: cls ? null : pickItem(spells) };
  })).filter(Boolean);
  const outPets = await each(pets, async p => {
    const d = (await B.get("/data/wow/pet/" + p.id, "stat")).json || {};
    const cname = d.creature && d.creature.name || p.name;
    const spells = critterSpells.all(p.name, cname).map(r => r.Id);
    return { id: p.id, name: p.name, icon: d.icon || "", type: d.battle_pet_type && d.battle_pet_type.name || "", desc: d.description || "",
      faction: d.is_alliance_only ? "ALLIANCE" : d.is_horde_only ? "HORDE" : "", item: pickItem(spells) };
  });
  const outToys = await each(toys, async x => {
    const d = (await B.get("/data/wow/toy/" + x.id, "stat")).json || {};
    let icon = "";
    if (d.media) { const md = (await B.get("/data/wow/media/item/" + d.media.id, "stat")).json; const a = md && (md.assets || []).find(z => z.key === "icon"); if (a) icon = a.value; }
    const iid = d.item && d.item.id;
    const db1 = iid ? itemInfo(iid) : null;
    return { id: x.id, name: d.item && d.item.name || x.name, icon, src: d.source && d.source.name || "", desc: d.source_description || "", item: db1 || (iid ? { id: iid, name: d.item.name, src: [] } : null) };
  });
  const outTitles = await each(titles, async x => {
    const d = (await B.get("/data/wow/title/" + x.id, "stat")).json || {};
    return { id: x.id, name: x.name, male: d.gender_name && d.gender_name.male || "", female: d.gender_name && d.gender_name.female || "", src: d.source && d.source.type && d.source.type.name || "",
      srcItems: (d.source && d.source.quests || []).map(q => q.name).concat((d.source && d.source.achievements || []).map(a => a.name)) };
  });
  const sort = (a, b) => a.name.localeCompare(b.name);
  fs.writeFileSync(OUT, JSON.stringify({ t: Date.now(), source: "Blizzard API (WoW Forever) + cmangos classic-db (GPL)",
    mounts: outMounts.sort(sort), pets: outPets.sort(sort), toys: outToys.sort(sort), titles: outTitles.sort(sort) }));
  const withSrc = l => l.filter(x => x.item && x.item.src && x.item.src.length).length;
  console.log("mounts:", outMounts.length, "(källa:", withSrc(outMounts) + ")", "pets:", outPets.length, "(källa:", withSrc(outPets) + ")", "toys:", outToys.length, "titlar:", outTitles.length);
})().catch(e => { console.error(e); process.exit(1); });
