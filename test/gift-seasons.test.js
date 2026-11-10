'use strict';

/* Seasonal gifts (owner, 10 Nov 2026: "Create a Seasonal Gifts page for
   Deepawali, Christmas, New Year, and other occasions. Let admins configure
   gift collections and offers by season and year, schedule upcoming seasons,
   and automatically display the active season's content. Add an admin toggle
   to show or hide the page and its navigation links on the public site.")

   Held here: what a season may hold, which season the page shows on which
   day in India, the public answer, the panel's routes (who may, save, copy,
   delete, the page's switch, the audit), that hiding the page takes its links
   with it, and that the page, the panel and the API are wired together. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USERS = {
  'test-admin': { uid: 'u-super', email: 'priya@pfa.test', name: 'Priya', claims: { admin: true, role: 'super' } },
  'test-staff': { uid: 'u-staff', email: 'ravi@pfa.test', name: 'Ravi', claims: { admin: true, role: 'staff', modules: ['submissions'] } },
  'test-gifts': { uid: 'u-gifts', email: 'asha@pfa.test', name: 'Asha', claims: { admin: true, role: 'staff', modules: ['gifts'] } }
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
const G = require('../lib/gift-seasons');
const adminGifts = require('../lib/routes/admin/gifts');
const publicGifts = require('../lib/routes/gifts');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let db;
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  adminAuth._clearFailures();
  V.forget();
  G.forget();
});
test.afterEach(() => { firebase._setDbForTests(null); V.forget(); G.forget(); });

function call(handler, { method = 'GET', body, token } = {}) {
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
      headers: Object.assign({ host: 'pfa.test', 'x-forwarded-for': '198.51.100.' + Math.floor(Math.random() * 200) }, token ? { authorization: `Bearer ${token}` } : {})
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const DEEPAWALI = {
  occasion: 'deepawali', year: 2026, startDate: '2026-10-20', endDate: '2026-11-10', status: 'published',
  headline: 'Light up their Deepawali.', intro: 'Gifts that pay for rescue and care.',
  offers: [{ title: 'Half price on every designer T-shirt', detail: 'While stocks last.', until: '2026-11-08' }, { title: '', detail: 'no title, left out' }],
  collections: [{ title: 'For the ones who have everything', blurb: 'Designer tees.', items: [{ type: 'piece', id: '23' }, { type: 'piece', id: '23' }, { type: 'link', title: 'A donation in their name', href: 'donate.html?gift=1', image: 'img/donate-dog.webp', price: 'Any amount' }] }]
};

/* ---- what a season may hold --------------------------------------------- */

test('a season is checked before it is kept, and every refusal is a sentence', () => {
  const ok = G.validate(DEEPAWALI);
  assert.equal(ok.error, undefined);
  assert.equal(ok.season.name, 'Deepawali');
  assert.equal(ok.season.offers.length, 1, 'an offer with no title is left out');
  assert.deepEqual(Object.keys(ok.season.offers[0]).sort(), ['detail', 'title', 'until'], 'no discount codes: the checkout takes none');
  assert.equal(ok.season.collections[0].items.length, 2, 'a piece named twice is in once');
  const bad = (change) => G.validate(Object.assign({}, DEEPAWALI, change)).error;
  assert.equal(bad({ occasion: 'diwali-party' }), 'Choose the occasion.');
  assert.equal(bad({ occasion: 'other', name: '' }), 'Name the occasion.');
  assert.equal(G.validate(Object.assign({}, DEEPAWALI, { occasion: 'other', name: "Mother's Day" })).season.name, "Mother's Day");
  assert.equal(bad({ year: 1999 }), 'Give the year, for example 2026.');
  assert.equal(bad({ startDate: '2026-02-30' }), 'Give the first day of the season.');
  assert.equal(bad({ endDate: '2026-10-01' }), 'The last day comes before the first.');
  assert.equal(bad({ endDate: '2027-03-01' }), 'A season can run for 120 days at most.');
  assert.equal(bad({ headline: '' }), 'Write the headline the page opens with.');
  assert.equal(G.validate(Object.assign({}, DEEPAWALI, { headline: '', status: 'draft' })).error, undefined, 'a draft may be unfinished');
  assert.equal(bad({ collections: [] }), 'Add at least one collection before publishing.');
  assert.equal(bad({ collections: [{ title: 'Empty', items: [] }] }), '"Empty" has no gifts in it yet.');
  assert.match(bad({ collections: [{ title: 'X', items: [{ type: 'piece', id: '999' }] }] }), /names a shop piece that is not in the shop/);
  assert.match(bad({ collections: [{ title: 'X', items: [{ type: 'link', title: 'Bad', href: 'javascript:alert(1)' }] }] }), /needs a link/);
  assert.match(bad({ collections: [{ title: 'X', items: [{ type: 'link', title: 'Bad', href: 'donate.html', image: '../../etc/passwd.png' }] }] }), /picture for "Bad"/);
  assert.equal(G.safeHref('https://example.org/x'), 'https://example.org/x');
  assert.equal(G.safeHref('http://example.org/x'), null);
  assert.equal(G.safeHref('get-involved.html#membership'), 'get-involved.html#membership');
});

test('the page shows the season on today in India; the newer of two overlapping; never a draft', () => {
  const seasons = [
    Object.assign(G.validate(DEEPAWALI).season, { id: 'deepawali-2026' }),
    Object.assign(G.validate(Object.assign({}, DEEPAWALI, { occasion: 'christmas', startDate: '2026-12-10', endDate: '2027-01-01', year: 2026 })).season, { id: 'christmas-2026' }),
    Object.assign(G.validate(Object.assign({}, DEEPAWALI, { occasion: 'new-year', startDate: '2026-12-31', endDate: '2027-01-05', year: 2027 })).season, { id: 'new-year-2027' }),
    Object.assign(G.validate(Object.assign({}, DEEPAWALI, { occasion: 'holi', startDate: '2026-12-01', endDate: '2026-12-31', status: 'draft' })).season, { id: 'holi-2027' })
  ];
  /* 11:59 pm and midnight in India, 10 to 11 November */
  assert.equal(G.todayIST('2026-11-10T18:29:00Z'), '2026-11-10');
  assert.equal(G.todayIST('2026-11-10T18:30:00Z'), '2026-11-11');
  assert.equal(G.pick(seasons, G.todayIST('2026-11-10T18:29:00Z')).active.id, 'deepawali-2026');
  const after = G.pick(seasons, G.todayIST('2026-11-10T18:30:00Z'));
  assert.equal(after.active, null, 'over at midnight in India');
  assert.equal(after.next.id, 'christmas-2026', 'the draft Holi is never next');
  assert.equal(G.pick(seasons, '2026-12-20').active.id, 'christmas-2026');
  assert.equal(G.pick(seasons, '2026-12-31').active.id, 'new-year-2027', 'New Year takes over the day it begins');
  assert.equal(G.stateOf(seasons[3], '2026-12-15'), 'draft');
  assert.equal(G.stateOf(seasons[1], '2026-11-01'), 'scheduled');
  assert.equal(G.stateOf(seasons[0], '2026-11-11'), 'ended');
  assert.equal(G.nextYearDay('2028-02-29'), '2029-02-28');
});

test('the public view fills pieces from the shop and drops what has ended', () => {
  const s = Object.assign(G.validate(DEEPAWALI).season, { id: 'deepawali-2026' });
  const v = G.publicView(s, '2026-11-09');
  assert.equal(v.offers.length, 0, 'the offer ended on 8 November');
  assert.equal(G.publicView(s, '2026-11-08').offers.length, 1, 'and is shown on its last day');
  const [piece, link] = v.collections[0].items;
  assert.deepEqual(Object.keys(piece).sort(), ['by', 'href', 'id', 'image', 'listPrice', 'price', 'title', 'type']);
  assert.equal(piece.href, 'shop.html#sabyasachi');
  assert.equal(piece.price, 2500);
  assert.equal(piece.listPrice, 5000);
  assert.match(piece.image, /^media\/shop\//);
  assert.equal(link.href, 'donate.html?gift=1');
  const shop = require('../lib/shop');
  for (const p of G.PIECES) assert.equal(p.price, shop.get(p.id).price, `${p.id}: the price is the shop's own`);
});

/* ---- the routes --------------------------------------------------------- */

test('who may: no token 401, staff without Seasonal gifts 403, with it 200', async () => {
  assert.equal((await call(adminGifts)).statusCode, 401);
  assert.equal((await call(adminGifts, { token: 'test-staff' })).statusCode, 403);
  const ok = await call(adminGifts, { token: 'test-gifts' });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json.seasons, []);
  assert.equal(ok.json.pieces.length, G.PIECES.length);
  assert.equal(ok.json.page.hidden, false);
  assert.ok(require('../lib/admin-modules').MODULE_KEYS.includes('gifts'));
});

test('a season saved, saved again, copied to next year and removed (kept, never deleted); each in the audit log', async () => {
  const save = (season, id) => call(adminGifts, { method: 'POST', token: 'test-gifts', body: { action: 'save', season, id } });
  const first = await save(DEEPAWALI);
  assert.equal(first.statusCode, 200, first.raw);
  assert.equal(first.json.saved, 'deepawali-2026');
  assert.equal((await save(Object.assign({}, DEEPAWALI, { status: 'draft' }))).json.saved, 'deepawali-2026-2', 'a second of the same year is its own');
  const refused = await save(Object.assign({}, DEEPAWALI, { endDate: '2026-01-01' }));
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json.message, 'The last day comes before the first.');
  const changed = await save(Object.assign({}, DEEPAWALI, { headline: 'A new headline.' }), 'deepawali-2026');
  assert.equal(changed.json.seasons.find((s) => s.id === 'deepawali-2026').headline, 'A new headline.');
  assert.equal((await save(DEEPAWALI, 'no-such-season')).statusCode, 404);

  const copy = await call(adminGifts, { method: 'POST', token: 'test-gifts', body: { action: 'copy', id: 'deepawali-2026' } });
  assert.equal(copy.json.saved, 'deepawali-2027');
  const c = copy.json.seasons.find((s) => s.id === 'deepawali-2027');
  assert.equal(c.status, 'draft');
  assert.equal(c.startDate, '2027-10-20');
  assert.equal(c.offers[0].until, '2027-11-08');
  assert.equal(c.state, 'draft');

  const del = await call(adminGifts, { method: 'POST', token: 'test-gifts', body: { action: 'remove', id: 'deepawali-2026-2' } });
  assert.ok(!del.json.seasons.some((s) => s.id === 'deepawali-2026-2'), 'off the list');
  assert.equal(db.dump()['giftSeasons/deepawali-2026-2'].removed, true, 'and still in the records');
  assert.equal((await call(adminGifts, { method: 'POST', token: 'test-gifts', body: { action: 'remove', id: 'deepawali-2026-2' } })).statusCode, 404, 'once');

  const audit = Object.entries(db.dump()).filter(([k]) => k.startsWith('adminAudit/')).map(([, v]) => v);
  assert.deepEqual(audit.map((a) => a.action).sort(), ['gift-season-add', 'gift-season-add', 'gift-season-add', 'gift-season-change', 'gift-season-remove']);
  assert.ok(audit.every((a) => a.module === 'gifts'));
});

test('the public answer: the live season, or the next one, kept briefly at the edge', async () => {
  const now = Date.parse('2026-11-01T06:00:00Z');
  await call(adminGifts, { method: 'POST', token: 'test-admin', body: { action: 'save', season: DEEPAWALI } });
  await call(adminGifts, { method: 'POST', token: 'test-admin', body: { action: 'save', season: Object.assign({}, DEEPAWALI, { occasion: 'christmas', startDate: '2026-12-10', endDate: '2026-12-31' }) } });
  G.forget();
  const live = await G.publicAnswer({ now: () => now, getDb: () => db });
  assert.equal(live.season.id, 'deepawali-2026');
  assert.equal(live.next.name, 'Christmas');
  G.forget();
  const between = await G.publicAnswer({ now: () => Date.parse('2026-11-20T06:00:00Z'), getDb: () => db });
  assert.equal(between.season, null);
  assert.deepEqual(between.next, { name: 'Christmas', year: 2026, startDate: '2026-12-10' });
  const res = await call(publicGifts);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['cache-control'], /s-maxage=30/);
  G.forget();
  const down = await G.publicAnswer({ getDb: () => { throw new Error('down'); } });
  assert.equal(down.unavailable, true);
  assert.equal((await call(publicGifts, { method: 'POST' })).statusCode, 405);
});

test('the switch hides the page and every link to it, for someone with only Seasonal gifts', async () => {
  const off = await call(adminGifts, { method: 'POST', token: 'test-gifts', body: { action: 'page', visible: false } });
  assert.equal(off.statusCode, 200, off.raw);
  assert.equal(off.json.page.hidden, true);
  V.forget();
  const pub = await V.publicState({ getDb: () => db });
  assert.deepEqual(pub.pages, ['gifts']);
  const page = require('../assets/site-visibility.js').PFA_VISIBILITY;
  const css = page.plan(page.clean(pub), 'index').css;
  assert.match(css, /a\[href="gifts\.html"\]/, 'the menu and footer links go with it');
  const audit = Object.entries(db.dump()).filter(([k]) => k.startsWith('adminAudit/')).map(([, v]) => v);
  assert.equal(audit[0].action, 'site-hide');
  assert.equal(audit[0].subject, 'gifts.html');
  const on = await call(adminGifts, { method: 'POST', token: 'test-gifts', body: { action: 'page', visible: true } });
  assert.equal(on.json.page.hidden, false);
  assert.equal((await call(adminGifts, { method: 'POST', token: 'test-gifts', body: { action: 'page', visible: 'no' } })).statusCode, 400);
});

/* ---- wired together ----------------------------------------------------- */

test('the page, the panel and the API are wired together', () => {
  const api = require('../api/index.js');
  assert.equal(api._private.ROUTES.gifts, './gifts.js');
  assert.equal(api._private.ROUTES['admin/gifts'], './admin/gifts.js');
  const index = read('api/index.js');
  assert.match(index, /'gifts': \(\) => require\('\.\.\/lib\/routes\/gifts\.js'\)/);
  assert.match(index, /'admin\/gifts': \(\) => require\('\.\.\/lib\/routes\/admin\/gifts\.js'\)/);

  const html = read('gifts.html');
  assert.match(html, /<script src="assets\/gifts\.js" defer><\/script>/);
  for (const id of ['top', 'offers', 'collections', 'always']) assert.match(html, new RegExp(`<section class="[^"]*" id="${id}"`));
  assert.match(html, /href="donate\.html\?gift=1"/, 'the year-round gifts are there with no season on');
  const js = read('assets/gifts.js');
  assert.doesNotMatch(js, /innerHTML/, 'what the server sends is set as text');
  assert.match(js, /fetch\('\/api\/gifts'/);

  assert.match(read('assets/chrome-header.html'), /\{\{CURRENT:gifts\.html\|Seasonal gifts\}\}/);
  assert.match(read('assets/chrome-footer.html'), /<a href="gifts\.html">Seasonal gifts<\/a>/);

  const admin = read('admin.html');
  assert.match(admin, /<button class="tab" type="button" data-tab="gifts">Seasonal gifts<\/button>/);
  assert.match(admin, /<div class="pane" data-pane="gifts"/);
  assert.match(admin, /gifts: \{ title: 'Seasonal gifts', module: 'gifts', needs: 'gifts' \}/);
  assert.match(admin, /if \(tab === 'gifts'\) return window\.PFAGifts && window\.PFAGifts\.pane\(\);/);
  assert.match(admin, /<script src="assets\/admin-gifts\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-gifts\.js'/);

  /* the shop's pieces, as the shop has them */
  assert.equal(require('../scripts/build-shop-pieces.js').build(), read('lib/shop-pieces.json'), 'run node scripts/build-shop-pieces.js');
});
