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
  /* two books (owner, 10 Nov 2026: "add orange dogs - book"), each with Buy on Amazon */
  const books = [...doc.querySelectorAll('#book .mp-bk')];
  assert.deepEqual(books.map((b) => b.querySelector('h3').textContent), ['Animals', 'Orange Dogs']);
  assert.deepEqual(books.map((b) => b.querySelector('a.btn').getAttribute('href')),
    ['https://www.amazon.in/Animals-Raghu-Rai/dp/9373070878?th=1', 'https://www.amazon.in/dp/9334516496']);
  for (const b of books) {
    const buy = b.querySelector('a.btn');
    assert.equal(buy.textContent.trim(), 'Buy on Amazon');
    assert.equal(buy.getAttribute('target'), '_blank');
    assert.equal(buy.getAttribute('rel'), 'noopener noreferrer');
  }
  assert.match(books[1].querySelector('.eyebrow').textContent, /Deepak Virwani/);
});

test('each book shows its real cover, whole, from this site (owner, 10 Nov 2026)', () => {
  const imgs = [...doc.querySelectorAll('#book .mp-bk__cover img')];
  assert.deepEqual(imgs.map((i) => i.getAttribute('data-still')), ['media/picks/animals-raghu-rai-cover.jpg', 'media/picks/orange-dogs-cover.jpg']);
  assert.deepEqual(imgs.map((i) => i.getAttribute('alt')), ['The cover of Animals by Raghu Rai and Maneka Gandhi', 'The cover of Orange Dogs by Deepak Virwani']);
  assert.match(html, /\.mp-bk__cover\.has-cover img\{display:block;width:100%;height:auto;/, 'at its own shape: never cut or stretched');
  assert.match(html, /img\.addEventListener\('load', function \(\) \{ box\.classList\.add\('has-cover'\); \}\);/, 'shown only once it has arrived');
  const { BOOKS, coverFromAmazon } = require('../scripts/fetch-founder-films.js');
  assert.deepEqual(BOOKS.map((b) => path.relative(ROOT, b.out)), imgs.map((i) => path.join(...i.getAttribute('data-still').split('/'))), 'npm run media:films fetches the very files the page asks for');
  for (const b of BOOKS) assert.match(b.image, /^https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+-]+\.jpg$/, `${b.title}: the original cover, not a thumbnail`);
  assert.equal(coverFromAmazon('"hiRes":"https://m.media-amazon.com/images/I/81abc._SL1500_.jpg"'), 'https://m.media-amazon.com/images/I/81abc.jpg');
  assert.equal(coverFromAmazon('<html>a check page</html>'), null);
  assert.match(doc.querySelector('#book .mp-bk p:not(.eyebrow)').textContent, /introduction by Maneka Gandhi/);
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

test('her photograph in the amber visor, whole, and the visor filled with the film as jjettas.com does it (owner, 10 Nov 2026)', () => {
  /* "implement ditto", "not even 1 pixel should flow out", "goal is to play the video perfectly" */
  const img = doc.querySelector('#mpRoom img.mp-photo');
  assert.equal(img.getAttribute('src'), 'media/picks/portrait-visor.jpg');
  assert.equal(img.getAttribute('width'), '2576');
  assert.equal(img.getAttribute('height'), '2113');
  for (const gone of ['portrait.webp', 'portrait-glasses.jpg', 'lens-l-mask.png', 'lens-r-mask.png']) assert.ok(!fs.existsSync(path.join(ROOT, 'media/picks', gone)), gone);
  assert.match(html, /\.mp-room\{position:relative;width:100%;aspect-ratio:2576\/2113;/, 'the photograph at its own shape');
  const lens = doc.querySelector('#mpLens.mp-lens');
  for (const part of ['.mp-lens__still', '.mp-lens__film', '.mp-lens__tone', '.mp-lens__grille', '.mp-lens__shine']) assert.ok(lens.querySelector(part), part);
  assert.match(html, /\.mp-lens\{[^}]*mask-image:url\("media\/picks\/visor-mask\.png"\)/, 'masked to the amber glass');
  for (const f of ['visor-mask.png', 'visor-shine.png', 'visor-frame.png', 'portrait-visor.jpg']) assert.ok(fs.existsSync(path.join(ROOT, 'media/picks', f)), f);
  /* the visor box, in percent of the photograph: 906 to 1676 across, 644 to 918 down */
  const pct = (re) => Number(re.exec(html)[1]) / 100;
  const W = 2576, H = 2113;
  const box = { l: pct(/\.mp-lens\{[^}]*left:([\d.]+)%/) * W, t: pct(/\.mp-lens\{[^}]*top:([\d.]+)%/) * H, w: pct(/\.mp-lens\{[^}]*width:([\d.]+)%/) * W, h: pct(/\.mp-lens\{[^}]*height:([\d.]+)%/) * H };
  assert.ok(Math.abs(box.l - 906) < 0.5 && Math.abs(box.t - 644) < 0.5 && Math.abs(box.w - 770) < 0.5 && Math.abs(box.h - 274) < 0.5, JSON.stringify(box));
  /* the mask is exactly the box's size, so it lands on the glass it was read from */
  for (const f of ['visor-mask.png', 'visor-frame.png', 'visor-shine.png']) {
    const png = fs.readFileSync(path.join(ROOT, 'media/picks', f));
    assert.equal(png.readUInt32BE(16), 770, f);
    assert.equal(png.readUInt32BE(20), 274, f);
  }
  /* the frame laid back over the film, outside the film's mask and on the
     same box, so the film ends on its drawn edge and no amber is left at it */
  const frame = lens.nextElementSibling;
  assert.equal(frame.className, 'mp-frame');
  assert.equal(frame.getAttribute('src'), 'media/picks/visor-frame.png');
  for (const k of ['left', 'top', 'width', 'height']) {
    assert.equal(new RegExp(`\\.mp-frame\\{[^}]*${k}:([\\d.]+)%`).exec(html)[1], new RegExp(`\\.mp-lens\\{[^}]*${k}:([\\d.]+)%`).exec(html)[1], k);
  }
  assert.match(html, /\.mp-frame\{[^}]*z-index:3;/);
  assert.match(html, /\.mp-room\.has-still \.mp-frame,\.mp-room\.is-playing \.mp-frame\{opacity:1\}/);
  assert.match(read('scripts/build-visor-mask.py'), /assert not \(through\[~shadowed\] > 0\)\.any\(\), 'the film shows on the frame'/);
  /* the film covers the visor: 16:9 as wide as the box, centred down it */
  const filmH = pct(/\.mp-lens__film,\.mp-lens__still\{[^}]*height:([\d.]+)%/) * box.h;
  const filmTop = -pct(/\.mp-lens__film,\.mp-lens__still\{[^}]*top:-([\d.]+)%/) * box.h;
  assert.ok(Math.abs(box.w / filmH - 16 / 9) < 0.01, `16:9, not ${box.w / filmH}`);
  assert.ok(Math.abs(filmTop + (filmH - box.h) / 2) < 0.5, 'centred');
  assert.match(html, /\.mp-lens__shine\{display:block;mix-blend-mode:screen\}/, 'the visor\'s reflections over the film');
  assert.match(html, /\.mp-lens__grille\{background:repeating-linear-gradient/);
});

test('the trailer in the visor is the theatre\'s, built only when Play is pressed', () => {
  const js = read('assets/theatre.js');
  assert.match(js, /function lens\(host, film, opts\)\{/);
  assert.match(js, /var hosts = \[\]\.concat\(host\)\.filter\(Boolean\);/);
  assert.match(js, /'\?autoplay=1&mute=' \+ \(n \|\| muted \? 1 : 0\)/, 'the first lens has the sound, the other follows muted');
  assert.match(js, /tell\(frames\[k\], 'seekTo', \[at\[0\] \+ 0\.1, true\]\)/, 'and is kept to its moment');
  assert.match(js, /window\.PFA_THEATRE\.lens = lens;\n\}\(\)\);\s*$/, 'still there after a page mounts its theatre');
  assert.match(js, /window\.PFA_THEATRE\.mount = mount;\n {4}window\.PFA_THEATRE\.lens = lens;/);
  assert.match(js, /var muted = !!opts\.muted \|\| ios;/, 'an iPhone starts it muted, as the theatre does');
  assert.match(html, /hosts = \[\$\('mpFilm'\)\]/);
  assert.match(html, /lens = lensOf\(hosts, FILMS\[cur\]\);/);
});

test('npm run media:films fetches its stills', () => {
  const { PAGES, filmsFromPage } = require('../scripts/fetch-founder-films.js');
  const own = PAGES.find((t) => t.page.endsWith('manekas-picks.html'));
  assert.ok(own && own.out.endsWith(path.join('media', 'picks-films')));
  assert.deepEqual(filmsFromPage(html).map((f) => f.id), FILMS.map((f) => f.yt));
});

test('nothing on the photograph moves until Play is pressed, so there is nothing to pause', () => {
  assert.doesNotMatch(html, /setInterval|requestAnimationFrame/);
  const controls = [...doc.querySelectorAll('.mp-ctl')].map((b) => b.textContent.trim());
  assert.deepEqual(controls, ['Play in her glasses', 'Sound: On', 'Next film', 'Full screen', 'Stop']);
});

test('at rest the visor carries the film\'s still the same way, once it is on this site', () => {
  assert.equal(doc.querySelectorAll('[data-lens-still]').length, 1);
  assert.match(html, /\.mp-room\.has-still \.mp-lens,\.mp-room\.is-playing \.mp-lens\{opacity:1\}/, 'until then the photograph\'s own glass is seen');
  assert.match(html, /probe\.onload = function \(\) \{\n\s*if \(FILMS\[cur\]\.poster !== url\) return;/);
});
