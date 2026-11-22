'use strict';
/* The signature collection behind its password (lib/signature-vault.js,
   lib/routes/admin/signatures.js, lib/routes/signature.js; owner, 22 Nov
   2026): sealed so the code and the database alone open nothing, a wrong
   password locks after five, the shapes kept are shapes only, the picture
   a place is drawn with is checked, letters, certificates and cards draw
   it, and no signature or password is anywhere in the site's files. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { memoryFirestore } = require('./_memory-firestore');
const V = require('../lib/signature-vault');

const ROOT = path.join(__dirname, '..');
const PASS = 'test-only-pass-01';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 344 100"><rect width="344" height="100" fill="#fff"/>'
  + '<path fill="#193b84" fill-rule="evenodd" d="M10 50 C 60 0, 120 100, 170 50 S 280 0, 334 50 L 334 60 C 280 10, 220 110, 170 60 Z M20 52 L 30 52 L 30 56 Z"/>'
  + '<script>alert(1)</script><image href="https://example.com/x.png"/></svg>';

function seeded() {
  const db = memoryFirestore();
  return db.collection(V.COLLECTION).doc('settings').set({ check: V.newCheck(PASS) }).then(() => db);
}
/* a PNG of a given size: header only is enough for the checks */
function png(w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8; ihdr[17] = 6;
  const idat = zlib.deflateSync(Buffer.alloc(10));
  const chunk = Buffer.alloc(12 + idat.length); chunk.writeUInt32BE(idat.length, 0); chunk.write('IDAT', 4, 'latin1'); idat.copy(chunk, 8);
  return Buffer.concat([sig, ihdr, chunk]);
}
const dataUrl = (b) => 'data:image/png;base64,' + b.toString('base64');

test('the password check: the right one passes, others do not, and the code holds no password', () => {
  const c = V.newCheck(PASS);
  assert.equal(V.matches(PASS, c), true);
  assert.equal(V.matches(PASS + 'x', c), false);
  assert.equal(V.matches('', c), false);
  /* the first check is a salted one-way check, not a password */
  assert.match(V.FIRST_CHECK.salt, /^[A-Za-z0-9+/]{22}==$/);
  assert.match(V.FIRST_CHECK.hash, /^[A-Za-z0-9+/]{43}=$/);
  assert.ok(V.FIRST_CHECK.N >= 65536);
  for (const guess of ['', 'password', 'pfa', 'admin', '12345678']) assert.equal(V.matches(guess, V.FIRST_CHECK), false, guess);
});

test('sealed: opens with the password only, and a change to the box is caught', () => {
  const box = V.seal({ a: 1 }, PASS);
  assert.deepEqual(V.open(box, PASS), { a: 1 });
  assert.throws(() => V.open(box, 'wrong-pass-123'));
  const bent = Object.assign({}, box, { data: Buffer.from(Buffer.from(box.data, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64') });
  assert.throws(() => V.open(bent, PASS));
  assert.ok(!JSON.stringify(box).includes('"a":1'));
});

test('an SVG: only its shapes, viewBox and fill rule are kept', () => {
  const r = V.shapesOf(SVG);
  assert.equal(r.ok, true);
  assert.deepEqual(r.vector.viewBox, [0, 0, 344, 100]);
  assert.equal(r.vector.paths.length, 1);
  assert.equal(r.vector.paths[0].rule, 'evenodd');
  assert.ok(!JSON.stringify(r.vector).includes('script'));
  assert.ok(!JSON.stringify(r.vector).includes('example.com'));
  assert.equal(V.shapesOf('<svg viewBox="0 0 10 10"><path d="M0 0 url(javascript:x)"/></svg>').ok, false);
  assert.equal(V.shapesOf('<svg viewBox="0 0 10 10"><rect/></svg>').ok, false);
  assert.equal(V.shapesOf('<svg viewBox="0 0 10 10"><g transform="scale(2)"><path d="M0 0L1 1Z"/></g></svg>').ok, false);
  assert.equal(V.shapesOf('not an svg').ok, false);
});

test('a picture: a PNG of the place shape only', () => {
  assert.equal(V.pictureOf(dataUrl(png(3024, 876)), 'certificate').ok, true);
  assert.equal(V.pictureOf(dataUrl(png(2748, 748)), 'letter').ok, true);
  assert.equal(V.pictureOf(dataUrl(png(3024, 3024)), 'card').ok, false);
  assert.equal(V.pictureOf('data:image/png;base64,' + Buffer.from('GIF89a........................').toString('base64'), 'card').ok, false);
  assert.equal(V.pictureOf(dataUrl(png(3024, 876)), 'poster').ok, false);
});

test('the store: add, open, use for a place, built-in again, and a new password', async () => {
  const db = await seeded();
  const added = await V.add(db, 'a@pfa', PASS, 'Sign only', SVG);
  assert.equal(added.ok, true);
  assert.equal(added.id, 'sign-only');
  assert.equal((await V.add(db, 'a@pfa', PASS, 'Sign only', SVG)).ok, false);
  const kept = (await db.collection(V.COLLECTION).doc('sig-sign-only').get()).data();
  assert.ok(!JSON.stringify(kept).includes('C 60 0'), 'the shapes are kept sealed');
  assert.equal((await V.unlock(db, PASS, 'sign-only')).ok, true);
  assert.equal((await V.unlock(db, 'wrong-pass-123', 'sign-only')).ok, false);
  const listed = await V.list(db);
  assert.deepEqual(listed.signatures.map((s) => s.name), ['Sign only']);
  assert.ok(!JSON.stringify(listed).includes('box'));
  assert.equal((await V.use(db, 'a@pfa', 'certificate', 'sign-only', '#7b1e2a', dataUrl(png(3024, 876)))).ok, true);
  assert.equal((await V.use(db, 'a@pfa', 'certificate', 'sign-only', 'red', dataUrl(png(3024, 876)))).ok, false);
  assert.equal((await V.pictureFor(db, 'certificate')).colour, '#7b1e2a');
  assert.equal(await V.pictureFor(db, 'card'), null);
  await V.reset(db, 'a@pfa', 'certificate');
  assert.equal((await V.list(db)).using.certificate, undefined, 'built-in again, nothing deleted');
  assert.equal((await db.collection(V.COLLECTION).doc('use-certificate').get()).data().builtIn, true);
  assert.equal(await V.pictureFor(db, 'certificate'), null);
  assert.equal((await V.changePassword(db, PASS, 'short')).ok, false);
  const changed = await V.changePassword(db, PASS, 'a-new-pass-456');
  assert.deepEqual(changed, { ok: true, resealed: 1 });
  assert.equal((await V.unlock(db, PASS, 'sign-only')).ok, false);
  assert.equal((await V.unlock(db, 'a-new-pass-456', 'sign-only')).ok, true);
  assert.equal((await V.admit(db, 'a@pfa', PASS)).ok, false);
  assert.equal((await V.admit(db, 'a@pfa', 'a-new-pass-456')).ok, true);
});

test('five wrong passwords lock that admin for 15 minutes; others can still try', async () => {
  const db = await seeded();
  const t0 = Date.UTC(2026, 10, 22, 10);
  for (let i = 0; i < 5; i += 1) assert.equal((await V.admit(db, 'x@pfa', 'nope-nope-' + i, t0 + i)).code, 'WRONG_PASSWORD');
  assert.equal((await V.admit(db, 'x@pfa', PASS, t0 + 10)).code, 'LOCKED', 'even the right one, while locked');
  assert.equal((await V.admit(db, 'y@pfa', PASS, t0 + 10)).ok, true);
  assert.equal((await V.admit(db, 'x@pfa', PASS, t0 + 16 * 60 * 1000)).ok, true);
});

function call(handler, method, body, query) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      end(b) { let json = null; try { json = JSON.parse(String(b || '')); } catch (_) { /* a picture */ } resolve({ status: this.statusCode, headers, body: b, json }); }
    };
    handler({ method, body, query: query || {}, headers: {} }, res);
  });
}

test('the panel route: every action asks the password, and none hands back a password', async () => {
  const db = await seeded();
  const handler = require('../lib/routes/admin/signatures').createHandler({ getDb: () => db, requireAdmin: async () => ({ email: 'a@pfa' }) });
  const wrong = await call(handler, 'POST', { action: 'add', password: 'wrong-pass-123', name: 'X', svg: SVG });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.json.code, 'WRONG_PASSWORD');
  assert.equal((await call(handler, 'POST', { action: 'check', password: PASS })).status, 200);
  assert.equal((await call(handler, 'POST', { action: 'check', password: 'wrong-pass-123' })).status, 422);
  const added = await call(handler, 'POST', { action: 'add', password: PASS, name: 'With name', svg: SVG });
  assert.equal(added.status, 200);
  const list = await call(handler, 'GET');
  assert.equal(list.json.signatures[0].id, 'with-name');
  assert.ok(!JSON.stringify(list.json).includes('paths'));
  const opened = await call(handler, 'POST', { action: 'unlock', password: PASS, id: 'with-name' });
  assert.equal(opened.json.vector.paths.length, 1);
  const used = await call(handler, 'POST', { action: 'use', password: PASS, place: 'card', id: 'with-name', colour: '#1b1b1b', picture: dataUrl(png(3024, 876)) });
  assert.equal(used.status, 200);
  assert.equal((await call(handler, 'POST', { action: 'nothing', password: PASS })).status, 400);
  const audit = JSON.stringify(db.dump());
  assert.ok(!audit.includes(PASS), 'the password is never kept');
});

test('the public picture: the chosen one, or the built-in one', async () => {
  const db = await seeded();
  const handler = require('../lib/routes/signature').createHandler({ getDb: () => db });
  let r = await call(handler, 'GET', null, { for: 'card' });
  assert.equal(r.status, 302);
  assert.match(r.headers.location, /signature-print\.png$/);
  await V.add(db, 'a@pfa', PASS, 'S', SVG);
  await V.use(db, 'a@pfa', 'card', 's', '#193b84', dataUrl(png(3024, 876)));
  r = await call(handler, 'GET', null, { for: 'card' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/png');
  assert.equal(r.body.readUInt32BE(0), 0x89504e47);
  assert.equal((await call(handler, 'GET', null, { for: 'letter' })).status, 302, 'letters are drawn on the server only');
  const online = await call(handler, 'GET', null, { for: 'card', builtin: 'svg' });
  assert.equal(online.status, 200, 'a chosen one is served whatever the fallback');
  await V.reset(db, 'a@pfa', 'card');
  const vec = await call(handler, 'GET', null, { for: 'card', builtin: 'svg' });
  assert.match(vec.headers.location, /signature\.svg$/, 'the cards online: the built-in vector until one is chosen');
});

test('letters, certificates and cards are drawn with the chosen signature', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  assert.match(read('lib/letters.js'), /Buffer\.isBuffer\(o\.signature\) \? o\.signature : raw\.signature/);
  assert.equal((read('lib/routes/admin/letters.js').match(/signature: await signatureNow\(\)|\{ signature \}|signature \}\)/g) || []).length >= 3, true);
  assert.match(read('assets/certificate.js'), /api\/signature\?for=certificate/);
  assert.match(read('assets/caregiver-card.js'), /loadImage\(SIG_LIVE\)\.then\(function \(im\) \{ return im \|\| loadImage\(SIG_SRC\); \}\)/);
  assert.match(read('assets/member-card.js'), /img\.src = SIG_LIVE/);
  assert.equal((read('assets/digital-card.js').match(/api\/signature\?for=card&amp;builtin=svg" alt="Signature of Smt\. Maneka Sanjay Gandhi" width="1512" height="438"/g) || []).length, 2);
  const api = read('api/index.js');
  assert.match(api, /'admin\/signatures': '\.\/admin\/signatures\.js'/);
  assert.match(api, /'signature': \(\) => require\('\.\.\/lib\/routes\/signature\.js'\)/);
  assert.match(read('firestore.rules'), /match \/signatureVault\/\{id\}\s+\{ allow read, write: if false; \}/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-signatures\.js'/);
  assert.match(read('assets/admin-cert-pane.js'), /assets\/admin-signatures\.js/);
});

test('no part of the signature vectors is anywhere in the site', () => {
  /* short pieces of the two vectors, each written in two halves so this
     file does not hold them either */
  const pieces = ['187.19,60.1' + '3 188.54,58.0', '695.33,96.7' + '7 695.18,97.2', '96.383 536.3' + '66,196.450 5'];
  const skip = new Set(['node_modules', '.git', '.vercel', '.firebase', 'firebase-public']);
  const hits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(svg|js|json|html|css|md|txt)$/i.test(e.name)) continue;
      const text = fs.readFileSync(full, 'latin1');
      if (pieces.some((p) => text.includes(p))) hits.push(path.relative(ROOT, full));
    }
  }(ROOT));
  assert.deepEqual(hits, []);
});
