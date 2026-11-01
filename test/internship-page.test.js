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
  assert.ok(open.querySelector('a[href="#collection"]') && doc.querySelector('section.vc#collection'), 'and leads to the cards');
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

/* how it works first, then the tasks in two lanes (owner, 1 Nov 2026:
   "process should be explained 1st and then only if clicks continue. show
   the tasks - mandatory and optional ones. separate lanes for both") */
const stepsOf = () => [...doc.querySelectorAll('#collection .vc-process .vc-gal > button.vc-sl')];
const coreOf = () => [...doc.querySelectorAll('#collection .vc-tasks .vc-lane__row--core > button.vc-tk')];
const optOf = () => [...doc.querySelectorAll('#collection .vc-tasks .vc-lane__row--opt > button.vc-tk')];
const tasksOf = () => coreOf().concat(optOf());
const cardsOf = () => stepsOf().concat(tasksOf());
const cardTitled = (t) => cardsOf().find((c) => c.getAttribute('data-title') === t);
const cardJs = read('assets/internship-cards.js');

test('how it works first; Continue shows the tasks, mandatory and optional in their own lanes', () => {
  assert.deepEqual(stepsOf().map((c) => c.getAttribute('data-title')), [
    'Apply', 'Follow the weekly plan', 'Send proof as you go', 'Earn your certificate'
  ]);
  /* owner, 1 Nov 2026 (internship-process.html): the process in one line and
     four numbers above its four steps, and "No experience with animals is
     needed." under Continue */
  assert.equal(doc.querySelector('#vcTitle').textContent, 'Eight weeks. Real work. A kinder town.');
  assert.deepEqual([...doc.querySelectorAll('#collection .vc-process .vc-facts li')].map((l) => l.textContent), ['8 weeks', '6 to 8 hours a week', '5 + 3 tasks', 'Free to join']);
  assert.match(doc.querySelector('#collection .vc-process .vc-note').textContent, /^No experience with animals is needed\.$/);
  assert.match(cardJs, /tasks: \['Your eight-week plan', 'Five for everyone\. Three of your choosing\.'\]/);
  assert.equal(doc.querySelector('#vcMand').textContent, 'Mandatory tasks');
  assert.equal(doc.querySelector('#vcOpt').textContent, 'Optional tasks');
  const tasks = doc.querySelector('#collection [data-vc-tasks]');
  assert.ok(tasks.hasAttribute('hidden'), 'the tasks wait for Continue');
  assert.ok(doc.querySelector('#collection [data-vc-process] [data-vc-continue]'), 'Continue, under the steps');
  assert.match(cardJs, /if \(cont\) cont\.addEventListener\('click', function \(\) \{ show\('tasks'\); \}\);/);
  assert.equal(tasks.querySelector('.vc-lane:not(.vc-lane--opt) .vc-tag').textContent, 'Lane 01');
  assert.equal(tasks.querySelector('.vc-lane--opt .vc-tag').textContent, 'Lane 02');
  assert.deepEqual(coreOf().map((c) => c.getAttribute('data-title')), ['Learn the law', 'Map your town or district', 'Bring your town onto the RRT', 'Find a lawyer', 'A film for The Wall']);
  assert.deepEqual(optOf().map((c) => c.getAttribute('data-title')), ['Help at a shelter PFA knows', 'Write for your local paper', 'Ask your town about its dogs', 'Nominate three films for CineKind', 'Give one talk', 'Animal first aid', 'Write your story']);
  for (const c of cardsOf()) {
    assert.ok(c.querySelector(':scope > .vc-more[hidden]'), 'the rest only when the card is opened');
    assert.ok(c.getAttribute('data-pill') && c.getAttribute('data-title'));
  }
  for (const c of stepsOf().concat(coreOf())) assert.ok(c.querySelector('img[src^="media/internship/"]'), 'a photograph on the face');
  /* "nothing should clip anything or overlap/overlay anything": the steps
     side by side, a card opened in the section's own place, never over it */
  assert.match(html, /\.vc-gal\{display:grid;grid-template-columns:repeat\(4,/);
  assert.ok(doc.querySelector('#collection > .vc-rd#vcReader[hidden]'), 'the reader is inside the section');
  assert.ok(!doc.querySelector('dialog'), 'nothing laid over the page');
  assert.match(html, /\.vc\.is-reading > :not\(\.vc-rd\)\{display:none!important\}/);
  assert.doesNotMatch(html.slice(html.indexOf('/* ---------- the collection'), html.indexOf('/* the RRT')), /position:(absolute|fixed)|rotate|overflow:hidden;[^}]*\.vc-sl/, 'no card lies across another');
  /* "all the cards should open without scroll. each one" */
  assert.match(html, /\.vc-rd\{[^}]*max-height:calc\(var\(--room\) - 72px\);[^}]*overflow:hidden\}/);
  assert.match(cardJs, /while \(over\(\) && z > 0\.55\)/);
  assert.match(cardJs, /fit\(\);\s*root\.setTimeout\(fit, 120\);\s*root\.setTimeout\(fit, 500\);/);
  /* one screen: the next section never shows at its foot */
  assert.match(html, /\.vc\{--room:calc\(100svh - var\(--ann,34px\) - var\(--nav,81px\) - var\(--tabbar,0px\)\);[^}]*min-height:var\(--room\)/);
  /* "ensure all text is centered to buttons" */
  assert.match(html, /\.vc \.btn\{[^}]*text-indent:\.12em\}/);
  assert.match(html, /<script src="assets\/internship-cards\.js"><\/script>/);
  assert.doesNotMatch(html, /assets\/deck\.(js|css)/, 'the Academy keeps its own deck');
  assert.match(read('academy.html'), /<script src="assets\/deck\.js"><\/script>/);
  /* what is left on the page: the opening, the cards, the questions (and the two forms, closed until asked) */
  assert.deepEqual([...doc.querySelectorAll('main > section')].map((x) => x.id), ['top', 'collection', 'apply', 'proof', 'more']);
  assert.ok(doc.querySelector('#apply[data-flow]') && doc.querySelector('#proof[data-flow]'), 'the forms open only when asked');
});

test('five core tasks in the order of the weeks, seven electives, each with its target and its proof', () => {
  /* owner: "Week 1, animal welfare laws; Week 2, map the district's animal
     welfare resources; Week 3, promote RRT through rapid-response.in,
     targeting 50 people per intern, rather than 100" */
  const core = coreOf();
  assert.deepEqual(core.map((c) => c.getAttribute('data-pill')), ['Core 01 · Week 1', 'Core 02 · Week 2', 'Core 03 · Week 3', 'Core 04 · Week 4', 'Core 05 · Week 5']);
  assert.deepEqual(core.map((c) => c.querySelector('.vc-tk__goal').textContent), ['4 laws', '1 district', '50 people', '1 lawyer', '1 film']);
  const rrt = cardTitled('Bring your town onto the RRT');
  /* owner, 1 Nov 2026: "have the hyperlink to the website , app download section" */
  assert.deepEqual([...rrt.querySelectorAll('.vc-more .vi-links a')].map((a) => a.getAttribute('href')), [
    'https://rapid-response.in', 'https://play.google.com/store/apps/details?id=com.rrt.sos', 'https://apps.apple.com/in/app/rapid-response/id6758672498'
  ]);
  assert.ok(rrt.querySelector('.vc-more p a[href="https://rapid-response.in"]'), 'rapid-response.in in the words is a link too');
  assert.match(rrt.querySelector('.vc-more').textContent, /rapid-response\.in/);
  assert.match(rrt.querySelector('.vc-more').textContent, /a click or a visit to the store is not a join/);
  for (const c of core) {
    assert.ok(c.querySelector('.vc-more .vi-how li'), 'how it works');
    assert.ok(c.querySelector(`.vc-more a[href="#proof"][data-task="${c.getAttribute('data-title')}"]`), 'and a way to send its proof');
  }
  const film = cardTitled('A film for The Wall');
  assert.match(film.textContent, /informative, really well shot/);
  assert.ok(film.querySelector('a[href="wall.html#submit"]'));
  /* the electives: seven, each its own card in the optional lane */
  const el = optOf();
  assert.deepEqual(el.map((c) => c.querySelector('.vc-tk__no').textContent), ['06', '07', '08', '09', '10', '11', '12']);
  for (const c of el) assert.ok(c.querySelector(`.vc-more a[href="#proof"][data-task="${c.getAttribute('data-title')}"]`), 'and a way to send its proof');
  assert.match(el[1].textContent, /Reviewed and passed by the PFA team before you send it to the paper/);
  assert.ok(el[3].querySelector('a[href="cinekind.html#nominations"]'));
  assert.match(el[2].textContent, /acknowledgement number/);
  /* the weeks, in that order */
  const weeks = [...cardTitled('Follow the weekly plan').querySelectorAll('.vi-weeks > li > b')].map((b) => b.textContent);
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
  assert.match(cardTitled('Earn your certificate').textContent, /all eight sign-offs are in: the five core tasks and your three electives/);
  assert.match(doc.querySelector('.vc-lane--opt').textContent, /Weeks 6 and 7\. Choose any three of seven; doing more counts too\./);
});

test('the portal: proof of one task at a time, under the application number, filed as PFA-VP', () => {
  /* owner, 31 Oct 2026: "everything to be proof backed- submitted to pfa on
     the pfa portal" */
  assert.ok(doc.querySelector('#collection .vc-tasks a[href="#proof"]'), 'the cards say where the proof goes');
  const form = doc.querySelector('#proof #pfForm');
  assert.ok(form);
  assert.deepEqual([...form.querySelectorAll('.m-step')].map((s) => s.getAttribute('data-step')), ['You', 'The task', 'Where', 'Send']);
  assert.ok(form.querySelector('fieldset[data-address][data-kind="PFA-VP"]'), 'where it was done, as on every form');
  for (const id of ['pfRef', 'pfName', 'pfEmail', 'pfTask', 'pfWhat', 'pfLinks']) assert.ok(form.querySelector(`#${id}[required]`), id);
  assert.ok(form.querySelector('#pfOwn[data-confirm]'), 'their own work, and real');
  const options = [...form.querySelectorAll('#pfTask option')].map((o) => o.textContent).filter((t) => t !== 'Choose the task');
  const tasks = tasksOf().map((c) => c.getAttribute('data-title'));
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
  /* the opening; a photograph on each step and each core task, and one for
     the shelter elective's open card (owner, 1 Nov 2026) */
  assert.equal(doc.querySelectorAll('main img').length, 11);
  /* each card photograph says its true size, so it is never drawn stretched */
  for (const img of doc.querySelectorAll('#collection img')) {
    for (const src of [img.getAttribute('src')].concat(img.getAttribute('srcset').split(',').map((x) => x.trim().split(' ')[0]))) {
      const b = fs.readFileSync(path.join(ROOT, src));
      const kind = b.toString('ascii', 12, 16);
      const size = kind === 'VP8X' ? [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
        : kind === 'VP8 ' ? [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
          : [(b.readUInt32LE(21) & 0x3fff) + 1, ((b.readUInt32LE(21) >> 14) & 0x3fff) + 1];
      assert.equal(size[0] * 9, size[1] * 16, `${src} is 16:9, the shape of its frame`);
    }
    assert.equal(Number(img.getAttribute('width')) * 9, Number(img.getAttribute('height')) * 16);
  }
  /* "no part of the photo can be clipped or messed with": every frame the
     photograph's own shape, whole, never zoomed */
  assert.match(html, /\.vc-sl__ph,\.vc-tk__ph\{display:block;width:100%;aspect-ratio:16\/9;/);
  const finish = html.slice(html.indexOf('<style id="internship-photographic-finish">'));
  assert.match(finish, /\.vc-sl__ph img,\.vc-tk__ph img,\.vc-rd__ph img\{object-fit:contain;/);
  assert.doesNotMatch(finish.slice(0, finish.indexOf('</style>')), /object-fit:cover|scale\(/);
});

test('the certificate in its blue, with the reader\'s name, marked SAMPLE', () => {
  assert.ok(cardTitled('Earn your certificate').querySelector('canvas.vi-cert__canvas') && cardTitled('Earn your certificate').querySelector('input.vi-try'));
  assert.match(html, /<script src="assets\/certificate\.js"><\/script>/);
  assert.match(html, /document\.addEventListener\('vc:open', function \(e\) \{ drawIn\(e\.detail && e\.detail\.panel\); \}\)/, 'drawn when its card opens');
  assert.match(cardJs, /new root\.CustomEvent\('vc:open', \{ detail: \{ card: c, panel: reader \} \}\)/);
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
