'use strict';

/* Seasonal gifts (owner, 10 Nov 2026: "Create a Seasonal Gifts page for
   Deepawali, Christmas, New Year, and other occasions. Let admins configure
   gift collections and offers by season and year, schedule upcoming seasons,
   and automatically display the active season's content. Add an admin toggle
   to show or hide the page and its navigation links on the public site.")

   A season is one occasion in one year: Deepawali 2026, Christmas 2026. It
   has its dates (India time, both days included), a headline and a line
   under it, its offers, and its collections. An offer is words on the page
   (a title, a line, the day it ends): the shop's checkout takes no codes and
   charges what lib/shop.js says, so an offer never promises a discount the
   checkout would not give. A collection holds shop pieces,
   named by their id in lib/shop.js (their photograph and place on shop.html
   are in lib/shop-pieces.json), and gift cards that lead elsewhere on the
   site: a donation in someone's name, a membership.

   Kept in Firestore, one document a season, in giftSeasons. Written only
   from the panel (lib/routes/admin/gifts.js), read by gifts.html through
   /api/gifts (lib/routes/gifts.js).

   Which season the page shows is worked out each time, from today's date in
   India: a published season whose dates include today. Two at once (New
   Year's starts while Christmas's is still on) gives the one that started
   last, so the newer occasion takes over the day it begins. A draft is never
   shown. With nothing on, the page says which season comes next and shows
   its year-round gifts. */

const PIECES = require('./shop-pieces.json').pieces;

const COLLECTION = 'giftSeasons';
const OCCASIONS = [
  { key: 'deepawali', name: 'Deepawali' },
  { key: 'christmas', name: 'Christmas' },
  { key: 'new-year', name: 'New Year' },
  { key: 'raksha-bandhan', name: 'Raksha Bandhan' },
  { key: 'holi', name: 'Holi' },
  { key: 'eid', name: 'Eid' },
  { key: 'pongal', name: 'Pongal and Sankranti' },
  { key: 'other', name: '' }
];
const LIMITS = { name: 40, headline: 90, intro: 320, collections: 8, items: 24, offers: 6, title: 60, blurb: 200, text: 160, href: 300, price: 30 };
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function text(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function validDay(v) {
  const m = DAY.exec(String(v || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
/* Today in India, as YYYY-MM-DD. */
function todayIST(now) {
  const t = new Date((now == null ? Date.now() : +new Date(now)) + 5.5 * 3600e3);
  return t.toISOString().slice(0, 10);
}
/* The same day a year on (29 February becomes 28). */
function nextYearDay(day) {
  const m = DAY.exec(day);
  const y = +m[1] + 1;
  const last = new Date(Date.UTC(y, +m[2], 0)).getUTCDate();
  return `${y}-${m[2]}-${String(Math.min(+m[3], last)).padStart(2, '0')}`;
}

/* A link on a gift card: a page of this site, or an https address. */
function safeHref(v) {
  const h = text(v, LIMITS.href);
  if (!h) return '';
  if (/^https:\/\/[^\s"'<>]+$/i.test(h)) return h;
  if (/^[a-z0-9][a-z0-9-]*\.html(#[A-Za-z0-9_-]+)?(\?[A-Za-z0-9_=&%-]*)?$/.test(h)) return h;
  return null;
}
/* A picture: one of the site's own, or an https address. */
function safeImage(v) {
  const h = text(v, LIMITS.href);
  if (!h) return '';
  if (/^https:\/\/[^\s"'<>]+\.(?:jpe?g|png|webp|avif|gif)(\?[^\s"'<>]*)?$/i.test(h)) return h;
  if (/^(?:img|media)\/[A-Za-z0-9/_.-]+\.(?:jpe?g|png|webp|avif|gif)$/.test(h) && !h.includes('..')) return h;
  return null;
}
function occasionName(key, custom) {
  const o = OCCASIONS.find((x) => x.key === key);
  return o && o.name ? o.name : text(custom, LIMITS.name);
}

/* What the panel sent, checked and cleaned. { season } or { error }, the
   error a sentence the person can act on. */
function validate(input, existingId) {
  const b = input && typeof input === 'object' ? input : {};
  const occasion = OCCASIONS.some((o) => o.key === b.occasion) ? b.occasion : '';
  if (!occasion) return { error: 'Choose the occasion.' };
  const name = occasionName(occasion, b.name);
  if (!name) return { error: 'Name the occasion.' };
  const year = Number(b.year);
  if (!Number.isInteger(year) || year < 2024 || year > 2100) return { error: 'Give the year, for example 2026.' };
  if (!validDay(b.startDate)) return { error: 'Give the first day of the season.' };
  if (!validDay(b.endDate)) return { error: 'Give the last day of the season.' };
  if (b.endDate < b.startDate) return { error: 'The last day comes before the first.' };
  const span = (Date.parse(b.endDate) - Date.parse(b.startDate)) / 864e5;
  if (span > 120) return { error: 'A season can run for 120 days at most.' };
  const status = b.status === 'published' ? 'published' : 'draft';
  const headline = text(b.headline, LIMITS.headline);
  if (status === 'published' && !headline) return { error: 'Write the headline the page opens with.' };

  const offers = [];
  for (const o of (Array.isArray(b.offers) ? b.offers : []).slice(0, LIMITS.offers + 1)) {
    const title = text(o && o.title, LIMITS.title);
    if (!title) continue;
    if (offers.length >= LIMITS.offers) return { error: `A season can carry ${LIMITS.offers} offers at most.` };
    const until = o && o.until ? String(o.until) : '';
    if (until && !validDay(until)) return { error: `The offer "${title}" has an end date that is not a date.` };
    offers.push({ title, detail: text(o.detail, LIMITS.blurb), until });
  }

  const collections = [];
  const rawCollections = Array.isArray(b.collections) ? b.collections : [];
  if (rawCollections.length > LIMITS.collections) return { error: `A season can have ${LIMITS.collections} collections at most.` };
  for (const c of rawCollections) {
    const title = text(c && c.title, LIMITS.title);
    const items = [];
    for (const it of (Array.isArray(c && c.items) ? c.items : [])) {
      if (it && it.type === 'piece') {
        const id = text(it.id, 10);
        if (!PIECES.some((p) => p.id === id)) return { error: `"${title || 'A collection'}" names a shop piece that is not in the shop.` };
        if (!items.some((x) => x.type === 'piece' && x.id === id)) items.push({ type: 'piece', id });
      } else if (it && it.type === 'link') {
        const t = text(it.title, LIMITS.title);
        if (!t) continue;
        const href = safeHref(it.href);
        if (href === null || !href) return { error: `The gift card "${t}" needs a link: a page of this site, like donate.html, or an https address.` };
        const image = safeImage(it.image);
        if (image === null) return { error: `The picture for "${t}" must be one of the site's own (img/ or media/) or an https address ending in .jpg, .png or .webp.` };
        items.push({ type: 'link', title: t, text: text(it.text, LIMITS.text), href, image, price: text(it.price, LIMITS.price) });
      }
      if (items.length > LIMITS.items) return { error: `"${title || 'A collection'}" can hold ${LIMITS.items} gifts at most.` };
    }
    if (!title && !items.length) continue;
    if (!title) return { error: 'Every collection needs a title.' };
    if (!items.length && status === 'published') return { error: `"${title}" has no gifts in it yet.` };
    collections.push({ title, blurb: text(c.blurb, LIMITS.blurb), items });
  }
  if (status === 'published' && !collections.length) return { error: 'Add at least one collection before publishing.' };

  return {
    season: {
      id: existingId || '',
      occasion, name, year,
      startDate: b.startDate, endDate: b.endDate,
      status, headline, intro: text(b.intro, LIMITS.intro),
      offers, collections
    }
  };
}

/* draft, scheduled, live or ended, on a given day */
function stateOf(season, today) {
  if (!season || season.status !== 'published') return 'draft';
  if (today < season.startDate) return 'scheduled';
  if (today > season.endDate) return 'ended';
  return 'live';
}

function pick(seasons, today) {
  const list = (seasons || []).filter((s) => s && s.status === 'published');
  const live = list.filter((s) => stateOf(s, today) === 'live')
    .sort((a, b) => (b.startDate.localeCompare(a.startDate)) || (a.endDate.localeCompare(b.endDate)) || String(a.id).localeCompare(String(b.id)));
  const next = list.filter((s) => stateOf(s, today) === 'scheduled')
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.id).localeCompare(String(b.id)));
  return { active: live[0] || null, next: next[0] || null };
}

/* A season as the public page gets it: pieces filled in from the shop, a
   piece no longer on sale left out, an offer whose end date has passed left
   out, and an emptied collection left out. */
function publicView(season, today) {
  if (!season) return null;
  const collections = (season.collections || []).map((c) => ({
    title: c.title,
    blurb: c.blurb || '',
    items: (c.items || []).map((it) => {
      if (it.type === 'piece') {
        const p = PIECES.find((x) => x.id === it.id);
        if (!p || !p.available) return null;
        return { type: 'piece', id: p.id, title: p.name, by: p.designer, price: p.price, listPrice: p.listPrice > p.price ? p.listPrice : 0, image: p.image, href: `shop.html#${p.anchor}` };
      }
      return { type: 'link', title: it.title, text: it.text || '', href: it.href, image: it.image || '', price: it.price || '' };
    }).filter(Boolean)
  })).filter((c) => c.items.length);
  return {
    id: season.id,
    occasion: season.occasion,
    name: season.name,
    year: season.year,
    startDate: season.startDate,
    endDate: season.endDate,
    headline: season.headline,
    intro: season.intro || '',
    offers: (season.offers || []).filter((o) => !o.until || o.until >= today),
    collections
  };
}

function teaser(season) {
  return season ? { name: season.name, year: season.year, startDate: season.startDate } : null;
}

function slug(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'season';
}

/* ---- Firestore ------------------------------------------------------------ */

/* Every season not removed. A removed season is kept, marked removed (no
   server code deletes a stored record), and is in no list and on no page. */
async function readAll(db) {
  const snap = await db.collection(COLLECTION).get();
  const out = [];
  snap.forEach((doc) => { const d = doc.data(); if (!d.removed) out.push(Object.assign({}, d, { id: doc.id })); });
  return out.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
}

/* The public answer, kept on each instance for a few seconds on top of what
   the edge keeps (lib/routes/gifts.js). */
const MEMORY_MS = 15000;
const READ_TIMEOUT_MS = 2500;
let memory = null;

/* The timer is made and cleared around the read whatever happens to it, so a
   read that fails at once leaves nothing running. */
function withTimeout(promise, ms) {
  let timer;
  const late = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timed out reading the gift seasons')), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

async function publicAnswer(deps) {
  const now = (deps && deps.now && deps.now()) || Date.now();
  if (memory && memory.until > now) return memory.body;
  const today = todayIST(now);
  try {
    const getDb = (deps && deps.getDb) || require('./firebase').getDb;
    const seasons = await withTimeout(Promise.resolve().then(() => readAll(getDb())), (deps && deps.timeoutMs) || READ_TIMEOUT_MS);
    const { active, next } = pick(seasons, today);
    const body = { ok: true, today, season: publicView(active, today), next: teaser(next) };
    memory = { until: now + MEMORY_MS, body };
    return body;
  } catch (error) {
    console.warn('gift seasons could not be read', (error && error.message) || error);
    return { ok: false, unavailable: true, today, season: null, next: null };
  }
}

function forget() { memory = null; }

module.exports = {
  COLLECTION, OCCASIONS, LIMITS, PIECES,
  validate, stateOf, pick, publicView, teaser, todayIST, nextYearDay, slug, safeHref, safeImage,
  readAll, publicAnswer, forget
};
