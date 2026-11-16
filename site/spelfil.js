// spelfil.js – läser addonets sparfil (WhippitPanel.lua, SavedVariables) och ger { ahItems: { id: "namn|kvalitet|…" },
// ahTips: { id: "vänster\thöger\n…" } }. Används av build.js och hamta-blizzard-meta.js på Joakims dator; synka.js
// skriver samma sak som spel.json till grenen egna, så molnet (GitHub Actions) slipper sparfilen.
const fs = require("fs");
const SV_DEFAULT = "M:/Battlenet/World of Warcraft/_forever_/WTF/Account/CRUIZIER/SavedVariables/WhippitPanel.lua";
// Whippit AH (eget addon sedan 2026-11-22) har AH-datan: ahItems, ahHistory, ahScanDepth … (samma format). ahTips och allt
// annat (bossLoot, deLog, seenPlayers …) ligger kvar i WhippitPanel.lua.
const SV_AH = "M:/Battlenet/World of Warcraft/_forever_/WTF/Account/CRUIZIER/SavedVariables/WhippitAH.lua";
// En AH-tabell ur Whippit AH:s sparfil, annars ur WhippitPanels (före flytten, eller om Whippit AH inte sparat än).
function ahTable(name) {
  for (const p of [SV_AH, SV_DEFAULT]) {
    if (!fs.existsSync(p)) continue;
    const t = table(fs.readFileSync(p, "utf8"), name);
    if (t && Object.keys(t).length) return t;
  }
  return null;
}

// Ett platt block ["namn"] = { [id] = "…", ... } ur sparfilen. WoW skriver utan indrag och en rad per vara, så första
// "},"-raden efter starten är blockets slut. Strängvärden kommer med WoW:s escaper (\n, \t, \", \\).
function block(sv, name, decode) {
  const out = {};
  const i = sv.indexOf('["' + name + '"] = {');
  if (i < 0) return out;
  const endM = /\r?\n\s*\},/.exec(sv.slice(i));
  const b = sv.slice(i, endM ? i + endM.index : sv.length);
  const re = /\[(\d+)\] = "((?:[^"\\]|\\.)*)",/g;
  let m;
  while ((m = re.exec(b))) out[m[1]] = decode ? m[2].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : m[2].replace(/\\"/g, '"');
  return out;
}

// Ett nästlat block ["namn"] = { ... } ur sparfilen som JS-objekt (liten Lua-tolk för SavedVariables: tabeller,
// ["sträng"]- och [tal]-nycklar, listelement, strängar, tal, true/false/nil). Används för bossLoot och loot.
function table(sv, name) {
  const start = sv.indexOf('["' + name + '"] = {');
  if (start < 0) return null;
  let i = sv.indexOf("{", start);
  const ws = () => { while (i < sv.length) { const c = sv[i]; if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === ",") i++; else if (c === "-" && sv[i + 1] === "-") { while (i < sv.length && sv[i] !== "\n") i++; } else break; } };
  const str = () => { let out = ""; i++; while (sv[i] !== '"') { if (sv[i] === "\\") { const n = sv[i + 1]; out += n === "n" ? "\n" : n === "t" ? "\t" : n; i += 2; } else out += sv[i++]; } i++; return out; };
  const val = () => {
    ws();
    const c = sv[i];
    if (c === "{") return tbl();
    if (c === '"') return str();
    const m = /^(-?[\d.]+(?:e[+-]?\d+)?|true|false|nil)/.exec(sv.slice(i, i + 40));
    i += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : m[0] === "nil" ? null : Number(m[0]);
  };
  const tbl = () => {
    i++;   // {
    const o = {}; let n = 1;
    for (;;) {
      ws();
      if (sv[i] === "}") { i++; return o; }
      if (sv[i] === "[") {
        i++;
        const k = sv[i] === '"' ? str() : val();
        ws(); i++;   // ]
        ws(); i++;   // =
        o[k] = val();
      } else o[n++] = val();
    }
  };
  return tbl();
}

function read(svPath) {
  const p = svPath || SV_DEFAULT;
  if (!fs.existsSync(p)) return { ahItems: {}, ahTips: {} };
  const sv = fs.readFileSync(p, "utf8");
  let siteNames = {};
  try { const t = table(sv, "seenPlayers"); siteNames = t && typeof t === "object" ? t : {}; } catch (e) { siteNames = {}; }   // SiteNames.lua: spelare Joakim sett (topplistorna)
  let bossLoot = {};
  try { bossLoot = table(sv, "bossLoot") || {}; } catch (e) { bossLoot = {}; }   // BossLoot.lua (dungeonbossarnas loot)
  // Disenchant.lua: varje disenchant ("tid|id|kvalitet|ilvl|krav|plats|klass|underklass|id:antal,…"), som lista.
  let deLog = [];
  try { const t = table(sv, "deLog"); deLog = t ? Object.values(t).filter(x => typeof x === "string") : []; } catch (e) { deLog = []; }
  // SiteNames.lua: olika spelare per klocktimme och per dag (statistikhinkarna, fältet n) till aktivitetskurvan.
  const nOf = name => { try { const t = table(sv, name) || {}; const o = {}; for (const [k, v] of Object.entries(t)) { if (typeof v === "number") o[k] = v; else if (v && typeof v.n === "number") o[k] = v.n; } return o; } catch (e) { return {}; } };
  const activity = { hours: nOf("seenPlayersHour"), days: nOf("seenPlayersDay") };
  // spellIcons: ikonens fileDataId per spell (talangernas ikoner, SpellIcons.lua), som sträng
  // Varunamnen: Whippit AH:s när den har dem (den scannar nu), annars sparfilens.
  let ahItems = block(sv, "ahItems", false);
  if (!svPath && fs.existsSync(SV_AH)) { const a = block(fs.readFileSync(SV_AH, "utf8"), "ahItems", false); if (Object.keys(a).length) ahItems = a; }
  return { ahItems, ahTips: block(sv, "ahTips", true), bossLoot, spellIcons: block(sv, "spellIcons", false), npcZones: block(sv, "npcZones", false), siteMapNames: block(sv, "siteMapNames", false), siteMapBounds: block(sv, "siteMapBounds", false), siteNames, deLog, activity };
}

// Spelets data: JSON-filen (molnet, AH_SPEL_JSON) om den finns, annars sparfilen.
function load() {
  const j = process.env.AH_SPEL_JSON;
  if (j && fs.existsSync(j)) return JSON.parse(fs.readFileSync(j, "utf8"));
  return read(process.env.AH_SV_FILE);
}
module.exports = { read, load, table, ahTable, SV_DEFAULT, SV_AH };
