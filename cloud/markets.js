// markets.js – alla WoW Forever-marknader (Joakim 2026-11-18: "alla länderna, roleplay, USA ... och Blackwater").
// Blizzards hus-id är desamma i alla regioner (ruleset/1/auctions): 110/111/112 Alliance, 113/114/115 Horde,
// 116/117/118 Blackwater; trion 110/113/116 = PvP, 111/114/117 = Normal, 119/120/121 och 123/124/125 = Roleplay och
// Roleplay PvP (API:t säger inte vilken trio som är vilken – antagande: ordningen, RP först), 112/115/118 är tomma.
// Korea och Taiwan har bara PvP och Normal (Roleplay finns inte där).
// Marknadens nummer (nyckel i data-<nr>.json, hist/<nr>/, api/<nr>/): EU = hus-id (som förut, 113 = huvudmarknaden),
// US = 1000 + hus, KR = 2000 + hus, TW = 3000 + hus. Då fungerar all nummerlogik på sidan och i bygget som förut.
const REGIONS = { eu: 0, us: 1000, kr: 2000, tw: 3000 };
const REGION_NAME = { eu: "EU", us: "US", kr: "KR", tw: "TW" };
const RULESETS = { pvp: [110, 113, 116], normal: [111, 114, 117], rp: [119, 120, 121], rppvp: [123, 124, 125] };
const RS_NAME = { pvp: "PvP", normal: "Normal", rp: "RP", rppvp: "RP-PvP" };
const FACTIONS = ["alliance", "horde", "blackwater"];
const FA_NAME = { alliance: "Alliance", horde: "Horde", blackwater: "Blackwater" };
const REGION_RS = { eu: ["pvp", "normal", "rp", "rppvp"], us: ["pvp", "normal", "rp", "rppvp"], kr: ["pvp", "normal"], tw: ["pvp", "normal"] };
// De fyra som funnits sedan 2026-11-16: hela timdatan sparas i 29 dagar och senaste-filen i git. Övriga glesas efter 3 dygn
// och har senaste-filen i GitHubs cache (repot ska inte växa med 9 MB per hus och körning).
const CORE = new Set([113, 110, 114, 111]);

const LIST = [];
for (const [reg, off] of Object.entries(REGIONS)) for (const rs of REGION_RS[reg]) RULESETS[rs].forEach((hid, i) => {
  const fa = FACTIONS[i];
  // hidden: hämtas (historiken finns om vi listar ut RP/RP-PvP) men byggs inte till sidan (Joakim 2026-11-18: "ta bort så länge")
  LIST.push({ key: off + hid, region: reg, house: hid, rs, fa, name: REGION_NAME[reg] + " " + RS_NAME[rs] + " " + FA_NAME[fa], hidden: rs === "rp" || rs === "rppvp" });
});
const BY_KEY = {};
for (const m of LIST) BY_KEY[m.key] = m;
const MARKETS = {}, SITE = {};
for (const m of LIST) { MARKETS[m.key] = m.name; if (!m.hidden) SITE[m.key] = m.name; }

module.exports = { LIST, BY_KEY, MARKETS, SITE, CORE, REGIONS, REGION_NAME, RS_NAME, FA_NAME, REGION_RS };
