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
  assert.ok(open.querySelector('a[href="#discover"]') && doc.querySelector('#discover'));
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

test('five core tasks and seven electives, each with a target and its detail under a plus; eight weeks', () => {
  /* owner, 31 Oct 2026: "say 5 mandatory activities, 3 optional. like in
     engineering degree" */
  const core = [...doc.querySelectorAll('#viCore > li.vi-task')];
  const elect = [...doc.querySelectorAll('#viElect > li.vi-task')];
  assert.equal(core.length, 5);
  assert.equal(elect.length, 7);
  assert.match(doc.querySelector('#tasks h2').textContent, /Five core tasks\. Three you choose\./);
  assert.match(doc.querySelector('#viElect').closest('.vi-group').querySelector('.vi-group__head').textContent, /Choose three of these seven/);
  const tasks = core.concat(elect);
  for (const t of tasks) {
    const row = t.querySelector(':scope > button.vi-task__row[aria-expanded="false"]');
    assert.ok(row, 'each task a card that opens');
    assert.ok(row.querySelector('.vi-goal b') && row.querySelector('.vi-goal small'), 'a target and its unit, on the card');
    const more = t.querySelector(`:scope > .vi-task__more#${row.getAttribute('aria-controls')}`);
    assert.ok(more && more.querySelector('p') && more.querySelectorAll('ul > li').length >= 3, 'what it is and how it works, when opened');
  }
  assert.deepEqual(tasks.map((t) => t.querySelector('.vi-task__no').textContent), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
  assert.equal(doc.querySelectorAll('.vi-weeks > li').length, 8);
  /* the board (owner, 1 Nov 2026: "internship page cannot have too much
     scroll. but cannot be half baked, think amazing UI UX"): core or
     electives one at a time, the open card in full beside the list on a
     wide screen and in place on a phone; without the script, all of it */
  const sw = doc.querySelector('#tasks .vi-switch[role="tablist"][hidden]');
  assert.ok(sw, 'the switch appears only when the script is there to work it');
  assert.deepEqual([...sw.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-controls')), ['viCoreGroup', 'viElectGroup']);
  assert.ok(doc.querySelector('#viDetail[aria-live="polite"][hidden]'));
  assert.match(html, /@media \(min-width:961px\)\{\s*\.vi-js \.vi-board\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(html, /\.vi-js \.vi-task\.is-open \.vi-task__more\{display:block/);
  assert.match(html, /\.vi-task\.is-open \.vi-task__icon\{transform:rotate\(45deg\)\}/, 'open, the plus turns to a cross: never a bar');
  assert.match(html, /a\.innerHTML = 'Send the proof for this task ' \+ ARROW;/);
  assert.match(html, /if \(a && pick\) pick\.value = a\.getAttribute\('data-task'\);/, 'and the portal opens on that task');
  assert.match(html, /\.vi-weeks\{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:62%;overflow-x:auto/, 'the weeks swiped on a phone, in one row');
  assert.ok(!doc.querySelector('#together'), 'no band that is only a photograph');

  /* the core (owner, 31 Oct 2026: "rrt, learn the law, 1 lawyer, min 1 video
     to the wall (informative, really well shot, awarenes), map the
     town/district"), and no reels: "10 reels are too many" */
  const coreTitles = core.map((t) => t.querySelector('.vi-task__title').textContent);
  assert.deepEqual(coreTitles, ['Bring your town onto the RRT', 'Learn the law', 'Find a lawyer', 'A film for The Wall', 'Map your town or district']);
  const film = core[3];
  assert.equal(film.querySelector('.vi-goal').textContent, '1film');
  assert.match(film.textContent, /informative, really well shot/);
  assert.ok(film.querySelector('a[href="wall.html#submit"]'), 'the task leads to The Wall');
  const all = tasks.map((t) => t.textContent).join(' ');
  assert.doesNotMatch(all + doc.querySelector('.vi-weeks').textContent + doc.querySelector('#more').textContent, /\breels?\b/i, 'no reels anywhere');
  assert.match(doc.querySelector('#tasks .m-head').textContent, /Each target is the least; going past it counts\./, 'more is better');

  /* the electives: the paper article in place of the guide, reviewed by PFA
     first; CineKind nominations (owner, 31 Oct 2026: "identify 3 movies that
     qualfy cinekind and nominate. link to cinekind site nomination link") */
  const electTitles = elect.map((t) => t.querySelector('.vi-task__title').textContent);
  assert.ok(!electTitles.concat(coreTitles).includes('Put a PFA guide in your language'));
  const paper = elect[electTitles.indexOf('Write for your local paper')];
  assert.ok(paper, 'the newspaper article is an elective');
  assert.match(paper.textContent, /Reviewed and passed by the PFA team before you send it to the paper/);
  const ck = elect[electTitles.indexOf('Nominate three films for CineKind')];
  assert.ok(ck && ck.querySelector('a[href="cinekind.html#nominations"]') && doc.querySelector('#nominations') === null);
  assert.ok(read('cinekind.html').includes('id="nominations"'), 'the link lands on the nominations');
  assert.equal(ck.querySelector('.vi-goal b').textContent, '3');

  /* safety and proof, kept from the first briefs */
  assert.doesNotMatch(all + doc.querySelector('.vi-weeks').textContent, /feeding circle|feeding rota|start(ing)? a feeding|feed (them|the dogs|the animals) (every|daily)|find homes|adopt|foster|catch, transport/i, 'no task an animal could come to depend on');
  assert.match(doc.querySelector('#tasks .m-head').textContent, /no animal is ever worse off when the eight weeks end/);
  assert.ok(!electTitles.concat(coreTitles).some((x) => /cruelty|count the dogs/i.test(x)), 'neither task is set');
  assert.ok(electTitles.includes('Ask your town about its dogs'));
  assert.match(all, /acknowledgement number/, 'the RTI is proved by its acknowledgement');
  for (const t of tasks.filter((x) => x.querySelector('.vi-task__title').textContent !== 'Write your story')) {
    assert.match(t.querySelector('.vi-task__more').textContent, /Proof|signed off|PFA chooses|confirmed/i, `${t.querySelector('.vi-task__title').textContent} says how it is proved`);
  }
  assert.match(doc.querySelector('#more').textContent, /Why are feeding and adoption not tasks\?/);
  assert.match(doc.querySelector('#more').textContent, /no starting a feeding spot, no fostering and no adoptions as part of the internship/);
  /* owner, 1 Nov 2026: "this can be locate feeding spots, take photos, of
     govt vet centers, inside , outside. as is . not staged." Feeding spots
     are found, never started, and kept off the public directory. */
  const map = core[4].querySelector('.vi-task__more').textContent;
  assert.match(map, /government veterinary centre photographed inside and outside, as it is on the day: never staged/);
  assert.match(map, /Feeding spots already kept by someone near you, located with the feeder's agreement; held by PFA, never published/);
  assert.match(doc.querySelector('#more').textContent, /Finding the spots where someone already feeds animals is part of mapping your district; starting one is not\./);
  assert.match(doc.querySelector('#certificate').textContent, /all eight sign-offs are in: the five core tasks and your three electives/);
});

test('the portal: proof of one task at a time, under the application number, filed as PFA-VP', () => {
  /* owner, 31 Oct 2026: "everything to be proof backed- submitted to pfa on
     the pfa portal" */
  assert.ok(doc.querySelector('.vi-proof a[href="#proof"]'), 'the tasks say where the proof goes');
  const form = doc.querySelector('#proof #pfForm');
  assert.ok(form);
  assert.deepEqual([...form.querySelectorAll('.m-step')].map((s) => s.getAttribute('data-step')), ['You', 'The task', 'Where', 'Send']);
  assert.ok(form.querySelector('fieldset[data-address][data-kind="PFA-VP"]'), 'where it was done, as on every form');
  for (const id of ['pfRef', 'pfName', 'pfEmail', 'pfTask', 'pfWhat', 'pfLinks']) assert.ok(form.querySelector(`#${id}[required]`), id);
  assert.ok(form.querySelector('#pfOwn[data-confirm]'), 'their own work, and real');
  const options = [...form.querySelectorAll('#pfTask option')].map((o) => o.textContent).filter((t) => t !== 'Choose the task');
  assert.deepEqual(options, [...doc.querySelectorAll('.vi-task__title')].map((h) => h.textContent), 'every task, in order');
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
  assert.match(html, /\.m-ph\.vi-intro__ph\{margin:0;aspect-ratio:2000\/1335\}/, 'the intro photograph at its own shape');
});

test('the certificate in its blue, with the reader\'s name, marked SAMPLE', () => {
  assert.ok(doc.querySelector('canvas#viCert'));
  assert.match(html, /<script src="assets\/certificate\.js"><\/script>/);
  assert.match(html, /C\.draw\(canvas, \{ name: name, startDate: iso\(start\), endDate: iso\(end\), issuedOn: iso\(end\), sample: true \}, 1\)/);
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

test('the targets line up down the list, on a wide screen and on a phone', () => {
  /* owner, 1 Nov 2026: "looks odd, not aligned properly..it is here and there" */
  assert.match(html, /\.vi-task__row \.vi-goal\{display:grid;grid-template-columns:46px 78px;column-gap:8px\}/, 'figures end on one line, units start on the next');
  assert.match(html, /\.vi-task__row \.vi-goal b\{text-align:right\}/);
  assert.match(html, /\.vi-task__row \.vi-goal\{grid-column:2;grid-row:2;display:flex;gap:6px\}/, 'on a phone the target sits under the title, where every target starts');
});
