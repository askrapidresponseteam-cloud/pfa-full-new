'use strict';

/* Site analytics without tracking anyone (owner, 3 Nov 2026: "admin to get
   analytics of how many visited which page.. and whatever other analytics
   that is actually useful").

   What is kept: numbers per day. How many times each page was opened; how
   many visits (a browser session, as the footer counter counts them); the
   page a visit began on; where visits came from (Google, Instagram,
   WhatsApp, a campaign link, typed in); phone, tablet or computer; the state
   or country, as the host reports it (Vercel's x-vercel-ip-country and
   -region headers); the hour of the day in India; and the scripts that
   failed on a page, so a broken page shows up in the panel before a visitor
   writes in about it.

   What is not: no cookie, no network address, no identifier of any kind, and
   nothing about one person. Each page view adds one to a few counters in one
   document for the day (analytics_days/<YYYY-MM-DD>, India time), one write
   per page view, inside Firestore's free allowance at the traffic PFA has.
   Campaign names and error messages, which a visitor's browser supplies,
   go to the day's second and third documents, so junk in them can never
   fill the day's main document. Browsers that ask not to be tracked (Do Not
   Track, Global Privacy Control) send nothing (assets/chrome.js). */

const crypto = require('node:crypto');

const DAY_MS = 864e5;
const IST_MS = 5.5 * 3600e3;

/* Which pages exist: the site's own list (assets/site-modules.json) and the
   unit pages (assets/unit-pages.json). A page key not on either is counted
   as "other", so no one can add fields by inventing addresses. */
let PAGES = null;
function pages() {
  if (PAGES) return PAGES;
  const out = new Map();
  try {
    const sm = require('../assets/site-modules.json');
    (sm.pages || []).forEach((p) => out.set(String(p.file || '').replace(/\.html$/, ''), p.title || p.id));
  } catch (_) { /* no list: everything is "other" */ }
  out.set('index', 'Home');
  try {
    const up = require('../assets/unit-pages.json');
    (up.units || []).forEach((u) => out.set(`units~${u.slug}`, `Unit: ${u.city}`));
  } catch (_) { /* no unit pages yet */ }
  PAGES = out;
  return out;
}

/* "/laws", "/laws.html", "laws.html#a27", "/units/agra" -> "laws", "units~agra" */
function pageKey(raw) {
  let p = String(raw || '').split(/[?#]/)[0].trim().toLowerCase();
  p = p.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  if (!p) p = 'index';
  const key = p.replace(/\//g, '~');
  return pages().has(key) ? key : 'other';
}

function titleOf(key) {
  if (key === 'other') return 'Other addresses';
  return pages().get(key) || key;
}

/* Where a visit came from, in a word the panel can show. */
const SOURCES = [
  [/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/duckduckgo\.com$/, 'DuckDuckGo'], [/(^|\.)yahoo\./, 'Yahoo'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'], [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'X (Twitter)'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'LinkedIn'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp'],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, 'ChatGPT'], [/(^|\.)perplexity\.ai$/, 'Perplexity'], [/(^|\.)(gemini\.google\.com|bard\.google\.com)$/, 'Gemini'],
  [/(^|\.)(peopleforanimalsindia\.org|pfa-new-website\.web\.app|pfa-new-website\.firebaseapp\.com)$/, 'This site'],
  [/(^|\.)rapid-response\.in$/, 'Rapid Response']
];
const UTM = { google: 'Google', facebook: 'Facebook', fb: 'Facebook', instagram: 'Instagram', ig: 'Instagram', whatsapp: 'WhatsApp', wa: 'WhatsApp', twitter: 'X (Twitter)', x: 'X (Twitter)', linkedin: 'LinkedIn', youtube: 'YouTube', email: 'Email', newsletter: 'Email', sms: 'SMS', qr: 'QR code', poster: 'QR code' };
function sourceOf(referrer, utmSource) {
  const u = String(utmSource || '').trim().toLowerCase();
  if (u) return UTM[u] || 'Campaign link';
  const host = String(referrer || '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#:]/)[0];
  if (!host) return 'Typed or bookmarked';
  for (const [re, name] of SOURCES) if (re.test(host)) return name;
  return 'Other websites';
}

function deviceOf(width, ua) {
  const w = Number(width);
  if (Number.isFinite(w) && w > 0) return w < 700 ? 'Phone' : w < 1100 ? 'Tablet' : 'Computer';
  return /mobi|android|iphone/i.test(String(ua || '')) ? 'Phone' : 'Computer';
}

const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|go-http|java\/|preview/i;
function isBot(ua) { return !ua || BOT.test(String(ua)); }

function dayOf(ms) { return new Date(ms + IST_MS).toISOString().slice(0, 10); }
function hourOf(ms) { return new Date(ms + IST_MS).getUTCHours(); }

/* A Firestore field name from something a browser sent: short, plain. */
function fieldName(v, max) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9 _-]+/g, '').replace(/\s+/g, ' ').slice(0, max || 30);
}

/* One page view, read and cleaned. Returns null for what is not counted. */
function readHit(body, headers, nowMs) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const h = headers || {};
  const ua = h['user-agent'] || '';
  if (isBot(ua)) return null;
  const key = pageKey(b.p);
  const country = String(h['x-vercel-ip-country'] || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  const region = String(h['x-vercel-ip-country-region'] || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  const error = typeof b.e === 'string' ? b.e.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  return {
    day: dayOf(nowMs), hour: hourOf(nowMs), page: key,
    visit: b.n === 1 || b.n === true || b.n === '1',
    source: sourceOf(b.r, b.us),
    campaign: fieldName(b.uc, 40),
    device: deviceOf(b.w, ua),
    country, region: country === 'IN' ? region : '',
    error
  };
}

/* The increments for the day's documents, for set(..., { merge: true }). */
function writesFor(hit, inc) {
  const main = { day: hit.day };
  if (hit.error) {
    main.errors = inc(1);
    main.errorPages = { [hit.page]: inc(1) };
    const id = crypto.createHash('sha256').update(hit.page + '|' + hit.error).digest('hex').slice(0, 12);
    return { main, errors: { [id]: { page: hit.page, message: hit.error, n: inc(1) } } };
  }
  main.views = inc(1);
  main.pages = { [hit.page]: inc(1) };
  main.devices = { [hit.device]: inc(1) };
  main.hours = { [String(hit.hour)]: inc(1) };
  if (hit.visit) {
    main.visits = inc(1);
    main.entries = { [hit.page]: inc(1) };
    main.sources = { [hit.source]: inc(1) };
    if (hit.country) main.countries = { [hit.country]: inc(1) };
    if (hit.region) main.regions = { [hit.region]: inc(1) };
  }
  const out = { main };
  if (hit.visit && hit.campaign) out.campaigns = { [hit.campaign]: inc(1) };
  return out;
}

/* India's states by the ISO 3166-2:IN code Vercel reports. */
const REGIONS = {
  AN: 'Andaman and Nicobar', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CH: 'Chandigarh', CT: 'Chhattisgarh', CG: 'Chhattisgarh',
  DN: 'Dadra, Nagar Haveli, Daman and Diu', DH: 'Dadra, Nagar Haveli, Daman and Diu', DD: 'Dadra, Nagar Haveli, Daman and Diu', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana', HP: 'Himachal Pradesh',
  JK: 'Jammu and Kashmir', JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep', MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur',
  ML: 'Meghalaya', MZ: 'Mizoram', NL: 'Nagaland', OR: 'Odisha', OD: 'Odisha', PY: 'Puducherry', PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu',
  TG: 'Telangana', TS: 'Telangana', TR: 'Tripura', UP: 'Uttar Pradesh', UT: 'Uttarakhand', UK: 'Uttarakhand', WB: 'West Bengal'
};

/* The days from..to inclusive, as YYYY-MM-DD, at most `max`. */
function daysBetween(from, to, max) {
  const a = Date.parse(from + 'T00:00:00Z'); const b = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out = [];
  for (let t = a; t <= b && out.length < (max || 400); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/* Add up the day documents into what the panel shows. */
function summarise(days, docs) {
  const sum = (into, map) => { Object.entries(map || {}).forEach(([k, v]) => { into[k] = (into[k] || 0) + (Number(v) || 0); }); };
  const t = { views: 0, visits: 0, errors: 0, pages: {}, entries: {}, sources: {}, devices: {}, countries: {}, regions: {}, hours: {}, errorPages: {}, campaigns: {} };
  const series = days.map((day, i) => {
    const d = docs[i] || {};
    t.views += Number(d.views) || 0; t.visits += Number(d.visits) || 0; t.errors += Number(d.errors) || 0;
    ['pages', 'entries', 'sources', 'devices', 'countries', 'regions', 'hours', 'errorPages'].forEach((k) => sum(t[k], d[k]));
    sum(t.campaigns, d.campaigns);
    return { day, views: Number(d.views) || 0, visits: Number(d.visits) || 0 };
  });
  const top = (map, n, label) => Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n || 50).map(([k, v]) => ({ key: k, label: label ? label(k) : k, n: v }));
  return {
    views: t.views, visits: t.visits, errors: t.errors,
    perVisit: t.visits ? Math.round((t.views / t.visits) * 10) / 10 : 0,
    series,
    pages: top(t.pages, 60, titleOf),
    entries: top(t.entries, 20, titleOf),
    sources: top(t.sources, 20),
    devices: top(t.devices, 5),
    regions: top(t.regions, 40, (k) => REGIONS[k] || k),
    countries: top(t.countries, 30),
    hours: Array.from({ length: 24 }, (_, h) => t.hours[String(h)] || 0),
    errorPages: top(t.errorPages, 20, titleOf),
    campaigns: top(t.campaigns, 30)
  };
}

module.exports = { pageKey, titleOf, sourceOf, deviceOf, isBot, dayOf, hourOf, readHit, writesFor, daysBetween, summarise, REGIONS, _reset: () => { PAGES = null; } };
