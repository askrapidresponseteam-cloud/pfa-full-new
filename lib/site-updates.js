'use strict';
/* "From PFA": news and notices PFA puts out to the public (owner, 26 Nov
   2026: "find a best place to display new news/notifications. it could have
   new info that pfa releases to public.. it should have a cool video player
   as well").

   Written in the panel (Updates, lib/routes/admin/updates.js), shown on the
   home page as one slim strip under the hero's buttons and in full at the
   top of the Newsroom (assets/updates.js), read from /api/updates.

   An update is a title, a few lines, and at most one picture and one film:
     media.kind  'file'       a film uploaded from the panel, kept in the
                              project's Storage bucket (lib/update-media.js)
                 'youtube'    a YouTube link, a live one included
                 'vimeo'      a Vimeo link
                 'instagram'  an Instagram post or reel
                 'mux'        a recording of a PFA live show (lib/live-show.js)
   Films play in the site's own player (assets/theatre.js); an Instagram
   reel opens in the reel box the founder and CineKind pages use, since no
   player outside Instagram's frame can drive it.

   Long dashes are turned into plain hyphens on the way in, not refused:
   the site never shows one (owner's standing rule), and a person pasting a
   press note should not be sent back to retype it. */

const crypto = require('crypto');

const COLLECTION = 'siteUpdates';
const MAX_TITLE = 90;
const MAX_BODY = 1200;
const MAX_PUBLIC = 20;
const KINDS = ['news', 'notice', 'event'];
const KIND_LABEL = { news: 'News', notice: 'Notice', event: 'Event' };

const DASHES = /[\u2012\u2013\u2014\u2015\u2212\u2E3A\u2E3B\uFE58\uFE63\uFF0D]/g;
function clean(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(DASHES, '-')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}
function oneLine(v, max) { return clean(v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max); }

/* A film or post link, read into what the site needs to play it. Only the
   hosts the site's players and its Content-Security-Policy allow. */
function readLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (_) { return { bad: true }; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '').toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  const yt = (id) => (/^[\w-]{11}$/.test(id || '') ? { kind: 'youtube', id } : { bad: true });
  if (host === 'youtu.be') return yt(parts[0]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.searchParams.get('v')) return yt(u.searchParams.get('v'));
    if (['embed', 'live', 'shorts', 'v'].includes(parts[0])) return yt(parts[1]);
    return { bad: true };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = parts.find((p) => /^\d{5,12}$/.test(p));
    return id ? { kind: 'vimeo', id } : { bad: true };
  }
  /* Facebook (owner, 26 Nov 2026: "allow facebook links as well.. and they
     should start playing natively"): a reel, a video, a watch link, a share
     link or fb.watch, kept as the plain address Facebook's own player takes,
     without the tracking that comes after it */
  if (host === 'fb.watch') return /^[\w-]{4,40}$/.test(parts[0] || '') ? { kind: 'facebook', url: `https://fb.watch/${parts[0]}/`, reel: false } : { bad: true };
  if (host === 'facebook.com' || host === 'web.facebook.com' || host === 'fb.com') {
    const num = (v) => (/^\d{5,25}$/.test(v || '') ? v : '');
    if (parts[0] === 'reel' && num(parts[1])) return { kind: 'facebook', url: `https://www.facebook.com/reel/${parts[1]}`, reel: true };
    if (parts[0] === 'watch' && num(u.searchParams.get('v'))) return { kind: 'facebook', url: `https://www.facebook.com/watch/?v=${u.searchParams.get('v')}`, reel: false };
    if (parts[0] === 'share' && ['v', 'r'].includes(parts[1]) && /^[\w-]{4,40}$/.test(parts[2] || '')) return { kind: 'facebook', url: `https://www.facebook.com/share/${parts[1]}/${parts[2]}/`, reel: parts[1] === 'r' };
    const vi = parts.indexOf('videos');
    if (vi >= 0 && num(parts[parts.length - 1])) return { kind: 'facebook', url: `https://www.facebook.com/${parts.slice(0, vi).map(encodeURIComponent).join('/')}${vi ? '/' : ''}videos/${parts[parts.length - 1]}`, reel: false };
    return { bad: true };
  }
  if (host === 'instagram.com') {
    const i = parts.findIndex((p) => ['p', 'reel', 'reels', 'tv'].includes(p));
    const code = i >= 0 ? parts[i + 1] : '';
    return /^[\w-]{5,40}$/.test(code || '') ? { kind: 'instagram', id: code, reel: parts[i] !== 'p' } : { bad: true };
  }
  return { bad: true, other: true };
}

/* A file this site keeps (lib/update-media.js): its address in the
   project's bucket, read back through Firebase Storage with its token. */
const FILE_URL = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[a-z0-9._-]+\/o\/public%2Fupdates%2F[\w%.-]+\?alt=media&token=[a-f0-9-]{36}$/;
function isOurFile(url) { return FILE_URL.test(String(url || '')); }

/* Where "Read more" goes: a page of this site, or a web address. */
function readMore(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: true, link: '' };
  const own = /^https?:\/\/(www\.)?peopleforanimalsindia\.org\/?/i;
  const local = s.replace(own, '').replace(/^\/+/, '');
  if (local !== s || /^[a-z0-9-]+\.html(#[\w-]+)?$/i.test(local)) {
    return /^([a-z0-9-]+\.html)?(#[\w-]+)?$/i.test(local) ? { ok: true, link: local || 'index.html' } : { ok: false, message: 'That page address is not right.' };
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return { ok: false, message: 'A link must start with https://.' };
    return { ok: true, link: u.href.slice(0, 400) };
  } catch (_) { return { ok: false, message: 'That link is not a web address.' }; }
}

function check(body) {
  const b = body || {};
  const title = oneLine(b.title, MAX_TITLE);
  if (title.length < 4) return { ok: false, message: 'Give the update a title.' };
  const text = clean(b.body, MAX_BODY);
  const kind = KINDS.includes(b.kind) ? b.kind : 'news';
  const more = readMore(b.link);
  if (!more.ok) return more;
  const linkLabel = more.link ? oneLine(b.linkLabel, 40) : '';

  let media = null;
  const m = b.media || {};
  if (m.kind === 'file') {
    if (!isOurFile(m.url)) return { ok: false, message: 'Upload the film again.' };
    media = { kind: 'file', url: m.url, type: /^video\/(mp4|webm|quicktime)$/.test(m.type) ? m.type : 'video/mp4' };
  } else if (m.kind === 'mux') {
    if (!/^[A-Za-z0-9]{10,80}$/.test(String(m.id || ''))) return { ok: false, message: 'That recording is not right.' };
    media = { kind: 'mux', id: String(m.id) };
  } else if (m.link) {
    const r = readLink(m.link);
    if (!r || r.bad) return { ok: false, message: r && r.other ? 'Films can come from YouTube, Vimeo, Instagram or Facebook, or be uploaded.' : 'That film link could not be read.' };
    media = r.kind === 'instagram' ? { kind: 'instagram', id: r.id, reel: !!r.reel }
      : r.kind === 'facebook' ? { kind: 'facebook', url: r.url, reel: !!r.reel }
      : { kind: r.kind, id: r.id };
  }
  let photo = '';
  if (b.photo) {
    if (!isOurFile(b.photo)) return { ok: false, message: 'Upload the picture again.' };
    photo = b.photo;
  }
  const photoAlt = photo ? oneLine(b.photoAlt, 160) : '';
  return {
    ok: true, title, body: text, kind, link: more.link, linkLabel, media, photo, photoAlt,
    pinned: !!b.pinned, status: b.status === 'draft' ? 'draft' : 'published'
  };
}

function newId(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex');
}

async function all(db) {
  const snap = await db.collection(COLLECTION).get();
  const out = [];
  snap.forEach((d) => { const v = d.data() || {}; if (v.status !== 'removed') out.push(Object.assign({ id: d.id }, v)); });
  return out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.publishedAt || b.createdAt || '').localeCompare(String(a.publishedAt || a.createdAt || '')));
}

async function save(db, who, body, nowMs) {
  const c = check(body);
  if (!c.ok) return c;
  const at = new Date(nowMs).toISOString();
  const id = body && /^\d{8}-[a-f0-9]{6}$/.test(String(body.id || '')) ? String(body.id) : '';
  const ref = db.collection(COLLECTION).doc(id || newId(nowMs));
  const before = id ? await ref.get() : null;
  if (id && (!before || !before.exists)) return { ok: false, message: 'That update is no longer there.' };
  const old = before ? before.data() || {} : {};
  const doc = {
    title: c.title, body: c.body, kind: c.kind, link: c.link, linkLabel: c.linkLabel,
    media: c.media, photo: c.photo, photoAlt: c.photoAlt, pinned: c.pinned, status: c.status,
    updatedAt: at, updatedBy: who,
    createdAt: old.createdAt || at, createdBy: old.createdBy || who,
    /* the date shown is the day it first went out; editing a typo later
       does not make it news again */
    publishedAt: c.status === 'published' ? (old.publishedAt || at) : (old.publishedAt || '')
  };
  if (c.pinned) {
    const others = await db.collection(COLLECTION).where('pinned', '==', true).get();
    const unpin = [];
    others.forEach((d) => { if (d.id !== ref.id) unpin.push(d.ref.set({ pinned: false }, { merge: true })); });
    await Promise.all(unpin);
  }
  await ref.set(doc);
  return { ok: true, id: ref.id, title: c.title, status: c.status };
}

/* Taken off the site. The record is kept (marked removed), like every
   other record in this project: nothing is deleted. */
async function remove(db, who, id, nowMs) {
  const ref = db.collection(COLLECTION).doc(String(id || ''));
  const d = await ref.get();
  if (!d.exists) return { ok: false, message: 'That update is no longer there.' };
  await ref.set({ status: 'removed', pinned: false, removedAt: new Date(nowMs).toISOString(), removedBy: who }, { merge: true });
  return { ok: true, id: ref.id, title: (d.data() || {}).title || '' };
}

/* The day it went out, in India: a note posted at 1 am IST on the 26th is
   dated the 26th, not the 25th it still is in UTC. */
function istDay(iso) {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10) : '';
}

/* What a visitor's browser gets: never who wrote it. */
function publicOf(u) {
  return {
    id: u.id, title: u.title, body: u.body || '', kind: u.kind || 'news', kindLabel: KIND_LABEL[u.kind] || 'News',
    date: istDay(u.publishedAt), link: u.link || '', linkLabel: u.linkLabel || '',
    media: u.media || null, photo: u.photo || '', photoAlt: u.photoAlt || '', pinned: !!u.pinned
  };
}
async function publicList(db) {
  return (await all(db)).filter((u) => u.status === 'published').slice(0, MAX_PUBLIC).map(publicOf);
}

module.exports = { istDay, COLLECTION, MAX_TITLE, MAX_BODY, KINDS, clean, readLink, readMore, isOurFile, check, all, save, remove, publicList, publicOf };
