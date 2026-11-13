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
   the page, and the page opens as the panel chooses: Option 1, her
   photograph the whole screen with the film in her visor (10 Nov 2026), or
   Option 2, a quiet portrait beside the title (11 Nov 2026). */
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
  /* three books (owner, 10 Nov 2026: "add orange dogs - book"; 13 Nov 2026:
     Tender Paws), the two on Amazon with Buy on Amazon, Tender Paws from its own site */
  const books = [...doc.querySelectorAll('#book .mp-bk')];
  assert.deepEqual(books.map((b) => b.querySelector('h3').textContent), ['Animals', 'Orange Dogs', 'Tender Paws']);
  assert.deepEqual(books.map((b) => b.querySelector('a.btn').getAttribute('href')),
    ['https://www.amazon.in/Animals-Raghu-Rai/dp/9373070878?th=1', 'https://www.amazon.in/dp/9334516496', 'https://tenderpaws.nz/']);
  assert.deepEqual(books.map((b) => b.querySelector('a.btn').textContent.trim()), ['Buy on Amazon', 'Buy on Amazon', 'Get the book']);
  for (const b of books) {
    const buy = b.querySelector('a.btn');
    assert.equal(buy.getAttribute('target'), '_blank');
    assert.equal(buy.getAttribute('rel'), 'noopener noreferrer');
  }
  assert.match(books[1].querySelector('.eyebrow').textContent, /Deepak Virwani/);
  assert.match(books[2].querySelector('.eyebrow').textContent, /Balvant Singh/);
  assert.equal(doc.querySelector('#book h2').textContent, 'Three to read.');
  assert.doesNotMatch(html, /two books/i, 'every count on the page says three');
  const turns = [...doc.querySelectorAll('.mp-card--books img[data-turn]')].map((i) => i.getAttribute('data-turn'));
  assert.deepEqual(turns, ['media/picks/animals-raghu-rai-cover.jpg', 'media/picks/orange-dogs-cover.jpg', 'media/picks/tender-paws-cover.jpg'], 'the card on the wall turns through all three');
});

test('each book shows its real cover, whole, from this site (owner, 10 Nov 2026)', () => {
  const imgs = [...doc.querySelectorAll('#book .mp-bk__cover img')];
  assert.deepEqual(imgs.map((i) => i.getAttribute('data-still')), ['media/picks/animals-raghu-rai-cover.jpg', 'media/picks/orange-dogs-cover.jpg', 'media/picks/tender-paws-cover.jpg']);
  assert.deepEqual(imgs.map((i) => i.getAttribute('alt')), ['The cover of Animals by Raghu Rai and Maneka Gandhi', 'The cover of Orange Dogs by Deepak Virwani', 'The cover of Tender Paws by Balvant Singh']);
  assert.match(html, /\.mp-bk__cover\.has-cover img\{display:block;width:100%;height:auto;/, 'at its own shape: never cut or stretched');
  assert.match(html, /img\.addEventListener\('load', function \(\) \{ box\.classList\.add\('has-cover'\); \}\);/, 'shown only once it has arrived');
  const { BOOKS, coverFromAmazon } = require('../scripts/fetch-founder-films.js');
  assert.deepEqual(BOOKS.map((b) => path.relative(ROOT, b.out)), imgs.map((i) => path.join(...i.getAttribute('data-still').split('/'))), 'npm run media:films fetches the very files the page asks for');
  for (const b of BOOKS.filter((x) => x.kept)) assert.ok(fs.statSync(b.out).size > 20000, `${b.title}: the cover kept in the repository is really here`);
  for (const b of BOOKS.filter((x) => !x.kept)) assert.match(b.image, /^https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+-]+\.jpg$/, `${b.title}: the original cover, not a thumbnail`);
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

/* The opening is Option 1 or Option 2, as the panel chooses (owner, 11 Nov
   2026: "have 2 options in the admin for manekas picks page. 1 and 2. which
   can be switched on the admin panel"). Option 1's rules answer only to
   html[data-choice-opening="1"], Option 2's to everything else; css1 is
   Option 1's rules as they read in v1.558, the prefix taken off. */
const P1 = 'html[data-choice-opening="1"] ';
const P2 = 'html:not([data-choice-opening="1"]) ';
const css1 = html.split(P1).join('');

test('the opening is Option 1 or Option 2, as the panel chooses; Option 2 until Option 1 is chosen', () => {
  const V = require('../lib/site-visibility.js');
  assert.equal(V.CHOICES['manekas-picks#opening'].page, 'manekas-picks');
  assert.equal(V.CHOICES['manekas-picks#opening'].name, 'opening', 'read by the page as data-choice-opening');
  assert.equal(V.CHOICES['manekas-picks#opening'].fallback, '2');
  /* every hero rule belongs to one option: none of the hero's own parts is styled for both */
  const heroRules = html.match(/^[^\n{}]*\.mp-(?:hero|room|scene|lens|card|foot|cap|ctl|type|photo|portrait|title)[^\n{}]*\{/gm) || [];
  for (const r of heroRules) assert.ok(r.includes(P1.trim()) || r.includes(P2.trim()) || /^\s*\.mp-wait \.mp-hero/.test(r), r);
  assert.ok(html.includes(P2 + '.mp-room,' + P2 + '.mp-card,' + P2 + '.mp-cap{display:none}'), 'Option 2 shows none of Option 1');
  /* one hero, one title, one id="top" */
  assert.equal(doc.querySelectorAll('main h1').length, 1);
  assert.equal(doc.querySelectorAll('#top').length, 1);
  /* each option's photograph loads only when it is on view */
  for (const img of doc.querySelectorAll('#top img.mp-photo, #top img#mpPortrait')) assert.equal(img.getAttribute('loading'), 'lazy', img.getAttribute('src'));
  /* Option 1's script starts only with Option 1, and again if the panel switches to it */
  assert.match(html, /function isOne\(\) \{ return html\.getAttribute\('data-choice-opening'\) === '1'; \}/);
  assert.match(html, /function follow\(\) \{\n {4}if \(isOne\(\) && !one\) one = startOne\(\);\n {4}else if \(!isOne\(\) && one\) one\.halt\(\);\n {2}\}\n {2}follow\(\);\n {2}window\.addEventListener\('pfa:visibility', follow\);/);
  /* a first visit waits for the answer, at most a second and a half, rather than showing one and swapping it */
  assert.match(html, /if \(seen && seen\.choices && seen\.choices\['manekas-picks#opening'\]\) return;/);
  assert.match(html, /setTimeout\(done, 1500\);/);
  assert.match(html, /\.mp-wait \.mp-hero\{visibility:hidden\}/);
  /* the panel's card, in its own file and in the Firebase bundle */
  assert.match(read('admin.html'), /<script src="assets\/admin-site-designs\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-site-designs\.js'/);
  assert.match(read('assets/admin-site-designs.js'), /body: \{ kind: 'choice', id: id, value: value \}/);
  assert.doesNotMatch(read('assets/admin-site-designs.js'), /[\u2013\u2014]/, 'no long dash');
});

test('Option 2 opens quietly: the title, and her photograph whole beside it (owner, 11 Nov 2026)', () => {
  /* "any toned down version. maneka madam is a well known public figure", choosing a quiet portrait */
  const hero = doc.querySelector('main > section#top.mp-hero');
  assert.ok(hero, 'the opening');
  assert.ok(hero.querySelector('.mp-foot > .mp-title > h1.pfa-title + p.mp-hero__role + .mp-acts.mp-acts--quiet'), 'the site\'s title block, its line and its buttons');
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
  assert.ok(html.includes(P2 + '.mp-portrait img{display:block;width:100%;height:auto;'), 'scaled, never stretched or cut');
  assert.equal(hero.querySelector('figcaption b').textContent, 'Smt. Maneka Sanjay Gandhi');
  assert.ok(html.includes(P2 + '.mp-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(32px,5vw,88px);align-items:center;padding:calc(var(--ann) + var(--nav) + 72px) var(--gutter) 64px}'), 'under the header, as every page opens');
  /* nothing over her, nothing moving: no Option 2 rule moves anything */
  const css2 = html.split('\n').filter((l) => l.includes(P2)).join('\n');
  assert.doesNotMatch(css2, /animation|(?<!-)transform|mask-image|@keyframes/);
});

test('Option 1: the page opens on her photograph, the whole screen, the title along its foot (owner, 10 Nov 2026)', () => {
  /* "opens like a hero ... full screen, powerful. both on mobile and web", above the phone's tab bar, light on dark */
  assert.match(css1, /\.mp-hero\{position:relative;height:calc\(100vh - var\(--tabbar,0px\)\);height:calc\(100svh - var\(--tabbar,0px\)\);/);
  assert.ok(doc.querySelector('#top.mp-hero > #mpRoom'), 'the photograph is the hero');
  assert.ok(doc.querySelector('#top .mp-foot .mp-title h1.pfa-title'), 'the title on it');
  assert.ok(doc.querySelector('#top .mp-card--books[href="#book"]') && doc.querySelector('#top .mp-card--films[href="#films"]'), 'the cards on the wall');
  assert.match(css1, /\.mp-title \.mp-hero__role\{margin:26px 0 0;/, 'the line under the title where v1.558 had it');
  assert.match(html, /html\[data-choice-opening="1"\] \.mp-portrait,html\[data-choice-opening="1"\] \.mp-acts--quiet\{display:none\}/, 'nothing of Option 2 with it');
});

test('Option 1: her photograph in the amber visor, whole, and the visor filled with the film as jjettas.com does it (owner, 10 Nov 2026)', () => {
  /* "implement ditto", "not even 1 pixel should flow out", "goal is to play the video perfectly" */
  const img = doc.querySelector('#mpRoom img.mp-photo');
  assert.equal(img.getAttribute('src'), 'media/picks/portrait-visor.jpg');
  assert.equal(img.getAttribute('width'), '2576');
  assert.equal(img.getAttribute('height'), '2113');
  for (const gone of ['portrait.webp', 'portrait-glasses.jpg', 'lens-l-mask.png', 'lens-r-mask.png']) assert.ok(!fs.existsSync(path.join(ROOT, 'media/picks', gone)), gone);
  /* under the header, never behind it, and her whole photograph in it, at
     its own shape, from the top of her head (owner, 10 Nov 2026: "her head
     is getting chopped ... the header of the page is intact ... nothing gets
     clipped") */
  assert.match(css1, /\.mp-room\{position:absolute;left:0;right:0;top:calc\(var\(--ann,0px\) \+ var\(--nav,81px\)\);bottom:0;/, 'the hero starts under the header');
  assert.match(css1, /\.mp-scene\{position:absolute;container-type:size;--pad:clamp\(10px,3cqh,32px\);--sh:min\(100cqh - var\(--pad\),100cqw \* 1\.7 \* 2113 \/ 2576\);--sw:calc\(var\(--sh\) \* 2576 \/ 2113\);width:var\(--sw\);height:var\(--sh\);left:calc\(50% - var\(--sw\) \/ 2\);top:var\(--pad\);/, 'the photograph at its own shape, her head at the top, never cut by the header');
  /* she is cut from the photograph's wall and stands on the page's own */
  assert.match(css1, /\.mp-photo\{[^}]*mask-image:url\("media\/picks\/portrait-cut\.png"\)/);
  const cut = fs.readFileSync(path.join(ROOT, 'media/picks/portrait-cut.png'));
  assert.deepEqual([cut.readUInt32BE(16), cut.readUInt32BE(20)], [1288, 1056], 'the cut, at half the photograph\'s size');
  assert.match(read('scripts/build-portrait-cut.py'), /assert alpha\[cy - 40:cy \+ 40, cx - 120:cx \+ 120\]\.min\(\) == 1, 'her face and the visor are whole'/);
  const lens = doc.querySelector('#mpLens.mp-lens');
  for (const part of ['.mp-lens__still', '.mp-lens__film', '.mp-lens__tone', '.mp-lens__grille', '.mp-lens__shine']) assert.ok(lens.querySelector(part), part);
  assert.match(css1, /\.mp-lens__glass\{[^}]*mask-image:url\("media\/picks\/visor-mask\.png"\)/, 'masked to the glass');
  for (const f of ['visor-mask.png', 'visor-shine.png', 'visor-frame.png', 'portrait-visor.jpg']) assert.ok(fs.existsSync(path.join(ROOT, 'media/picks', f)), f);
  /* the photograph without the generated texture, made from the original kept out of the site (10 Nov 2026) */
  const crypto = require('crypto');
  const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/source/portrait-visor-original.jpg')), 'the original, to make it again from');
  assert.notEqual(hash('media/picks/portrait-visor.jpg'), hash('scripts/source/portrait-visor-original.jpg'), 'the page shows the retouched photograph');
  assert.match(read('scripts/retouch-portrait.py'), /freckles/);
  /* the visor box, in percent of the photograph: 906 to 1676 across, 644 to 918 down */
  const pct = (re) => Number(re.exec(css1)[1]) / 100;
  const W = 2576, H = 2113;
  const box = { l: pct(/\.mp-lens\{[^}]*left:([\d.]+)%/) * W, t: pct(/\.mp-lens\{[^}]*top:([\d.]+)%/) * H, w: pct(/\.mp-lens\{[^}]*width:([\d.]+)%/) * W, h: pct(/\.mp-lens\{[^}]*height:([\d.]+)%/) * H };
  assert.ok(Math.abs(box.l - 906) < 0.5 && Math.abs(box.t - 644) < 0.5 && Math.abs(box.w - 770) < 0.5 && Math.abs(box.h - 274) < 0.5, JSON.stringify(box));
  /* the mask is exactly the box's size, so it lands on the glass it was read from */
  for (const f of ['visor-mask.png', 'visor-frame.png', 'visor-shine.png']) {
    const png = fs.readFileSync(path.join(ROOT, 'media/picks', f));
    assert.equal(png.readUInt32BE(16), 770, f);
    assert.equal(png.readUInt32BE(20), 274, f);
  }
  /* the frame laid back over the film: in the same box, outside the film's
     mask, last, so the film ends on its drawn edge and no amber is left at it */
  const frame = lens.lastElementChild;
  assert.equal(frame.className, 'mp-lens__frame');
  assert.equal(frame.getAttribute('src'), 'media/picks/visor-frame.png');
  assert.ok(lens.querySelector('.mp-lens__glass > .mp-lens__film'), 'the film is under the mask');
  assert.ok(!frame.closest('.mp-lens__glass'), 'the frame is not');
  assert.match(read('scripts/build-visor-mask.py'), /assert not \(through\[~shadowed\] > 0\)\.any\(\), 'the film shows on the frame'/);
  /* the film covers the visor: 16:9 as wide as the box, centred down it */
  const filmH = pct(/\.mp-lens__film,\.mp-lens__still\{[^}]*height:([\d.]+)%/) * box.h;
  const filmTop = -pct(/\.mp-lens__film,\.mp-lens__still\{[^}]*top:-([\d.]+)%/) * box.h;
  assert.ok(Math.abs(box.w / filmH - 16 / 9) < 0.01, `16:9, not ${box.w / filmH}`);
  assert.ok(Math.abs(filmTop + (filmH - box.h) / 2) < 0.5, 'centred');
  assert.match(css1, /\.mp-lens__shine\{display:block;mix-blend-mode:screen\}/, 'the visor\'s reflections over the film');
  assert.match(css1, /\.mp-lens__grille\{background:repeating-linear-gradient/);
});

test('Option 1: the trailer in the visor is the theatre\'s, built only when Play is pressed', () => {
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

test('Option 1: the photograph\'s effects, as jjettas.com\'s hero: decorative, and all still when motion is reduced (10 Nov 2026)', () => {
  /* the type behind her drifts, a light runs across the visor, the picture leans to the pointer */
  assert.ok(doc.querySelector('#mpRoom > .mp-type[aria-hidden="true"] .mp-type__row--back .mp-type__track'), 'across the whole wall');
  assert.ok(doc.querySelector('#mpRoom > .mp-type + .mp-scene'), 'behind her: she is in front of it');
  assert.ok(fs.existsSync(path.join(ROOT, 'media/picks/portrait-wall.png')), 'the wall, which her cut is made from');
  /* the cards on the wall take turns (owner, 10 Nov 2026: "the books appear in
     turns, and the films too. the thumbnails should take turns") */
  assert.equal(doc.querySelectorAll('.mp-card--books img[data-turn]').length, 3, 'all three books');
  assert.equal(doc.querySelectorAll('.mp-card--films img[data-turn]').length, 3, 'all three films');
  assert.deepEqual([...doc.querySelectorAll('.mp-card--films img[data-turn]')].map((i) => i.getAttribute('data-turn')), FILMS.map((f) => `media/picks-films/${f.yt}.jpg`));
  assert.match(html, /timer = setTimeout\(function \(\) \{[\s\S]{0,200}if \(!held && !document\.hidden && isOne\(\) && ok\.length > 1\)/, 'one picture after another, held while looked at, and only while Option 1 is on view');
  assert.match(html, /if \(!calm\) setTimeout\(turn, n \* 2500\);/, 'and not at all when motion is reduced');
  assert.ok(doc.querySelector('.mp-lens__glass .mp-lens__glint'), 'the light inside the glass, under its mask');
  assert.match(css1, /@media \(prefers-reduced-motion:reduce\)\{\n {2}\.mp-scene,\.mp-type__row,\.mp-card\{transform:none\}\n {2}\.mp-lens__glint\{display:none\}\n\}/);
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{\n {2}\*\{transition:none!important;animation:none!important\}\n\}/);
  assert.match(html, /if \(calm \|\| !window\.matchMedia \|\| !window\.matchMedia\('\(hover: hover\)'\)\.matches\) return;/, 'the lean only with a pointer, never when motion is reduced');
  assert.doesNotMatch(html, /setInterval/);
  const controls = [...doc.querySelectorAll('.mp-ctl')].map((b) => b.textContent.trim());
  assert.deepEqual(controls, ['Play in her glasses', 'Sound: On', 'Next film', 'Full screen', 'Stop']);
});

test('Option 1: at rest the visor carries the film\'s still the same way, once it is on this site', () => {
  assert.equal(doc.querySelectorAll('[data-lens-still]').length, 1);
  assert.match(css1, /\.mp-room\.has-still \.mp-lens,\.mp-room\.is-playing \.mp-lens\{opacity:1\}/, 'until then the photograph\'s own glass is seen');
  assert.match(html, /probe\.onload = function \(\) \{\n\s*if \(FILMS\[cur\]\.poster !== url\) return;/);
});

test('every trailer plays in the theatre, opened from its tile', () => {
  assert.equal(doc.querySelectorAll('[data-film]').length, 3);
  assert.match(html, /b\.addEventListener\('click', function \(\) \{ if \(one\) one\.halt\(\); if \(T\) T\.open\(\+b\.getAttribute\('data-film'\), 'long'\); \}\);/, 'stopping a film in the visor first');
});

test('npm run media:films fetches its stills', () => {
  const { PAGES, filmsFromPage } = require('../scripts/fetch-founder-films.js');
  const own = PAGES.find((t) => t.page.endsWith('manekas-picks.html'));
  assert.ok(own && own.out.endsWith(path.join('media', 'picks-films')));
  assert.deepEqual(filmsFromPage(html).map((f) => f.id), FILMS.map((f) => f.yt));
});
