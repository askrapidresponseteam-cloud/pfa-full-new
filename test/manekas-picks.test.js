'use strict';
/* Maneka's Picks (owner, 9 Nov 2026): "maneka's picks has to go perfectly
   with this website. find the best place and append the link.. the theme
   should match with the website", then "find the right trailer for each and
   render within the specs perfectly. and have the right hyperlinks to watch
   from the OTT. and there should be buy book from amazon link as well..".

   These hold what was checked that day: each film's trailer is its own (the
   publisher was read from YouTube), each film links to the service it
   streams on, the book links to Amazon, the page is reached from About and
   from the founder's films, and the trailer in the glasses is built by the
   theatre, never by the page. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('manekas-picks.html');
const doc = new JSDOM(html).window.document;

const FILMS = [
  { title: 'Test Subject V', yt: 'jvTxVAMrgGA', watch: 'https://www.hotstar.com/in/movies/test-subject-v/1271666270', on: 'JioHotstar' },
  { title: 'Oslo: A Tail of Promise', yt: 'Y4ftPP5XnAk', watch: 'https://tv.apple.com/in/movie/oslo---a-tail-of-promise/umc.cmc.1bftumclcvzdtx1o623j0aocg', on: 'Apple TV' },
  /* the 2026 Hindi film on Netflix, not the 2022 Tamil "Oh My Dog" (b4SqEAAh-_s) the first draft carried */
  { title: 'Ohh My Dog', yt: 'Hkv1-F5-EaI', watch: 'https://www.netflix.com/in/title/83197638', on: 'Netflix' }
];

test('each film plays its own trailer, in the theatre, with a still from this site', () => {
  for (const f of FILMS) {
    assert.match(html, new RegExp(`title:'${f.title}'[^}]*yt:'${f.yt}', poster:'media/picks-films/${f.yt}\\.jpg'`), f.title);
  }
  assert.doesNotMatch(html, /b4SqEAAh-_s|YEENqLBLiBU/, 'the wrong Ohh My Dog, and Oslo\'s short in place of its teaser');
  assert.match(html, /<script src="assets\/theatre\.js"><\/script>/);
  assert.match(html, /PT\.mount\(\{/);
  assert.doesNotMatch(html, /i\.ytimg\.com|youtube(?:-nocookie)?\.com\/(?:embed|watch|iframe_api)/, 'nothing reaches YouTube from the page itself');
});

test('each film links to the service it streams on, and the book to Amazon', () => {
  const tiles = [...doc.querySelectorAll('.mp-film')];
  assert.equal(tiles.length, 3);
  tiles.forEach((li, i) => {
    const f = FILMS[i];
    assert.equal(li.querySelector('h3').textContent, f.title);
    const a = li.querySelector('a.btn');
    assert.equal(a.getAttribute('href'), f.watch);
    assert.equal(a.textContent.trim(), `Watch on ${f.on}`);
    assert.equal(a.getAttribute('target'), '_blank');
    assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
    const play = li.querySelector('button.mp-shot');
    assert.equal(play.getAttribute('data-film'), String(i), 'a tile is a button that opens the theatre');
  });
  const buy = doc.querySelector('#book a.btn');
  assert.equal(buy.getAttribute('href'), 'https://www.amazon.in/Animals-Raghu-Rai/dp/9373070878?th=1');
  assert.equal(buy.textContent.trim(), 'Buy on Amazon');
  assert.equal(doc.querySelector('#book h3').textContent, 'Animals');
});

test('the page is the site\'s: its header, title block, faces and footer', () => {
  const h1 = doc.querySelectorAll('main h1');
  assert.equal(h1.length, 1);
  assert.ok(h1[0].classList.contains('pfa-title'));
  assert.ok(h1[0].previousElementSibling.classList.contains('pfa-kicker'));
  assert.match(html, /<link rel="stylesheet" href="assets\/pfa-theme\.css">/);
  assert.match(html, /\.mp-hero\{[^}]*padding:calc\(var\(--ann\) \+ var\(--nav\) \+ 72px\)/);
  assert.ok(doc.querySelector('header.site nav[aria-label="Main navigation"]'));
  assert.ok(doc.querySelector('footer.pfa-footer'));
  assert.doesNotMatch(html, /Kalam|Impact|Arial Black|;base64,/, 'no face but the site\'s, nothing inlined');
});

test('it is reached from About, the footer and the founder\'s films', () => {
  assert.match(read('assets/chrome-header.html'), /\{\{CURRENT:founder\.html\|The founder\}\}\n\s*\{\{CURRENT:manekas-picks\.html\|Maneka’s Picks\}\}/);
  assert.match(read('assets/chrome-footer.html'), /<a href="founder\.html">Founder<\/a><\/li>\n\s*<li><a href="manekas-picks\.html">Maneka’s Picks<\/a>/);
  assert.match(read('founder.html'), /<a class="watch__picks" href="manekas-picks\.html">/);
  const { PAGES } = require('../scripts/sync-chrome.js');
  assert.deepEqual(PAGES['manekas-picks.html'], { current: 'manekas-picks.html', group: 'founder.html', announce: 'Every drive, camp and open day is free to attend' });
});

test('the glasses: one fit for the portrait and the rim drawn over the film', () => {
  const fit = 'translate(777 319) rotate(-1.4) scale(2.59) translate(-85 -2)';
  assert.equal(doc.getElementById('mpVisor').getAttribute('transform'), fit);
  assert.equal(doc.querySelector('.mp-rim > g').getAttribute('transform'), fit);
  assert.equal(doc.querySelector('.mp-face').getAttribute('viewBox'), doc.querySelector('.mp-rim').getAttribute('viewBox'));
  assert.equal(doc.querySelector('.mp-face').getAttribute('preserveAspectRatio'), doc.querySelector('.mp-rim').getAttribute('preserveAspectRatio'));
  assert.ok(fs.existsSync(path.join(ROOT, 'media/picks/portrait.webp')));
  /* the film is cut to the outline itself, measured on every resize */
  assert.match(html, /glass\.getPointAtLength\(len \* i \/ N\)/);
  assert.match(html, /new ResizeObserver\(place\)\.observe\(room\)/);
});

test('the trailer in the glasses is the theatre\'s, built only when Play is pressed', () => {
  const js = read('assets/theatre.js');
  assert.match(js, /function lens\(host, film, opts\)\{/);
  assert.match(js, /window\.PFA_THEATRE\.lens = lens;\n\}\(\)\);\s*$/, 'still there after a page mounts its theatre');
  assert.match(js, /window\.PFA_THEATRE\.mount = mount;\n {4}window\.PFA_THEATRE\.lens = lens;/);
  assert.match(js, /var muted = !!opts\.muted \|\| ios;/, 'an iPhone starts it muted, as the theatre does');
  assert.match(html, /lens = lensOf\(host, FILMS\[cur\]\);/);
});

test('npm run media:films fetches its stills and the lens\'s frames', () => {
  const { PAGES, filmsFromPage } = require('../scripts/fetch-founder-films.js');
  const own = PAGES.find((t) => t.page.endsWith('manekas-picks.html'));
  assert.ok(own && own.frames && own.out.endsWith(path.join('media', 'picks-films')));
  assert.deepEqual(filmsFromPage(html).map((f) => f.id), FILMS.map((f) => f.yt));
});

test('no pause button: the glasses stand still on hover, on focus and for reduced motion', () => {
  assert.match(html, /room\.addEventListener\('pointerenter', function \(\) \{ held = true; \}\);/);
  assert.match(html, /room\.addEventListener\('focusin', function \(\) \{ held = true; \}\);/);
  assert.match(html, /function still\(\)\{ return held \|\| !seen \|\| lens \|\| reduce\.matches/);
});
