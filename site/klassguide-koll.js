// klassguide-koll.js – nybörjarguiden per klass i Classes-fliken (Joakim 2026-11-21): kollar klassguide/<klass>.json mot
// Forevers riktiga talangträd (talents.json) och spells (classes.json) och skriver ihop dem till klassguide.json åt sidan.
// Forever har gjort om många talanger (Spearing Strike, Bloodthrill …), så en Classic-guide går inte att skriva av rakt.
//
// Kör: node klassguide-koll.js            (alla klasser, skriver klassguide.json om allt håller)
//      node klassguide-koll.js warlock    (bara den klassen, skriver inget)
//
// Format per klass (klassguide/warlock.json):
// {
//   "class": "Warlock", "spec": "Affliction",          spec = trädet levelbuilden lägger flest poäng i
//   "diff": 1,                                         1 lätt, 2 medel, 3 svår för en nybörjare
//   "intro": "…",                                      högst 320 tecken
//   "good": ["…"], "bad": ["…"],                       2–4 resp. 1–3 korta rader (högst 70 tecken)
//   "stats": ["Stamina", "Intellect", …],              2–4, viktigast först
//   "talents": [["Improved Corruption", 5], …],        ordningen poängen läggs, en poäng per level från 10: summa 51
//   "levels": [ { "from": 1, "to": 10, "title": "…",   sex block: 1–10, 10–20, 20–30, 30–40, 40–50, 50–60
//                 "tips": ["…"],                       2–4 tips (högst 150 tecken)
//                 "rot": ["Shadow Bolt", …],           2–6 spells i den ordning man använder dem på en vanlig mob
//                 "train": ["Summon Voidwalker"] } ],  valfritt: det man inte får missa i blocket
//   "notes": { "10": "…" },                            valfritt: en rad på en viss level (högst 110 tecken), högst 20
//   "end": { "spec": "Destruction", "title": "…", "text": "…", "talents": [[…]] }   valfritt: build för level 60
// }
const fs = require("fs"), path = require("path");
const DIR = path.join(__dirname, "klassguide"), OUT = path.join(__dirname, "klassguide.json");
const TAL = JSON.parse(fs.readFileSync(path.join(__dirname, "talents.json"), "utf8"));
const CL = JSON.parse(fs.readFileSync(path.join(__dirname, "classes.json"), "utf8"));
const ORDER = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
const BR = [[1, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, 60]];
const only = (process.argv[2] || "").toLowerCase();

function treesOf(name) {
  const c = Object.values(TAL.classes).find((x) => x.name === name);
  if (!c) return null;
  return c.trees.map((tr) => {   // samma rensning som sidan (loadTal): krav från en lägre rad räknas inte
    const row = {}; tr.nodes.forEach((n) => { row[n.id] = n.row; });
    return { spec: tr.spec, nodes: tr.nodes.map((n) => ({ ...n, req: (n.req || []).filter((r) => row[r] == null || row[r] <= n.row) })) };
  });
}
// Spelar upp ordningen poäng för poäng. Ger { err[], ranks, byLevel[{lvl, name, rank, max, tree}], spent[3], learned{namn: level} }.
function play(trees, list, label) {
  const err = [], ranks = {}, spent = [0, 0, 0], byLevel = [], learned = {};
  let lvl = 10, total = 0;
  for (const it of list || []) {
    if (!Array.isArray(it) || typeof it[0] !== "string" || !(it[1] >= 1)) { err.push(label + ": felaktig post " + JSON.stringify(it)); continue; }
    let ti = -1, node = null;
    trees.forEach((tr, i) => tr.nodes.forEach((n) => { if (n.name === it[0]) { ti = i; node = n; } }));
    if (!node) { err.push(label + ": talangen finns inte i Forevers träd: " + it[0]); continue; }
    for (let k = 0; k < it[1]; k++) {
      const tr = trees[ti], have = ranks[node.id] || 0;
      if (have >= node.max) { err.push(label + ": " + node.name + " har bara " + node.max + " rang(er)"); break; }
      if (spent[ti] < (node.row - 1) * 5) { err.push(label + ": " + node.name + " (rad " + node.row + ") kräver " + (node.row - 1) * 5 + " poäng i " + tr.spec + ", har " + spent[ti] + " vid level " + lvl); break; }
      const miss = node.req.map((rid) => tr.nodes.find((x) => x.id === rid)).filter((r) => r && (ranks[r.id] || 0) < r.max);
      if (miss.length) { err.push(label + ": " + node.name + " kräver full " + miss.map((m) => m.name).join(", ") + " först (level " + lvl + ")"); break; }
      ranks[node.id] = have + 1; spent[ti]++; total++;
      byLevel.push({ lvl, name: node.name, rank: have + 1, max: node.max, tree: ti });
      if (have === 0) learned[node.name] = lvl;
      lvl++;
    }
  }
  if (total !== 51) err.push(label + ": " + total + " poäng, ska vara 51");
  return { err, ranks, byLevel, spent, learned };
}
const len = (s, n, what, err) => { if (typeof s !== "string" || !s.trim()) err.push(what + " saknas"); else if (s.length > n) err.push(what + " är " + s.length + " tecken (högst " + n + "): " + s.slice(0, 60) + "…"); };

function check(g, file) {
  const err = [], warn = [];
  if (!ORDER.includes(g.class)) { err.push("okänd klass " + g.class); return { err, warn }; }
  const trees = treesOf(g.class), cl = Object.values(CL.classes).find((x) => x.name === g.class);
  if (path.basename(file, ".json") !== g.class.toLowerCase()) err.push("filen ska heta " + g.class.toLowerCase() + ".json");
  if (!trees.some((t) => t.spec === g.spec)) err.push("spec " + g.spec + " är inget träd (" + trees.map((t) => t.spec).join(", ") + ")");
  if (![1, 2, 3].includes(g.diff)) err.push("diff ska vara 1, 2 eller 3");
  len(g.intro, 320, "intro", err);
  if (!Array.isArray(g.good) || g.good.length < 2 || g.good.length > 4) err.push("good: 2–4 rader"); else g.good.forEach((s, i) => len(s, 70, "good[" + i + "]", err));
  if (!Array.isArray(g.bad) || g.bad.length < 1 || g.bad.length > 3) err.push("bad: 1–3 rader"); else g.bad.forEach((s, i) => len(s, 70, "bad[" + i + "]", err));
  if (!Array.isArray(g.stats) || g.stats.length < 2 || g.stats.length > 4) err.push("stats: 2–4");
  const p = play(trees, g.talents, "talents");
  err.push(...p.err);
  const top = p.spent.indexOf(Math.max(...p.spent));
  if (!p.err.length && trees[top].spec !== g.spec) warn.push("flest poäng i " + trees[top].spec + " men spec = " + g.spec);
  // Spells: namnet finns hos klassen och går att ha vid blockets slut, eller är en talang som levelbuilden gett då.
  const spellMin = {};
  cl.spells.forEach((s) => { if (!s.x && (spellMin[s.n] == null || (s.l || 1) < spellMin[s.n])) spellMin[s.n] = s.l || 1; });
  cl.pets.forEach((pt) => pt.spells.forEach((s) => { if (spellMin[s.n] == null) spellMin[s.n] = s.l || 1; }));
  const spellOk = (name, to, what) => {
    if (p.learned[name] != null && p.learned[name] <= to) return;   // talangförmåga (rang 2+ kan stå hos tränaren senare)
    if (spellMin[name] != null) { if (spellMin[name] > to) err.push(what + ": " + name + " lärs först på level " + spellMin[name]); return; }
    if (p.learned[name] != null) { if (p.learned[name] > to) err.push(what + ": talangen " + name + " fås först på level " + p.learned[name]); return; }
    err.push(what + ": varken spell eller talang i buildens ordning: " + name);
  };
  if (!Array.isArray(g.levels) || g.levels.length !== 6) err.push("levels: exakt sex block");
  else g.levels.forEach((b, i) => {
    const w = "levels[" + b.from + "–" + b.to + "]";
    if (b.from !== BR[i][0] || b.to !== BR[i][1]) err.push(w + ": ska vara " + BR[i].join("–"));
    len(b.title, 40, w + " title", err);
    if (!Array.isArray(b.tips) || b.tips.length < 2 || b.tips.length > 4) err.push(w + ": tips 2–4"); else b.tips.forEach((s, k) => len(s, 150, w + " tips[" + k + "]", err));
    if (!Array.isArray(b.rot) || b.rot.length < 2 || b.rot.length > 6) err.push(w + ": rot 2–6"); else b.rot.forEach((s) => spellOk(s, b.to, w + " rot"));
    (b.train || []).forEach((s) => { spellOk(s, b.to, w + " train"); if (spellMin[s] != null && spellMin[s] < b.from) warn.push(w + " train: " + s + " lärs redan på " + spellMin[s]); });
  });
  const nk = Object.keys(g.notes || {});
  if (nk.length > 20) err.push("notes: högst 20");
  nk.forEach((k) => { if (!(+k >= 1 && +k <= 60)) err.push("notes: level " + k); len(g.notes[k], 110, "notes[" + k + "]", err); });
  if (g.end) {
    if (!trees.some((t) => t.spec === g.end.spec)) err.push("end.spec " + g.end.spec + " är inget träd");
    len(g.end.title, 40, "end.title", err); len(g.end.text, 220, "end.text", err);
    err.push(...play(trees, g.end.talents, "end.talents").err);
  }
  return { err, warn, spent: p.spent.join("/") };
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && (!only || f === only + ".json")) : [];
if (!files.length) { console.log("inga filer i " + DIR + (only ? " för " + only : "")); process.exit(1); }
let bad = 0;
const out = {};
for (const f of files) {
  let g;
  try { g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch (e) { console.log("✗ " + f + ": inte giltig JSON: " + e.message); bad++; continue; }
  const r = check(g, f);
  if (r.err.length) { bad++; console.log("✗ " + f); r.err.forEach((e) => console.log("   " + e)); } else console.log("✓ " + f + " (" + r.spent + ")");
  r.warn.forEach((w) => console.log("   varning: " + w));
  out[g.class] = g;
}
if (only) process.exit(bad ? 1 : 0);
if (bad) { console.log(bad + " fil(er) med fel: klassguide.json skrivs inte"); process.exit(1); }
const missing = ORDER.filter((n) => !out[n]);
if (missing.length) console.log("saknas än: " + missing.join(", "));
fs.writeFileSync(OUT, JSON.stringify({ t: new Date().toISOString().slice(0, 10), classes: out }));
console.log("skrev klassguide.json (" + Object.keys(out).length + " klasser)");
