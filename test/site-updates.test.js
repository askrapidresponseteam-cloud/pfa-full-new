'use strict';
/* "From PFA" updates and PFA Live (owner, 26 Nov 2026: "find a best place
   to display new news/notifications ... it should have a cool video player
   as well", and the monthly live show with live comments and questions).
   lib/site-updates.js, lib/update-media.js, lib/live-show.js, their routes,
   assets/updates.js, assets/live-show.js and the panel's two sections. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { memoryFirestore } = require('./_memory-firestore');
const U = require('../lib/site-updates');
const M = require('../lib/update-media');
const L = require('../lib/live-show');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-26T05:00:00Z');
const FILE = 'https://firebasestorage.googleapis.com/v0/b/pfa-new-website.firebasestorage.app/o/public%2Fupdates%2F2026%2Fabcdef0123456789abcdef01.mp4?alt=media&token=0b7c6a52-9d1e-4f3a-8a59-3c7c2a1b9e10';
const PIC = FILE.replace('.mp4', '.webp');

function call(handler, method, body, headers) {
  return new Promise((resolve) => {
    const h = {};
    const res = {
      statusCode: 200,
      setHeader(k, v) { h[k.toLowerCase()] = v; },
      end(b) { let json = null; try { json = JSON.parse(String(b || '')); } catch (_) { /* none */ } resolve({ status: this.statusCode, headers: h, json }); }
    };
    handler({ method, body, query: {}, headers: headers || {} }, res);
  });
}

test('film links: YouTube in every shape, Vimeo, Instagram posts and reels; nothing else', () => {
  for (const l of ['https://youtu.be/dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://www.youtube.com/live/dQw4w9WgXcQ?si=a', 'https://m.youtube.com/shorts/dQw4w9WgXcQ']) {
    assert.deepEqual(U.readLink(l), { kind: 'youtube', id: 'dQw4w9WgXcQ' }, l);
  }
  assert.deepEqual(U.readLink('https://vimeo.com/channels/x/123456789'), { kind: 'vimeo', id: '123456789' });
  assert.deepEqual(U.readLink('https://www.instagram.com/reel/C1abcDEF12/?igsh=x'), { kind: 'instagram', id: 'C1abcDEF12', reel: true });
  assert.deepEqual(U.readLink('https://instagram.com/p/C1abcDEF12'), { kind: 'instagram', id: 'C1abcDEF12', reel: false });
  /* Facebook (26 Nov 2026): reels, videos, watch, share and fb.watch links, the tracking dropped */
  assert.deepEqual(U.readLink('facebook.com/reel/1785602909217866/?rdid=hxeZx&share_url=https%3A%2F%2Fwww.facebook.com'), { kind: 'facebook', url: 'https://www.facebook.com/reel/1785602909217866', reel: true });
  assert.deepEqual(U.readLink('https://m.facebook.com/watch/?v=123456789012'), { kind: 'facebook', url: 'https://www.facebook.com/watch/?v=123456789012', reel: false });
  assert.deepEqual(U.readLink('https://www.facebook.com/PeopleForAnimals/videos/987654321012345/'), { kind: 'facebook', url: 'https://www.facebook.com/PeopleForAnimals/videos/987654321012345', reel: false });
  assert.deepEqual(U.readLink('https://fb.watch/abCD12xy/'), { kind: 'facebook', url: 'https://fb.watch/abCD12xy/', reel: false });
  assert.deepEqual(U.readLink('https://www.facebook.com/share/r/1AbCdEfGh/'), { kind: 'facebook', url: 'https://www.facebook.com/share/r/1AbCdEfGh/', reel: true });
  assert.equal(U.readLink('https://www.facebook.com/someone/posts/1').bad, true, 'a post that is not a film');
  assert.deepEqual(U.check({ title: 'Delhi notice', photo: PIC, media: { link: 'facebook.com/reel/1785602909217866/?rdid=x' } }).media, { kind: 'facebook', url: 'https://www.facebook.com/reel/1785602909217866', reel: true });
  assert.equal(U.readLink('https://evil.example/watch?v=dQw4w9WgXcQ').bad, true);
  assert.equal(U.readLink('https://youtube.com/watch?v=short').bad, true);
});

test('an update is checked: a title, long dashes made hyphens, only our own files, only real links', () => {
  assert.equal(U.check({ title: 'no' }).ok, false);
  const c = U.check({ title: 'Camp on Sunday \u2014 free', body: 'One\u2013two\n\n\n\nthree', media: { link: 'https://youtu.be/dQw4w9WgXcQ' }, link: 'https://peopleforanimalsindia.org/donate.html#ways' });
  assert.equal(c.ok, true);
  assert.equal(c.title, 'Camp on Sunday - free');
  assert.equal(c.body, 'One-two\n\nthree');
  assert.equal(c.link, 'donate.html#ways');
  assert.deepEqual(c.media, { kind: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.equal(U.check({ title: 'A film', media: { kind: 'file', url: 'https://evil.example/x.mp4' } }).ok, false);
  assert.equal(U.check({ title: 'A film', media: { kind: 'file', url: FILE } }).ok, false, 'a film of our own needs a cover picture');
  assert.equal(U.check({ title: 'A film', photo: PIC, media: { kind: 'file', url: FILE } }).ok, true);
  /* a picture with every update put on the site (27 Nov 2026); a YouTube film brings its own; a draft may wait */
  assert.equal(U.check({ title: 'A notice' }).needsPicture, true);
  assert.equal(U.check({ title: 'A notice', status: 'draft' }).ok, true);
  assert.equal(U.check({ title: 'A notice', photo: PIC }).ok, true);
  assert.equal(U.check({ title: 'A reel', media: { link: 'https://www.instagram.com/reel/C1abcDEF12/' } }).needsPicture, true);
  assert.equal(U.check({ title: 'A film', media: { link: 'https://youtu.be/dQw4w9WgXcQ' } }).ok, true);
  assert.equal(U.check({ title: 'A picture', photo: 'https://evil.example/x.jpg' }).ok, false);
  assert.equal(U.check({ title: 'A link', link: 'http://example.org' }).ok, false);
  assert.equal(U.check({ title: 'A link', link: 'javascript:alert(1)' }).ok, false);
});

test('the public list: published only, the kept one first, newest next, no names of staff, dated in India', async () => {
  const db = memoryFirestore();
  await U.save(db, 'a@pfa', { title: 'Older news item', status: 'published', photo: PIC }, NOW - 3 * 864e5);
  const pin = await U.save(db, 'a@pfa', { title: 'Kept at the top', pinned: true, photo: PIC }, NOW - 2 * 864e5);
  await U.save(db, 'a@pfa', { title: 'A draft for later', status: 'draft' }, NOW - 864e5);
  /* posted at 1 am in India on the 26th: 19:30 UTC on the 25th */
  await U.save(db, 'a@pfa', { title: 'Newest news item', photo: PIC }, Date.parse('2026-11-25T19:30:00Z'));
  let list = await U.publicList(db);
  assert.deepEqual(list.map((u) => u.title), ['Kept at the top', 'Newest news item', 'Older news item']);
  assert.equal(list[1].date, '2026-11-26');
  assert.ok(!JSON.stringify(list).includes('a@pfa'));
  /* keeping another at the top lets the first go */
  const other = list.find((u) => u.title === 'Older news item');
  await U.save(db, 'b@pfa', { id: other.id, title: 'Older news item', pinned: true, photo: PIC }, NOW);
  list = await U.publicList(db);
  assert.equal(list[0].title, 'Older news item');
  assert.equal(list.filter((u) => u.pinned).length, 1);
  /* editing keeps the day it went out */
  assert.equal(list[0].date, '2026-11-23');
  /* taken off: gone from the site, kept in the records */
  await U.remove(db, 'a@pfa', pin.id, NOW);
  list = await U.publicList(db);
  assert.ok(!list.some((u) => u.id === pin.id));
  assert.equal((await db.collection(U.COLLECTION).doc(pin.id).get()).data().status, 'removed');
});

test('the routes: the panel needs the Updates module; the public answer is cached briefly and says if a show is on', async () => {
  const db = memoryFirestore();
  let asked = '';
  const admin = require('../lib/routes/admin/updates').createHandler({ getDb: () => db, requireAdmin: async (req, res, mod) => { asked = mod; return { email: 'a@pfa' }; }, now: () => NOW });
  let r = await call(admin, 'POST', { action: 'save', title: 'Rescue in Delhi', media: { link: 'https://youtu.be/dQw4w9WgXcQ' } });
  assert.equal(r.status, 200);
  assert.equal(asked, 'updates');
  r = await call(admin, 'POST', { action: 'save', title: 'x' });
  assert.equal(r.status, 422);
  r = await call(admin, 'GET');
  assert.equal(r.json.updates.length, 1);
  const pub = require('../lib/routes/updates').createHandler({ getDb: () => db });
  r = await call(pub, 'GET');
  assert.match(r.headers['cache-control'], /s-maxage=90/);
  assert.equal(r.json.updates[0].title, 'Rescue in Delhi');
  assert.equal(r.json.live, null);
  await L.setup(db, 'a', { title: 'Maneka ki Baat', youtube: 'https://youtu.be/dQw4w9WgXcQ', announce: true }, NOW);
  r = await call(pub, 'GET');
  assert.deepEqual(r.json.live, { status: 'soon', title: 'Maneka ki Baat', startsAt: '' });
});

test('uploads: only films and pictures of a sane size, only from the panel, and only files under public/updates come back', async () => {
  const made = [];
  M._stub(() => ({ name: 'pfa-new-website.firebasestorage.app', bucket: { file: (p) => ({
    createResumableUpload: async (o) => { made.push({ p, o }); return ['https://storage.googleapis.com/upload/session-1']; },
    getMetadata: async () => [{ contentType: 'video/mp4', size: '123456', metadata: { firebaseStorageDownloadTokens: '0b7c6a52-9d1e-4f3a-8a59-3c7c2a1b9e10' } }]
  }) } }));
  try {
    assert.equal((await M.start({ kind: 'video', type: 'application/x-msdownload', size: 10, origin: 'https://pfa-new-website.web.app' })).ok, false);
    assert.equal((await M.start({ kind: 'video', type: 'video/mp4', size: 2 * 1024 ** 3, origin: 'https://pfa-new-website.web.app' })).ok, false);
    assert.equal((await M.start({ kind: 'video', type: 'video/mp4', size: 10, origin: 'https://evil.example' })).ok, false);
    const s = await M.start({ kind: 'video', type: 'video/mp4', size: 5e6, origin: 'https://pfa-new-website.web.app' });
    assert.equal(s.ok, true);
    assert.match(s.path, /^public\/updates\/\d{4}\/[a-f0-9]{24}\.mp4$/);
    assert.equal(made[0].o.origin, 'https://pfa-new-website.web.app');
    assert.match(made[0].o.metadata.metadata.firebaseStorageDownloadTokens, /^[a-f0-9-]{36}$/);
    assert.equal((await M.finish('submissions/PFA-C-2026-00001/1')).ok, false);
    const f = await M.finish(s.path);
    assert.equal(f.ok, true);
    assert.equal(U.isOurFile(f.url), true);
  } finally { M._stub(null); }
  /* no bucket: said plainly, with the way round it */
  M._stub(() => null);
  try {
    const r = await M.start({ kind: 'video', type: 'video/mp4', size: 10, origin: 'https://pfa-new-website.web.app' });
    assert.equal(r.ok, false);
    assert.match(r.message, /YouTube, Vimeo, Instagram or Facebook link/);
  } finally { M._stub(null); }
});

test('live: questions before the show, comments only while it is on, one at a time, no links, bad words held', async () => {
  const db = memoryFirestore();
  const cid = (c) => c.repeat(32);
  assert.equal((await L.post(db, { type: 'question', name: 'Ravi', text: 'Hello?', cid: cid('a') }, '1.1.1.1', NOW)).ok, false);
  await L.setup(db, 'a', { title: 'Maneka ki Baat', youtube: 'https://youtu.be/dQw4w9WgXcQ', announce: true }, NOW);
  assert.equal((await L.post(db, { type: 'comment', name: 'Ravi', text: 'Hi all', cid: cid('a') }, '1.1.1.1', NOW)).ok, false);
  const q = await L.post(db, { type: 'question', name: 'Ravi', text: 'What about strays?', cid: cid('a') }, '1.1.1.1', NOW);
  assert.equal(q.ok, true); assert.equal(q.shown, false);
  await L.setStatus(db, 'a', 'live', NOW);
  assert.equal((await L.post(db, { type: 'comment', name: 'Ravi', text: 'Hi all', cid: cid('a') }, '1.1.1.1', NOW + 1000)).ok, false, 'too soon after the question');
  assert.equal((await L.post(db, { type: 'comment', name: 'Asha', text: 'see www.spam.in', cid: cid('b') }, '1.1.1.2', NOW)).ok, false);
  assert.equal((await L.post(db, { type: 'comment', name: 'Asha', text: 'Lovely show', cid: cid('b') }, '1.1.1.2', NOW)).shown, true);
  assert.equal((await L.post(db, { type: 'comment', name: 'Troll', text: 'you bastard', cid: cid('c') }, '1.1.1.3', NOW)).shown, false);
  const st = await L.publicState(db);
  assert.deepEqual(st.comments.map((c) => c.text), ['Lovely show']);
  assert.equal(st.show.status, 'live');
  assert.equal(st.show.youtubeId, 'dQw4w9WgXcQ');
  assert.ok(!JSON.stringify(st).includes('"who"'), 'no viewer marker goes out');
});

test('live, the desk: put a question on air, answer it, stop a person, reply as PFA, post the recording', async () => {
  const db = memoryFirestore();
  const cid = (c) => c.repeat(32);
  await L.setup(db, 'a', { title: 'Maneka ki Baat', youtube: 'https://youtu.be/dQw4w9WgXcQ' }, NOW);
  await L.setStatus(db, 'a', 'live', NOW);
  await L.post(db, { type: 'question', name: 'Ravi', text: 'What about strays?', cid: cid('a') }, '', NOW);
  await L.post(db, { type: 'comment', name: 'Troll', text: 'first rude thing', cid: cid('c') }, '', NOW);
  let p = await L.panelState(db);
  const q = p.messages.find((m) => m.type === 'question');
  const bad = p.messages.find((m) => m.name === 'Troll');
  await L.moderate(db, 'staff', { act: 'spotlight', id: q.id }, NOW);
  assert.equal((await L.publicState(db)).spotlight.text, 'What about strays?');
  await L.moderate(db, 'staff', { act: 'answered', id: q.id }, NOW);
  await L.moderate(db, 'staff', { act: 'block', id: bad.id }, NOW);
  assert.deepEqual((await L.publicState(db)).comments, []);
  const again = await L.post(db, { type: 'comment', name: 'Troll', text: 'second thing', cid: cid('c') }, '', NOW + 60000);
  assert.equal(again.ok, true); assert.equal(again.shown, false, 'a stopped person is told nothing different');
  await L.moderate(db, 'staff', { act: 'reply', text: 'Thank you all for joining' }, NOW);
  const pub = await L.publicState(db);
  assert.deepEqual(pub.comments.map((c) => [c.name, c.pfa]), [['PFA', true]]);
  p = await L.panelState(db);
  assert.equal(p.messages.find((m) => m.id === q.id).answered, true);
  assert.equal((await L.postRecording(db, 'staff', NOW)).ok, false, 'not before it ends');
  await L.setStatus(db, 'a', 'ended', NOW + 1800e3);
  assert.equal((await L.publicState(db)).spotlight, null);
  const posted = await L.postRecording(db, 'staff', NOW + 1900e3);
  assert.equal(posted.ok, true);
  const u = (await U.publicList(db))[0];
  assert.equal(u.kind, 'event');
  assert.deepEqual(u.media, { kind: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.match(u.title, /^Maneka ki Baat, 26 November 2026$/);
});

test('live through Mux: one stream made once, YouTube added as its backup, the recording found when the show ends', async () => {
  const db = memoryFirestore();
  const calls = [];
  const was = { id: process.env.MUX_TOKEN_ID, s: process.env.MUX_TOKEN_SECRET };
  process.env.MUX_TOKEN_ID = 'tok'; process.env.MUX_TOKEN_SECRET = 'sec';
  L._fetch(async (url, o) => {
    calls.push([o.method, url.replace('https://api.mux.com/video/v1', ''), o.body ? JSON.parse(o.body) : null]);
    const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
    if (o.method === 'POST' && /\/live-streams$/.test(url)) return ok({ id: 'ls1', stream_key: 'sk-secret', playback_ids: [{ id: 'PLAYBACKlive01', policy: 'public' }] });
    if (/simulcast-targets$/.test(url)) return ok({ id: 'st1' });
    if (o.method === 'GET' && /\/live-streams\/ls1$/.test(url)) return ok({ id: 'ls1', stream_key: 'sk-secret', playback_ids: [{ id: 'PLAYBACKlive01', policy: 'public' }], recent_asset_ids: ['as1'] });
    if (/\/assets\/as1$/.test(url)) return ok({ id: 'as1', status: 'ready', playback_ids: [{ id: 'PLAYBACKrec001', policy: 'public' }] });
    if (/complete$/.test(url)) return ok({});
    return { ok: false, status: 404, json: async () => ({ error: { type: 'not found' } }) };
  });
  try {
    assert.equal((await L.muxSetup(db, 'a', { ytServer: 'rtmp://a.rtmp.youtube.com/live2', ytKey: 'abcd-efgh-ijkl-mnop' }, NOW)).ok, true);
    assert.equal(calls[0][2].latency_mode, 'low');
    assert.equal(calls[1][2].url, 'rtmp://a.rtmp.youtube.com/live2');
    /* asked again, the same stream: the key in OBS never changes */
    await L.muxSetup(db, 'a', {}, NOW);
    assert.equal(calls.filter((c) => c[0] === 'POST' && c[1] === '/live-streams').length, 1);
    await L.setup(db, 'a', { title: 'Maneka ki Baat', source: 'mux' }, NOW);
    await L.setStatus(db, 'a', 'live', NOW);
    const pub = await L.publicState(db);
    assert.equal(pub.show.source, 'mux');
    assert.equal(pub.show.playbackId, 'PLAYBACKlive01');
    assert.ok(!JSON.stringify(pub).includes('sk-secret'), 'the stream key never reaches a viewer');
    assert.equal((await L.panelState(db)).mux.streamKey, 'sk-secret');
    await L.setStatus(db, 'a', 'ended', NOW + 1800e3);
    assert.ok(calls.some((c) => c[0] === 'PUT' && /complete$/.test(c[1])));
    const r = await L.postRecording(db, 'a', NOW + 1900e3);
    assert.equal(r.ok, true);
    assert.deepEqual((await U.publicList(db))[0].media, { kind: 'mux', id: 'PLAYBACKrec001' });
  } finally {
    L._fetch(null);
    if (was.id === undefined) delete process.env.MUX_TOKEN_ID; else process.env.MUX_TOKEN_ID = was.id;
    if (was.s === undefined) delete process.env.MUX_TOKEN_SECRET; else process.env.MUX_TOKEN_SECRET = was.s;
  }
});

test('wiring: routes, panel sections, page holders, rules, policy, and no long dash anywhere new', () => {
  const api = read('api/index.js');
  for (const r of ['updates', 'admin/updates', 'live', 'admin/live']) assert.ok(api.includes(`'${r}': () => require('../lib/routes/${r}.js')`), r);
  const mods = require('../lib/admin-modules');
  for (const k of ['updates', 'live']) assert.ok(mods.MODULE_KEYS.includes(k), k);
  const admin = read('admin.html');
  assert.match(admin, /data-tab="updates"/); assert.match(admin, /data-tab="live"/);
  assert.match(admin, /assets\/admin-updates\.js/); assert.match(admin, /assets\/admin-live-show\.js/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-updates\.js', 'assets\/admin-subs\.js', 'assets\/admin-live-show\.js'/);
  /* on top, as on Facebook (26 Nov 2026: "this cannot be below the join
     button. have it on top like facebook"): the bell beside Shop, and
     nothing left under the hero's buttons */
  const home = read('index.html');
  assert.match(home, /class="shop">Shop<\/a>\s*<a class="pfa-notification" href="newsroom\.html#from-pfa" data-updates="bell"/);
  assert.doesNotMatch(home, /data-updates="strip"|class="pfa-new"/);
  assert.match(read('newsroom.html'), /<section class="upd" id="from-pfa" data-updates="feed"[^>]*hidden><\/section>/);
  assert.match(read('scripts/build-newsroom.js'), /data-updates="feed"/);
  assert.match(read('live.html'), /<script src="assets\/live-show\.js" defer><\/script>/);
  const rules = read('firestore.rules');
  for (const c of ['siteUpdates/{id}', 'liveShow/{document=**}', 'liveBlocks/{id}', 'liveRate/{id}']) assert.ok(rules.includes(`match /${c}`) , c);
  const csp = read('vercel.json');
  assert.match(csp, /media-src 'self' blob: https:\/\/firebasestorage\.googleapis\.com https:\/\/stream\.mux\.com/);
  assert.match(csp, /connect-src 'self' https:\/\/storage\.googleapis\.com/);
  assert.match(read('scripts/firebase-secrets.js'), /'MUX_TOKEN_ID', 'MUX_TOKEN_SECRET'/);
  assert.match(read('assets/theatre.js'), /\\\.m3u8/);
  /* a Facebook film plays on the page, in Facebook's own frame, at once, from the bell too */
  const upd = read('assets/updates.js');
  assert.match(upd, /var FACEBOOK = 'https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=';/);
  assert.match(upd, /&autoplay=1&mute=0/);
  assert.match(upd, /if \(playable\(u\) \|\| framed\(u\)\) \{ e\.preventDefault\(\); shutBell\(false\); play\(u, bell\); \}/);
  assert.match(read('assets/updates.css'), /\.pfa-bell__count\{position:absolute/);
  /* in the Newsroom, Facebook's own player at the film's real shape, told its own size (26 Nov 2026) */
  assert.match(upd, /upd__media--fb' \+ \(m\.reel \? ' upd__media--tall' : ''\)/);
  assert.match(upd, /f\.src = f\.getAttribute\('data-fb'\) \+ '&width=' \+ w \+ '&height=' \+ h;/);
  const css = read('assets/updates.css');
  assert.match(css, /\.upd__media--tall\{aspect-ratio:9\/16;/);
  assert.match(css, /\.upd__list\[data-n="1"\]\{grid-template-columns:minmax\(0,1fr\)\}/, 'one update fills the row');
  assert.match(read('vercel.json'), /frame-src[^;]*https:\/\/www\.facebook\.com/);
  /* never an empty frame: an older update without a picture, or one whose picture fails, shows PFA's own (27 Nov 2026) */
  assert.match(upd, /var COVER = 'img\/og-default\.jpg';/);
  assert.match(upd, /function cover\(u\) \{ return poster\(u\) \|\| COVER; \}/);
  assert.doesNotMatch(upd, /onerror="this\.remove\(\)"/);
  assert.match(read('assets/admin-updates.js'), /YouTube, Vimeo, Instagram or Facebook link/);
  for (const f of ['lib/site-updates.js', 'lib/update-media.js', 'lib/live-show.js', 'lib/routes/updates.js', 'lib/routes/admin/updates.js', 'lib/routes/live.js', 'lib/routes/admin/live.js',
    'assets/updates.js', 'assets/updates.css', 'assets/live-show.js', 'assets/live.css', 'assets/admin-updates.js', 'assets/admin-live-show.js', 'live.html']) {
    assert.ok(!/[\u2013\u2014\u2212]/.test(read(f)), f + ' carries a long dash');
  }
});
