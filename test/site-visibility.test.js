'use strict';

/* Showing and hiding the public site from the panel: the server side.

   Owner, 8 Oct 2026: "Admin should be able to show/hide any section or
   content module ... without code changes. Changes should reflect on the
   public site immediately, with each section having a simple Visible /
   Hidden toggle."

   These drive the real routes (lib/routes/admin/site.js and
   lib/routes/site-visibility.js) against the in-memory Firestore, with the
   real registry (assets/site-modules.json) and sign-in stood in for by three
   tokens: a super admin, a staff account without the Website module, and one
   with it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USERS = {
  'test-admin': { uid: 'u-super', email: 'priya@pfa.test', name: 'Priya', claims: { admin: true, role: 'super' } },
  'test-staff': { uid: 'u-staff', email: 'ravi@pfa.test', name: 'Ravi', claims: { admin: true, role: 'staff', modules: ['submissions'] } },
  'test-web': { uid: 'u-web', email: 'asha@pfa.test', name: 'Asha', claims: { admin: true, role: 'staff', modules: ['website'] } }
};
const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) {
        const u = USERS[token];
        if (!u) throw new Error('bad token');
        return { uid: u.uid, email: u.email, name: u.name };
      },
      async getUser(uid) {
        const u = Object.values(USERS).find((x) => x.uid === uid);
        return { uid, email: u.email, displayName: u.name, customClaims: u.claims };
      }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const adminAuth = require('../lib/admin-auth');
const V = require('../lib/site-visibility');
const M = require('../lib/admin-modules');
const site = require('../lib/routes/admin/site');
const visibility = require('../lib/routes/site-visibility');

const ROOT = path.join(__dirname, '..');
let db;

test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  adminAuth._clearFailures();
  V.forget();
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  V.forget();
});

function call(handler, { method = 'GET', body, token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = {
      method, url: '/api', query: {}, body,
      headers: Object.assign({ host: 'pfa.test', 'x-forwarded-for': '198.51.100.' + Math.floor(Math.random() * 200) },
        token ? { authorization: `Bearer ${token}` } : {}, headers)
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}
const change = (body, token = 'test-admin') => call(site, { method: 'POST', body, token });
const stored = () => db.dump()['siteSettings/visibility'];
const auditRows = () => Object.entries(db.dump()).filter(([k]) => k.startsWith('adminAudit/')).map(([, v]) => v);

/* ---- who may ------------------------------------------------------------ */

test('no token is 401, staff without Website is 403, staff with it and a super admin are 200', async () => {
  assert.equal((await call(site)).statusCode, 401);
  const staff = await call(site, { token: 'test-staff' });
  assert.equal(staff.statusCode, 403);
  assert.match(staff.json.message, /Website/, 'the refusal names the section the account lacks');
  assert.equal((await call(site, { token: 'test-web' })).statusCode, 200);
  assert.equal((await call(site, { token: 'test-admin' })).statusCode, 200);
  /* and the same for a change, which must not have happened */
  assert.equal((await change({ kind: 'page', id: 'laws', visible: false }, 'test-staff')).statusCode, 403);
  assert.equal((await call(site, { method: 'POST', body: { kind: 'page', id: 'laws', visible: false } })).statusCode, 401);
  assert.equal(stored(), undefined, 'nothing was written by a caller who may not');
});

test('Website is a module of its own; a super admin has it without being given it', () => {
  const mod = M.MODULES.find((m) => m.key === 'website');
  assert.ok(mod, 'lib/admin-modules.js lists website');
  assert.equal(mod.label, 'Website');
  assert.ok(M.accessOf({ admin: true, role: 'super' }).modules.includes('website'), 'super admins carry every module');
  assert.ok(M.accessOf({ admin: true }).modules.includes('website'), 'and so does an admin from before roles');
  assert.equal(M.canAccess({ role: 'staff', modules: ['submissions'] }, 'website'), false);
  assert.equal(M.canAccess({ role: 'staff', modules: ['website'] }, 'website'), true);
  assert.deepEqual(M.normaliseModules(['website', 'nonsense']), ['website'], 'it can be ticked on the People page');
  assert.ok(M.PRESETS.find((p) => p.key === 'everything').modules.includes('website'));
});

/* ---- reading ------------------------------------------------------------- */

test('GET lists every page, grouped as the menus group them, with its sections, locks and the state', async () => {
  const res = await call(site, { token: 'test-web' });
  assert.equal(res.statusCode, 200, res.raw);
  assert.deepEqual(res.json.groups.slice(0, 4), ['Our Work', 'Learn', 'Get Involved', 'About'], 'the header’s own four menus, in order');
  const page = (id) => res.json.pages.find((p) => p.id === id);
  assert.equal(page('units').group, 'Our Work');
  assert.equal(page('laws').group, 'Learn');
  assert.equal(page('founder').group, 'About');
  assert.equal(page('achievements').title, 'Policies and achievements');
  assert.ok(page('laws').modules.some((m) => m.key === 'laws#part-a' && m.label === 'Dogs'));
  for (const id of ['index', 'track', 'search']) assert.ok(page(id).locked.length > 20, `${id} says why it cannot be hidden`);
  assert.equal(page('index').partsLocked, false, 'the home page’s sections can still be hidden');
  assert.equal(page('track').partsLocked, true);
  assert.equal(page('laws').locked, '');
  assert.deepEqual(res.json.state.hidden, { pages: {}, modules: {} });
  assert.equal(res.json.state.version, 0);
  assert.equal(res.headers['cache-control'], 'no-store');
});

/* ---- changing ------------------------------------------------------------ */

test('hiding a page and a section, then showing them again', async () => {
  let res = await change({ kind: 'page', id: 'units', visible: false });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(res.json.changed, 1);
  assert.deepEqual(res.json.state.hidden.pages, { units: true });
  assert.equal(res.json.state.version, 1);
  assert.equal(res.json.state.updatedBy.email, 'priya@pfa.test', 'who comes from the token');
  assert.equal(res.json.state.marks['page:units'].visible, false);
  assert.equal(res.json.state.marks['page:units'].by, 'priya@pfa.test');
  assert.deepEqual(res.json.state.last, [{ kind: 'page', id: 'units', label: 'Units (units.html)', from: 'visible', to: 'hidden' }]);

  res = await change({ kind: 'module', id: 'laws#part-a', visible: false }, 'test-web');
  assert.equal(res.statusCode, 200, res.raw);
  assert.deepEqual(stored().hidden, { pages: { units: true }, modules: { 'laws#part-a': true } });
  assert.equal(stored().version, 2);

  const pub = await call(visibility);
  assert.deepEqual(pub.json, { version: 2, pages: ['units'], modules: ['laws#part-a'], choices: { 'manekas-picks#opening': '2' } }, 'the public site is told at once');

  res = await change({ kind: 'page', id: 'units', visible: true });
  assert.deepEqual(res.json.state.hidden.pages, {}, 'shown again: gone from the list, not stored as false');
  assert.equal(res.json.state.marks['page:units'].visible, true);
  assert.equal(stored().version, 3);
});

test('asking for what is already so changes nothing, bumps nothing and logs nothing', async () => {
  await change({ kind: 'page', id: 'units', visible: false });
  const before = auditRows().length;
  const res = await change({ kind: 'page', id: 'units', visible: false });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.changed, 0);
  assert.equal(stored().version, 1);
  assert.equal(auditRows().length, before);
  assert.equal((await change({ kind: 'page', id: 'laws', visible: true })).json.changed, 0, 'showing what is shown');
});

test('the home page, track and search cannot be hidden, and say why; the home page’s sections can', async () => {
  for (const id of ['index', 'track', 'search']) {
    const res = await change({ kind: 'page', id, visible: false });
    assert.equal(res.statusCode, 409, id);
    assert.equal(res.json.code, 'LOCKED');
    assert.equal(res.json.message, V.LOCKED[id].reason);
  }
  assert.match(V.LOCKED.track.reason, /reference numbers/, 'track: people follow the numbers in their emails there');
  assert.equal((await change({ kind: 'module', id: 'track#top', visible: false })).statusCode, 409, 'nor any part of track');
  assert.equal((await change({ kind: 'module', id: 'search#top', visible: false })).statusCode, 409);
  assert.equal(stored(), undefined, 'nothing was written');
  const home = await change({ kind: 'module', id: 'index#founder', visible: false });
  assert.equal(home.statusCode, 200, home.raw);
  assert.deepEqual(stored().hidden.modules, { 'index#founder': true });
});

test('ids the site does not have, and changes that are not changes, are refused, and nothing is written', async () => {
  const cases = [
    [{ kind: 'page', id: 'nowhere', visible: false }, 400, 'UNKNOWN'],
    [{ kind: 'page', id: 'laws.html', visible: false }, 400, 'UNKNOWN'],
    [{ kind: 'module', id: 'laws#part-z', visible: false }, 400, 'UNKNOWN'],
    [{ kind: 'module', id: 'part-a', visible: false }, 400, 'UNKNOWN'],
    [{ kind: 'module', id: 'laws', visible: false }, 400, 'UNKNOWN'],
    [{ kind: 'page', id: '__proto__', visible: false }, 400, 'UNKNOWN'],
    [{ kind: 'section', id: 'laws', visible: false }, 400, 'BAD_KIND'],
    [{ kind: 'page', id: 'laws', visible: 'false' }, 400, 'BAD_VISIBLE'],
    [{ kind: 'page', id: 'laws' }, 400, 'BAD_VISIBLE'],
    [{ changes: [] }, 400, 'NOTHING_TO_CHANGE'],
    [{ changes: [{ kind: 'page', id: 'laws', visible: false }, { kind: 'page', id: 'nowhere', visible: false }] }, 400, 'UNKNOWN'],
    [{ changes: [{ kind: 'page', id: 'laws', visible: false }, { kind: 'page', id: 'index', visible: false }] }, 409, 'LOCKED']
  ];
  for (const [body, status, code] of cases) {
    const res = await change(body);
    assert.equal(res.statusCode, status, JSON.stringify(body));
    assert.equal(res.json.code, code, JSON.stringify(body));
  }
  assert.equal(stored(), undefined, 'a bulk change with one bad entry writes none of it');
  assert.equal(auditRows().length, 0);
});

test('a bulk change lands whole, in one version', async () => {
  const res = await change({ changes: [
    { kind: 'page', id: 'careers', visible: false },
    { kind: 'module', id: 'laws#part-b', visible: false },
    { kind: 'module', id: 'units#gallery', visible: false },
    { kind: 'module', id: 'units#gallery', visible: false }
  ] });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(res.json.changed, 3, 'the repeat is counted once');
  assert.equal(stored().version, 1);
  assert.deepEqual(stored().hidden, { pages: { careers: true }, modules: { 'laws#part-b': true, 'units#gallery': true } });
  assert.equal(auditRows().length, 3, 'one row per thing changed');
});

test('every change is in the audit log before the answer: who, what, from and to', async () => {
  /* Every read and write waits a few milliseconds, so a log write that the
     route did not wait for would still be in flight when the answer came. */
  db = memoryFirestore({ latency: 4 });
  firebase._setDbForTests(db);
  const res = await change({ kind: 'module', id: 'laws#part-c', visible: false }, 'test-web');
  assert.equal(res.statusCode, 200, res.raw);
  const rows = auditRows();
  assert.equal(rows.length, 1, 'the row was written before the answer was sent');
  const row = rows[0];
  assert.equal(row.actor.email, 'asha@pfa.test');
  assert.equal(row.module, 'website');
  assert.equal(row.action, 'site-hide');
  assert.equal(row.subject, 'laws#part-c');
  assert.equal(row.detail, 'Laws: Animal husbandry: Visible to Hidden');
  assert.equal(row.outcome, 'done');

  await change({ kind: 'page', id: 'units', visible: false });
  await change({ kind: 'page', id: 'units', visible: true });
  const last = auditRows().sort((a, b) => a.atMs - b.atMs).pop();
  assert.equal(last.action, 'site-show');
  assert.equal(last.subject, 'units.html');
  assert.equal(last.detail, 'Units (units.html): Hidden to Visible');
  assert.equal(last.actor.email, 'priya@pfa.test');
});

test('the route writes in a transaction: two people toggling at the same moment both land', async () => {
  /* Without a transaction, each request reads the empty state, adds its own
     page and writes the whole thing back: the second write erases the first. */
  db = memoryFirestore({ latency: 3 });
  firebase._setDbForTests(db);
  const [a, b] = await Promise.all([
    change({ kind: 'page', id: 'careers', visible: false }, 'test-admin'),
    change({ kind: 'page', id: 'events', visible: false }, 'test-web')
  ]);
  assert.equal(a.statusCode, 200, a.raw);
  assert.equal(b.statusCode, 200, b.raw);
  assert.deepEqual(stored().hidden.pages, { careers: true, events: true }, 'both changes are there');
  assert.equal(stored().version, 2, 'each was its own version');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'site-visibility.js'), 'utf8');
  assert.match(src, /runTransaction\(async \(tx\)/);
});

test('a hidden id that has left the pages can be shown again, and only shown', async () => {
  await db.collection('siteSettings').doc('visibility').set({ hidden: { pages: {}, modules: { 'laws#part-old': true } }, version: 4 });
  assert.equal((await change({ kind: 'module', id: 'laws#part-old', visible: false })).statusCode, 400, 'never hidden afresh');
  const res = await change({ kind: 'module', id: 'laws#part-old', visible: true });
  assert.equal(res.statusCode, 200, res.raw);
  assert.deepEqual(stored().hidden.modules, {});
  assert.equal((await change({ kind: 'module', id: 'laws#never-was', visible: true })).statusCode, 400, 'an id that is neither on the site nor hidden is still unknown');
});

test('a hand edit in the database cannot hide a locked page or slip anything odd into the public answer', async () => {
  await db.collection('siteSettings').doc('visibility').set({
    hidden: { pages: { index: true, track: true, laws: true, 'x"]{}': true, founder: 'yes' }, modules: { 'track#top': true, 'index#founder': true, 'laws#part-a': true, 'laws#a b': true } },
    version: 7
  });
  const pub = await call(visibility);
  assert.deepEqual(pub.json, { version: 7, pages: ['laws'], modules: ['index#founder', 'laws#part-a'], choices: { 'manekas-picks#opening': '2' } });
});

/* ---- the public answer --------------------------------------------------- */

test('the public route: the shape, the cache header, HEAD, and nothing about who', async () => {
  await change({ kind: 'page', id: 'events', visible: false });
  const res = await call(visibility);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.json).sort(), ['choices', 'modules', 'pages', 'version']);
  assert.deepEqual(res.json, { version: 1, pages: ['events'], modules: [], choices: { 'manekas-picks#opening': '2' } });
  assert.equal(res.headers['cache-control'], 'public, max-age=0, s-maxage=10, stale-while-revalidate=30');
  assert.match(res.headers['content-type'], /application\/json/);
  assert.ok(!/priya|marks|updatedBy/.test(res.raw), 'the public answer names nobody');
  const head = await call(visibility, { method: 'HEAD' });
  assert.equal(head.statusCode, 200);
  assert.equal(head.raw, '');
  const post = await call(visibility, { method: 'POST', body: {} });
  assert.equal(post.statusCode, 405);
});

test('each instance keeps the answer five seconds; a change made on it is served at once', async () => {
  let reads = 0;
  const counting = { collection: (name) => { const c = db.collection(name); return { doc: (id) => { const d = c.doc(id); return { get: async () => { reads += 1; return d.get(); } }; } }; } };
  let clock = 1000000;
  const deps = { getDb: () => counting, now: () => clock };
  await V.publicState(deps);
  await V.publicState(deps);
  assert.equal(reads, 1, 'the second ask within five seconds is answered from memory');
  clock += V.MEMORY_MS + 1;
  await V.publicState(deps);
  assert.equal(reads, 2, 'after five seconds it reads again');

  /* through the route: a change on this instance forgets the memory */
  V.forget();
  assert.deepEqual((await call(visibility)).json.pages, []);
  await change({ kind: 'page', id: 'wall', visible: false });
  assert.deepEqual((await call(visibility)).json.pages, ['wall'], 'not five seconds late on the instance that made it');
});

test('it fails open: if the setting cannot be read, nothing is hidden and the edge keeps that only a moment', async () => {
  firebase._setDbForTests({ collection() { throw new Error('UNAVAILABLE: Firestore is unreachable'); } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const res = await call(visibility);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json, { version: 0, pages: [], modules: [], choices: { 'manekas-picks#opening': '2' }, unavailable: true });
    assert.equal(res.headers['cache-control'], 'public, max-age=0, s-maxage=2');
    /* a read that hangs is given up on, not waited for */
    const hung = await V.publicState({ getDb: () => ({ collection: () => ({ doc: () => ({ get: () => new Promise(() => {}) }) }) }), timeoutMs: 30 });
    assert.equal(hung.unavailable, true);
    /* and the failure is not remembered: the next ask reads again */
    firebase._setDbForTests(db);
    await db.collection('siteSettings').doc('visibility').set({ hidden: { pages: { quiz: true }, modules: {} }, version: 2 });
    assert.deepEqual((await call(visibility)).json, { version: 2, pages: ['quiz'], modules: [], choices: { 'manekas-picks#opening': '2' } });
  } finally {
    console.warn = warn;
  }
});

/* ---- the seams ----------------------------------------------------------- */

test('the server and the page agree on what can never be hidden', () => {
  const page = require('../assets/site-visibility.js').PFA_VISIBILITY;
  assert.deepEqual(Object.keys(page.LOCKED).sort(), Object.keys(V.LOCKED).sort());
  for (const id of Object.keys(V.LOCKED)) {
    assert.equal(page.LOCKED[id] === 2, V.LOCKED[id].parts, `${id}: whether its sections are locked too`);
  }
});

test('both routes are mounted, and the rules keep browsers out of the setting', () => {
  const api = require('../api/index.js');
  assert.equal(api._private.ROUTES['admin/site'], './admin/site.js');
  assert.equal(api._private.ROUTES['site-visibility'], './site-visibility.js');
  const index = fs.readFileSync(path.join(ROOT, 'api', 'index.js'), 'utf8');
  assert.match(index, /'admin\/site': \(\) => require\('\.\.\/lib\/routes\/admin\/site\.js'\)/);
  assert.match(index, /'site-visibility': \(\) => require\('\.\.\/lib\/routes\/site-visibility\.js'\)/);
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/siteSettings\/\{id\}\s*\{ allow read, write: if false; \}/);
});

/* ---- page designs: Option 1 or Option 2 (owner, 11 Nov 2026) -------------- */

test('a page design is chosen in the panel, logged, and told to the public site', async () => {
  /* "have 2 options in the admin for manekas picks page. 1 and 2. which can be switched on the admin panel" */
  assert.deepEqual(Object.keys(V.CHOICES), ['manekas-picks#opening']);
  assert.deepEqual(V.CHOICES['manekas-picks#opening'].options.map((o) => o.label), ['Option 1', 'Option 2']);
  assert.equal(V.CHOICES['manekas-picks#opening'].fallback, '2', 'the quiet portrait until Option 1 is chosen');

  const listing = await call(site, { token: 'test-admin' });
  assert.equal(listing.statusCode, 200, listing.raw);
  assert.deepEqual(listing.json.choices.map((c) => [c.id, c.page, c.fallback, c.options.map((o) => o.value)]), [['manekas-picks#opening', 'manekas-picks', '2', ['1', '2']]]);
  assert.deepEqual(listing.json.state.choices, { 'manekas-picks#opening': '2' });

  let res = await change({ kind: 'choice', id: 'manekas-picks#opening', value: '1' });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(res.json.changed, 1);
  assert.deepEqual(res.json.state.choices, { 'manekas-picks#opening': '1' });
  assert.deepEqual(res.json.state.marks['choice:manekas-picks#opening'].value, '1');
  assert.equal(res.json.state.marks['choice:manekas-picks#opening'].by, 'priya@pfa.test');
  assert.deepEqual(stored().choices, { 'manekas-picks#opening': '1' });
  assert.deepEqual((await call(visibility)).json.choices, { 'manekas-picks#opening': '1' }, 'the public site is told at once');
  const row = auditRows()[0];
  assert.equal(row.action, 'site-design');
  assert.equal(row.subject, 'manekas-picks#opening');
  assert.equal(row.detail, 'Maneka’s Picks: how the page opens: Option 2 to Option 1');

  /* choosing what is already chosen changes nothing */
  res = await change({ kind: 'choice', id: 'manekas-picks#opening', value: '1' });
  assert.equal(res.json.changed, 0);
  assert.equal(auditRows().length, 1);

  res = await change({ kind: 'choice', id: 'manekas-picks#opening', value: '2' });
  assert.deepEqual((await call(visibility)).json.choices, { 'manekas-picks#opening': '2' });
  assert.equal(stored().version, 2);
});

test('a page design that is not there, or an option it does not have, is refused and nothing is written', async () => {
  for (const [body, code] of [
    [{ kind: 'choice', id: 'manekas-picks#opening', value: '3' }, 'BAD_OPTION'],
    [{ kind: 'choice', id: 'manekas-picks#opening' }, 'BAD_OPTION'],
    [{ kind: 'choice', id: 'index#hero', value: '1' }, 'UNKNOWN'],
    [{ kind: 'choice', id: '__proto__', value: '1' }, 'UNKNOWN']
  ]) {
    const res = await change(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.json.code, code);
  }
  assert.equal(stored(), undefined);
  /* a hand edit in the database cannot slip an option the page does not have into the public answer */
  await db.collection('siteSettings').doc('visibility').set({ choices: { 'manekas-picks#opening': '9', 'x#y': '1' }, version: 3 });
  assert.deepEqual((await call(visibility)).json.choices, { 'manekas-picks#opening': '2' });
});
