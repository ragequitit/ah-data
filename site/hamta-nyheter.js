// hamta-nyheter.js – News och Blue posts till startsidan (Joakim 2026-11-23: "news och blueposts om wow forever ... så man
// alltid håller folk uppdaterade"). Källan är Blizzards egna forum (Discourse): gruppen blizzard-tracker listar allt som
// Blizzards anställda skriver, EU och US. Bara det som rör Forever tas med: inlägg i Forever-kategorierna eller med
// "Forever" i trådens titel.
//   News       = nya trådar som Blizzard startat (hotfix-listor, nyheter, underhåll, podden)
//   Blue posts = Blizzards svar inne i trådar (nya hotfixar i en lista, svar till spelare)
// Sidan visar rubrik, vem, när och en kort första rad, och länkar till forumet. Ingen text kopieras i övrigt.
// Körs av build.js (molnet bygger sidan två gånger i timmen) och skriver <PUB_DIR>/news.json. Tidigare poster i filen
// behålls, så listan inte blir tom om forumet svarar fel en gång.
//   node hamta-nyheter.js [mapp]
const fs = require("fs");
const path = require("path");
const DIR = process.argv[2] || process.env.AH_PUB_DIR || path.join(__dirname, "publik");
const OUT = path.join(DIR, "news.json");
const FORUMS = [{ r: "eu", base: "https://eu.forums.blizzard.com/en/wow" }, { r: "us", base: "https://us.forums.blizzard.com/en/wow" }];
const PAGES = 4, KEEP = 40, MAX_DAYS = 60;
const HDR = { "User-Agent": "Azeroth-Atlas-news/1.0 (+https://ragequitit.github.io/ah/)", Accept: "application/json" };

const get = async (u) => {
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 15000);
  try { const r = await fetch(u, { headers: HDR, signal: ac.signal }); if (!r.ok) throw new Error(r.status + " " + u); return await r.json(); }
  finally { clearTimeout(to); }
};
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", hellip: "…", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—" };
const clean = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&(#?\w+);/g, (m, e) => ENT[e] != null ? ENT[e] : /^#\d+$/.test(e) ? String.fromCharCode(+e.slice(1)) : m);
// Första meningsfulla raden: hoppa över datumrader och rubrikord som "Classes", kortat till ~110 tecken.
const firstLine = (ex) => {
  const lines = clean(ex).split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean)
    .filter((l) => !/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(l) && !/^\d{1,2} [A-Z][a-z]+ \d{4}$/.test(l));
  let i = 0; while (i < lines.length - 1 && lines[i].length < 25) i++;   // korta rubrikrader (Classes, Rogue, Combat)
  const ctx = lines.slice(0, i).slice(-2).join(" · ").replace(/:+$/, ""), l = lines[i] || "";
  let out = (ctx ? ctx + (/[,;!?.]$/.test(ctx) ? " " : ": ") : "") + l;
  if (out.length > 110) out = out.slice(0, 108).replace(/\s+\S*$/, "") + "…";
  return out.replace(/…+$/, "…");
};

// Hotfix-rader (Joakim 2026-11-23, "bygg 2": sökbara hotfixar). Blizzards hotfix-trådar är listor:
//   <p><strong>November 20, 2026</strong></p> <p><strong>Classes</strong></p> <ul><li><strong>Rogue</strong><ul><li><strong>Combat</strong><ul><li>text
// Varje innersta punkt blir en rad med datum, vägen dit ("Classes › Rogue › Combat") och länk till inlägget.
const FIX_TOPIC = /hotfix|tuning|balance|adjustment|xp increased/i, FIX_KEEP = 800;
const fixLines = (html, url, fallbackAt) => {
  const out = [], frames = [];
  let date = fallbackAt, sect = "", para = null, head = null;
  const txt = (s) => clean(s).replace(/\s+/g, " ").trim();
  for (const tok of String(html || "").split(/(<[^>]+>)/)) {
    if (!tok) continue;
    if (tok[0] !== "<") {
      if (frames.length) frames[frames.length - 1].t += tok;
      else if (head != null) head += tok;
      else if (para != null) para += tok;
      continue;
    }
    const tag = (tok.match(/^<\/?(\w+)/) || [])[1], close = tok[1] === "/";
    if (!tag) continue;
    if (/^h[1-4]$/.test(tag)) {
      if (!close) head = "";
      else { const h = txt(head || ""); head = null; if (h && !/^hotfix/i.test(h)) sect = h; }
    } else if (tag === "p" && !frames.length) {
      if (!close) para = "";
      else {
        const p = txt(para || ""); para = null;
        if (!p) continue;
        const d = Date.parse(p.replace(/(\d)(st|nd|rd|th)\b/, "$1"));
        // Datumet som dag (12:00 UTC), annars blir "November 20" den 19:e i UTC
        if (p.length < 40 && !isNaN(d) && /\d{1,2}/.test(p) && /[a-z]{3}/i.test(p)) { const L = new Date(d); date = Date.UTC(L.getFullYear(), L.getMonth(), L.getDate(), 12); sect = ""; }
        else if (p.length < 50 && !/[.!?:]$/.test(p)) sect = p;
      }
    } else if (tag === "li") {
      if (!close) frames.push({ t: "", ctx: null });
      else {
        const f = frames.pop(); if (!f) continue;
        const x = txt(f.t);
        if (x && f.ctx == null) {
          const path = [sect].concat(frames.map((g) => g.ctx)).filter(Boolean).join(" › ");
          out.push({ d: date, s: path, x, u: url });
        }
      }
    } else if (tag === "ul" || tag === "ol") {
      if (!close && frames.length) {
        const f = frames[frames.length - 1];
        if (f.ctx == null) {
          // Kort rubrik (Rogue, Combat) blir vägen; en hel mening med underpunkter (utvecklarnas noter) blir en egen rad.
          const x = txt(f.t); f.t = "";
          if (x.length > 50 || /[.!]$/.test(x)) { out.push({ d: date, s: [sect].concat(frames.slice(0, -1).map((g) => g.ctx)).filter(Boolean).join(" › "), x, u: url }); f.ctx = ""; }
          else f.ctx = x;
        }
      }
    }
  }
  return out;
};
const getFixes = async (F, topicIds) => {
  const out = [];
  for (const id of topicIds) {
    let j;
    try { j = await get(F.base + "/t/" + id + ".json"); } catch (e) { console.log("news: hotfixtråd " + id + ": " + e.message); continue; }
    let posts = (j.post_stream && j.post_stream.posts) || [];
    const have = new Set(posts.map((p) => p.id)), miss = ((j.post_stream && j.post_stream.stream) || []).filter((x) => !have.has(x));
    for (let i = 0; i < miss.length && i < 100; i += 20) {
      try { const k = await get(F.base + "/t/" + id + "/posts.json?" + miss.slice(i, i + 20).map((x) => "post_ids[]=" + x).join("&")); posts = posts.concat((k.post_stream && k.post_stream.posts) || []); }
      catch (e) { break; }
    }
    // Bara Blizzards inlägg. Inlägg 1 är ofta hela samlade listan: ta de enskilda inläggen först, så länken går till dagens inlägg.
    posts = posts.filter((p) => p.staff || /blizzard/i.test(p.primary_group_name || "")).sort((a, b) => (a.post_number === 1) - (b.post_number === 1) || b.post_number - a.post_number);
    for (const p of posts) out.push.apply(out, fixLines(p.cooked, F.base + "/t/" + j.slug + "/" + id + "/" + p.post_number, Date.parse(p.created_at)));
  }
  return out;
};

(async () => {
  let prev = { news: [], blue: [] };
  try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) {}
  const news = [], blue = [];
  let ok = 0;
  for (const F of FORUMS) {
    let forever = new Set();
    try {
      const c = await get(F.base + "/categories.json?include_subcategories=true");
      const walk = (cs, inF) => cs.forEach((x) => { const f = inF || /forever/i.test(x.name + " " + x.slug); if (f) forever.add(x.id); if (x.subcategory_list) walk(x.subcategory_list, f); });
      walk(c.category_list.categories, false);
    } catch (e) { console.log("news: kategorier " + F.r + ": " + e.message); }
    let before = "";
    for (let p = 0; p < PAGES; p++) {
      let j;
      try { j = await get(F.base + "/groups/blizzard-tracker/posts.json" + (before ? "?before_post_id=" + before : "")); ok++; }
      catch (e) { console.log("news: " + F.r + " sida " + (p + 1) + ": " + e.message); break; }
      const posts = j.posts || [];
      if (!posts.length) break;
      for (const x of posts) {
        const title = clean(x.topic_title).trim();
        if (!forever.has(x.category_id) && !/forever/i.test(title)) continue;
        const item = { title, url: F.base + x.url.replace(/^\/en\/wow/, ""), at: Date.parse(x.created_at), by: x.name || x.username, r: F.r };
        if (x.post_number === 1) news.push(item);
        else blue.push(Object.assign(item, { ex: firstLine(x.excerpt) }));
      }
      before = Math.min.apply(null, posts.map((x) => x.id));
    }
  }
  if (!ok) { console.log("news: forumet svarade inte, news.json oförändrad"); return; }
  // EU först; samma rubrik (nyheter) eller rubrik + rad (svar) i båda regionerna visas en gång.
  // EU och US skriver datumet olika ("- 17 November" / "- November 17"): jämför utan datum och siffror.
  const sameKey = (t) => t.toLowerCase().replace(/(january|february|march|april|may|june|july|august|september|october|november|december)/g, "").replace(/[^a-z]+/g, "");
  const merge = (now, old, key) => {
    const seen = new Set(), out = [];
    now.concat(old || []).sort((a, b) => (b.at - a.at) || (a.r === "eu" ? -1 : 1)).forEach((x) => {
      const k = key(x); if (seen.has(k)) return; seen.add(k);
      if (Date.now() - x.at > MAX_DAYS * 864e5) return;
      out.push(x);
    });
    return out.slice(0, KEEP);
  };
  const res = { t: Date.now(),
    news: merge(news, prev.news, (x) => sameKey(x.title)),
    // Blue posts per region (Joakim 2026-11-23: väljare EU/US på sidan), 40 var
    blue: ["eu", "us"].reduce((a, r) => a.concat(merge(blue.filter((x) => x.r === r), (prev.blue || []).filter((x) => x.r === r), (x) => sameKey(x.ex) || sameKey(x.title))), []) };
  // Hotfix-rader ur EU:s hotfix-trådar (US har samma text). Trådarna hittas bland nyheterna; samma rad samma dag en gång.
  const topicIds = [...new Set(res.news.filter((x) => x.r === "eu" && FIX_TOPIC.test(x.title)).map((x) => +((x.url.match(/\/(\d+)\/\d+$/) || [])[1])).filter(Boolean))];
  let fix = [];
  try { fix = await getFixes(FORUMS[0], topicIds); } catch (e) { console.log("news: hotfixar: " + e.message); }
  const day = (d) => new Date(d).toISOString().slice(0, 10), seenF = new Set();
  res.fix = fix.concat(fix.length ? [] : prev.fix || []).filter((x) => { const k = day(x.d) + sameKey(x.x); if (seenF.has(k)) return false; seenF.add(k); return Date.now() - x.d < MAX_DAYS * 864e5; })
    .sort((a, b) => b.d - a.d).slice(0, FIX_KEEP);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(res));
  console.log("news.json: " + res.news.length + " nyheter, " + res.blue.length + " blue posts, " + res.fix.length + " hotfix-rader (senaste " + new Date(res.news.concat(res.blue).reduce((m, x) => Math.max(m, x.at), 0)).toISOString().slice(0, 16) + ")");
})().catch((e) => console.log("news: " + e.message));
