'use strict';

/* The phone, second pass (owner, 22 Oct 2026: "fix the whole mobile site..
   comprehesively. first address- menu isnt loading properly on mobile. search
   also has to be working perfectly. and cinekind page as well needs to be
   fixed the image at the top of cinekind landing page isnt proper (above
   trophy, the clouds look distorted)"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const V = require('../assets/site-visibility.js').PFA_VISIBILITY;

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SKIP = new Set(['admin.html', 'read.html', 'submission-collage.html']);
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !SKIP.has(f));

function dom(html, url) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => { if (!/Could not parse CSS|Not implemented: navigation/.test(e.message)) errors.push(e.message); });
  const d = new JSDOM(html, { runScripts: 'outside-only', url, pretendToBeVisual: true, virtualConsole: vc });
  d.window.setInterval = () => 0;
  return { w: d.window, doc: d.window.document, errors };
}

/* ---- the menu ------------------------------------------------------------ */

test('with a page hidden in the panel, the phone menu still lists everything else (it opened empty)', () => {
  /* The menu's rows sit in cards now; the hiding rules were written for rows
     straight under each group, so one hidden page hid every group. */
  const { css } = V.plan({ pages: ['achievements'], modules: [] }, 'laws');
  const { w, doc, errors } = dom(read('laws.html'), 'https://pfa.test/laws.html');
  w.eval(read('assets/chrome.js'));
  assert.deepEqual(errors, []);
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.appendChild(style);
  const panel = doc.getElementById('mnav');
  const shown = (el) => w.getComputedStyle(el).display !== 'none';
  const groups = [...panel.querySelectorAll('.mnav__group')].filter(shown);
  assert.equal(groups.length, 4, 'all four sections');
  const rows = [...panel.querySelectorAll('.mnav__list a')].filter(shown).map((a) => a.textContent);
  assert.ok(!rows.includes('Policies and achievements'), 'the hidden page is not offered');
  assert.ok(rows.includes('Units: find help near you') && rows.includes('Contact'));
  assert.equal(rows.length, 23, 'every other link (Virtual internship joined on 31 Oct 2026)');
  /* a card left with nothing, and its caption, go */
  const all = V.plan({ pages: ['campaign', 'legacy', 'csr'] }, 'laws').css;
  const style2 = doc.createElement('style'); style2.textContent = all; doc.head.appendChild(style2);
  const give = [...panel.querySelectorAll('.mnav__sub')].find((p) => p.textContent === 'Give and partner');
  assert.equal(w.getComputedStyle(give).display, 'none', 'the caption over an emptied card');
  assert.equal(w.getComputedStyle(give.nextElementSibling).display, 'none', 'the emptied card');
});

test('a hidden page keeps the phone tab bar, so there is a way on', () => {
  const { css } = V.plan({ pages: ['units'] }, 'units');
  assert.match(css, /body>:not\(\.announce\):not\(header\):not\(\.pfa-tabs\)/);
});

test('the menu has its own ground, so its white cards show on pages whose stone is white', () => {
  const css = read('assets/chrome.css');
  assert.match(css, /html\[data-pfa-tabs\] \.mnav\{[^}]*background:#f1f0ed;/);
  assert.doesNotMatch(css, /html\[data-pfa-tabs\] \.mnav\{[^}]*var\(--stone/);
});

test('Back closes the menu, and the menu\'s step does not linger in the history', () => {
  const { w, doc, errors } = dom(read('laws.html'), 'https://pfa.test/laws.html');
  w.eval(read('assets/chrome.js'));
  assert.deepEqual(errors, []);
  const menu = doc.querySelector('.pfa-tabs [data-tab="menu"]');
  const panel = doc.getElementById('mnav');
  const length = w.history.length;
  menu.click();
  assert.equal(panel.hidden, false);
  assert.equal(w.history.state && w.history.state.pfaMenu, 1, 'opening adds a step');
  assert.equal(w.history.length, length + 1);
  w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
  assert.ok(!doc.documentElement.classList.contains('mnav-open'), 'Back shuts it');
  const src = read('assets/chrome.js');
  assert.match(src, /location\.replace\(a\.href\)/, 'a row chosen replaces the step');
  assert.match(src, /window\.addEventListener\('pageshow', function \(\) \{ close\(false, true\); \}\);/, 'coming back to the page does not walk the history');
});

/* ---- search -------------------------------------------------------------- */

test('every page has the search overlay, so the search button opens it everywhere', () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /<script src="\/?pfa-search\.js" defer><\/script>/, `${page}: pfa-search.js`);
    assert.match(html, /<link rel="stylesheet" href="\/?pfa-search\.css">/, `${page}: pfa-search.css`);
  }
});

function bootSearch() {
  const { w, doc, errors } = dom('<!doctype html><html><head></head><body><header class="site"><a class="appsearch" href="search.html" data-open-search>Search</a></header><main id="top"></main></body></html>', 'https://pfa.test/laws.html');
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(read('pfa-search.js'));
  doc.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { w, doc, errors };
}

test('the search box takes the caret in the tap itself, so an iPhone raises the keyboard', () => {
  const { w, doc, errors } = bootSearch();
  const raf = w.requestAnimationFrame;
  let frames = 0;
  w.requestAnimationFrame = (fn) => { frames += 1; return raf.call(w, fn); };
  doc.querySelector('[data-open-search]').click();
  assert.equal(doc.activeElement && doc.activeElement.id, 'pfa-q', 'focused before any frame has run');
  assert.ok(frames >= 0);
  assert.deepEqual(errors, []);
  assert.doesNotMatch(read('pfa-search.js'), /requestAnimationFrame\(function \(\) \{ overlay\.classList\.add\('is-open'\); input\.focus\(\)/);
});

test('Back closes search; Close takes its step away; a result replaces it', () => {
  const { w, doc } = bootSearch();
  const length = w.history.length;
  doc.querySelector('[data-open-search]').click();
  assert.ok(doc.documentElement.classList.contains('pfa-search-open'));
  assert.equal(w.history.state && w.history.state.pfaSearch, 1);
  assert.equal(w.history.length, length + 1);
  w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
  assert.ok(!doc.documentElement.classList.contains('pfa-search-open'), 'Back shuts it');
  const src = read('pfa-search.js');
  assert.match(src, /location\.replace\(url\)/, 'leaving for a result replaces the step');
  assert.match(src, /if \(pushed\) \{ e\.preventDefault\(\); to\('search\.html\?q=' \+ encodeURIComponent\(q\)\); \}/, 'and so does the results page');
});

/* ---- CineKind -------------------------------------------------------------- */

function fragmentShader() {
  const html = read('cinekind.html');
  const at = html.indexOf('var fragment=');
  return html.slice(at, html.indexOf('`;', at));
}

test('the CineKind sky is never smeared: the camera stays inside the photograph', () => {
  const f = fragmentShader();
  /* the room the window has, and every move clamped to it */
  assert.match(f, /vec2 room=max\(vec2\(0\.\),\.5-span-\.001\);/);
  assert.match(f, /vec2 uv=\(screen-\.5\)\*fit\/zoom\+\.5\+clamp\(shift,-room,room\);/);
  assert.doesNotMatch(f, /uv\.y-=\.04/, 'no shift past the top edge any more');
  /* worked through for a phone (390 x 844) and the 1557 x 1010 photograph:
     every sample lands inside it at every moment, scroll and pointer */
  const aspect = 390 / 844, imageAspect = 1557 / 1010;
  const fit = [Math.min(1, aspect / imageAspect), Math.min(1, imageAspect / aspect)];
  for (const time of [0, 1, 5, 30, 300]) {
    for (const travel of [0, 0.5, 1]) {
      const zoom = 1.035 + Math.exp(-time * 0.8) * 0.075 + travel * 0.19;
      const span = fit.map((x) => 0.5 * x / zoom);
      const room = span.map((s) => Math.max(0, 0.5 - s - 0.001));
      const shift = [Math.sin(time * 0.18) * 0.003 + 0.5 * 0.009, Math.cos(time * 0.14) * 0.002 + 0.5 * 0.006 + (1 - fit[1]) * (0.5 - 0.5) - (0.04 + travel * 0.022)];
      const s = shift.map((v, i) => Math.max(-room[i], Math.min(room[i], v)));
      for (const edge of [0, 1]) {
        for (const i of [0, 1]) {
          const uv = (edge - 0.5) * fit[i] / zoom + 0.5 + s[i];
          assert.ok(uv >= 0 && uv <= 1, `t=${time} travel=${travel} axis ${i} edge ${edge}: ${uv}`);
        }
      }
    }
  }
});

test('the CineKind scene asks for full precision where the phone has it, and uses no reserved word', () => {
  const html = read('cinekind.html');
  assert.match(html, /getShaderPrecisionFormat\(gl\.FRAGMENT_SHADER,gl\.HIGH_FLOAT\)/);
  assert.match(html, /var fragment=\(hp\?'precision highp float;':'precision mediump float;'\)\+`/);
  /* GLSL ES 1.00 reserves these; one as a name stops the shader compiling,
     and the page falls back to the still photograph */
  const RESERVED = ['half', 'fixed', 'input', 'output', 'sizeof', 'cast', 'namespace', 'using', 'long', 'short', 'double', 'unsigned', 'superp', 'flat', 'packed', 'filter', 'sample', 'class', 'union', 'enum', 'template', 'this', 'goto', 'switch', 'default', 'inline', 'volatile', 'public', 'static', 'extern', 'external', 'interface'];
  const f = fragmentShader();
  for (const word of RESERVED) assert.doesNotMatch(f, new RegExp(`\\b(?:float|vec2|vec3|vec4|int)\\s+${word}\\b`), `"${word}" is reserved in GLSL ES`);
});

/* ---- the footer -------------------------------------------------------------- */

test('the footer\'s numbers, email and social links are thumb-sized on a phone, without moving a line', () => {
  const css = read('assets/chrome.css');
  assert.match(css, /@media \(pointer:coarse\),\(max-width:719px\)\{\s*\.pfa-footer__where a,\.pfa-footer__social a,\.pfa-flow-bar__help\{position:relative\}/);
  assert.match(css, /\.pfa-footer__where a::after,\.pfa-flow-bar__help::after\{content:"";position:absolute;left:-4px;right:-4px;top:-12px;bottom:-12px\}/);
  assert.match(css, /\.pfa-footer__social a::after\{content:"";position:absolute;left:-10px;right:-10px;top:-6px;bottom:-6px\}/);
});

/* ---- words on faces ---------------------------------------------------------- */

/* Owner, 22 Oct 2026: "on mobile screens the limited edition label is sitting
   on people's faces in the shop section., can you fix this.. fix these kinda
   issues comprehensively". Every page was photographed at 360, 390, 768 and
   1440 wide with the words over each picture hidden, faces were found in
   what was under them, and the words that sat on a face were moved. */

test('shop: the edition label is over the name, never on the photograph', () => {
  const doc = new JSDOM(read('shop.html')).window.document;
  const items = [...doc.querySelectorAll('article.item')];
  assert.ok(items.length >= 15);
  assert.equal(doc.querySelectorAll('.item__media .item__tag').length, 0, 'no label inside a picture');
  const tagged = items.filter((it) => it.querySelector('.item__tag'));
  assert.ok(tagged.length >= 15);
  tagged.forEach((it) => {
    const tag = it.querySelector('.item__tag');
    assert.ok(tag.parentElement.classList.contains('item__bd'), `${it.id}: in the card's words`);
    assert.ok(tag.nextElementSibling && tag.nextElementSibling.classList.contains('item__name'), `${it.id}: just over the name`);
  });
  assert.doesNotMatch(read('shop.html'), /\.item__tag\{position:absolute/);
});

test('CineKind: on a phone the honours cards carry the award and name under the photograph', () => {
  const html = read('cinekind.html');
  const at = html.indexOf('.honours .roll li{aspect-ratio:auto;display:flex;flex-direction:column}');
  assert.ok(at > 0);
  const block = html.slice(html.lastIndexOf('@media (max-width:1100px){', at), html.indexOf('}\n}', at) + 3);
  assert.match(block, /\.honours \.roll \.n\{position:static/, 'the number too');
  assert.match(block, /\.honours \.roll \.cap\{position:static/);
  assert.match(block, /\.honours \.roll li::after\{display:none\}/, 'and the photograph is not darkened');
});

test('Newsroom: on a phone a photograph tile shows the photograph whole, then its headline', () => {
  const html = read('newsroom.html');
  const at = html.indexOf('.nr-tile--photo .nr-tile__img{position:relative;inset:auto;aspect-ratio:4/3}');
  assert.ok(at > 0);
  assert.ok(html.lastIndexOf('@media (max-width:900px){', at) > at - 200, 'to 900px wide');
  assert.match(html, /\.nr-tile--photo \.nr-tile__body\{padding:16px 18px 20px;background:none\}/);
});

/* ---- marks in the middle ------------------------------------------------------ */

/* Owner, 23 Oct 2026, two screenshots: "why that black line below units. we
   dont need that things. it looks odd. seems like a bug. fix it .that +
   inside the circle is not perfectly centered. we can never have such silly
   mistakes anywhere on the site pls". */

test('the menu opens with the panel focused, not its first row, so no focus ring is cut to a line', () => {
  const js = read('assets/chrome.js');
  assert.match(js, /panel\.setAttribute\('tabindex', '-1'\)/);
  assert.match(js, /panel\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(js, /first\.focus\(\{ preventScroll: true \}\)/);
  const css = read('assets/chrome.css');
  assert.match(css, /\.mnav:focus,\.mnav:focus-visible\{outline:none\}/);
  assert.match(css, /html\[data-pfa-tabs\] \.mnav__list a:focus-visible\{outline:2px solid var\(--ink,#111\);outline-offset:-4px/, 'a keyboard ring sits inside the row');
  const { w, doc } = dom(read('units.html'), 'https://pfa.test/units.html');
  w.eval(read('assets/chrome.js'));
  doc.querySelector('.pfa-tabs [data-tab="menu"]').click();
  assert.equal(doc.activeElement, doc.getElementById('mnav'));
});

test('no plus, minus, cross, arrow or chevron in a button is a typed character: each is drawn from the middle', () => {
  /* A character sits where its font puts it, a pixel or two off the middle
     of its circle or square. Drawn (two bars from the centre, or an SVG
     drawn about the centre of its box), it is in the middle by construction.
     Measured on every page at 390 and 1440 wide, at 3x. */
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !SKIP.has(f))
    .concat(['assets/chrome.css', 'assets/micro.css', 'pfa-search.css', 'pfa-search.js', 'assets/shop.js', 'scripts/sync-chrome.js', 'scripts/build-events.js']);
  const TYPED = [
    [/content:"[+\u00d7\u2715\u2212]"/, 'a pseudo-element typing a plus, cross or minus'],
    [/content:"\\2212"/, 'a typed minus (a dash to the eye, too)'],
    [/>[+\u00d7\u2715\u2212\u2192\u2190\u203a\u2039]<\/(?:button|span)>/, 'a button or span holding a typed mark'],
    [/&(?:rsaquo|lsaquo|minus|#10005|times);<\/(?:button|span)>/, 'an entity typed as a mark'],
    [/\\u2715<\/button>|\\u2212' : '\+'|el\('button', (?:null|'[^']*'), '[-+]'\)/, 'a script typing a mark'],
    [/<button type="submit" aria-label="Search">\u2192<\/button>/, 'the search arrow typed']
  ];
  const bad = [];
  for (const f of files) {
    const s = read(f);
    for (const [re, what] of TYPED) if (re.test(s)) bad.push(`${f}: ${what}`);
  }
  assert.deepEqual(bad, []);
  /* and the circles that carry them draw them from their centre, in 2px
     bars that land on whole pixels (28 Oct 2026) */
  assert.match(read('lab-animal-rules.html'), /\.lab-more summary::after\{content:"";[^}]*background:linear-gradient\(currentColor,currentColor\) center\/12px 2px no-repeat,linear-gradient\(currentColor,currentColor\) center\/2px 12px no-repeat/);
  assert.match(read('units.html'), /\.u-fold\{[^}]*background:linear-gradient\(currentColor,currentColor\) center\/12px 2px no-repeat/);
  /* the bell's ink runs 2 to 22 of its 24, the middle of its button */
  assert.match(read('scripts/sync-chrome.js'), /<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"\/><path d="M10 22h4M12 3V2"\/>/);
});
