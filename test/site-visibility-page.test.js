'use strict';

/* Showing and hiding the public site: what a visitor's browser does with it.

   assets/site-visibility.js is one file with two lives: required here in
   Node, and copied by scripts/sync-chrome.js into an inline script at the
   top of every page's header include, where it hides what the panel has
   hidden before any of the page is parsed. These check the CSS it writes
   for each case, that every page carries it in front of its content, that
   the copy in the pages runs, that assets/chrome.js picks up a change while
   a page is open, and that site search leaves out what is hidden. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createDocument } = require('./_dom-shim.js');
const { PAGES, visibilityScript } = require('../scripts/sync-chrome.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const V = require('../assets/site-visibility.js').PFA_VISIBILITY;

/* Rules of the plan's CSS, as [selector, declarations]. */
function rules(css) {
  return css.split('}').filter(Boolean).map((r) => r.split('{'));
}

/* ---- the pure function --------------------------------------------------- */

test('nothing hidden writes nothing', () => {
  assert.deepEqual(V.plan({ version: 3, pages: [], modules: [] }, 'laws'), { css: '', gone: false });
  assert.deepEqual(V.plan(null, 'laws'), { css: '', gone: false });
  assert.deepEqual(V.plan(undefined, 'index'), { css: '', gone: false });
});

test('a hidden section is hidden on its own page and nowhere else', () => {
  /* academy.html has a #part-a too. Hiding the laws page's Dogs must not
     take the Academy's first module with it. */
  const state = { modules: ['laws#part-a'] };
  const onLaws = V.plan(state, 'laws').css;
  assert.match(onLaws, /\[id="part-a"\],\[data-module="part-a"\]\{display:none!important\}/);
  assert.match(onLaws, /a\[href="#part-a"\]:not\(\[aria-current\]\)/, 'an in-page link to it goes too');
  /* Hiding a page's opening section (#top) must not take the page's own
     entry out of the menus: on its own page that entry links to #top. */
  const top = V.plan({ modules: ['laws#top'] }, 'laws').css;
  const own = new JSDOM(read('laws.html'), { virtualConsole: new VirtualConsole() }).window.document;
  const linkRule = rules(top).find(([sel]) => sel.includes('a[href="#top"]'))[0];
  assert.ok(!own.querySelector('header.site a[aria-current="page"]').matches(linkRule), 'What the law says stays in the Learn menu');
  const onAcademy = V.plan(state, 'academy').css;
  assert.ok(!onAcademy.includes('[id="part-a"]'), 'the Academy keeps its own #part-a');
  assert.ok(!onAcademy.includes('a[href="#part-a"]'), 'and its own links to it');
  assert.match(onAcademy, /a\[href\$="laws\.html#part-a"\]/, 'links from anywhere to the hidden section go');
  assert.equal(V.plan(state, 'laws').gone, false, 'the page itself is still shown');
  assert.ok(!onLaws.includes('body>'), 'and nothing else on it is touched');
});

test('a hidden page: every link to it goes, in every form the site writes one, and the page is not hidden where it is not', () => {
  const { css, gone } = V.plan({ pages: ['units'] }, 'laws');
  assert.equal(gone, false);
  for (const sel of ['a[href="units.html"]', 'a[href^="units.html#"]', 'a[href^="units.html?"]', 'a[href$="/units.html"]', 'a[href*="/units.html#"]', 'a[href*="/units.html?"]']) {
    assert.ok(css.includes(sel), `missing ${sel}`);
  }
  const all = rules(css);
  /* The plain list stands alone, so a browser that cannot read :has() still
     hides the links. */
  const plain = all.find(([sel]) => sel.startsWith('a[href="units.html"]'));
  assert.ok(plain && !/:has|:is|:not/.test(plain[0]), 'the plain rule uses nothing newer than attribute selectors');
  assert.equal(plain[1], 'display:none!important');
  /* The header's own section button (Our Work) leads to units.html; it stays. */
  const keep = all.find(([sel]) => sel.startsWith('.navitem>a[href="units.html"]'));
  assert.ok(keep, 'the menu button is kept');
  assert.match(keep[1], /display:revert!important/);
  assert.match(keep[1], /pointer-events:none/);
  /* A list item that is only that link goes; an emptied menu, phone group or footer column goes. */
  assert.ok(all.some(([sel]) => sel.startsWith('li:has(>:is(') && sel.endsWith(':only-child)')));
  assert.ok(all.some(([sel]) => sel.startsWith('.navitem:not(:has(.menu>a:not(')));
  assert.ok(all.some(([sel]) => sel.startsWith('.mnav__group:not(:has(a:not(')), 'a phone-menu group is looked into, not just at: its rows sit in cards');
  assert.ok(all.some(([sel]) => sel.startsWith('.mnav__list:not(:has(>a:not(')), 'and a card left empty goes');
  assert.ok(all.some(([sel]) => sel.startsWith('.pfa-footer__col:not(:has(li>a:not(')));
  assert.ok(!css.includes('#pfa-gone'), 'no notice on a page that is shown');
});

test('the hidden page itself: everything it brought goes, the notice and the way on stay', () => {
  const { css, gone } = V.plan({ pages: ['units'] }, 'units');
  assert.equal(gone, true);
  assert.match(css, /body>:not\(\.announce\):not\(header\):not\(\.pfa-tabs\):not\(\.pfa-footer\):not\(\.mnav\):not\(\.cursor-layer\):not\(\.pfa-search\):not\(#pfa-gone\)\{display:none!important\}/, 'the phone tab bar stays as a way on');
  assert.match(css, /#pfa-gone\{display:block!important/);
  assert.match(css, /a\[aria-current="page"\]/, 'its own menu entry, which says #top there, goes too');
  assert.equal(V.NOTICE, 'This page is not available right now.');
});

test('the home page, track and search are never hidden here either, and nothing malformed gets through', () => {
  assert.deepEqual(V.plan({ pages: ['index', 'track', 'search'] }, 'index'), { css: '', gone: false });
  assert.deepEqual(V.plan({ pages: ['track'] }, 'track'), { css: '', gone: false });
  assert.deepEqual(V.plan({ modules: ['track#top', 'search#top'] }, 'track'), { css: '', gone: false });
  assert.match(V.plan({ modules: ['index#founder'] }, 'index').css, /\[id="founder"\]/, 'a home page section can be');
  const odd = V.plan({ pages: ['x"]{body{display:none}', 'UNITS', '../laws', 7, null], modules: ['laws#a b', 'laws#"x"', '#part-a', 'laws#', 'laws#1a'] }, 'laws');
  assert.deepEqual(odd, { css: '', gone: false }, 'a value from storage or the network cannot write its own CSS');
});

test('the page id is read from the address the way both hosts serve it', () => {
  const cases = { '/units.html': 'units', '/units': 'units', '/': 'index', '': 'index', '/index.html': 'index',
    'laws.html#a5': 'laws', '/laws.html?q=dog#a5': 'laws', 'https://peopleforanimalsindia.org/get-involved': 'get-involved',
    'units.html?q=Guwahati': 'units', '#top': 'index' };
  for (const [url, id] of Object.entries(cases)) assert.equal(V.pageOf(url), id, url);
});

test('blocked(): a page, a section, and with the anchors anything inside a section', () => {
  const state = { pages: ['units'], modules: ['laws#part-a', 'get-involved#membership'] };
  const anchors = require('../assets/site-modules.json').anchors;
  assert.equal(V.blocked('units.html', state), true);
  assert.equal(V.blocked('units.html?q=Guwahati', state), true);
  assert.equal(V.blocked('laws.html#part-a', state), true);
  assert.equal(V.blocked('get-involved.html#membership', state), true);
  assert.equal(V.blocked('get-involved.html#volunteer', state), false);
  assert.equal(V.blocked('laws.html#a10', state), false, 'without the anchors a question is not known to be inside');
  assert.equal(V.blocked('laws.html#a10', state, anchors), true, 'with them it is');
  assert.equal(V.blocked('laws.html#b10', state, anchors), false, 'a question in Cattle stays');
  assert.equal(V.blocked('laws.html', state, anchors), false);
  assert.equal(V.blocked('academy.html#part-a', state, anchors), false);
});

/* ---- every page carries it ---------------------------------------------- */

test('every page carries the script at the very top of the header include, before any of its own content', () => {
  const tag = visibilityScript();
  for (const page of Object.keys(PAGES)) {
    const html = read(page);
    const at = html.indexOf('<script id="pfa-vis">');
    assert.ok(at > -1, `${page} does not carry the visibility script`);
    assert.ok(html.includes(tag), `${page} carries an old copy; run npm run sync:chrome`);
    assert.equal(html.indexOf('<script id="pfa-vis">', at + 1), -1, `${page} carries it twice`);
    assert.ok(at > html.indexOf('<body'), `${page}: it is inside <body>, where document.body exists`);
    for (const later of ['<div class="announce"', '<header', '<main', '<section', '<footer']) {
      const there = html.indexOf(later, html.indexOf('<body'));
      if (there > -1) assert.ok(at < there, `${page}: the script must run before ${later}`);
    }
  }
  assert.ok(!read('admin.html').includes('pfa-vis'), 'the panel is not the public site');
});

test('the copy in the pages is the file, without its comments, and it parses', () => {
  const code = visibilityScript().replace(/^<script id="pfa-vis">\n/, '').replace(/\n<\/script>\n$/, '');
  assert.ok(!code.includes('/*') && !code.includes('*/'), 'no comment marker may sit inside a string or pattern of the file');
  assert.ok(!/<\/?(header|footer|script|body)\b/i.test(code), 'nothing in it can be mistaken for the markup sync-chrome looks for');
  new vm.Script(code);
  /* Run the page copy and the file side by side: the same answers. */
  const box = { localStorage: null };
  vm.runInNewContext(code, box);
  const state = { pages: ['units', 'careers'], modules: ['laws#part-a', 'index#founder'] };
  for (const page of ['units', 'laws', 'index', 'academy']) {
    assert.equal(JSON.stringify(box.PFA_VISIBILITY.plan(state, page)), JSON.stringify(V.plan(state, page)), page);
  }
});

function pageDom(file, state) {
  const dom = new JSDOM(read(file), { url: `https://pfa.test/${file.replace(/\.html$/, '')}`, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  if (state) dom.window.localStorage.setItem(V.KEY, JSON.stringify(state));
  dom.window.eval(visibilityScript().replace(/^<script id="pfa-vis">\n/, '').replace(/\n<\/script>\n$/, ''));
  return dom;
}

test('in a page: the last state seen hides a section and the links to a hidden page, and nothing else', () => {
  const dom = pageDom('laws.html', { version: 4, pages: ['units'], modules: ['laws#part-a'] });
  const d = dom.window.document;
  const style = d.getElementById('pfa-vis-css');
  assert.ok(style && style.parentNode === d.head, 'one <style> in <head>');
  const [ownRule, linkRule] = rules(style.textContent);
  const hidden = [...d.querySelectorAll(ownRule[0])];
  assert.deepEqual(hidden.map((el) => el.id), ['part-a'], 'exactly the Dogs section');
  const links = [...d.querySelectorAll(linkRule[0])];
  assert.ok(links.length >= 3, 'the menu entry, the footer entry and the button in the page');
  assert.ok(links.every((a) => a.tagName === 'A' && /units\.html/.test(a.getAttribute('href'))), 'and only links to the hidden page');
  assert.ok(links.some((a) => a.closest('.pfa-footer')), 'the footer’s');
  assert.ok(links.some((a) => a.closest('.menu')), 'the header menu’s');
  assert.equal(d.getElementById('pfa-gone'), null, 'the laws page is not hidden');
  assert.equal(d.querySelector('meta[name="robots"][content="noindex"]'), null);
});

test('in a page: a hidden page shows a polite notice with the way home, noindex and its own title, and takes them back', () => {
  const dom = pageDom('units.html', { version: 1, pages: ['units'], modules: [] });
  const d = dom.window.document;
  const box = d.getElementById('pfa-gone');
  assert.ok(box, 'the notice is there');
  assert.equal(box.querySelector('h1').textContent, 'This page is not available right now.');
  const home = box.querySelector('a');
  assert.equal(home.getAttribute('href'), '/');
  assert.equal(home.textContent, 'Go to the home page');
  assert.ok(d.querySelector('meta#pfa-vis-robots[name="robots"][content="noindex"]'), 'and noindex');
  assert.match(d.title, /^Not available right now/);
  /* The answer changes while the page is open: everything comes back. */
  dom.window.PFA_VISIBILITY.apply({ version: 2, pages: [], modules: [] });
  assert.equal(d.getElementById('pfa-gone'), null);
  assert.equal(d.getElementById('pfa-vis-robots'), null);
  assert.equal(d.title, 'Units | People for Animals');
  assert.equal(d.getElementById('pfa-vis-css').textContent, '');
});

test('in a page: no storage, broken storage or nonsense in storage is nothing hidden, never an error', () => {
  for (const raw of [null, '{', '"x"', '[]', JSON.stringify({ pages: 'units' })]) {
    const dom = new JSDOM(read('laws.html'), { url: 'https://pfa.test/laws', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
    if (raw !== null) dom.window.localStorage.setItem(V.KEY, raw);
    dom.window.eval(visibilityScript().replace(/^<script id="pfa-vis">\n/, '').replace(/\n<\/script>\n$/, ''));
    assert.equal(dom.window.document.getElementById('pfa-vis-css'), null, String(raw));
  }
});

/* ---- chrome.js: the current answer, while the page is open --------------- */

test('chrome.js asks for the current state, keeps it, applies it, and points a menu button past a hidden page', async () => {
  const dom = pageDom('laws.html', null);
  const w = dom.window;
  const asked = [];
  let answer = { version: 5, pages: ['units'], modules: ['laws#part-b'] };
  w.fetch = (url) => {
    asked.push(String(url));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(answer) });
  };
  let told = 0;
  w.addEventListener('pfa:visibility', () => { told += 1; });
  w.eval(read('assets/chrome.js'));
  const settle = () => new Promise((r) => setTimeout(r, 20));
  await settle();
  assert.ok(asked.includes('/api/site-visibility'));
  assert.deepEqual(JSON.parse(w.localStorage.getItem(V.KEY)), { version: 5, pages: ['units'], modules: ['laws#part-b'] }, 'kept for the next page');
  assert.match(w.document.getElementById('pfa-vis-css').textContent, /\[id="part-b"\]/, 'and applied to this one');
  assert.equal(told, 1, 'search is told');
  const ourWork = w.document.querySelector('header.site .navitem > a[data-nav="units.html"]');
  assert.equal(ourWork.getAttribute('href'), 'report.html', 'Our Work leads to the first page in its menu still shown');
  assert.equal(ourWork.getAttribute('data-home'), 'units.html');

  /* An answer that says the setting could not be read changes nothing. */
  answer = { version: 0, pages: [], modules: [], unavailable: true };
  w.dispatchEvent(new w.PageTransitionEvent('pageshow', { persisted: true }));
  await settle();
  assert.equal(JSON.parse(w.localStorage.getItem(V.KEY)).version, 5, 'the last good answer stands');
  assert.equal(ourWork.getAttribute('href'), 'report.html');

  /* Shown again: the button goes home. */
  answer = { version: 6, pages: [], modules: [] };
  w.dispatchEvent(new w.PageTransitionEvent('pageshow', { persisted: true }));
  await settle();
  assert.equal(ourWork.getAttribute('href'), 'units.html');
  assert.equal(w.document.getElementById('pfa-vis-css').textContent, '');
});

/* ---- site search --------------------------------------------------------- */

const REGISTRY = JSON.parse(read('assets/site-modules.json'));
const INDEX = JSON.parse(read('search-index.json'));

/* pfa-search.js booted the way a page boots it: the visibility script first
   (from a stored state), then search, with the crawled index and the
   registry served to it. */
async function searchWith(state) {
  const doc = createDocument('<html><body></body></html>');
  const store = { [V.KEY]: state ? JSON.stringify(state) : null };
  const win = {
    document: doc, location: { search: '', hash: '', pathname: '/index.html', href: 'https://x/', protocol: 'https:' },
    navigator: {}, history: { replaceState() {}, pushState() {} },
    sessionStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, removeEventListener() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1,
    console, JSON, Math, Date, Number, String, Boolean, Array, Object, RegExp, Error, parseInt, parseFloat, isNaN,
    encodeURIComponent, decodeURIComponent, Promise, Map, Set, Intl, URL, URLSearchParams,
    __PFA_SEARCH_INDEX: INDEX,
    fetch: (url) => Promise.resolve(/site-modules\.json/.test(url)
      ? { ok: true, json: () => Promise.resolve(REGISTRY) }
      : { ok: false, json: () => Promise.resolve({}) })
  };
  win.window = win; win.self = win; win.globalThis = win; doc.defaultView = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read('assets/site-visibility.js'), ctx, { filename: 'site-visibility.js' });
  vm.runInContext(read('pfa-search.js'), ctx, { filename: 'pfa-search.js' });
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  return win.PFASearch;
}
const pages = (rows) => rows.map((r) => r.u);

test('search leaves out a hidden page, by page and in every list it keeps', async () => {
  const before = await searchWith(null);
  assert.ok(pages(before.search('unit near me').rows).some((u) => /^units\.html/.test(u)), 'a unit is the answer while units are shown');
  const S = await searchWith({ version: 1, pages: ['units'], modules: [] });
  for (const q of ['unit near me', 'units', 'vet near me', 'guwahati', 'chennai', 'animal hospital']) {
    const got = pages(S.search(q, { limit: 50 }).rows);
    assert.ok(!got.some((u) => /^units\.html/.test(u)), `"${q}" still offers ${got.find((u) => /^units\.html/.test(u))}`);
  }
  assert.ok(!S.complete('find a uni', 10).some((t) => /unit near you/i.test(t)), 'nor completes to it');
  assert.ok(pages(S.search('report cruelty').rows).includes('report.html'), 'everything else is still found');
});

test('search leaves out a hidden section and every result inside it, and only those', async () => {
  const S = await searchWith({ version: 1, pages: [], modules: ['laws#part-a', 'get-involved#membership'] });
  const dogs = pages(S.search('feeding street dogs', { limit: 50 }).rows);
  assert.ok(!dogs.includes('laws.html#a10'), 'a question inside the hidden Dogs part is not offered');
  assert.ok(!dogs.some((u) => /^laws\.html#(a\d+|part-a)$/.test(u)), `nothing from inside it: ${dogs.filter((u) => /^laws\.html#a/.test(u))}`);
  assert.ok(!pages(S.search('become a member').rows).includes('get-involved.html#membership'));
  assert.ok(pages(S.search('volunteer').rows).includes('get-involved.html#volunteer'), 'the journey beside it stays');
  const cattle = pages(S.search('cattle transport', { limit: 50 }).rows);
  assert.ok(cattle.some((u) => /^laws\.html#b\d+$/.test(u)), 'the Cattle part of the same page stays');
});
