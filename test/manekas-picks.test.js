'use strict';
/* Maneka's Picks (owner, 9 Nov 2026): "maneka's picks has to go perfectly
   with this website. find the best place and append the link.. the theme
   should match with the website", then "find the right trailer for each and
   render within the specs perfectly. and have the right hyperlinks to watch
   from the OTT. and there should be buy book from amazon link as well..".

   These hold what was checked that day: each film's trailer is its own (the
   publisher was read from YouTube), each film links to the service it
   streams on, the book links to Amazon, the page is reached from About and
   from the founder's films, every trailer is played by the theatre, never by
   the page, and the page opens quietly on her photograph (11 Nov 2026). */
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

test('the page opens quietly: the title, and her photograph whole beside it (owner, 11 Nov 2026)', () => {
  /* "any toned down version. maneka madam is a well known public figure", choosing a quiet portrait */
  const hero = doc.querySelector('main > section#top.mp-hero');
  assert.ok(hero, 'the opening');
  assert.ok(hero.querySelector('.mp-hero__text > h1.pfa-title + p.mp-hero__role + .mp-acts'), 'the site\'s title block, its line and its buttons');
  assert.deepEqual([...hero.querySelectorAll('.mp-acts a.btn')].map((a) => [a.textContent.trim(), a.getAttribute('href')]),
    [['See the films', '#films'], ['See the books', '#book']]);
  /* her photograph whole, at its own shape, under the header: never cut, masked or stretched */
  const img = hero.querySelector('figure.mp-portrait > img#mpPortrait');
  assert.equal(img.getAttribute('src'), 'media/picks/portrait.jpg');
  assert.equal(img.getAttribute('width'), '2770');
  assert.equal(img.getAttribute('height'), '2272');
  const jpg = fs.readFileSync(path.join(ROOT, 'media/picks/portrait.jpg'));
  let at = 2; let size = null;
  while (at < jpg.length) { const m = jpg[at + 1]; const len = jpg.readUInt16BE(at + 2); if (m >= 0xc0 && m <= 0xc2) { size = [jpg.readUInt16BE(at + 7), jpg.readUInt16BE(at + 5)]; break; } at += 2 + len; }
  assert.deepEqual(size, [2770, 2272], 'the file is the size the page says, so it is never stretched');
  assert.equal(img.getAttribute('alt'), 'Smt. Maneka Sanjay Gandhi, a black and white photograph');
  /* without the generated texture, as a high-resolution camera records it (owner, 11 Nov 2026), made again from the original kept out of the site */
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/source/portrait-sunglasses-original.png')), 'the original, to make it again from');
  assert.match(read('scripts/retouch-portrait-sunglasses.py'), /OUT = ROOT \/ 'media' \/ 'picks' \/ 'portrait\.jpg'/);
  assert.match(read('scripts/retouch-portrait-sunglasses.py'), /resize\(\(W \* 2, H \* 2\), Image\.LANCZOS\)/, 'scaled whole, never stretched');
  assert.match(html, /\.mp-portrait img\{display:block;width:100%;height:auto;/, 'scaled, never stretched or cut');
  assert.equal(hero.querySelector('figcaption b').textContent, 'Smt. Maneka Sanjay Gandhi');
  assert.match(html, /\.mp-hero\{[^}]*padding:calc\(var\(--ann\) \+ var\(--nav\) \+ 72px\) var\(--gutter\) 64px\}/, 'under the header, as every page opens');
  /* nothing over her, nothing moving */
  assert.doesNotMatch(html, /mp-lens|mp-room|mp-type|mp-card|mp-scene|mask-image|portrait-cut|visor-mask|in her glasses|pointermove|mp-float|mp-drift/i);
  assert.doesNotMatch(html, /@keyframes/);
  assert.doesNotMatch(html, /setInterval/);
  assert.equal(doc.querySelectorAll('.mp-ctl').length, 0, 'no player controls on the opening');
});

test('every trailer plays in the theatre, opened from its tile', () => {
  assert.equal(doc.querySelectorAll('[data-film]').length, 3);
  assert.match(html, /b\.addEventListener\('click', function \(\) \{ if \(T\) T\.open\(\+b\.getAttribute\('data-film'\), 'long'\); \}\);/);
});

test('npm run media:films fetches its stills', () => {
  const { PAGES, filmsFromPage } = require('../scripts/fetch-founder-films.js');
  const own = PAGES.find((t) => t.page.endsWith('manekas-picks.html'));
  assert.ok(own && own.out.endsWith(path.join('media', 'picks-films')));
  assert.deepEqual(filmsFromPage(html).map((f) => f.id), FILMS.map((f) => f.yt));
});
