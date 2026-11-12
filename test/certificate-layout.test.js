'use strict';
/* Where the signature sits on the internship certificate (owner, 12 Nov
   2026, with the certificate's design and its own position controls: "fix
   the bugs. and update this certificate with controls").

   Checked in a browser: the drawn signature lands on the design's own to the
   pixel (26 to the right, the design's navy ink); moving Left / right to 60
   moves it 34 of the design's pixels; Save sends it; Reset goes back to 26;
   a number past the range is held at its end; nothing wider than the screen
   at 1280 and 390. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const audit = require('../lib/admin-audit');
const L = require('../lib/certificate-layout');
const ROUTE = require('../lib/routes/admin/certificates');
const PUBLIC = require('../lib/routes/certificate-layout');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-12T04:30:00.000Z');
let db; let rows; let real;
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  rows = [];
  real = audit.record;
  audit.record = async (who, row) => { rows.push(row); };
});
test.afterEach(() => { audit.record = real; firebase._setDbForTests(null); });

function respond(handler, request) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {} };
    const response = { get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw || '{}'); } catch (_) { out.json = null; } resolve(out); } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}
const admin = (method, body) => respond(ROUTE.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'office@pfa.test', name: 'Office', role: 'super' }), now: () => NOW }),
  { method, url: '/api/admin/certificates', query: {}, body, headers: {} });

test('the design\'s own place until it is set, then saved from the panel, logged, and told to every page', async () => {
  assert.deepEqual(L.DEFAULT, { x: 26, y: 0 }, 'the design\'s own: 26 to the right');
  assert.deepEqual(L.RANGE, { x: 100, y: 50 }, 'the design\'s own ranges');
  let list = await admin('GET');
  assert.deepEqual([list.json.layout.x, list.json.layout.y], [26, 0]);
  let pub = await respond(PUBLIC, { method: 'GET', headers: {} });
  assert.deepEqual(pub.json, { x: 26, y: 0 });

  const saved = await admin('POST', { action: 'layout', x: 40, y: -6 });
  assert.equal(saved.statusCode, 200, saved.raw);
  assert.deepEqual([saved.json.layout.x, saved.json.layout.y, saved.json.layout.updatedBy], [40, -6, 'office@pfa.test']);
  assert.deepEqual([db.dump()['siteSettings/certificate'].sigX, db.dump()['siteSettings/certificate'].sigY], [40, -6]);
  assert.equal(rows[0].action, 'certificate-layout');
  assert.equal(rows[0].detail, 'Signature moved from 26 across, 0 down to 40 across, -6 down');
  pub = await respond(PUBLIC, { method: 'GET', headers: {} });
  assert.deepEqual(pub.json, { x: 40, y: -6 });
  assert.match(pub.headers['cache-control'], /s-maxage=60/);
  list = await admin('GET');
  assert.deepEqual([list.json.layout.x, list.json.layout.y], [40, -6]);
});

test('a position past the design\'s ranges, or not a number, is refused and nothing is written', async () => {
  for (const body of [{ x: 101, y: 0 }, { x: 0, y: -51 }, { x: 'left', y: 0 }, {}]) {
    const r = await admin('POST', Object.assign({ action: 'layout' }, body));
    assert.equal(r.statusCode, 422, JSON.stringify(body));
  }
  assert.equal(db.dump()['siteSettings/certificate'], undefined);
  /* and a hand edit in the database is held to the ranges */
  assert.deepEqual(L.view({ sigX: 900, sigY: -900 }), { x: 100, y: -50 });
  assert.deepEqual(L.view({ sigX: 'x' }), { x: 26, y: 0 });
});

test('the public answer fails to the design\'s own place, kept only a moment', async () => {
  firebase._setDbForTests({ collection() { throw new Error('UNAVAILABLE'); } });
  const warn = console.warn; console.warn = () => {};
  try {
    const r = await respond(PUBLIC, { method: 'GET', headers: {} });
    assert.deepEqual(r.json, { x: 26, y: 0, unavailable: true });
    assert.equal(r.headers['cache-control'], 'public, max-age=0, s-maxage=2');
  } finally { console.warn = warn; }
  assert.equal((await respond(PUBLIC, { method: 'POST', headers: {} })).statusCode, 405);
  assert.match(read('api/index.js'), /'certificate-layout': \(\) => require\('\.\.\/lib\/routes\/certificate-layout\.js'\)/);
});

/* ---- the drawing ---------------------------------------------------------- */

function drawn(opts) {
  /* assets/certificate.js against a canvas that records what it is asked to draw */
  const calls = [];
  const ctx = new Proxy({ measureText: () => ({ width: 10 }) }, {
    get(t, k) { if (k in t) return t[k]; return (...a) => calls.push([k, ...a]); },
    set(t, k, v) { if (k === 'fillStyle') calls.push(['fillStyle', v]); t[k] = v; return true; }
  });
  const images = [];
  class Image { set src(v) { this._src = v; images.push(this); setTimeout(() => ((opts.fail || []).some((f) => v.includes(f)) ? this.onerror && this.onerror() : this.onload && this.onload()), 0); } get src() { return this._src; } }
  const win = { document: { currentScript: null, createElement: () => ({}) }, Image, Promise, setTimeout, Number, Math, String };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(read('assets/certificate.js').replace('(typeof window !== \'undefined\' ? window : this)', '(window)'), win);
  const C = win.PFACertificate;
  const canvas = { getContext: () => ctx };
  return { C, canvas, calls, images };
}

test('the paper, then the art, then the signature on it; the signature where the design and the panel put it', async () => {
  const { C, canvas, calls } = drawn({});
  await C.load();
  C.draw(canvas, { name: 'Asha Rao', endDate: '2026-11-01', number: 'PFA-INT-4K2M8QRT' }, 1);
  const images = calls.filter((c) => c[0] === 'drawImage');
  assert.equal(images.length, 2, 'the art and the signature, each once');
  assert.match(images[0][1]._src, /completion\.webp$/);
  assert.match(images[1][1]._src, /signature\.png$/);
  assert.deepEqual([...images[1].slice(2)], [798 + 26, 653, 252, 73], 'the design\'s own place: 26 to the right');
  assert.ok(!calls.some((c) => c[0] === 'fillRect' && c[3] === 1120), 'the art drawn, so no white paper laid over it');
  assert.deepEqual({ ...C.setLayout({ x: -12, y: 8 }) }, { x: -12, y: 8 });
  calls.length = 0;
  C.draw(canvas, {}, 1);
  assert.deepEqual([...calls.filter((c) => c[0] === 'drawImage')[1].slice(2)], [798 - 12, 653 + 8, 252, 73]);
  assert.deepEqual({ ...C.setLayout({ x: 500, y: -500 }) }, { x: 100, y: -50 }, 'held to the ranges');
});

test('a signature that does not arrive is an error, never a certificate drawn without it (12 Nov 2026 bug)', async () => {
  const { C } = drawn({ fail: ['signature.png'] });
  await assert.rejects(C.load(), /signature could not be loaded/);
  const src = read('assets/certificate.js');
  assert.match(src, /if \(art\) ctx\.drawImage\(art, 0, 0, W, H\);\n {4}else \{ ctx\.fillStyle = '#ffffff'; ctx\.fillRect\(0, 0, W, H\); \}\n {4}if \(sig\) ctx\.drawImage\(sig,/, 'the white paper only when there is no art, whatever the signature does');
});

test('the art is the design without its signature, the signature its own file, and the course line the internship\'s', () => {
  const art = read('scripts/build-certificate-art.js');
  assert.match(art, /s = s\.replace\(\/>Animal Welfare \(\?:&\|&amp;\) Compassionate Action<\/, '>Remote Internship<'\);/, 'whichever way the design writes the ampersand');
  assert.match(art, /throw new Error\(`build-certificate-art: \$\{why\} still reads/, 'a wording change that misses stops the build');
  assert.match(art, /<article style="--signature-x: 0px; --signature-y: 0px;" class="certificate"/, 'the signature measured unmoved: the move is the panel\'s');
  const png = fs.readFileSync(path.join(ROOT, 'assets/certificates/signature.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [504, 146], 'the signature at twice its 252 by 73');
  assert.doesNotMatch(read('scripts/source/PFA-Certificate.html'), /[–—]/, 'no long dash in the kept design');
  for (const f of ['assets/certificates/signature.png', 'assets/admin-cert-layout.js']) assert.match(read('scripts/build-firebase.js'), new RegExp(`'${f.replace(/[.]/g, '\\.')}'`), `${f} goes with the panel`);
});

test('the panel: Signature position under its +, two sliders with their numbers, Save and Reset; every page reads the saved place', () => {
  const js = read('assets/admin-cert-layout.js');
  assert.match(js, /'<details class="fold ct-sig" id="ctSig"><summary>Signature position<\/summary>/);
  assert.match(js, /row\('x', 'Left \/ right', r\.x, saved\.x\)/);
  assert.match(js, /row\('y', 'Up \/ down', r\.y, saved\.y\)/);
  assert.match(js, /data-sig-act="save" disabled>Save for every certificate<\/button>/, 'Save only when something has moved');
  assert.match(js, /A\.api\('\/api\/admin\/certificates', \{ method: 'POST', body: \{ action: 'layout', x: l\.x, y: l\.y \} \}\)/);
  assert.doesNotMatch(js, /[–—]/);
  const admin = read('admin.html');
  assert.match(admin, /\+ \(window\.PFACertLayout \? window\.PFACertLayout\.panel\(ct\.layout\) : ''\)/);
  assert.match(admin, /ct\.layout = d\.layout \|\| null;/);
  assert.match(admin, /<script src="assets\/admin-cert-layout\.js"><\/script>/);
  assert.ok(fs.statSync(path.join(ROOT, 'admin.html')).size < 409600, 'the panel stays under its ceiling');
  assert.match(read('certificate.html'), /fetch\('\/api\/certificate-layout'/);
  assert.match(read('certificate.html'), /placed\.then\(function\(\)\{ return C\.pdf\(record/, 'the PDF waits for the place');
  assert.match(read('assets/internship-fieldnotes.js'), /fetch\('\/api\/certificate-layout'/);
});
