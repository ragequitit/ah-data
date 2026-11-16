// hamta-talanger.js – Forevers talangträd ur Blizzards API (talent-tree, static-forever-eu) → talents.json för sidans
// talangvy och talangplanerare (Joakim 2026-11-17). Per klass tre träd; per talang rad, kolumn, max rang, text per rang,
// spell-id (för ikonen) och vilken talang som krävs (pil). Ikoner: Blizzards webb-API har bara ikoner för spells som finns
// kvar i retail, så icon fylls ur talent-ikoner.json (addonets dump ur spelet: /whip talentikoner) när den finns.
// Kör: node dashboard/ah-sida/hamta-talanger.js
const fs = require("fs");
const path = require("path");
const B = require("./blizzard.js");
const NS = "static-forever-eu";
const OUT = path.join(__dirname, "talents.json");
const ICONS = path.join(__dirname, "talent-ikoner.json");   // { spellId: fileDataId } ur spelet
const rel = h => h.replace(/^https:\/\/[^/]+/, "").replace(/\?.*$/, "");

(async () => {
  // Ikonerna ur spelet (addonets spellIcons i sparfilen), annars en sparad kopia.
  let icons = {};
  try { icons = require("./spelfil.js").load().spellIcons || {}; } catch (e) { icons = {}; }
  if (Object.keys(icons).length) fs.writeFileSync(ICONS, JSON.stringify(icons)); else if (fs.existsSync(ICONS)) icons = JSON.parse(fs.readFileSync(ICONS, "utf8"));
  for (const k in icons) icons[k] = +icons[k] || 0;
  const idx = (await B.get("/data/wow/talent-tree/index", NS)).json;
  const classes = {};
  for (const t of idx.spec_talent_trees) {
    const r = await B.get(rel(t.key.href), NS);
    const sp = r.json;
    if (!sp || !sp.playable_class) { console.log("hoppar över", t.name, r.status); continue; }
    const cid = sp.playable_class.id;
    const c = classes[cid] = classes[cid] || { name: sp.playable_class.name, trees: [] };
    const nodeTalent = {};
    sp.spec_talent_nodes.forEach(n => { nodeTalent[n.id] = n.ranks[0].tooltip.talent.id; });
    // display_col räknas över alla tre träden (1–4, 7–10, 14–17): kolumnen inom trädet blir 0–3. Noder utanför rutnätet
    // (rad > 7, kolumn > 3) är dubbletter eller gamla dolda talanger i Blizzards data (testat 2026-11-17) och hoppas över.
    const minX = Math.min(...sp.spec_talent_nodes.map(n => n.raw_position_x)), base = minX < 4000 ? 1 : minX < 8000 ? 7 : 14;
    const nodes = sp.spec_talent_nodes.filter(n => n.display_row >= 1 && n.display_row <= 7 && n.display_col - base >= 0 && n.display_col - base <= 3).map(n => {
      const r0 = n.ranks[0].tooltip, spell = r0.spell_tooltip && r0.spell_tooltip.spell;
      return {
        id: r0.talent.id, name: r0.talent.name, row: n.display_row, col: n.display_col - base, max: n.ranks.length,
        spell: spell ? spell.id : 0, icon: spell && icons[spell.id] || 0,
        cast: r0.spell_tooltip && r0.spell_tooltip.cast_time || "",
        desc: n.ranks.map(k => k.tooltip.spell_tooltip ? k.tooltip.spell_tooltip.description || "" : ""),
        req: (n.locked_by || []).map(id => nodeTalent[id]).filter(Boolean),   // rensas nedan: krav från en lägre rad är cirkelkrav i Blizzards data (Intimidation ⇄ Bestial Wrath)
      };
    }).sort((a, b) => a.row - b.row || a.col - b.col);
    const rowOf = {}; nodes.forEach(n => { rowOf[n.id] = n.row; });
    nodes.forEach(n => { n.req = n.req.filter(r => rowOf[r] == null || rowOf[r] <= n.row); });   // krav uppåt = cirkelkrav, bort (2026-11-20)
    c.trees.push({ spec: sp.name, id: sp.playable_specialization && sp.playable_specialization.id, nodes });
  }
  // Retail har ikonen för de spells som finns kvar där: används när spelets dump saknas.
  let retail = 0;
  for (const c of Object.values(classes)) for (const tr of c.trees) for (const n of tr.nodes) {
    if (n.icon || !n.spell) continue;
    const m = await B.get("/data/wow/media/spell/" + n.spell, "static-eu");
    const a = m.json && (m.json.assets || []).find(x => x.key === "icon");
    if (a) { n.icon = a.file_data_id || 0; retail++; }
  }
  const all = Object.values(classes).flatMap(c => c.trees.flatMap(t => t.nodes));
  fs.writeFileSync(OUT, JSON.stringify({ t: Date.now(), source: "Blizzard Game Data API (talent-tree, static-forever-eu)", classes }));
  console.log("talents.json:", Object.keys(classes).length, "klasser,", all.length, "talanger, ikoner", all.filter(n => n.icon).length, "(retail " + retail + ")");
  // Spell-id:n som saknar ikon, för addonets dump.
  const miss = [...new Set(all.filter(n => !n.icon && n.spell).map(n => n.spell))];
  fs.writeFileSync(path.join(__dirname, "talent-spells-utan-ikon.txt"), miss.join(","));
  // Addonet läser listan och sparar ikonerna ur spelet (SpellIcons.lua); hela listan, så ett omtag fyller allt.
  const allSpells = [...new Set(all.filter(n => n.spell).map(n => n.spell))].sort((a, b) => a - b);
  const lines = [];
  for (let i = 0; i < allSpells.length; i += 12) lines.push("  " + allSpells.slice(i, i + 12).join(", ") + ",");
  const lua = ["-- SiteSpellIds.lua – GENERERAD av dashboard/ah-sida/hamta-talanger.js, ändra inte för hand.",
    "-- Talangernas spell-id: SpellIcons.lua sparar ikonen för varje id till hemsidans talangträd.",
    "local _, ns = ...", "ns.SITE_SPELL_IDS = {", ...lines, "}", ""].join("\n");
  fs.writeFileSync(path.join(__dirname, "..", "..", "addon", "WhippitPanel", "SiteSpellIds.lua"), lua);
  console.log("utan ikon:", miss.length, "spells → talent-spells-utan-ikon.txt");
})().catch(e => { console.error(e); process.exit(1); });
