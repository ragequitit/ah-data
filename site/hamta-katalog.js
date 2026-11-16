// hamta-katalog.js – katalogen till Armorys topplistor (Joakim 2026-11-17: "vilka gilder som leder … toppkaraktärerna …
// bäst item level … snöboll via guilden"). Blizzards API kan bara slå upp en spelare eller guild på namn, inte lista alla.
// Katalogen växer därför som en snöboll: kända spelare (fröna nedan, förra katalogen, spelarnamnen addonet antecknat i
// seenPlayers) → deras guild → guildens roster → medlemmarna → deras guilder … tills anropsbudgeten är slut.
// Per spelare: profilen (level, klass, ras, sida, guild, item level, achievement points, senast inloggad) och PvP
// (honorable kills, rank). Per guild: roster (medlemmar, levlar). Blizzards villkor: det som inte setts på 29 dagar
// tas bort, högst 36 000 anrop i timmen (budgeten nedan är långt under).
// Kör: node dashboard/ah-sida/hamta-katalog.js   (molnet: en gång per dygn, AH_KATALOG_FILE = var filen ligger)
const fs = require("fs");
const path = require("path");
const B = require("./blizzard.js");
const OUT = process.env.AH_KATALOG_FILE || path.join(__dirname, "katalog.json");
const BUDGET = +process.env.AH_KATALOG_CALLS || 15000;   // anrop per körning (Blizzards tak 36 000 i timmen)
const KEEP_MS = 29 * 24 * 3600 * 1000;
const REFRESH_MS = 3 * 24 * 3600 * 1000;                 // spelare som hämtats senaste 3 dygnen hoppas över: nya namn får budgeten
const SEED_PLAYERS = ["alisee-alistar", "dziad-lumpek", "nasty-licker", "hona-mannen", "shay-shantalah"];
const SEED_GUILDS = ["egentid", "svenska-björnkossor"];
const CLS = { 1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest", 7: "Shaman", 8: "Mage", 9: "Warlock", 11: "Druid" };
const slugOf = s => String(s || "").trim().toLowerCase().replace(/\s+/g, "-");
const okSlug = s => /^[a-z0-9À-ɏ'’-]{3,60}$/i.test(s);

// Förra katalogen: både filen vi skriver (molnets meta/katalog.json) och den som följer med sidans filer (körd på Joakims
// dator); per spelare/guild vinner den senast hämtade.
const old = { players: {}, guilds: {} };
const miss = {};   // slug → när Blizzard svarade 404 (bank-alts som aldrig loggat ut m.m.): hoppas över i 7 dagar
const MISS_MS = 7 * 24 * 3600 * 1000;
const firstKills = {};   // boss → { t, inst, p, n, g, gn, fa }: tidigaste kill katalogen sett (encounters/raids ger senaste kill per spelare)
let start = 0;   // katalogens första körning (äldsta t60 som betyder "redan 60 då")
for (const f of [...new Set([OUT, path.join(__dirname, "katalog.json")])]) {
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if (j.start && (!start || j.start < start)) start = j.start;
    if (!j.start && j.t && (!start || j.t < start)) start = j.t;
    for (const p of j.players || []) if (!old.players[p.s] || (p.got || 0) > (old.players[p.s].got || 0)) old.players[p.s] = p;
    for (const g of j.guilds || []) if (!old.guilds[g.s] || (g.seen || 0) > (old.guilds[g.s].seen || 0)) old.guilds[g.s] = g;
    for (const [b, v] of Object.entries(j.firstKills || {})) if (!firstKills[b] || v.t < firstKills[b].t) firstKills[b] = v;   // first kills bevaras för alltid
    for (const [sl, t] of Object.entries(j.miss || {})) if (Date.now() - t < MISS_MS && !(miss[sl] > t)) miss[sl] = t;
  } catch (e) { /* finns inte än */ }
}
const now = Date.now();
const players = {}, guilds = {};
for (const [s, p] of Object.entries(old.players)) if (now - (p.seen || 0) < KEEP_MS) players[s] = p;
// Lagning av äldre katalog (granskning 2026-11-18): ett 60-datum utan att spelaren setts under 60 är bara när den hittades.
for (const p of Object.values(players)) if (p.t60 && !p.u60 && start && p.t60 > start) p.t60 = start;
for (const p of Object.values(players)) if (p.rk && typeof p.rk === "object") { p.rkl = p.rk; p.rk = 0; }   // lagning 2026-11-19: raidkills hamnade i rk
for (const [s, g] of Object.entries(old.guilds)) if (now - (g.seen || 0) < KEEP_MS) guilds[s] = g;

// Kö: guilder först (en roster ger många spelare för två anrop), sedan spelare.
const qG = [], qP = [], qN = [], inQ = new Set();   // qN: addonets namn som katalogen saknar – går först
// front = Alliance (Joakim 2026-11-17: "logga alla alliance-spelare också"): Joakim spelar Horde och ser mest Horde, så
// de få Alliance-namn som kommer in (slagfälten, Egentid) går först i kön och snöbollen växer på båda sidor.
const addG = (s, front) => { s = slugOf(s); if (okSlug(s) && !inQ.has("g" + s)) { inQ.add("g" + s); if (front) qG.unshift(s); else qG.push(s); } };
const addP = (s, front) => { s = slugOf(s); if (okSlug(s) && !inQ.has("p" + s)) { inQ.add("p" + s); if (front) qP.unshift(s); else qP.push(s); } };
const ALLIANCE_RACE = new Set(["Human", "Dwarf", "Night Elf", "Gnome", "High Order Skyborne"]);
SEED_GUILDS.forEach(addG); SEED_PLAYERS.forEach(addP);
Object.keys(guilds).forEach(g => addG(g, guilds[g].fa === "ALLIANCE"));
// Addonets spelarnamn (seenPlayers): nyckeln är namnet, fält 7 en annan namnform, fält 4 guilden.
try {
  const seen = require("./spelfil.js").load().siteNames || {};
  for (const [name, v] of Object.entries(seen)) {
    const f = String(v).split("|");
    // Forever: UnitName ger förnamn och efternamn som "Os-Mique" (efternamnet där realmen brukar stå), chatten "Os Mique".
    // Båda blir Blizzards slug "os-mique". Ett ensamt förnamn går inte att slå upp.
    const full = /[\s-]/.test(name) ? name : (f[6] && /\s/.test(f[6]) ? f[6] : "");
    const ally = ALLIANCE_RACE.has(f[4]);
    if (full) { const sl = slugOf(full.replace(/-/g, " ")); if (okSlug(sl) && !players[sl] && !miss[sl] && !inQ.has("p" + sl)) { inQ.add("p" + sl); qN.push(sl); } else addP(full.replace(/-/g, " "), ally); }
    if (f[3]) addG(f[3], ally);
  }
} catch (e) { /* ingen sparfil här */ }
Object.keys(players).forEach(addP);

// Slagfält (Joakim 2026-11-28): pvp-summary ger per karta spelade/vunna/förlorade. Spelaren får bgm = [[kart-id, spelade, vunna]],
// katalogen bgn = { kart-id: namn } (Alterac Valley, Warsong Gulch, Darkspear Islands …). Saknas i svaret: bgm = 0.
const bgn = {};
for (const f of [...new Set([OUT, path.join(__dirname, "katalog.json")])]) { try { Object.assign(bgn, JSON.parse(fs.readFileSync(f, "utf8")).bgn || {}); } catch (e) {} }
function parseBg(j) {
  const L = (j && j.pvp_map_statistics || []).map(m => {
    const id = m.world_map && m.world_map.id, st = m.match_statistics || {};
    if (id && m.world_map.name) bgn[id] = m.world_map.name;
    return id && st.played > 0 ? [id, st.played || 0, st.won || 0] : null;
  }).filter(Boolean);
  return L.length ? L : 0;
}
let calls = 0;
const get = async p => { calls++; try { return await B.get(p, "prof"); } catch (e) { return { status: 0, json: null }; } };
async function doGuild(s) {
  const base = "/data/wow/guild/" + encodeURIComponent(s);
  const [g, r] = await Promise.all([get(base), get(base + "/roster")]);
  if (g.status !== 200 || !g.json) return;
  const members = (r.json && r.json.members || []).map(m => m.character).filter(Boolean);
  const lv = members.map(c => c.level || 0);
  guilds[s] = { s, name: g.json.name, fa: g.json.faction && g.json.faction.type || "", n: g.json.member_count || members.length, n60: lv.filter(l => l >= 60).length,
    avg: lv.length ? Math.round(lv.reduce((a, b) => a + b, 0) / lv.length * 10) / 10 : 0, created: g.json.created_timestamp || 0, seen: now };
  for (const c of members) {
    const ps = slugOf(c.name + (c.surname ? " " + c.surname : ""));
    if ((c.level || 0) >= 10) addP(ps, guilds[s].fa === "ALLIANCE");   // Blizzard visar spelare från level 10
  }
}
// encounters/raids → { bossnamn: [senaste kill ms, instansnamn] } (tom {} när inget dödats).
function parseRaids(j) {
  const out = {};
  for (const ex of j.expansions || []) for (const inst of ex.instances || []) {
    const iname = inst.instance && inst.instance.name || "";
    for (const m of inst.modes || []) for (const e of (m.progress && m.progress.encounters) || []) {
      const nm = e.encounter && e.encounter.name; if (!nm || !(e.completed_count > 0)) continue;
      const t = e.last_kill_timestamp || 0;
      if (!out[nm] || (t && t < out[nm][0])) out[nm] = [t, iname];
    }
  }
  return out;
}
async function doPlayer(s) {
  // Hämtad nyligen och med ruleset: hoppa över (utan ruleset = äldre katalog: hämtas om).
  if (players[s] && players[s].rs && now - (players[s].got || 0) < REFRESH_MS) { if (players[s].g) addG(players[s].g, players[s].fa === "ALLIANCE"); return; }
  const base = "/profile/wow/character/" + encodeURIComponent(s);
  const [p, pv] = await Promise.all([get(base), get(base + "/pvp-summary")]);
  if (p.status === 404) miss[s] = now;
  if (p.status !== 200 || !p.json) return;
  const j = p.json, prev = players[s], lvl = j.level || 0;
  // Sett under 60 någon gång (u60): bara då vet katalogen när spelaren nådde 60 (granskning 2026-11-18: förr fick alla
  // som redan var 60 när snöbollen hittade dem "nu" som datum, alltså i den ordning de hittades).
  const u60 = (prev && prev.u60) || (prev && prev.lv > 0 && prev.lv < 60) || lvl < 60 ? 1 : 0;
  players[s] = { s, n: j.name, sn: j.surname || "", lv: j.level || 0, c: j.character_class && (j.character_class.name || CLS[j.character_class.id]) || "",
    r: j.race && j.race.name || "", ge: j.gender && j.gender.type === "FEMALE" ? 1 : undefined, fa: j.faction && j.faction.type || "",   // ge: kvinnlig figur (rasikonen på topplistorna)
    // Ruleset (Joakim 2026-11-17): Blizzards API har alla Forever-spelare, PvP och Normal i samma hög. "pvp"/"normal".
    rs: /pvp/i.test(j.ruleset && (j.ruleset.type || j.ruleset.name) || "") ? "pvp" : j.ruleset ? "normal" : "", g: j.guild ? j.guild.slug || slugOf(j.guild.name) : "", gn: j.guild ? j.guild.name : "",
    il: j.equipped_item_level || 0, ap: j.achievement_points || 0, last: j.last_login_timestamp || 0,
    hk: pv.json && pv.json.honorable_kills || 0, rk: pv.json && pv.json.pvp_rank || 0, got: now, seen: now,
    bgm: pv.status === 200 && pv.json ? parseBg(pv.json) : prev ? prev.bgm : undefined,
    // t60: när katalogen såg spelaren gå från under 60 till 60 (First to 60). Den som var 60 första gången katalogen såg
    // den får startdagen och visas som "före".
    t60: lvl < 60 ? 0 : prev && prev.t60 && prev.u60 ? prev.t60 : prev && prev.lv > 0 && prev.lv < 60 ? now : (start || now), u60: u60 || undefined,
    att: prev ? prev.att : undefined, attT: prev ? prev.attT : undefined, rep: prev ? prev.rep : undefined, bk: prev ? prev.bk : undefined, fish: prev ? prev.fish : undefined, pv2: prev ? prev.pv2 : undefined, pve: prev ? prev.pve : undefined, gath: prev ? prev.gath : undefined, gv: prev ? prev.gv : undefined, rkl: prev ? prev.rkl : undefined, ti: prev ? prev.ti : undefined, ac: prev ? prev.ac : undefined, tr: prev ? prev.tr : undefined };   // attunements/rykte hämtas i egen pass nedan
  if (players[s].g) addG(players[s].g, players[s].fa === "ALLIANCE");
}

(async () => {
  const PAR = 6;
  const ATT_RESERVE = 9000;   // sex anrop per 60:a i veckan (quests, rykte, statistik, raider, titlar, achievements)   // anrop sparade till attunements/rykte för 60:orna (passet nedan)
  const nNew = qN.length;
  while ((qN.length || qG.length || qP.length) && calls < BUDGET - ATT_RESERVE) {
    const batch = [];
    while (batch.length < PAR && (qN.length || qG.length || qP.length)) batch.push(qN.length ? ["p", qN.shift()] : qG.length ? ["g", qG.shift()] : ["p", qP.shift()]);
    await Promise.all(batch.map(([k, s]) => (k === "g" ? doGuild(s) : doPlayer(s)).catch(() => {})));
  }
  // Attunements och rykte för 60:or (Joakim 2026-11-19): quests/completed + reputations, en gång i veckan per spelare,
  // inom samma budget. att = bitmask 1 MC, 2 Onyxia, 4 BWL, 8 Naxxramas (något av kedjans sista quest klart).
  // rep = { ex: antal Exalted, f: { faktion: [standing 0–7, poäng] } } för raid- och grindfraktionerna.
  const ATTQ = { mc: [7848, 7487], onyH: [6602], onyA: [6502], bwl: [7761], naxx: [9121, 9122, 9123] };
  const REPF = ["Timbermaw Hold", "Zandalar Tribe", "Argent Dawn", "Cenarion Circle", "Thorium Brotherhood", "Hydraxian Waterlords", "Brood of Nozdormu", "Wintersaber Trainers", "Darkmoon Faire", "Bloodsail Buccaneers"];
  const STAND = { Hated: 0, Hostile: 1, Unfriendly: 2, Neutral: 3, Friendly: 4, Honored: 5, Revered: 6, Exalted: 7 };
  const ATT_MS = 7 * 24 * 3600 * 1000;
  // bk = { instans: [olika bossar dödade, kills på slutbossen] } ur "X kills (Instans)" (bara rader med kills finns);
  // fish = [fångade, olika sorter, skill] ur Skills › Secondary Skills.
  const FINAL = { "Molten Core": "Ragnaros", "Onyxia's Lair": "Onyxia", "Blackwing Lair": "Nefarian", "Zul'Gurub": "Hakkar", "Ruins of Ahn'Qiraj": "Ossirian the Unscarred", "Temple of Ahn'Qiraj": "C'Thun", "Naxxramas": "Kel'Thuzad" };
  const need = Object.values(players).filter(p => p.lv >= 60 && (now - (p.attT || 0) > ATT_MS || p.bk === undefined || p.gv !== 3)).sort((a, b) => (b.last || 0) - (a.last || 0));
  let nAtt = 0;
  for (let i = 0; i < need.length && calls < BUDGET; i += PAR) {
    await Promise.all(need.slice(i, i + PAR).map(async p => {
      const base = "/profile/wow/character/" + encodeURIComponent(p.s);
      const [qc, rp, st] = await Promise.all([get(base + "/quests/completed"), get(base + "/reputations"), get(base + "/achievements/statistics")]);
      const [er, ti, ac] = await Promise.all([get(base + "/encounters/raids"), get(base + "/titles"), get(base + "/achievements")]);   // två omgångar: sex samtidigt × 6 spelare gav 429
      if (er.status === 200 && er.json) p.rkl = parseRaids(er.json);
      // Titlar: [antal, aktiv titel, [alla titelnamn]]; achievements per kategori: { kategori: antal } (+ _p poäng, _n totalt)
      if (ti.status === 200 && ti.json) { const L = (ti.json.titles || []).map(x => x.name).filter(Boolean); p.ti = L.length ? [L.length, ti.json.active_title && ti.json.active_title.name || "", L] : 0; }
      if (ac.status === 200 && ac.json) { const o = {}; for (const c of ac.json.category_progress || []) if (c.category && c.category.name && c.quantity > 0) o[c.category.name] = c.quantity; o._n = ac.json.total_quantity || 0; o._p = ac.json.total_points || 0; p.ac = o._n ? o : 0; }
      if (st.status === 200 && st.json) {
        const bk = {}, fish = [0, 0, 0], pv = [0, 0, 0, 0, 0, 0, 0, 0];   // pv: bg spelade, bg vunna, killing blows, world kb, dueller vunna, förlorade, world HK, bg HK
        const gath = {};   // yrkesrader med antal: "Herbs gathered", "Mining nodes mined", "Items disenchanted" … (namnen som Blizzard ger)
        const pe = [0, 0, 0, 0, 0, 0, 0, 0];   // pe: total kills, creatures killed, dungeons entered, raids entered, quests completed, deaths, critters killed
        const PE = [/^Total kills$/i, /^Creatures killed$/i, /^Total 5-player dungeons entered$/i, /raids entered$/i, /^Quests completed$/i, /^Total deaths$/i, /^Critters killed$/i, /^Quests abandoned$/i];
        const tr = [0, 0, 0, 0], TR = [/^Flight paths taken$/i, /^Mage Portals taken$/i, /^Summons accepted$/i, /times hearthed$/i];   // resor: flyg, portaler, summons, hearth
        const PV = [/^Battlegrounds played$/i, /^Battlegrounds won$/i, /^Total Killing Blows$/i, /^World Killing Blows$/i, /^Duels won$/i, /^Duels lost$/i, /^World Honorable Kills$/i, /^Battleground Honorable Kills$/i];
        const walk = (cat, sub) => {
          for (const x of cat.statistics || []) {
            const m = /^(.+?) kills \((.+)\)$/i.exec(x.name || "");
            if (m) { const e = bk[m[2]] = bk[m[2]] || [0, 0]; if (x.quantity > 0) e[0]++; if (FINAL[m[2]] ? m[1] === FINAL[m[2]] : true) e[1] = Math.max(e[1], x.quantity || 0); continue; }
            if (/^fish(?:es)?\b.*caught/i.test(x.name)) fish[0] = x.quantity || 0;
            else if (/different fish/i.test(x.name)) fish[1] = x.quantity || 0;
            else if (/^fishing skill/i.test(x.name)) fish[2] = x.quantity || 0;
            else if (/gathered|picked|plucked|mined|skinned|disenchanted|produced|crafted|created|learned|known/i.test(x.name || "")) { if (x.quantity > 0) gath[x.name] = x.quantity; }   // Forever räknar inte örter/malm/skinning (2026-11-19), men recept lärda och disenchant finns
            else { PV.forEach((re, i) => { if (re.test(x.name || "")) pv[i] = x.quantity || 0; }); PE.forEach((re, i) => { if (re.test(x.name || "")) pe[i] = x.quantity || 0; }); TR.forEach((re, i) => { if (re.test(x.name || "")) tr[i] = x.quantity || 0; }); }
          }
          for (const sc of cat.sub_categories || []) walk(sc, true);
        };
        for (const c of st.json.categories || []) walk(c, false);
        p.bk = bk; p.fish = fish[0] || fish[1] || fish[2] ? fish : 0; p.pv2 = pv.some(v => v > 0) ? pv : 0; p.pve = pe.some(v => v > 0) ? pe : 0; p.gath = Object.keys(gath).length ? gath : 0; p.tr = tr.some(v => v > 0) ? tr : 0; p.gv = 3;
      }
      if (qc.status === 200 && qc.json) {
        const done = new Set((qc.json.quests || []).map(q => q.id)), any = ids => ids.some(id => done.has(id));
        p.att = (any(ATTQ.mc) ? 1 : 0) | (any(p.fa === "ALLIANCE" ? ATTQ.onyA : ATTQ.onyH) ? 2 : 0) | (any(ATTQ.bwl) ? 4 : 0) | (any(ATTQ.naxx) ? 8 : 0);
        p.attT = now; nAtt++;
      }
      if (rp.status === 200 && rp.json) {
        const rs = rp.json.reputations || [], fo = {};
        let ex = 0;
        for (const r of rs) { const nm = r.faction && r.faction.name, st = r.standing && r.standing.name; if (st === "Exalted") ex++; if (REPF.includes(nm)) fo[nm] = [STAND[st] ?? 3, r.standing && r.standing.value || 0]; }
        p.rep = { ex, f: fo };
      }
    }));
  }
  console.log("attunements/rykte: " + nAtt + " 60:or uppdaterade, " + (need.length - nAtt) + " kvar");
  // Raidkills för 60:or som ännu inte fått dem (ett anrop var), inom budgeten.
  const needR = Object.values(players).filter(p => p.lv >= 60 && p.rkl === undefined);
  let nR = 0;
  for (let i = 0; i < needR.length && calls < BUDGET; i += PAR) {
    await Promise.all(needR.slice(i, i + PAR).map(async p => {
      const er = await get("/profile/wow/character/" + encodeURIComponent(p.s) + "/encounters/raids");
      if (er.status === 200 && er.json) { p.rkl = parseRaids(er.json); nR++; }
    }));
  }
  // Slagfälten för spelare som hämtades innan bgm fanns (2026-11-28): bara pvp-summary, flest HK först, egen budget
  // (AH_KATALOG_BG_CALLS, normalt 20 000) så att alla med HK har sina slagfält inom några dygn.
  const BG_CALLS = +process.env.AH_KATALOG_BG_CALLS || 20000, bgStop = calls + BG_CALLS;
  const needB = Object.values(players).filter(p => p.hk > 0 && p.bgm === undefined).sort((a, b) => b.hk - a.hk);
  let nB = 0;
  for (let i = 0; i < needB.length && calls < bgStop; i += PAR) {
    await Promise.all(needB.slice(i, i + PAR).map(async p => {
      const pv = await get("/profile/wow/character/" + encodeURIComponent(p.s) + "/pvp-summary");
      if (pv.status === 200 && pv.json) { p.bgm = parseBg(pv.json); p.hk = pv.json.honorable_kills || p.hk; p.rk = pv.json.pvp_rank || p.rk; nB++; }
      else if (pv.status === 404) p.bgm = 0;
    }));
  }
  console.log("slagfält: " + nB + " spelare hämtade, " + Math.max(0, needB.length - nB) + " kvar, " + Object.keys(bgn).length + " kartor");
  // First kills: tidigaste kill per boss över alla spelare (en boss som dödats en gång har senaste = första).
  let nFk = 0;
  for (const p of Object.values(players)) {
    if (!p.rkl || typeof p.rkl !== "object") continue;
    for (const [boss, v] of Object.entries(p.rkl)) {
      if (!v[0]) continue;
      if (!firstKills[boss] || v[0] < firstKills[boss].t) { firstKills[boss] = { t: v[0], inst: v[1], p: p.s, n: p.n + (p.sn ? " " + p.sn : ""), g: p.g || "", gn: p.gn || "", fa: p.fa }; nFk++; }
    }
  }
  console.log("raidkills: " + nR + " 60:or hämtade, " + Object.keys(firstKills).length + " bossar med first kill (" + nFk + " nya/tidigare)");
  const pl = Object.values(players), gl = Object.values(guilds);
  // Guildernas item level och HK ur katalogens spelare (de som hunnit hämtas).
  const byG = {};
  for (const p of pl) if (p.g) (byG[p.g] = byG[p.g] || []).push(p);
  for (const g of gl) {
    const m = byG[g.s] || [], top = m.filter(p => p.lv >= 60);
    g.il60 = top.length ? Math.round(top.reduce((a, p) => a + p.il, 0) / top.length * 10) / 10 : 0;
    g.hk = m.reduce((a, p) => a + p.hk, 0); g.ap = m.reduce((a, p) => a + p.ap, 0); g.known = m.length;
    const pv = m.filter(p => p.rs === "pvp").length, no = m.filter(p => p.rs === "normal").length;   // guildens ruleset = medlemmarnas
    g.rs = pv || no ? (pv >= no ? "pvp" : "normal") : (g.rs || "");
  }
  fs.writeFileSync(OUT, JSON.stringify({ t: now, start: start || now, source: "Blizzard API (WoW Forever)", players: pl, guilds: gl, firstKills, bgn, miss }));
  console.log("addonets nya namn: " + nNew + " i kö, " + qN.length + " kvar; 404-minne: " + Object.keys(miss).length);
  console.log("katalog: " + pl.length + " spelare, " + gl.length + " guilder, " + calls + " anrop, kvar i kön: " + qP.length + " spelare / " + qG.length + " guilder");
})().catch(e => { console.error(e); process.exit(1); });
