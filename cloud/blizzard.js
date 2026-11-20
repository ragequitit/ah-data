// blizzard.js – Blizzards Game Data API för WoW Forever (EU). Nyckeln ligger i C:\Users\joaki\.blizzard\client.json
// (utanför alla repon) och skrivs aldrig ut. Odokumenterat API (community-probat 2026-11): namespace dynamic-forever-eu,
// auktioner per "hus" under /data/wow/ruleset/{id}/auctions/ (rulesetet filtrerar inte, samma hus oavsett).
// Villkor: API-data sparas högst 30 dagar, Blizzard anges som källa, inga betalfunktioner, 36 000 anrop/h.
const fs = require("fs");
const path = require("path");
const KEY = path.join(process.env.USERPROFILE || "C:/Users/joaki", ".blizzard", "client.json");
const REGION = "eu";
const NS = { dyn: "dynamic-forever-eu", stat: "static-forever-eu", prof: "profile-forever-eu" };

let tok = null;   // { access_token, until }
async function token() {
  if (tok && Date.now() < tok.until) return tok.access_token;
  // I molnet (GitHub Actions) ligger nyckeln i miljön som hemligheter; på Joakims dator i filen.
  const k = process.env.BLIZZARD_CLIENT_ID ? { client_id: process.env.BLIZZARD_CLIENT_ID, client_secret: process.env.BLIZZARD_CLIENT_SECRET } : JSON.parse(fs.readFileSync(KEY, "utf8"));
  const id = String(k.client_id || "").trim(), secret = String(k.client_secret || "").trim();
  if (!id || !secret || id.startsWith("KLISTRA")) throw new Error("Ingen nyckel i " + KEY);
  const r = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error("token: HTTP " + r.status);
  const j = await r.json();
  tok = { access_token: j.access_token, until: Date.now() + (j.expires_in - 120) * 1000 };
  return tok.access_token;
}

// GET /data/wow/... med namespace. Ger { status, json, lastModified } och kastar inte på 404 (anroparen avgör).
async function get(p, ns, extra) {
  const t = await token();
  const url = "https://" + REGION + ".api.blizzard.com" + p + (p.includes("?") ? "&" : "?") + "namespace=" + (NS[ns] || ns) + "&locale=en_GB" + (extra || "");
  const r = await fetch(url, { headers: { Authorization: "Bearer " + t } });
  const out = { status: r.status, lastModified: r.headers.get("last-modified"), json: null };
  if (r.ok) out.json = await r.json();
  return out;
}

module.exports = { token, get, NS, REGION };
