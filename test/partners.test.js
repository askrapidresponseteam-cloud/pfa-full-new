'use strict';

/* Partners in giving (owner, 27 Nov 2026): "what is the best way to share
   the donors givings. it has to look amazing and stand out"; "The amount can
   be shown or hidden using a toggle in the admin panel. In either case, the
   layout should look natural to website visitors, with no amount hidden
   message or empty space when the amount is hidden." */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { memoryFirestore } = require('./_memory-firestore');
const P = require('../lib/partners');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.UTC(2026, 10, 27, 4, 0);

test('the first partnership is Rosie’s Heroes and PFA Khamgaon, put in once, with its photographs and logo on the site', async () => {
  const db = memoryFirestore();
  const list = await P.publicList(db);
  assert.equal(list.length, 1);
  const r = list[0];
  assert.equal(r.id, 'rosies-heroes');
  assert.equal(r.unit, 'PFA Khamgaon');
  assert.deepEqual(r.people, ['Priyanka Rao, President', 'Archana Ramamoorthy, Treasurer', 'Sonia Dong, Secretary']);
  for (const src of [r.logo].concat(r.photos.map((p) => p.src))) assert.ok(fs.existsSync(path.join(ROOT, src)), src + ' is on the site');
  /* taken off, it is not put back by the seed */
  await P.remove(db, 'a@pfa', 'rosies-heroes', NOW);
  assert.equal((await P.publicList(db)).length, 0);
});

test('the amount leaves the server only while it is to be shown', async () => {
  const db = memoryFirestore();
  const base = Object.assign({}, P.ROSIES, { amount: '2,664.92', currency: 'USD' });
  let r = await P.save(db, 'a@pfa', Object.assign({}, base, { showAmount: false }), NOW);
  assert.equal(r.ok, true);
  let pub = (await P.publicList(db))[0];
  assert.equal(pub.given, undefined);
  assert.doesNotMatch(JSON.stringify(pub), /2664|amount|showAmount/i, 'not even its name reaches a visitor');
  r = await P.save(db, 'a@pfa', Object.assign({}, base, { showAmount: true }), NOW);
  pub = (await P.publicList(db))[0];
  assert.equal(pub.given, 'US$2664.92', 'written without separators');
  /* switched on with no amount, nothing shows */
  await P.save(db, 'a@pfa', Object.assign({}, base, { amount: '', showAmount: true }), NOW);
  assert.equal((await P.publicList(db))[0].given, undefined);
  assert.equal(P.check(Object.assign({}, base, { amount: 'lots' })).ok, false);
});

test('the timeline adds up the animals helped; a partnership needs a name, a headline and a photograph; only our own pictures', async () => {
  const db = memoryFirestore();
  const tl = P.ROSIES.timeline.concat([{ date: '2026-12-03', title: 'First week on the road', count: 9 }, { date: '2026-12-10', title: 'Second week', count: '4' }]);
  await P.save(db, 'a@pfa', Object.assign({}, P.ROSIES, { timeline: tl }), NOW);
  const pub = (await P.publicList(db))[0];
  assert.equal(pub.helped, 13);
  assert.deepEqual(pub.timeline.map((e) => e.date), ['2026-11-25', '2026-11-29', '2026-12-03', '2026-12-10'], 'oldest first');
  assert.equal(P.check(Object.assign({}, P.ROSIES, { donor: '' })).ok, false);
  assert.equal(P.check(Object.assign({}, P.ROSIES, { headline: '' })).ok, false);
  assert.equal(P.check(Object.assign({}, P.ROSIES, { photos: [] })).ok, false);
  assert.equal(P.check(Object.assign({}, P.ROSIES, { photos: [{ src: 'https://evil.example/x.jpg' }] })).ok, false);
  assert.equal(P.check(Object.assign({}, P.ROSIES, { timeline: [{ date: '2026-02-31', title: 'Bad day' }] })).ok, false);
  assert.equal(P.check(Object.assign({}, P.ROSIES, { link: 'http://rosiesheroes.org' })).ok, false);
  assert.equal(P.check(Object.assign({}, P.ROSIES, { story: 'One \u2014 two' })).partner.story, 'One - two', 'long dashes become hyphens');
});

test('the page: four facts with the amount, three without, the row closing up and nothing said about it', async () => {
  const page = read('partners.html').replace(/<script[\s\S]*?<\/script>/g, '');
  const run = async (pub) => {
    const dom = new JSDOM(page, { runScripts: 'outside-only', url: 'https://pfa.test/partners.html' });
    const w = dom.window;
    w.fetch = async () => ({ ok: true, json: async () => ({ ok: true, partners: [pub] }) });
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.eval(read('assets/partners.js'));
    await new Promise((r) => setTimeout(r, 30));
    return w.document;
  };
  const hidden = P.publicOf(Object.assign({}, P.ROSIES, { amount: '2664.92', showAmount: false }));
  let d = await run(hidden);
  let facts = [...d.querySelectorAll('.pg-facts > div > dt')].map((s) => s.textContent);
  assert.equal(d.querySelector('.pg-facts').getAttribute('data-n'), '3');
  assert.deepEqual(facts, ['The gift', 'Where it works', 'Arrived']);
  assert.doesNotMatch(d.querySelector('[data-partners]').textContent, /amount|hidden|not shown|undisclosed/i);
  assert.equal(d.querySelector('.pg-count'), null, 'no count until there is one');
  const shown = P.publicOf(Object.assign({}, P.ROSIES, { amount: '2664.92', showAmount: true, timeline: P.ROSIES.timeline.concat([{ id: 't-w1', date: '2026-11-27', title: 'First days', count: 9 }]) }));
  d = await run(shown);
  facts = [...d.querySelectorAll('.pg-facts > div')].map((li) => li.textContent);
  assert.equal(d.querySelector('.pg-facts').getAttribute('data-n'), '4');
  assert.equal(facts.length, 4);
  assert.match(facts[3], /Given\s*US\$2664\.92/);
  assert.match(d.querySelector('.pg-count').textContent, /9animals carried to care so far, with Rosie’s Heroes’ gift/);
  assert.equal(d.querySelector('.pg-with__donor').getAttribute('src'), 'media/partners/rosies-heroes/logo.webp');
  assert.ok(d.querySelector('h1.pg-title'));
  /* the logos stand on the page, never in a box over the photograph */
  assert.equal(d.querySelector('.pg-open__photo .pg-with'), null);
  /* the row of facts is as many columns as there are facts, so it closes up */
  const css = read('assets/partners.css');
  assert.match(css, /\.pg-facts\{[^}]*grid-template-columns:repeat\(var\(--n,3\),minmax\(0,1fr\)\)/);
  assert.match(css, /\.pg-facts\[data-n="3"\]\{--n:3\}/);
  assert.match(css, /\.pg-facts\[data-n="4"\]\{--n:4\}/);
  /* the livery is drawn once, and not at all for anyone who asks for less motion */
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{\s*\.pg-wave path\{animation:/);
});

test('the page without script carries the first partnership, written by the page\'s own render', () => {
  const B = require('../scripts/build-partners');
  const page = read('partners.html');
  assert.equal(B.build(page), page, 'partners.html is out of date: run node scripts/build-partners.js');
  const { render } = require('../assets/partners.js');
  assert.ok(page.includes(render(P.publicOf(P.ROSIES), true, B.AS_OF)));
  const d = new JSDOM(page).window.document;
  assert.equal(d.querySelectorAll('h1.pg-title').length, 1);
  assert.ok(d.querySelector('.pg-open svg.pg-wave'));
  assert.doesNotMatch(d.querySelector('[data-partners]').textContent, /amount|hidden|not shown|undisclosed/i);
});

test('wired in: the routes, the panel section with its switch, the menu and footer, the rules, no long dashes', () => {
  const api = read('api/index.js');
  for (const r of ['partners', 'admin/partners']) assert.ok(api.includes(`'${r}': () => require('../lib/routes/${r}.js')`), r);
  assert.ok(require('../lib/admin-modules').MODULE_KEYS.includes('partners'));
  const admin = read('admin.html');
  assert.match(admin, /data-tab="partners"/);
  assert.match(admin, /<script src="assets\/admin-partners\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-partners\.js'/);
  const panel = read('assets/admin-partners.js');
  assert.match(panel, /id="ppShowAmount"/);
  assert.match(panel, /Show the amount on the site/);
  assert.match(panel, /Instagram picture/);
  assert.match(read('assets/chrome-header.html'), /\{\{CURRENT:partners\.html\|Partners in giving\}\}/);
  assert.match(read('assets/chrome-footer.html'), /<a href="partners\.html">Partners in giving<\/a>/);
  assert.match(read('firestore.rules'), /match \/partners\/\{id\}\s+\{ allow read, write: if false; \}/);
  for (const f of ['lib/partners.js', 'lib/routes/partners.js', 'lib/routes/admin/partners.js', 'assets/partners.js', 'assets/partners.css', 'assets/admin-partners.js', 'partners.html']) {
    assert.ok(!/[\u2013\u2014]/.test(read(f)), f + ' carries a long dash');
  }
});

test('the letter of thanks: linked from the partnership, a page of this site only, added once to the partnership written before it', async () => {
  const P = require('../lib/partners');
  const { memoryFirestore } = require('./_memory-firestore.js');
  const db = memoryFirestore();
  /* a partnership as it was saved before letters: no letter field */
  const old = Object.assign({}, P.ROSIES); delete old.letter;
  await db.collection('siteMeta').doc('partnersSeed').set({ at: 'then' });
  await db.collection('partners').doc(P.ROSIES.id).set(old);
  let list = await P.all(db);
  assert.equal(list[0].letter, 'rosies-heroes.html');
  /* taken off in the panel, it stays off */
  await db.collection('partners').doc(P.ROSIES.id).update({ letter: '' });
  list = await P.all(db);
  assert.equal(list[0].letter, '');
  assert.equal(P.publicOf(P.ROSIES).letter, 'rosies-heroes.html');
  for (const bad of ['https://evil.example/x.html', 'javascript:alert(1)', '../admin.html', 'a page.html']) {
    assert.equal(P.check(Object.assign({}, P.ROSIES, { letter: bad })).ok, false, bad);
  }
  assert.ok(read('partners.html').includes('<a class="pg-thanks__letter" href="rosies-heroes.html">Read our letter of thanks</a>'));
  const page = read('rosies-heroes.html');
  assert.doesNotMatch(page.replace(/<!--[\s\S]*?-->/g, ''), /class="[^"]*marquee|Scroll to discover/i, 'no marquee, no scroll cue (owner, 27 Nov 2026)');
  assert.ok(!/[–—]/.test(page) && !/[–—]/.test(read('assets/gratitude.js')), 'no long dashes');
});

/* review of 27 Nov 2026 (the backend-developer agent): a second gift from
   the same donor never overwrites the first; two people editing at once do
   not lose each other's work; first written is kept; a page with nothing on
   the site says so, and a failed read is not "nothing". */
test('safe saves: a new partnership never lands on one on file, a stale edit is refused, createdAt kept', async () => {
  const db = memoryFirestore();
  const first = await P.save(db, 'a@pfa', Object.assign({}, P.ROSIES), NOW);
  assert.equal(first.id, 'rosies-heroes');
  const createdAt = (await db.collection('partners').doc('rosies-heroes').get()).data().createdAt;
  /* New partnership, the same donor: the next free address */
  const next = await P.save(db, 'b@pfa', Object.assign({}, P.ROSIES, { id: '', headline: 'A second ambulance for Akola', timeline: [] }), NOW + 1000);
  assert.equal(next.ok, true);
  assert.equal(next.id, 'rosies-heroes-2');
  assert.equal((await db.collection('partners').doc('rosies-heroes').get()).data().timeline.length, P.ROSIES.timeline.length, 'the first keeps its timeline');
  /* two people with the same version open: the second save is refused */
  const v = (await db.collection('partners').doc('rosies-heroes').get()).data().updatedAt;
  const one = await P.save(db, 'a@pfa', Object.assign({}, P.ROSIES, { updatedAt: v, story: 'Edited by A' }), NOW + 2000);
  assert.equal(one.ok, true);
  const two = await P.save(db, 'b@pfa', Object.assign({}, P.ROSIES, { updatedAt: v, story: 'Edited by B' }), NOW + 3000);
  assert.equal(two.ok, false);
  assert.equal(two.conflict, true);
  const kept = (await db.collection('partners').doc('rosies-heroes').get()).data();
  assert.equal(kept.story, 'Edited by A');
  assert.equal(kept.createdAt, createdAt, 'first written is kept through every edit');
});

test('the public list: fresh, a failed read answers 503 and is not cached; nothing on the site empties the page', async () => {
  const ROUTE = require('../lib/routes/partners');
  const call = async (getDb) => new Promise((resolve) => {
    const out = { headers: {} };
    ROUTE.createHandler({ getDb })({ method: 'GET', headers: {} }, { setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, set statusCode(v) { out.status = v; }, end(raw) { out.json = JSON.parse(raw); resolve(out); } });
  });
  const ok = await call(() => memoryFirestore());
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.match(ok.headers['cache-control'], /s-maxage=5\b/);
  const bad = await call(() => { throw new Error('down'); });
  assert.equal(bad.status, 503);
  assert.equal(bad.headers['cache-control'], 'no-store');
  /* the page: an empty list from a good read empties it; a failed read keeps it */
  const page = read('partners.html').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const [answer, still] of [[{ ok: true, partners: [] }, false], [null, true]]) {
    const dom = new JSDOM(page, { runScripts: 'outside-only', url: 'https://pfa.test/partners.html' });
    dom.window.fetch = async () => (answer ? { ok: true, json: async () => answer } : { ok: false, json: async () => ({}) });
    dom.window.eval(read('assets/partners.js'));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(Boolean(dom.window.document.querySelector('#rosies-heroes')), still);
  }
});
