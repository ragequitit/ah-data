// hamta-set.js – alla utrustningsset på Forever till Collections › Gear sets (Joakim 2026-11-28: "klickar på gear sets så dyker
// alla dem fram … klickar man på ett av seten så kommer alla delar upp på en figur, och man kan hovra över delarna").
// Blizzards API: item-set/index (163 set 2026-11-28, nya PvP-rankset 2083–2093) → item-set/{id} (delar + setbonusar) →
// item/{id} (kvalitet, plats, typ, item level, krav, rustning, stats, Equip-effekter) och media/item/{id} (ikonens fileDataId).
// Föremål som Blizzard inte har (404) får namn och id ur setet; sidan fyller i ikon och pris ur sina egna listor.
// Utdata sets.json = { t, sets: [{ id, name, bonus: [[antal delar, text]], items: [{ id, name, q, slot, inv, sub, ilvl, req,
//   icon, armor, weapon, stats, equip, cls }] }] }. Ingen pris- eller spelardata: speldata som inte går ut (villkoren gäller
// API-data som ändras; körs om när veckans api-koll.js säger att set-listan ändrats).
// node hamta-set.js
const fs = require("fs");
const path = require("path");
const B = require("./blizzard.js");
const OUT = path.join(__dirname, "sets.json");
const QUALITY = { POOR: 0, COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5, ARTIFACT: 6 };
// Blizzards inventory_type → Armoryns platsnamn (paper-dollens platser)
const SLOT = { HEAD: "HEAD", NECK: "NECK", SHOULDER: "SHOULDER", CLOAK: "BACK", BACK: "BACK", CHEST: "CHEST", ROBE: "CHEST", BODY: "SHIRT", TABARD: "TABARD", WRIST: "WRIST",
  HAND: "HANDS", HANDS: "HANDS", WAIST: "WAIST", LEGS: "LEGS", FEET: "FEET", FINGER: "FINGER_1", TRINKET: "TRINKET_1", WEAPON: "MAIN_HAND", TWOHWEAPON: "MAIN_HAND", WEAPONMAINHAND: "MAIN_HAND",
  WEAPONOFFHAND: "OFF_HAND", SHIELD: "OFF_HAND", HOLDABLE: "OFF_HAND", RANGED: "RANGED", RANGEDRIGHT: "RANGED", THROWN: "RANGED", RELIC: "RANGED" };
const CLS_BY_NAME = { "Darkmantle Armor": "Rogue", "Feralheart Raiment": "Druid", "Vestments of the Virtuous": "Priest", "Beastmaster Armor": "Hunter", "Soulforge Armor": "Paladin",
  "Deathmist Raiment": "Warlock", "The Five Thunders": "Shaman", "Battlegear of Heroism": "Warrior", "Sorcerer's Regalia": "Mage" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(p, ns) { for (let f = 0; f < 4; f++) { let r; try { r = await B.get(p, ns); } catch (e) { r = { status: 0 }; } if (r.status !== 429 && r.status !== 0) return r; await sleep(2000 * (f + 1)); } return { status: 0, json: null }; }
async function pool(list, n, fn) { const out = new Array(list.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } })); return out; }

(async () => {
  const ix = await get("/data/wow/item-set/index", "stat");
  if (ix.status !== 200) throw new Error("item-set/index " + ix.status);
  const raw = await pool(ix.json.item_sets, 6, s => get("/data/wow/item-set/" + s.id, "stat"));
  const sets = [], itemIds = new Set();
  raw.forEach((r, k) => {
    const s = ix.json.item_sets[k];
    if (r.status !== 200 || !r.json) { sets.push({ id: s.id, name: s.name, bonus: [], items: [] }); return; }
    const j = r.json;
    const items = (j.items || []).map(x => ({ id: x.id, name: x.name }));
    items.forEach(x => itemIds.add(x.id));
    const bonus = (j.effects || []).map(e => [e.required_count || 0, e.display_string || ""]).filter(b => b[1]).sort((a, b) => a[0] - b[0]);
    sets.push({ id: s.id, name: j.name || s.name, bonus, items });
  });
  const ids = [...itemIds];
  const it = {}, icon = {};
  await pool(ids, 6, async id => {
    const r = await get("/data/wow/item/" + id, "stat");
    if (r.status === 200 && r.json) it[id] = r.json;
    const m = await get("/data/wow/media/item/" + id, "stat");
    const a = m.json && (m.json.assets || []).find(x => x.key === "icon");
    if (a) icon[id] = a.file_data_id || +(/\/(\d+)\.jpg$/.exec(a.value || "") || [])[1] || 0;
  });
  let n404 = 0;
  for (const s of sets) {
    s.items = s.items.map(x => {
      const j = it[x.id], o = { id: x.id, name: x.name };
      if (icon[x.id]) o.icon = icon[x.id];
      if (!j) { n404++; return o; }
      const p = j.preview_item || {}, inv = j.inventory_type && j.inventory_type.type || "";
      o.name = j.name || x.name; o.q = QUALITY[j.quality && j.quality.type] ?? 1; o.inv = inv; o.slot = SLOT[inv] || inv;
      o.sub = j.item_subclass && j.item_subclass.name || ""; o.ilvl = j.level || 0; o.req = j.required_level || 0;
      o.armor = p.armor && p.armor.display && p.armor.display.display_string || "";
      if (p.weapon) o.weapon = { damage: p.weapon.damage && p.weapon.damage.display_string, speed: p.weapon.attack_speed && p.weapon.attack_speed.display_string, dps: p.weapon.dps && p.weapon.dps.display_string };
      o.stats = (p.stats || []).map(st => st.display && st.display.display_string).filter(Boolean);
      o.equip = (p.spells || []).map(sp => sp.description).filter(d => d && /^(Equip|Use|Chance on hit):/.test(d));
      const cl = p.requirements && p.requirements.playable_classes && p.requirements.playable_classes.links;
      if (cl && cl.length) o.cls = cl.map(c => c.name);
      return o;
    });
    // setets klass och nivå: vanligast bland delarna
    const cls = s.items.map(x => (x.cls || []).join("/")).filter(Boolean);
    if (cls.length) s.cls = cls.sort((a, b) => cls.filter(v => v === b).length - cls.filter(v => v === a).length)[0];
    // Dungeon-seten (Tier 0.5) har ingen klass i Blizzards data: klassen efter namnet
    if (!s.cls && CLS_BY_NAME[s.name]) s.cls = CLS_BY_NAME[s.name];
    const lv = s.items.map(x => x.ilvl || 0).filter(Boolean);
    if (lv.length) s.ilvl = Math.max(...lv);
    const rq = s.items.map(x => x.req || 0).filter(Boolean);
    if (rq.length) s.req = Math.max(...rq);
    const q = s.items.map(x => x.q).filter(v => v != null);
    if (q.length) s.q = Math.max(...q);
  }
  fs.writeFileSync(OUT, JSON.stringify({ t: Date.now(), source: "Blizzard API (WoW Forever)", sets }));
  console.log("sets.json: " + sets.length + " set, " + ids.length + " delar (" + n404 + " utan Blizzard-data), " + Object.keys(icon).length + " ikoner");
})().catch(e => { console.error(e); process.exit(1); });
