'use strict';

/* The newsroom front page (owner, 17 Sep 2026, from a magazine reference):
   a nameplate, a front page of up to four stories and desks for the rest,
   written into newsroom.html from data/newsroom.json by
   scripts/build-newsroom.js. Every story is something that happened, with
   the page that carries it. Held here: the data, the page, the links, the
   shape as the list grows, and Case 001's record, which stays word for word. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const B = require('../scripts/build-newsroom.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DATA = JSON.parse(read('data/newsroom.json'));
const doc = (html) => new JSDOM(html).window.document;

test('the data is valid, and newsroom.html carries exactly what it says', () => {
  assert.deepEqual(B.validate(DATA), []);
  const page = read('newsroom.html');
  assert.equal(B.render(page, DATA), page, 'newsroom.html is out of date: run node scripts/build-newsroom.js');
});

test('the build never looks at today, so its check gives the same answer every day', () => {
  assert.doesNotMatch(read('scripts/build-newsroom.js'), /Date\.now\(|new Date\(\s*\)/);
});

test('the front page carries the stories marked for it, in order, a photograph or a date for each', () => {
  const d = doc(read('newsroom.html'));
  const marked = DATA.stories.filter((s) => s.front).sort((a, b) => a.front - b.front);
  const tiles = [...d.querySelectorAll('.nr-front .nr-tile')];
  assert.equal(tiles.length, marked.length);
  tiles.forEach((tile, i) => {
    const st = marked[i];
    assert.equal(tile.querySelector('.nr-tile__title').textContent, st.title);
    assert.equal(tile.querySelector('a').getAttribute('href'), st.link.href);
    assert.equal(tile.querySelector('time').getAttribute('datetime'), st.date);
    if (st.image) {
      const img = tile.querySelector('img');
      assert.equal(img.getAttribute('alt'), st.image.alt);
      assert.match(img.getAttribute('onerror'), /closest\('\[data-shot\]'\)/, 'a photograph that fails leaves the story set in type');
    } else {
      assert.ok(tile.classList.contains('nr-tile--text') && tile.querySelector('.nr-tile__date'), 'a story with no photograph is set in type, its date large');
      assert.equal(tile.querySelector('img'), null, 'and is never given a stand-in picture');
    }
  });
  assert.ok(tiles[0].classList.contains('nr-tile--lead'), 'the first is the lead');
  assert.ok(tiles[3].classList.contains('nr-tile--wide'), 'with four, the last runs wide');
});

test('the desks hold every story not on the front page, newest first, and nothing twice', () => {
  const d = doc(read('newsroom.html'));
  const onFront = new Set([...d.querySelectorAll('.nr-front .nr-tile__title')].map((n) => n.textContent));
  const inDesks = [...d.querySelectorAll('.nr-card__title')].map((n) => n.textContent);
  assert.equal(onFront.size + inDesks.length, DATA.stories.length, 'every story appears once');
  assert.ok(inDesks.every((t) => !onFront.has(t)));
  for (const list of d.querySelectorAll('.nr-desk .nr-cards')) {
    const dates = [...list.querySelectorAll('time')].map((t) => t.getAttribute('datetime'));
    assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
  }
  assert.equal(d.querySelector('.nr-count').textContent, `${DATA.stories.length} stories on the record`);
});

test('every link the script writes lands on a page and an anchor that exist', () => {
  const html = read('newsroom.html');
  const links = [...doc(html).querySelectorAll('.nr a[href]')].map((a) => a.getAttribute('href'));
  assert.ok(links.length >= DATA.stories.length);
  for (const href of links) {
    if (/^https:\/\//.test(href)) continue; /* a press report, checked by validate() */
    const [file, id] = href.split('#');
    const target = file ? read(file) : html;
    if (id) assert.ok(target.includes(`id="${id}"`), `${href} lands nowhere`);
  }
});

test('Case 001 is still carried word for word, under its own heading, and the front page leads to it', () => {
  const html = read('newsroom.html');
  for (const words of [
    'Removed for a&nbsp;VIP visit.<br>Returned by a&nbsp;city.',
    'PEC had 35 community dogs picked up before the Prime Minister&rsquo;s visit, then declined their return. Four offices, one protest, six states: the director cleared every single one.',
    'Won under the Animal Birth Control Rules, 2023: community dogs return to the locality they came from.',
    '<span>Filed 8 August 2026</span><span>Chandigarh</span><span>Resolved</span>'
  ]) assert.ok(html.includes(words), `Case 001 lost: ${words.slice(0, 50)}`);
  const d = doc(html);
  assert.equal(d.querySelectorAll('#case-001 .row').length, 4, 'the four steps of the case');
  assert.ok(d.querySelector('.nr-front a[href="#case-001"]'));
  assert.ok(d.getElementById('case-file').compareDocumentPosition(d.getElementById('case-001')) & 4, 'the heading comes before the record');
  assert.equal(d.querySelectorAll('main form').length, 0, 'the newsroom still carries no form');
});

test('as the newsroom grows or shrinks, the front page keeps its shape', () => {
  const page = read('newsroom.html');
  const base = DATA.stories.find((s) => s.desk === 'cinekind' && !s.image);
  const many = Array.from({ length: 12 }, (_, i) => ({ ...base, slug: `story-${String(i + 1).padStart(2, '0')}`, title: `Story ${i + 1}`, date: `2027-${String(i + 1).padStart(2, '0')}-01`, front: undefined }));
  const grown = doc(B.render(page, { stories: many }));
  assert.equal(grown.querySelector('.nr-front').getAttribute('data-count'), '4');
  assert.deepEqual([...grown.querySelectorAll('.nr-front .nr-tile__title')].map((n) => n.textContent), ['Story 12', 'Story 11', 'Story 10', 'Story 9'], 'with none marked, the four newest lead');
  assert.equal(grown.querySelectorAll('.nr-card').length, 8);
  for (const n of [1, 2, 3]) {
    const small = doc(B.render(page, { stories: many.slice(0, n) }));
    assert.equal(small.querySelector('.nr-front').getAttribute('data-count'), String(n));
    assert.equal(small.querySelectorAll('.nr-front__side').length, n > 1 ? 1 : 0);
    assert.equal(small.querySelectorAll('.nr-card').length, 0);
  }
  const none = doc(B.render(page, { stories: [] }));
  assert.equal(none.querySelector('.nr-front'), null);
  assert.ok(none.getElementById('case-001') && none.getElementById('nrTitle'), 'with no stories, the nameplate and the case record still stand');
});

test('bad data is refused with the story and the field, before it can reach the page', () => {
  const good = DATA.stories.find((s) => s.desk === 'cinekind' && !s.image);
  const cases = [
    [{ ...good, slug: 'X' }, /slug must be/],
    [{ ...good, desk: 'gossip' }, /desk must be one of/],
    [{ ...good, date: '2025-13-01' }, /real date/],
    [{ ...good, title: 'x'.repeat(91) }, /at most 90/],
    [{ ...good, front: 5 }, /front must be/],
    [{ ...good, link: { href: 'nowhere.html', label: 'x' } }, /not a page on this site/],
    [{ ...good, link: { href: 'achievements.html#rec-999999', label: 'x' } }, /no #rec-999999/],
    [{ ...good, desk: 'policy' }, /desk must be one of/],
    [{ ...good, desk: 'law' }, /desk must be one of/],
    [{ ...good, link: { href: 'https://example.com/report', label: 'x' } }, /only a "work" story may link/],
    [{ ...good, link: { href: 'javascript:alert(1)', label: 'x' } }, /must be a page on this site/],
    [{ ...good, image: { src: 'https://example.com/a.jpg', alt: 'x' } }, /img-src/],
    [{ ...good, image: { src: 'img/nowhere.webp', alt: 'x' } }, /not on disk/],
    [{ ...good, dek: 'Mumbai \u2014 at last' }, /em dash/],
    [{ ...good, print: 'Reported in print' }, /only a "work" story may be one reported in print/],
    [{ ...good, desk: 'work', print: 'Reported in print' }, /has no link; give one or the other/],
    [{ ...good, desk: 'work', link: undefined, print: ' ' }, /must name the paper/]
  ];
  for (const [st, why] of cases) {
    const problems = B.validate({ stories: [st] });
    assert.ok(problems.some((p) => why.test(p)), `expected ${why}, got ${JSON.stringify(problems)}`);
    assert.ok(problems.every((p) => /^story 1/.test(p)), 'each problem names the story');
  }
  assert.ok(B.validate({ stories: [good, { ...good }] }).some((p) => /used twice/.test(p)));
  assert.ok(B.validate({ stories: [{ ...good, front: 1 }, { ...good, slug: 'another-story', front: 1 }] }).some((p) => /front 1 is used twice/.test(p)));
});

test('a story of PFA work links to the press report it comes from, in a new tab', () => {
  const work = DATA.stories.filter((s) => s.desk === 'work' && !s.print);
  assert.ok(work.length >= 1, 'the newsroom carries PFA work for animals');
  const d = doc(read('newsroom.html'));
  for (const st of work) {
    assert.match(st.link.href, /^https:\/\//);
    const a = [...d.querySelectorAll('a')].find((n) => n.getAttribute('href') === st.link.href);
    assert.ok(a, `${st.slug} is not on the page`);
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.getAttribute('rel'), /noopener/);
  }
  assert.equal(DATA.stories.filter((s) => s.desk === 'policy' || s.desk === 'law').length, 0, 'policy and law are not newsroom stories');
});

/* Owner, 26 Nov 2026, a newspaper clipping: "add this under news". A story
   reported only in print names the paper where the link would be, and its
   headline links nowhere. */
test('a story reported in print names it instead of a link, and the Kanpur clipping is on the page', () => {
  const st = DATA.stories.find((s) => s.slug === 'kanpur-puppy-cruelty-arrest');
  assert.ok(st && st.desk === 'work' && st.print && !st.link);
  const d = doc(read('newsroom.html'));
  const h = [...d.querySelectorAll('.nr-card__title')].find((n) => n.textContent === st.title);
  assert.ok(h, 'in the For the animals desk');
  assert.equal(h.querySelector('a'), null, 'its headline links nowhere');
  const card = h.closest('.nr-card');
  assert.equal(card.querySelector('.nr-card__print').textContent, st.print);
  assert.equal(card.querySelector('.nr-card__more'), null);
  assert.equal(card.closest('.nr-desk').id, 'desk-work');
  assert.deepEqual(B.validate({ stories: [st] }), []);
});
