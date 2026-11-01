'use strict';

/* The remote internship on the site (owner, 31 Oct 2026: "add internship
   page inline with the current website theme. cert theme to be this blue
   one"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('internship.html');
const doc = new JSDOM(html).window.document;

test('the opening: the photograph whole, the words in the site\'s own title block', () => {
  const open = doc.querySelector('main > section.vi-open#top');
  assert.ok(open, 'the page opens on it');
  const img = open.querySelector('img');
  assert.equal(img.getAttribute('src'), 'media/site/internship/eye.webp');
  assert.ok(fs.existsSync(path.join(ROOT, 'media/site/internship/eye.webp')) && fs.existsSync(path.join(ROOT, 'media/site/internship/eye-1000.webp')));
  assert.match(html, /\.vi-open__ph img\{display:block;width:100%;height:auto;aspect-ratio:2400\/1347\}/, 'whole, at its own shape');
  assert.equal(open.querySelector('.pfa-kicker').textContent, 'A little of your time. Their whole world.');
  const h1 = open.querySelector('h1.pfa-title');
  assert.equal(h1.textContent.replace(/\s+/g, ' '), 'Make care count.');
  assert.equal(doc.querySelectorAll('main h1').length, 1);
  assert.match(open.textContent, /Eight weeks\.\s*Real work\. Where you live\./);
  assert.ok(open.querySelector('a[href="#cards"]') && doc.querySelector('section.deck#cards'), 'and leads to the cards');
});

test('in the site theme: the shared header, footer, microsite kit and editorial layer', () => {
  assert.match(html, /<link rel="stylesheet" href="assets\/micro\.css">/);
  assert.match(html, /<link rel="stylesheet" href="assets\/pfa-theme\.css">/);
  assert.ok(doc.querySelector('header.site') && doc.querySelector('footer.pfa-footer') && doc.querySelector('nav.pfa-tabs'));
  assert.equal(doc.querySelector('title').textContent, 'Remote internship | People for Animals');
  assert.ok(doc.querySelector('header.site a[aria-current="page"][data-nav="internship.html"]'), 'marked in the Get Involved menu');
  assert.match(read('assets/chrome-header.html'), /\{\{CURRENT:internship\.html\|Remote internship\}\}/);
  assert.match(read('assets/chrome-footer.html'), /<li><a href="internship\.html">Remote internship<\/a><\/li>/);
});

const cardsOf = () => [...doc.querySelectorAll('#cards .deck__cards > button.card')];
const cardTitled = (t) => cardsOf().find((c) => c.getAttribute('data-title') === t);

test('one card at a time, as the Academy: ten cards, nothing shown all at once', () => {
  /* owner, 1 Nov 2026: "the modules should be card like in academy.. dont
     show everything at once and overwhelm peep" */
  const cards = cardsOf();
  assert.deepEqual(cards.map((c) => c.getAttribute('data-title')), [
    'Eight weeks for the animals of your town',
    'Learn the law', 'Map your town or district', 'Bring your town onto the RRT', 'Find a lawyer', 'A film for The Wall',
    'Choose three of seven', 'How the eight weeks go', 'A certificate, earned', 'Apply in four steps'
  ]);
  for (const c of cards) {
    assert.ok(c.querySelector(':scope > .card__pill') && c.querySelector(':scope > .card__t') && c.querySelector(':scope > .card__art svg'), 'a pill, a title and a drawing on the face');
    assert.ok(c.querySelector(':scope > .card__more[hidden]'), 'the rest only when the card is opened');
  }
  /* the Academy's own deck, shared */
  assert.match(html, /<link rel="stylesheet" href="assets\/deck\.css">/);
  assert.match(html, /<script src="assets\/deck\.js"><\/script>/);
  assert.match(read('academy.html'), /<script src="assets\/deck\.js"><\/script>/, 'one deck for both pages');
  for (const bit of ['.deck__next', '.deck__show', '.deck__panel[hidden] .deck__close', '[data-deck-pill]', '[data-deck-title]', '[data-deck-body]', '[data-deck-one]', '[data-deck-all]']) {
    assert.ok(doc.querySelector(`#cards ${bit}`), bit);
  }
  /* what is left on the page: the opening, the cards, the questions (and the two forms, closed until asked) */
  assert.deepEqual([...doc.querySelectorAll('main > section')].map((x) => x.id), ['top', 'cards', 'apply', 'proof', 'more']);
  assert.ok(doc.querySelector('#apply[data-flow]') && doc.querySelector('#proof[data-flow]'), 'the forms open only when asked');
});

test('five core tasks in the order of the weeks, seven electives, each with its target and its proof', () => {
  /* owner: "Week 1, animal welfare laws; Week 2, map the district's animal
     welfare resources; Week 3, promote RRT through rapid-response.in,
     targeting 50 people per intern, rather than 100" */
  const core = cardsOf().slice(1, 6);
  assert.deepEqual(core.map((c) => c.getAttribute('data-pill')), ['Core 01 · Week 1', 'Core 02 · Week 2', 'Core 03 · Week 3', 'Core 04 · Week 4', 'Core 05 · Week 5']);
  assert.deepEqual(core.map((c) => c.querySelector('.card__goal').textContent), ['4 laws', '1 district', '50 people', '1 lawyer', '1 film']);
  const rrt = cardTitled('Bring your town onto the RRT');
  assert.match(rrt.querySelector('.card__more').textContent, /rapid-response\.in/);
  assert.match(rrt.querySelector('.card__more').textContent, /a click or a visit to the store is not a join/);
  for (const c of core) {
    assert.ok(c.querySelector('.card__more .vi-how li'), 'how it works');
    assert.ok(c.querySelector(`.card__more a[href="#proof"][data-task="${c.getAttribute('data-title')}"]`), 'and a way to send its proof');
  }
  const film = cardTitled('A film for The Wall');
  assert.match(film.textContent, /informative, really well shot/);
  assert.ok(film.querySelector('a[href="wall.html#submit"]'));
  /* the electives: seven, each under a plus inside one card */
  const el = [...cardTitled('Choose three of seven').querySelectorAll('.vi-el > li > details')];
  assert.deepEqual(el.map((d) => d.querySelector('.vi-el__t').textContent), ['Help at a shelter PFA knows', 'Write for your local paper', 'Ask your town about its dogs', 'Nominate three films for CineKind', 'Give one talk', 'Animal first aid', 'Write your story']);
  assert.match(el[1].textContent, /Reviewed and passed by the PFA team before you send it to the paper/);
  assert.ok(el[3].querySelector('a[href="cinekind.html#nominations"]'));
  assert.match(el[2].textContent, /acknowledgement number/);
  /* the weeks, in that order */
  const weeks = [...cardTitled('How the eight weeks go').querySelectorAll('.vi-weeks > li > b')].map((b) => b.textContent);
  assert.equal(weeks.length, 8);
  assert.deepEqual(weeks.slice(0, 3), ['Animal welfare laws', 'Map your district', 'Bring people onto the RRT']);
  /* the old briefs still hold */
  const all = cardsOf().map((c) => c.textContent).join(' ');
  assert.doesNotMatch(all, /\breels?\b/i, 'no reels');
  assert.doesNotMatch(all, /feeding circle|feeding rota|start(ing)? a feeding|find homes|adopt|foster|catch, transport/i, 'no task an animal could come to depend on');
  assert.match(all, /no animal is ever worse off when the eight weeks end/);
  assert.match(all, /Each target is the least; going past it counts\./);
  assert.ok(!/cruelty|count the dogs/i.test(cardsOf().map((c) => c.getAttribute('data-title')).join(' ')));
  const map = cardTitled('Map your town or district').textContent;
  assert.match(map, /government veterinary centre photographed inside and outside, as it is on the day: never staged/);
  assert.match(map, /Feeding spots already kept by someone near you, located with the feeder's agreement; held by PFA, never published/);
  assert.match(doc.querySelector('#more').textContent, /Why are feeding and adoption not tasks\?/);
  assert.match(doc.querySelector('#more').textContent, /Finding the spots where someone already feeds animals is part of mapping your district; starting one is not\./);
  assert.match(cardTitled('A certificate, earned').textContent, /all eight sign-offs are in: the five core tasks and your three electives/);
});

test('the portal: proof of one task at a time, under the application number, filed as PFA-VP', () => {
  /* owner, 31 Oct 2026: "everything to be proof backed- submitted to pfa on
     the pfa portal" */
  assert.ok(doc.querySelector('#cards a[href="#proof"]'), 'the cards say where the proof goes');
  const form = doc.querySelector('#proof #pfForm');
  assert.ok(form);
  assert.deepEqual([...form.querySelectorAll('.m-step')].map((s) => s.getAttribute('data-step')), ['You', 'The task', 'Where', 'Send']);
  assert.ok(form.querySelector('fieldset[data-address][data-kind="PFA-VP"]'), 'where it was done, as on every form');
  for (const id of ['pfRef', 'pfName', 'pfEmail', 'pfTask', 'pfWhat', 'pfLinks']) assert.ok(form.querySelector(`#${id}[required]`), id);
  assert.ok(form.querySelector('#pfOwn[data-confirm]'), 'their own work, and real');
  const options = [...form.querySelectorAll('#pfTask option')].map((o) => o.textContent).filter((t) => t !== 'Choose the task');
  const tasks = cardsOf().slice(1, 6).map((c) => c.getAttribute('data-title')).concat([...doc.querySelectorAll('.vi-el__t')].map((t) => t.textContent));
  assert.deepEqual(options, tasks, 'every task, in the order of the cards');
  assert.match(html, /kind: 'PFA-VP',\s*page: 'internship\.html'/);
  assert.match(html, /var REF = \/\^PFA-VI-\\d\{4\}-\\d\{5,\}\$\//);
  const S = require('../lib/submissions');
  assert.equal(S.KIND_LABELS['PFA-VP'], 'Internship proof');
  assert.deepEqual(S.STAGES['PFA-VP'].map((x) => x.label), ['Sent', 'Being checked', 'Signed off', 'More needed', 'Withdrawn']);
  const F = require('../lib/submission-fields');
  assert.deepEqual(F.specFor('PFA-VP').options.task, options);
});

test('the photographs are on the site, shown whole at their own shapes', () => {
  for (const img of doc.querySelectorAll('main img')) {
    const src = img.getAttribute('src');
    assert.ok(fs.existsSync(path.join(ROOT, src)), src);
    assert.ok(img.getAttribute('alt'), `${src} has words for a screen reader`);
  }
  assert.equal(doc.querySelectorAll('main img').length, 1, 'one photograph, the opening');
});

test('the certificate in its blue, with the reader\'s name, marked SAMPLE', () => {
  assert.ok(cardTitled('A certificate, earned').querySelector('canvas.vi-cert__canvas') && cardTitled('A certificate, earned').querySelector('input.vi-try'));
  assert.match(html, /<script src="assets\/certificate\.js"><\/script>/);
  assert.match(html, /deck\.addEventListener\('deck:open', function \(e\) \{ drawIn\(e\.detail && e\.detail\.panel\); \}\)/, 'drawn when its card opens');
  assert.match(html, /startDate: iso\(start\), endDate: iso\(end\), issuedOn: iso\(end\), sample: true \}, 1\)/);
  const js = read('assets/certificate.js');
  assert.match(js, /if \(d\.sample\) \{/);
  assert.match(js, /ctx\.fillText\('SAMPLE'/);
});

test('the application: four steps, the address, a parent for 16 and 17, filed as PFA-VI', () => {
  const form = doc.querySelector('#viForm');
  assert.deepEqual([...form.querySelectorAll('.m-step')].map((s) => s.getAttribute('data-step')), ['You', 'Where', 'Why', 'Send']);
  assert.ok(form.querySelector('fieldset[data-address][data-kind="PFA-VI"]'));
  assert.ok(form.querySelector('#minorBox[hidden] #parent'));
  assert.match(html, /kind: 'PFA-VI',\s*page: 'internship\.html'/);
  assert.match(html, /a < 16 \? 'The internship is for people aged 16 and over\.'/);
  const S = require('../lib/submissions');
  assert.equal(S.KIND_LABELS['PFA-VI'], 'Remote internship application');
  const F = require('../lib/submission-fields');
  assert.equal(F.specFor('PFA-VI').page, 'internship.html');
  assert.ok(require('../lib/confirmations.js'));
  assert.ok(!/[–—]/.test(html.replace(/<script id="pfa-vis">[\s\S]*?<\/script>/, '')), 'no dashes');
});

test('no mentors and no weekly sessions are promised, anywhere the intern reads', () => {
  /* owner, 1 Nov 2026: "Planned with your mentor first.. this is not
     feasible.. dont mention mentors anywhere.." */
  assert.doesNotMatch(html, /mentor/i, 'not on the page, its description or its comments');
  assert.doesNotMatch(html, /every Saturday|weekly log/i, 'and no session or log that needs one');
  const S = require('../lib/submissions');
  const C = require('../lib/confirmations');
  for (const kind of ['PFA-VI', 'PFA-VP']) {
    assert.doesNotMatch(JSON.stringify(S.STAGES[kind]), /mentor/i, `${kind}: the stages`);
    assert.doesNotMatch(JSON.stringify(C.forKind ? C.forKind(kind) : C), /mentor/i, `${kind}: the confirmation`);
  }
  assert.doesNotMatch(read('search-index.json'), /mentors you|your mentor|PFA mentor/i, 'nor in site search');
});


test('short forms show their full form on hover or a tap, across the site', () => {
  /* owner, 1 Nov 2026: "items like tl;dr when someone hovers over abbrev like
     these- full form should appear" */
  const js = read('assets/chrome.js');
  for (const [w, full] of [['TL;DR', 'Too long; didn'], ['RRT', 'Rapid Response Team'], ['RTI', 'Right to Information'], ['ABC', 'Animal Birth Control'], ['PCA', 'Prevention of Cruelty to Animals'], ['AWBI', 'Animal Welfare Board of India']]) {
    assert.ok(js.includes(`'${w}': '${full}`), w);
  }
  assert.ok(!/'PFA':/.test(js), 'the site\'s own name is left alone');
  assert.match(js, /header\.site,\.pfa-tabs,\.pfa-footer,\[data-no-abbr\]/, 'never in the header, menus or footer');
  assert.match(read('assets/chrome.css'), /abbr\.pfa-abbr\{text-decoration:underline dotted;/);
  assert.match(read('assets/chrome.css'), /\.pfa-abbr-tip\.is-on\{opacity:1;visibility:visible\}/);
  assert.ok(!/[–—]/.test(js), 'no dashes');
});
