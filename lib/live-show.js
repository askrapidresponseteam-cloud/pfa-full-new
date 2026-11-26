'use strict';
/* PFA Live: a monthly live show on the site, with comments and questions
   (owner, 26 Nov 2026: "how much would it cost to do a live stream like
   maneka ki bath. 1 time a month- for 30 mins. that includes live comments
   and qna. it has to be enterprise grade", then the plan agreed the same
   night: our own player, comments moderated, a Q&A desk in the panel, the
   recording posted as an update, a YouTube backup, "Live now" on the home
   page).

   Where the picture comes from, either:
     mux      Mux (mux.com) takes the stream from OBS or any encoder, sends
              it to every viewer at the quality their connection can carry,
              keeps the recording, and copies it to YouTube as a backup.
              Used when MUX_TOKEN_ID and MUX_TOKEN_SECRET are set.
     youtube  a YouTube Live link pasted in the panel, played on the page.
              The way to run a show before the Mux keys are in.
   Comments and questions are this site's own either way, in Firestore,
   moderated from the panel (lib/routes/admin/live.js).

   Kept:
     liveShow/current                    the show: title, status, source,
                                         what is in the spotlight
     liveShow/private                    the Mux stream key (panel only)
     liveShow/current/s_<session>/...    comments and questions of one show
     liveBlocks/<hash>                   people stopped from posting

   What a viewer's browser asks for (lib/routes/live.js) is cached for three
   seconds at the edge, so a thousand viewers polling cost the database a
   few reads a second, not a thousand. */

const crypto = require('crypto');

const COLLECTION = 'liveShow';
const BLOCKS = 'liveBlocks';
const RATE = 'liveRate';
const MAX_TEXT = 280;
const MAX_NAME = 40;
const SHOWN = 60;          // comments a viewer is sent
const GAP_MS = 8000;       // one message per person per this long

const DASHES = /[\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const clean = (v, max) => String(v == null ? '' : v).replace(DASHES, '-').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/* Words that keep a comment off the screen until someone at PFA looks at
   it. Short on purpose: a person reads everything held. */
const HOLD = /\b(f+u+c+k+\w*|sh[i1]t+|b[i1]tch\w*|bastard|asshole|c+u+n+t+|d[i1]ck|chut\w*|madarchod|behenchod|bhenchod|bc|mc|bsdk|gand\w*|lund|randi|harami|kutt[ie]\s*ki)\b/i;
const LINKY = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|org|net|io|co|ly|me|xyz)\b)/i;

function hash(v) { return crypto.createHash('sha256').update('pfa-live:' + String(v || '')).digest('hex').slice(0, 24); }

function ytIdOf(raw) {
  const U = require('./site-updates');
  const r = U.readLink(raw);
  return r && r.kind === 'youtube' ? r.id : '';
}

/* ---------- Mux ---------- */
function muxKeys() {
  const id = String(process.env.MUX_TOKEN_ID || '').trim();
  const secret = String(process.env.MUX_TOKEN_SECRET || '').trim();
  return id && secret ? { id, secret } : null;
}
let fetcher = null;   // tests
async function mux(method, path, body) {
  const k = muxKeys();
  if (!k) throw Object.assign(new Error('Mux keys are not set'), { code: 'NO_MUX' });
  const f = fetcher || fetch;
  const r = await f('https://api.mux.com/video/v1' + path, {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(k.id + ':' + k.secret).toString('base64'), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('Mux said ' + r.status + ': ' + String((j.error && (j.error.messages || [j.error.type]).join(' ')) || '').slice(0, 160)), { code: 'MUX', status: r.status });
  return j.data;
}

/* ---------- the show ---------- */
async function readShow(db) {
  const d = await db.collection(COLLECTION).doc('current').get();
  return d.exists ? d.data() || {} : {};
}
function sessionCol(db, session) { return db.collection(COLLECTION).doc('current').collection('s_' + session); }

/* What the home strip says: only while a show is on or about to start. */
async function headline(db) {
  const s = await readShow(db);
  if (s.status !== 'live' && s.status !== 'soon') return null;
  return { status: s.status, title: s.title || 'PFA Live', startsAt: s.startsAt || '' };
}

/* What every viewer's page is sent. */
async function publicState(db) {
  const s = await readShow(db);
  const status = ['soon', 'live', 'ended'].includes(s.status) ? s.status : 'off';
  const show = {
    status, title: s.title || 'PFA Live', about: s.about || '', startsAt: s.startsAt || '',
    source: s.source === 'mux' && s.playbackId ? 'mux' : (s.youtubeId ? 'youtube' : ''),
    playbackId: s.source === 'mux' ? (s.playbackId || '') : '', youtubeId: s.youtubeId || '',
    session: s.session || '', questions: s.questions !== false
  };
  let comments = [];
  if (s.session && status !== 'off') {
    const snap = await sessionCol(db, s.session).orderBy('at', 'desc').limit(SHOWN * 3).get();
    snap.forEach((d) => {
      const m = d.data() || {};
      if (m.type === 'comment' && m.status === 'shown' && comments.length < SHOWN) comments.push({ id: d.id, name: m.name, text: m.text, at: m.at, pfa: !!m.pfa });
    });
    comments.reverse();
  }
  return { show, spotlight: s.spotlight || null, comments };
}

function checkMessage(body) {
  const b = body || {};
  const type = b.type === 'question' ? 'question' : 'comment';
  const name = clean(b.name, MAX_NAME);
  const text = clean(b.text, MAX_TEXT);
  if (name.length < 2) return { ok: false, message: 'Add your name.' };
  if (text.length < 2) return { ok: false, message: type === 'question' ? 'Type your question.' : 'Type a comment.' };
  if (LINKY.test(text) || LINKY.test(name)) return { ok: false, message: 'Links cannot be posted here.' };
  const cid = /^[a-f0-9]{16,64}$/.test(String(b.cid || '')) ? String(b.cid) : '';
  if (!cid) return { ok: false, message: 'Reload the page and try again.' };
  return { ok: true, type, name, text, cid, hold: HOLD.test(text) || HOLD.test(name) };
}

/* A comment or a question from a viewer. */
async function post(db, body, ip, nowMs) {
  const c = checkMessage(body);
  if (!c.ok) return c;
  const s = await readShow(db);
  if (s.status !== 'live' && !(c.type === 'question' && s.status === 'soon')) return { ok: false, message: s.status === 'soon' ? 'Comments open when the show starts. You can send a question now.' : 'The show is not on just now.' };
  if (c.type === 'question' && s.questions === false) return { ok: false, message: 'Questions are closed for this show.' };
  const who = hash(c.cid), where = hash(ip || '');
  const [b1, b2] = await Promise.all([db.collection(BLOCKS).doc(who).get(), ip ? db.collection(BLOCKS).doc(where).get() : Promise.resolve({ exists: false })]);
  const blocked = b1.exists || b2.exists;
  const rateRef = db.collection(RATE).doc(who);
  const last = await rateRef.get();
  if (last.exists && nowMs - Number((last.data() || {}).at || 0) < GAP_MS) return { ok: false, message: 'One moment before the next one.' };
  await rateRef.set({ at: nowMs });
  const status = blocked ? 'hidden' : (c.type === 'question' || c.hold || s.approveFirst) ? 'held' : 'shown';
  const ref = sessionCol(db, s.session).doc();
  await ref.set({ type: c.type, name: c.name, text: c.text, at: nowMs, status, who, where, answered: false, held: !!c.hold });
  /* A person who was stopped is told the same as everyone: nothing to argue
     with, nothing to get round. */
  return { ok: true, id: ref.id, type: c.type, shown: status === 'shown' };
}

/* ---------- the panel ---------- */
async function panelState(db) {
  const s = await readShow(db);
  const priv = await db.collection(COLLECTION).doc('private').get();
  const p = priv.exists ? priv.data() || {} : {};
  let messages = [];
  if (s.session) {
    const snap = await sessionCol(db, s.session).orderBy('at', 'desc').limit(400).get();
    snap.forEach((d) => { const m = d.data() || {}; messages.push({ id: d.id, type: m.type, name: m.name, text: m.text, at: m.at, status: m.status, answered: !!m.answered, held: !!m.held, pfa: !!m.pfa }); });
  }
  return {
    show: {
      status: s.status || 'off', title: s.title || '', about: s.about || '', startsAt: s.startsAt || '',
      source: s.source || '', youtubeId: s.youtubeId || '', playbackId: s.playbackId || '', session: s.session || '',
      approveFirst: !!s.approveFirst, questions: s.questions !== false, spotlight: s.spotlight || null,
      startedAt: s.startedAt || '', endedAt: s.endedAt || '', posted: s.posted || ''
    },
    mux: { ready: !!muxKeys(), streamId: p.streamId ? true : false, streamKey: p.streamKey || '', server: 'rtmps://global-live.mux.com:443/app', simulcast: !!p.simulcast },
    messages
  };
}

async function setup(db, who, body, nowMs) {
  const b = body || {};
  const title = clean(b.title, 80);
  if (title.length < 3) return { ok: false, message: 'Give the show a title.' };
  const about = clean(b.about, 300);
  const startsAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(b.startsAt || '')) ? String(b.startsAt).slice(0, 16) : '';
  let youtubeId = '';
  if (b.youtube) { youtubeId = ytIdOf(b.youtube); if (!youtubeId) return { ok: false, message: 'That YouTube link could not be read.' }; }
  const s = await readShow(db);
  const source = b.source === 'mux' ? 'mux' : 'youtube';
  if (source === 'mux' && !s.playbackId) return { ok: false, message: 'Set up the Mux stream first.' };
  if (source === 'youtube' && !youtubeId) return { ok: false, message: 'Paste the YouTube Live link, or set up Mux.' };
  const fresh = s.status === 'ended' || s.status === 'off' || !s.session;
  const doc = {
    title, about, startsAt, youtubeId, source, approveFirst: !!b.approveFirst, questions: b.questions !== false,
    status: s.status === 'live' ? 'live' : (b.announce ? 'soon' : (s.status === 'soon' ? 'soon' : 'off')),
    session: fresh ? new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, '') + crypto.randomBytes(2).toString('hex') : s.session,
    spotlight: fresh ? null : (s.spotlight || null),
    posted: fresh ? '' : (s.posted || ''),
    updatedAt: new Date(nowMs).toISOString(), updatedBy: who
  };
  await db.collection(COLLECTION).doc('current').set(doc, { merge: true });
  return { ok: true, title };
}

/* One Mux stream, kept and used show after show: the same key in OBS every
   month. A new recording is made each time it goes live. */
async function muxSetup(db, who, body, nowMs) {
  if (!muxKeys()) return { ok: false, message: 'Mux keys are not set on the server yet.' };
  const privRef = db.collection(COLLECTION).doc('private');
  const priv = await privRef.get();
  const p = priv.exists ? priv.data() || {} : {};
  let stream = null;
  if (p.streamId) { try { stream = await mux('GET', '/live-streams/' + p.streamId); } catch (_) { stream = null; } }
  if (!stream) {
    stream = await mux('POST', '/live-streams', {
      playback_policies: ['public'], latency_mode: 'low', reconnect_window: 60,
      new_asset_settings: { playback_policies: ['public'] }
    });
  }
  const playbackId = ((stream.playback_ids || []).find((x) => x.policy === 'public') || {}).id || '';
  let simulcast = !!p.simulcast;
  const b = body || {};
  if (b.ytServer && b.ytKey) {
    if (!/^rtmps?:\/\/[\w.-]+(:\d+)?\/[\w/.-]*$/.test(String(b.ytServer))) return { ok: false, message: 'That YouTube stream address is not right.' };
    if (!/^[\w-]{8,64}$/.test(String(b.ytKey))) return { ok: false, message: 'That YouTube stream key is not right.' };
    await mux('POST', '/live-streams/' + stream.id + '/simulcast-targets', { url: String(b.ytServer), stream_key: String(b.ytKey), passthrough: 'YouTube backup' });
    simulcast = true;
  }
  await privRef.set({ streamId: stream.id, streamKey: stream.stream_key || p.streamKey || '', simulcast, at: new Date(nowMs).toISOString(), by: who });
  await db.collection(COLLECTION).doc('current').set({ playbackId, source: 'mux' }, { merge: true });
  return { ok: true, playbackId, simulcast };
}

async function setStatus(db, who, status, nowMs) {
  const s = await readShow(db);
  if (!s.title) return { ok: false, message: 'Set up the show first.' };
  const at = new Date(nowMs).toISOString();
  const patch = { status, updatedAt: at, updatedBy: who };
  if (status === 'live') { patch.startedAt = at; patch.endedAt = ''; }
  if (status === 'ended') { patch.endedAt = at; patch.spotlight = null; }
  await db.collection(COLLECTION).doc('current').set(patch, { merge: true });
  if (status === 'ended' && s.source === 'mux' && muxKeys()) {
    const p = (await db.collection(COLLECTION).doc('private').get()).data() || {};
    if (p.streamId) await mux('PUT', '/live-streams/' + p.streamId + '/complete').catch(() => {});
  }
  return { ok: true, status, title: s.title };
}

async function moderate(db, who, body, nowMs) {
  const b = body || {};
  const s = await readShow(db);
  if (!s.session) return { ok: false, message: 'There is no show yet.' };
  const act = String(b.act || '');
  if (act === 'clear') { await db.collection(COLLECTION).doc('current').set({ spotlight: null }, { merge: true }); return { ok: true, act }; }
  if (act === 'reply') {
    const text = clean(b.text, MAX_TEXT);
    if (text.length < 2) return { ok: false, message: 'Type the message.' };
    const ref = sessionCol(db, s.session).doc();
    await ref.set({ type: 'comment', name: 'PFA', text, at: nowMs, status: 'shown', pfa: true, by: who });
    return { ok: true, act, id: ref.id };
  }
  const ref = sessionCol(db, s.session).doc(String(b.id || 'x'));
  const d = await ref.get();
  if (!d.exists) return { ok: false, message: 'That message is no longer there.' };
  const m = d.data() || {};
  if (act === 'show' || act === 'hide') await ref.set({ status: act === 'show' ? 'shown' : 'hidden', by: who }, { merge: true });
  else if (act === 'answered') await ref.set({ answered: !m.answered, by: who }, { merge: true });
  else if (act === 'spotlight') {
    await db.collection(COLLECTION).doc('current').set({ spotlight: { id: ref.id, name: m.name, text: m.text, type: m.type } }, { merge: true });
  } else if (act === 'block') {
    const at = new Date(nowMs).toISOString();
    await db.collection(BLOCKS).doc(m.who).set({ at, by: who, name: m.name, text: m.text });
    await ref.set({ status: 'hidden', by: who }, { merge: true });
    /* everything this person posted in the show comes off the screen */
    const theirs = await sessionCol(db, s.session).where('who', '==', m.who).get();
    const w = [];
    theirs.forEach((x) => w.push(x.ref.set({ status: 'hidden' }, { merge: true })));
    await Promise.all(w);
  } else return { ok: false, message: 'Say what to do.' };
  return { ok: true, act, id: ref.id, name: m.name };
}

/* The recording, posted to "From PFA" as an update with its film. */
async function postRecording(db, who, nowMs) {
  const U = require('./site-updates');
  const s = await readShow(db);
  if (s.status !== 'ended') return { ok: false, message: 'End the show first.' };
  let media;
  if (s.source === 'mux') {
    const p = (await db.collection(COLLECTION).doc('private').get()).data() || {};
    const stream = await mux('GET', '/live-streams/' + p.streamId);
    const assetId = (stream.recent_asset_ids || []).slice(-1)[0] || stream.active_asset_id;
    if (!assetId) return { ok: false, message: 'Mux has no recording of this show yet. Try again in a minute.' };
    const asset = await mux('GET', '/assets/' + assetId);
    if (asset.status !== 'ready') return { ok: false, message: 'The recording is still being prepared. Try again in a minute.' };
    const id = ((asset.playback_ids || []).find((x) => x.policy === 'public') || {}).id;
    if (!id) return { ok: false, message: 'The recording has no public copy.' };
    media = { kind: 'mux', id };
  } else if (s.youtubeId) media = { link: 'https://www.youtube.com/watch?v=' + s.youtubeId };
  else return { ok: false, message: 'There is no film to post.' };
  const when = s.startedAt ? new Date(s.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
  const r = await U.save(db, who, {
    title: (s.title || 'PFA Live') + (when ? ', ' + when : ''),
    body: s.about ? s.about + '\n\nThe full recording of the live show.' : 'The full recording of the live show.',
    kind: 'event', media, status: 'published'
  }, nowMs);
  if (r.ok) await db.collection(COLLECTION).doc('current').set({ posted: r.id }, { merge: true });
  return r;
}

module.exports = {
  COLLECTION, BLOCKS, MAX_TEXT, GAP_MS, hash, checkMessage, headline, publicState, post,
  panelState, setup, muxSetup, setStatus, moderate, postRecording, muxKeys,
  _fetch(fn) { fetcher = fn; }
};
