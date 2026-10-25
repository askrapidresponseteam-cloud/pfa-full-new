'use strict';

/* The site on a phone, read like an app (owner, 22 Oct 2026: "right now on
   the landing page, there is shop, donate, notification and hamburger menu..
   looks so shitty on mobile screen.. it is distracting.. make it look like
   app on mobile screen").

   At 900px and under: a top bar of the mark, the search and (home page) the
   bell; a tab bar at the foot (Home, Find help, Donate, Shop, Menu); Menu
   opens the sections as a list screen. CineKind keeps its own clean header
   and has no tab bar. Above 900px nothing changes. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const CHROME = require('../scripts/sync-chrome.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SKIP = new Set(['admin.html', 'read.html', 'submission-collage.html']);
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !SKIP.has(f));
const BARE = new Set(['cinekind.html']);

/* a page's own stylesheet is not what is being read here */
const quiet = () => { const v = new VirtualConsole(); v.on('jsdomError', () => {}); return v; };
const tabsOf = (html) => {
  const doc = new JSDOM(html, { virtualConsole: quiet() }).window.document;
  return { doc, bars: doc.querySelectorAll('nav.pfa-tabs'), tabs: [...doc.querySelectorAll('nav.pfa-tabs .pfa-tab')] };
};

test('every page but CineKind has the five tabs, after the header and before the chrome script', () => {
  for (const page of pages) {
    const html = read(page);
    const { doc, bars, tabs } = tabsOf(html);
    if (BARE.has(page)) {
      assert.equal(bars.length, 0, `${page}: no tab bar`);
      assert.doesNotMatch(html.slice(0, html.indexOf('<head')), /data-pfa-tabs/, `${page}: <html> does not claim one`);
      continue;
    }
    assert.equal(bars.length, 1, `${page}: one tab bar`);
    assert.match(html, /<html\b[^>]*\sdata-pfa-tabs[\s>]/, `${page}: <html data-pfa-tabs>`);
    const at = html.indexOf('<nav class="pfa-tabs"');
    assert.ok(at > html.indexOf('</header>') && at < html.indexOf('<script src="assets/chrome.js'), `${page}: between </header> and assets/chrome.js`);
    assert.deepEqual(tabs.map((t) => t.querySelector('.pfa-tab__label').textContent), ['Home', 'Find help', 'Donate', 'Shop', 'Menu'], page);
    assert.deepEqual(tabs.map((t) => t.getAttribute('data-tab')), ['home', 'help', 'donate', 'shop', 'menu'], page);
    const [home, help, donate, shop, menu] = tabs;
    assert.ok(['index.html', '#top'].includes(home.getAttribute('href')), page);
    assert.ok(['units.html', '#top'].includes(help.getAttribute('href')), page);
    assert.ok(['donate.html', '#top'].includes(donate.getAttribute('href')), page);
    assert.ok(['shop.html', '#top'].includes(shop.getAttribute('href')), page);
    assert.ok(donate.querySelector('.pfa-tab__give svg'), `${page}: Donate is the raised circle`);
    assert.ok(shop.querySelector('.pfa-tab__badge'), `${page}: Shop carries the offer's badge`);
    assert.equal(menu.tagName, 'BUTTON', `${page}: Menu is a button`);
    assert.equal(menu.getAttribute('aria-controls'), 'mnav');
    assert.equal(menu.getAttribute('aria-expanded'), 'false');
    tabs.forEach((t) => assert.equal(t.querySelector('svg').getAttribute('aria-hidden'), 'true', `${page}: icons are not read out`));
    assert.ok(doc.querySelector('nav.pfa-tabs').getAttribute('aria-label'));
  }
});

test('the page you are on is the tab marked, and a page that is none of the four marks none', () => {
  const want = { 'index.html': 'home', 'units.html': 'help', 'report.html': 'help', 'donate.html': 'donate', 'shop.html': 'shop' };
  for (const page of pages.filter((p) => !BARE.has(p))) {
    const { tabs } = tabsOf(read(page));
    const on = tabs.filter((t) => t.classList.contains('is-on'));
    const current = tabs.filter((t) => t.getAttribute('aria-current') === 'page');
    if (want[page]) {
      assert.deepEqual(on.map((t) => t.dataset.tab), [want[page]], page);
      assert.deepEqual(current.map((t) => t.dataset.tab), [want[page]], page);
    } else {
      assert.equal(on.length, 0, `${page}: no tab marked`);
      assert.equal(current.length, 0, page);
    }
  }
  /* your own tab goes back to the top; report's goes to the units */
  assert.equal(tabsOf(read('index.html')).tabs[0].getAttribute('href'), '#top');
  assert.equal(tabsOf(read('report.html')).tabs[1].getAttribute('href'), 'units.html');
  assert.equal(CHROME.tabOf('laws.html'), null);
});

test('every page asks to run edge to edge with a paper browser bar, so the tab bar clears an iPhone home bar', () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/, page);
    assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}">/i, page);
  }
});

test('the top bar on a phone is the mark, the search and the bell; on a wide screen the header is as it was', () => {
  const header = read('assets/chrome-header.html');
  assert.match(header, /<a class="appsearch" href="search\.html" data-open-search aria-label="Search the site">/);
  const css = read('assets/chrome.css');
  assert.match(css, /\.pfa-tabs,\.appsearch\{display:none\}/, 'neither shows on a wide screen');
  const phone = css.slice(css.indexOf('.pfa-tabs,.appsearch{display:none}'));
  const block = phone.slice(phone.indexOf('@media (max-width:900px){'));
  assert.match(block, /html\[data-pfa-tabs\] header\.site \.donate,\s*html\[data-pfa-tabs\] header\.site \.shop,\s*html\[data-pfa-tabs\] header\.site \.burger\{display:none!important\}/);
  assert.match(block, /html\[data-pfa-tabs\] \.announce\{display:none!important\}/, 'no announcement strip on a phone');
  assert.match(block, /html\[data-pfa-tabs\] header\.site \.appsearch\{[^}]*display:inline-flex/);
  /* the tab bar: pinned at the foot, the home bar under it, room kept for it */
  assert.match(block, /html\[data-pfa-tabs\]\{--tabbar:calc\(58px \+ env\(safe-area-inset-bottom,0px\)\)\}/);
  assert.match(block, /html\[data-pfa-tabs\] body\{padding-bottom:var\(--tabbar\)\}/);
  assert.match(block, /html\[data-pfa-tabs\] \.pfa-tabs\{position:fixed;left:0;right:0;bottom:0;z-index:50;display:grid/);
  /* it steps aside for a form journey, search and the keyboard */
  assert.match(block, /html\[data-pfa-tabs\] body\.in-flow \.pfa-tabs,\s*html\[data-pfa-tabs\]\.pfa-search-open \.pfa-tabs\{display:none\}/);
  assert.match(block, /html\[data-pfa-tabs\] body\.in-flow\{--tabbar:0px\}/);
  assert.match(block, /html\[data-pfa-tabs\]\.pfa-typing \.pfa-tabs\{transform:translateY\(110%\)\}/);
  /* what a page pins to its foot stands on it */
  assert.match(block, /html\[data-pfa-tabs\] \.toast\{bottom:calc\(var\(--tabbar\) \+ 14px\)\}/);
  assert.match(block, /html\[data-pfa-tabs\] \.bagbtn\{bottom:calc\(var\(--tabbar\) \+ 14px\)\}/);
  /* the menu sits between the two bars, as a list screen */
  assert.match(block, /html\[data-pfa-tabs\] \.mnav\{[^}]*bottom:var\(--tabbar\)/);
  assert.match(block, /html\[data-pfa-tabs\] \.mnav__list\{background:#fff;border-radius:14px/);
  /* the screens that fill a phone's height leave the tab bar its room */
  assert.match(read('index.html'), /--hh:max\(520px,calc\(100svh - var\(--bar,115px\) - var\(--tabbar,0px\)\)\);/);
  assert.match(read('index.html'), /margin-top:var\(--bar,115px\);min-height:var\(--hh\);/, 'the landing hero is that tall');
  assert.match(read('academy.html'), /min-height:calc\(100svh - var\(--tabbar,0px\)\)/);
});

test('CineKind keeps the logo and its menu button, and no tab bar', () => {
  const ck = read('cinekind.html');
  assert.ok(ck.includes('class="burger"'));
  assert.doesNotMatch(ck, /class="pfa-tabs"/);
  assert.equal(CHROME.PAGES['cinekind.html'].bare, true);
});

/* ---- the behaviour, booted ------------------------------------------------- */

function boot(page) {
  const html = read(page);
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => { if (!/Could not parse CSS/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `https://pfa.test/${page}`, pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  w.setInterval = () => 0;
  w.eval(read('assets/chrome.js'));
  return { w, doc: w.document, errors, close: () => w.close() };
}

test('Menu opens the sections as cards of rows, marks itself, and shuts again', () => {
  const { w, doc, errors, close } = boot('laws.html');
  try {
    assert.deepEqual(errors, []);
    const menu = doc.querySelector('.pfa-tabs [data-tab="menu"]');
    const panel = doc.getElementById('mnav');
    assert.ok(panel && panel.hidden, 'the panel is built, and shut');
    menu.click();
    assert.equal(panel.hidden, false);
    assert.equal(menu.getAttribute('aria-expanded'), 'true');
    assert.ok(doc.documentElement.classList.contains('mnav-open'), 'Menu is the marked tab while it is open');
    /* every desktop menu entry is a row, in a card */
    const rows = [...panel.querySelectorAll('.mnav__list a')].map((a) => a.textContent);
    const desktop = [...doc.querySelectorAll('header.site .menu a')].map((a) => a.textContent.trim());
    assert.deepEqual(rows, desktop);
    assert.equal(panel.querySelectorAll('.mnav__group > a').length, 0, 'no row outside a card');
    /* a caption ("Join the tribe") sits between cards, not inside one */
    assert.equal(panel.querySelectorAll('.mnav__list .mnav__sub').length, 0);
    assert.ok(panel.querySelector('.mnav__sub + .mnav__list'));
    /* the page you are on is marked in the list */
    assert.equal(panel.querySelector('a[aria-current="page"]').textContent, 'What the law says');
    menu.click();
    assert.equal(menu.getAttribute('aria-expanded'), 'false');
    assert.ok(!doc.documentElement.classList.contains('mnav-open'));
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  } finally { close(); }
});

test('the tab bar steps aside while a field has the keyboard', async () => {
  const { w, doc, close } = boot('ask.html');
  try {
    const field = doc.querySelector('main textarea, main input[type="text"], main input:not([type])');
    assert.ok(field, 'a field to type in');
    field.focus();
    assert.ok(doc.documentElement.classList.contains('pfa-typing'));
    field.blur();
    await new Promise((r) => w.setTimeout(r, 5));
    assert.ok(!doc.documentElement.classList.contains('pfa-typing'));
    /* a checkbox is not typing */
    const box = doc.createElement('input'); box.type = 'checkbox'; doc.body.appendChild(box);
    box.focus();
    assert.ok(!doc.documentElement.classList.contains('pfa-typing'));
  } finally { close(); }
});
