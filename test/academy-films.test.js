'use strict';
/* Five films on the academy page, played by assets/theatre.js: the same
 * player the wall and the founder page mount. Nothing about the player is
 * retested here, because it is tested where it lives. What is tested is the
 * wiring, which is the part that was written fresh and the part that was
 * wrong.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'academy.html'), 'utf8');
const THEATRE_JS = fs.readFileSync(path.join(ROOT, 'assets', 'theatre.js'), 'utf8');

/* In the order they appear on the page. */
const IDS = ['bvKKHRCCkfI', 'EzoqvBZe_gI', 'ubPmwKeVLpo', 'UWagM1FBB4c', 'tuRl8moQbXU'];

const OPEN = [];
test.after(() => { OPEN.forEach((d) => { try { d.window.close(); } catch (e) { /* gone */ } }); });

function page() {
  const tag = '<script src="assets/theatre.js"></script>';
  assert.ok(html.includes(tag), 'the page must link the shared player');
  const dom = new JSDOM(html.replace(tag, `<script>${THEATRE_JS}</script>`), {
    runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),          /* jsdom has no media element */
    url: 'https://pfa.test/academy.html'
  });
  OPEN.push(dom);
  return { dom, d: dom.window.document, w: dom.window, $: (q) => dom.window.document.querySelector(q) };
}
const click = (p, q) => p.$(q).dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));

test('all five films are on the page', () => {
  const missing = IDS.filter((id) => !html.includes(`yt:'${id}'`));
  assert.deepEqual(missing, [], `not added: ${missing.join(', ')}`);
});

test('the page carries no player of its own', () => {
  assert.match(html, /<script src="assets\/theatre\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="assets\/theatre\.css">/);
  assert.ok(!/id="theatre"/.test(html), 'the module brings its own markup');
});

test('the player is not called The Wall here', () => {
  /* The Wall is a section of this site in its own right. A player announcing
     itself as that on a third page points somewhere else. */
  assert.match(html, /name: 'Lecture Theatre'/);
  const p = page();
  assert.equal(p.$('#thMark').textContent, 'Lecture Theatre');
  assert.match(p.$('#thFootCredit').textContent, /Academy/);
});

test('every tile opens the film it shows', () => {
  /* The bug this exists for: the player keeps one list per wall, so a film's
     place in the page's array is not its place in its own wall. The short
     sits third, which pushed every long film after it down by one. Tile four
     opened the fifth film and tile five wrapped round to the first, and both
     looked like a working player. */
  const p = page();
  assert.equal(p.d.querySelectorAll('#filmGrid [data-film]').length, 5);
  IDS.forEach((want, i) => {
    click(p, `#filmGrid [data-film="${i}"]`);
    const list = p.w.PFA_THEATRE.list();
    assert.equal(list[p.w.PFA_THEATRE.current()].yt, want, `tile ${i + 1} opened the wrong film`);
    click(p, '#thClose');
  });
});

test('the short is declared short, and opens as one', () => {
  /* A 9:16 film in the long list is letterboxed into a stripe, and the shape
     control would offer to crop it. */
  assert.match(html, /wall:'short'[^}]*yt:'ubPmwKeVLpo'/);
  const p = page();
  click(p, '#filmGrid [data-film="2"]');
  assert.ok(p.$('#theatre').classList.contains('is-short'));
  assert.equal(p.d.querySelectorAll('.film--short').length, 1, 'and its tile is the same shape');
});

test('the film that was shared at a moment opens at it', () => {
  assert.match(html, /yt:'UWagM1FBB4c'[^}]*start:25/, 'the link carried t=25s');
});

test('the page asks YouTube for nothing until Play is pressed', () => {
  assert.ok(!/ytimg\.com|img\.youtube\.com/.test(html), 'the stills are served from this site');
  assert.ok(!/youtube(-nocookie)?\.com\/embed/.test(html), 'the frame is the player\'s, built on a press');
  IDS.forEach((id) => {
    assert.ok(html.includes(`media/academy-films/${id}.jpg`), `${id} has no local still path`);
  });
});

test('the page builds without throwing', () => {
  /* A theatre that fails to mount leaves tiles that do nothing, which looks
     like a page rather than a fault. */
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const tag = '<script src="assets/theatre.js"></script>';
  const dom = new JSDOM(html.replace(tag, `<script>${THEATRE_JS}</script>`), {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'https://pfa.test/academy.html'
  });
  OPEN.push(dom);
  assert.deepEqual(errors, []);
  assert.ok(dom.window.PFA_THEATRE && dom.window.PFA_THEATRE.open, 'the player mounted');
});

test('the still fetcher knows about this page', () => {
  const { filmsFromPage, PAGES } = require(path.join(ROOT, 'scripts', 'fetch-founder-films.js'));
  assert.ok(PAGES.some((t) => t.page.endsWith('academy.html')), 'npm run media:films must cover it');
  assert.deepEqual(filmsFromPage(html).map((f) => f.id), IDS);
});

/* ------------------------------------------------------------- the course ---
   The rail, the corner brackets and the bracketed sources that stood here
   were three accents nobody could see. They are gone, and what replaced them
   is the answer to why the page was overwhelming: seventy lessons all open at
   once, and no way in for the person who is not studying. */

test('the page opens on the emergency, not on the syllabus', () => {
  /* Two people arrive here and only one is studying. The other has an animal
     bleeding in front of them. */
  const p = page();
  /* The emergency is now the first card of the deck, ahead even of the
     introduction, for the same reason the triage once stood first. */
  const first = p.$('#deckCards .card');
  assert.equal(first && first.getAttribute('data-pill'), 'Emergency', 'the first card of the deck is the emergency');
  const order = [...p.d.querySelectorAll('#top, #films, #syllabus')].map((n) => n.id);
  assert.deepEqual(order, ['top', 'films', 'syllabus'],
    'the deck first, then the films, and the ten-module syllabus after both');
});

test('every triage target reaches a lesson that exists', () => {
  /* These are deep links into Module 07 and Module 05. A typo here sends
     someone holding a bleeding animal to the top of the page. */
  const p = page();
  const targets = [...p.d.querySelectorAll('.deck__links a')];
  assert.equal(targets.length, 6, 'six, because a seventh is one too many to scan');
  const dead = targets.filter((a) => !p.d.getElementById(a.getAttribute('href').slice(1)));
  assert.deepEqual(dead.map((a) => a.getAttribute('href')), []);
});

test('one emergency door, not two', () => {
  /* The hero used to carry six .tri tiles asking the same question the
     triage below it asks, so the page opened by stuttering: two ink blocks,
     six answers each, four of them the same. The hero tiles are gone and
     their icons and lesson references moved into the triage, so the .tri
     class retired with them. If it comes back, a second door has been
     built again. */
  const p = page();
  assert.equal(p.d.querySelectorAll('.tri').length, 0, 'the hero triage was merged into #now');
  assert.equal(p.d.querySelectorAll('.trg').length, 0, 'and #now in turn became the emergency card of the deck');
  assert.equal(p.d.querySelectorAll('.deck__links a').length, 6);
});

test('a module holds its lessons until asked', () => {
  const p = page();
  assert.equal(p.d.querySelectorAll('.part__lessons').length, 14);
  assert.equal(p.d.querySelectorAll('.part__lessons[hidden]').length, 14,
    'seventy lessons open at once is what made this page overwhelming');
  assert.equal(p.d.querySelectorAll('.part__more').length, 14);

  p.$('.part__more').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  assert.equal(p.d.querySelectorAll('.part__lessons[hidden]').length, 13, 'one opens, the rest stay shut');
});

test('everything that already revealed lessons still does', () => {
  /* Filtering and Expand all worked by hiding what did not match. They would
     have been hiding things inside a closed box. */
  const p = page();
  p.$('#toggleAll').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  assert.equal(p.d.querySelectorAll('.part__lessons[hidden]').length, 0);
});

test('a deep link opens the module it lands in', () => {
  /* Which is what makes the triage block work at all. */
  const tag = '<script src="assets/theatre.js"></script>';
  const dom = new JSDOM(html.replace(tag, `<script>${THEATRE_JS}</script>`), {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    url: 'https://pfa.test/academy.html#g6'
  });
  OPEN.push(dom);
  assert.equal(dom.window.document.querySelectorAll('.part__lessons[hidden]').length, 13,
    'the module holding the heatstroke lesson must be open on arrival');
});

/* The five strings I wrote from context when YouTube could not be reached.
   Three of these films turned out to be MinuteEarth explainers, so these are
   not merely unverified: they attribute other people's work to a named
   politician. Named here so they can never come back by any route. */
const INVENTED = [
  'Maneka Gandhi on animal law and the work ahead',
  'On rescue, shelters and what the public can do',
  'A minute on community dogs',
  'Animal welfare policy, explained',
  'Kindness, cruelty and the law in practice'
];

/* Verified by hand. YouTube returns the same, so these hold before the fetch
   and after it. */
const KNOWN = {
  bvKKHRCCkfI: ['Are You a Mosquito Magnet?', 'MinuteEarth'],
  UWagM1FBB4c: ['ALL THE CATS, EXPLAINED', 'MinuteEarth'],
  tuRl8moQbXU: ['ALL THE DOGS, EXPLAINED', 'MinuteEarth']
};

/* The regex reads the page's source, so a title arrives as it sits inside
   the string literal: an apostrophe as \' and a backslash as \\. The JS
   engine decodes those before any visitor sees them, so they are decoded
   here too. Compared raw, a real title carrying an apostrophe fails against
   the tile that shows it correctly - which is how "Why Don't Snakes Poison
   Themselves?" stopped a ship. */
const unquote = (s) => s.replace(/\\(.)/g, '$1');
const filmsOf = (markup) => [...markup.matchAll(/title:'((?:[^'\\]|\\.)*)',\s*credit:'((?:[^'\\]|\\.)*)'[^}]*yt:'([\w-]+)'/g)]
  .map((m) => ({ title: unquote(m[1]), credit: unquote(m[2]), id: m[3] }));

test('no film carries a title or a credit I invented', () => {
  /* Stated as a rule rather than as a snapshot. The first version of this
     asserted the two unverified films were empty, which stopped being true
     the moment npm run media:films did its job, and stopped the ship with a
     red suite over a correct page. A test must not fail because the step it
     exists to protect was taken. */
  const films = filmsOf(html);
  assert.equal(films.length, 5);
  for (const f of films) {
    assert.ok(!INVENTED.includes(f.title), `${f.id} carries a title I made up: "${f.title}"`);
    if (KNOWN[f.id]) {
      assert.equal(f.title, KNOWN[f.id][0], `${f.id} must carry its real title`);
      assert.equal(f.credit, KNOWN[f.id][1], `${f.id} must be credited to who made it`);
    }
    /* Half an attribution is the error this whole file is about: a title with
       no channel reads as ours, and a channel with no title credits nothing. */
    assert.equal(!!f.title, !!f.credit, `${f.id} has one of title and credit but not the other`);
  }
});

test('a film shows its title when it has one, and its number when it does not', () => {
  /* Also a rule. Before the fetch two films have no title; after it they do,
     and both states are correct. */
  const films = filmsOf(html);
  const p = page();
  const shown = [...p.d.querySelectorAll('#filmGrid .film__t')].map((n) => n.textContent);
  assert.equal(shown.length, 5);
  films.forEach((f, i) => {
    assert.equal(shown[i], f.title || `Film 0${i + 1}`,
      `tile ${i + 1} should show ${f.title ? 'its title' : 'its number'}`);
  });
});

test('the section does not claim whose films these are', () => {
  /* It read "The course, in her own words" over three MinuteEarth explainers. */
  assert.ok(!/in her own words/.test(html), 'that heading attributed them to the wrong person');
  assert.match(html, /made by other people and credited to them/);
});

test('the fetcher brings back the channel, not just the title', () => {
  /* A film credited to the wrong person is a worse error than an uncredited
     one, so the credit must come from YouTube as well. */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'fetch-founder-films.js'), 'utf8');
  assert.match(src, /author_name/, 'oEmbed returns the channel and it should be used');
  assert.match(src, /credit:'/, 'and written beside the title');
});
