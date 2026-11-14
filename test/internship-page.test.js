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
  assert.ok(open.querySelector('a[href="#collection"]') && doc.querySelector('section#collection #internship-process'), 'and leads to the field notes');
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

/* The field notes (owner, 1 Nov 2026: "this is how the internship page
   should be", internship-process.html, exactly): how the internship works
   first, then on Continue the tasks in two lanes, mandatory and optional; a
   card opens its task in the reader under its lane. */
const lanes = JSON.parse(doc.querySelector('#lane-data').textContent);
const photos = JSON.parse(doc.querySelector('#v-data').textContent);
const cards = () => [...doc.querySelectorAll('#collection #task-lanes .lane-card')];
const laneOf = (name) => [...doc.querySelectorAll(`#collection .lane-track[data-lane="${name}"] > .lane-card`)];
const task = (t) => lanes.find((x) => x.title === t);
const fnJs = read('assets/internship-fieldnotes.js');

const TASKS = ['Learn the law', 'Map your district', 'Bring 50 people onto the RRT', 'Two films for The Wall', 'Shelter work', 'An RTI to the municipality', 'One CineKind nomination', 'Your own story with animals'];

test('how the internship works first; Continue shows the eight tasks every intern does', () => {
  /* owner, 2 Nov 2026: "All interns do all 8 in 2 months" */
  const intro = doc.querySelector('#collection #internship-process');
  assert.equal(intro.querySelector('h2').innerHTML, 'Eight weeks. Real work.<br>A kinder town.');
  assert.deepEqual([...intro.querySelectorAll('.process-facts > span')].map((x) => x.textContent), ['8 weeks', '6-8 hours a week', '8 tasks', 'Free to join']);
  assert.deepEqual([...intro.querySelectorAll('.process-steps h3')].map((x) => x.textContent), ['Apply', 'Follow the weekly plan', 'Send proof as you go', 'Earn your certificate']);
  assert.match(intro.textContent, /One task a week, eight in all, the same for every intern\./);
  assert.match(intro.textContent, /Your certificate is issued once all eight tasks are signed off\./);
  assert.doesNotMatch(intro.textContent + doc.querySelector('#more').textContent, /elective|optional task|choose three|three of seven/i, 'no choice left in the plan');
  assert.ok(intro.querySelector('#process-continue'));
  assert.equal(intro.querySelector('.process-note').textContent, 'No experience with animals is needed.');
  const tl = doc.querySelector('#collection #task-lanes');
  assert.ok(tl.hasAttribute('hidden'), 'the tasks wait for Continue');
  /* owner, 2 Nov 2026: "8 tasks, all 8 for everyone sounds redundant": the rhythm, then the count once */
  assert.equal(tl.querySelector('.lanes-heading h2').innerHTML, 'One task a week.<br>Each one signed off.');
  assert.equal(tl.querySelector('.lane-head p:not(.lane-kicker)').textContent, 'The same eight for every intern. Open a card for its target and proof.');
  assert.equal(tl.querySelector('.lane-help'), null, 'said once, in the lane head');
  assert.equal(tl.querySelectorAll('.task-lane').length, 1, 'one lane');
  assert.equal(doc.querySelector('#all-heading').textContent, 'Your eight tasks');
  assert.match(fnJs, /next\.addEventListener\('click',\(\)=>\{intro\.hidden=true;lanes\.hidden=false;/);
  assert.deepEqual(laneOf('all').map((c) => lanes[Number(c.getAttribute('data-task-index'))].title), TASKS, 'the eight, in the order of the weeks');
  assert.deepEqual(lanes.map((t) => t.title), TASKS);
  for (const c of cards()) assert.equal(c.querySelector('.lane-card-title').textContent, lanes[Number(c.getAttribute('data-task-index'))].title);
  assert.ok(doc.querySelector('#v-reader .v-readclose'), 'the reader closes');
  assert.ok(doc.querySelector('#apply[data-flow]') && doc.querySelector('#proof[data-flow]'), 'the forms open only when asked');
});

test('each of the eight with its week, its target and its proof', () => {
  assert.deepEqual(laneOf('all').map((c) => c.querySelector('.lane-card-pill').textContent),
    ['TASK 1 · WEEK 1', 'TASK 2 · WEEK 2', 'TASK 3 · WEEK 3', 'TASK 4 · WEEK 4', 'TASK 5 · WEEKS 5-6', 'TASK 6 · WEEK 6', 'TASK 7 · WEEK 7', 'TASK 8 · WEEK 8']);
  assert.deepEqual(laneOf('all').map((c) => c.querySelector('.lane-card-bottom').textContent),
    ['25 questions · View task', '1 district · View task', '50 people · View task', '2 films · View task', '20 hours · View task', '1 RTI · View task', '1 nomination · View task', '1 story · View task']);
  const body = (t) => new JSDOM(task(t).body).window.document;
  for (const t of lanes) {
    const b = body(t.title);
    assert.ok(b.querySelector('.vi-how li'), `${t.title}: how it is done`);
    if (t.title === 'Learn the law') assert.ok(b.querySelector('a[href="intern.html"]'), 'the law task: its quiz, in the portal');
    else assert.ok(b.querySelector(`a[href="#proof"][data-task="${t.title}"]`), `${t.title}: a way to send its proof`);
  }
  /* 1: the four laws and ten common incidents, then the 25-question quiz in the portal (3 Nov 2026; 25 from 14 Nov 2026) */
  const law = body('Learn the law');
  assert.deepEqual([...law.querySelectorAll('.vi-how li')].slice(0, 4).map((li) => li.textContent), ['Section 325 of the Bharatiya Nyaya Sanhita', 'The Prevention of Cruelty to Animals Act, 1960', 'The ABC Rules, 2023, and the right to feed community animals', 'Article 51A(g) of the Constitution: compassion for living creatures']);
  assert.match(law.querySelector('.vi-goal-line').textContent, /10 incidents, 25 questions/);
  assert.match(law.querySelector('.vi-qs').textContent, /Two or three questions on each incident, easy, medium and hard, worth 1, 2 and 3 marks, all 25 mixed\./);
  assert.match(law.querySelector('.vi-qs').textContent, /Two minutes a question\./);
  assert.ok(law.querySelector('[data-law-sample-host] [data-law-sample]'), 'the practice round, from the task itself');
  assert.match(law.querySelector('.vi-qs').textContent, /Pass with 60 percent\. Three attempts/);
  /* 2: names, addresses and phone numbers, and at least ten activists */
  const map = task('Map your district').body;
  assert.match(map, /vets, government vet centres, shelters and ABC centres in your district, and at least 10 animal activists/);
  assert.match(map, /the name, the address and a phone number, checked by a call/);
  assert.match(map, /government vet centre photographed inside and outside, as it is on the day: never staged/);
  /* 3: fifty people, counted on the app */
  const rrt = body('Bring 50 people onto the RRT');
  assert.deepEqual([...rrt.querySelectorAll('.vi-links a')].map((a) => a.getAttribute('href')), [
    'https://rapid-response.in', 'https://play.google.com/store/apps/details?id=com.rrt.sos', 'https://apps.apple.com/in/app/rapid-response/id6758672498'
  ]);
  assert.match(rrt.body.textContent, /a click or a visit to the store is not a join/);
  /* 4 to 8 */
  assert.match(task('Two films for The Wall').body, /Two well-made films of about one minute each/);
  assert.match(task('Shelter work').body, /<b>20<\/b> hours/);
  assert.match(task('An RTI to the municipality').body, /acknowledgement number/);
  assert.match(task('One CineKind nomination').body, /cinekind\.html#nominations/);
  assert.match(task('Your own story with animals').body, /Four to six hundred words, with photographs/);
  /* the old briefs still hold */
  const all = lanes.map((t) => t.body).join(' ');
  assert.doesNotMatch(all, /\breels?\b/i, 'no reels');
  assert.doesNotMatch(all, /feeding circle|feeding rota|start(ing)? a feeding|find homes|adopt|foster|catch, transport/i, 'no task an animal could come to depend on');
  assert.match(doc.querySelector('#more').textContent, /Why are feeding and adoption not tasks\?/);
});

test('the portal: proof of one task at a time, under the application number, filed as PFA-VP', () => {
  /* owner, 31 Oct 2026: "everything to be proof backed- submitted to pfa on
     the pfa portal" */
  assert.ok(doc.querySelector('#collection .v-toplinks a[href="#proof"]'), 'the notes say where the proof goes');
  const form = doc.querySelector('#proof #pfForm');
  assert.ok(form);
  assert.deepEqual([...form.querySelectorAll('.m-step')].map((s) => s.getAttribute('data-step')), ['You', 'The task', 'Where', 'Send']);
  assert.ok(form.querySelector('fieldset[data-address][data-kind="PFA-VP"]'), 'where it was done, as on every form');
  for (const id of ['pfRef', 'pfName', 'pfEmail', 'pfTask', 'pfWhat', 'pfLinks']) assert.ok(form.querySelector(`#${id}[required]`), id);
  assert.ok(form.querySelector('#pfOwn[data-confirm]'), 'their own work, and real');
  const options = [...form.querySelectorAll('#pfTask option')].map((o) => o.textContent).filter((t) => t !== 'Choose the task');
  assert.deepEqual(options, lanes.map((t) => t.title), 'every task, in the order of the lanes');
  assert.match(html, /kind: 'PFA-VP',\s*page: 'internship\.html'/);
  assert.match(html, /var REF = \/\^PFA-VI-\\d\{4\}-\\d\{5,\}\$\//);
  const S = require('../lib/submissions');
  assert.equal(S.KIND_LABELS['PFA-VP'], 'Internship proof');
  assert.deepEqual(S.STAGES['PFA-VP'].map((x) => x.label), ['Sent', 'Being checked', 'Signed off', 'More needed', 'Withdrawn']);
  const F = require('../lib/submission-fields');
  assert.deepEqual(F.specFor('PFA-VP').options.task, options);
});

test('the photographs are on the site, as files, each with words for a screen reader', () => {
  for (const img of doc.querySelectorAll('main img[src]')) {
    const src = img.getAttribute('src');
    assert.ok(fs.existsSync(path.join(ROOT, src)), src);
    assert.ok(img.getAttribute('alt'), `${src} has words for a screen reader`);
  }
  assert.equal(photos.length, 10);
  for (const p of photos) {
    assert.match(p.img, /^media\/internship\/field-notes\/\d\d\.webp$/);
    assert.ok(fs.existsSync(path.join(ROOT, p.img)), p.img);
    assert.ok(p.alt, `${p.img} has words for a screen reader`);
  }
  for (const c of cards()) assert.ok(photos[Number(c.querySelector('img').getAttribute('data-photo'))], 'each card names a photograph');
  /* owner, 2 Nov 2026: the logo and the words under it render properly, the words in white on the dark */
  const logo = path.join(ROOT, 'media/internship/field-notes/pfa-logo-white.webp');
  assert.ok(fs.existsSync(logo), 'the logo, as a file');
  assert.ok(fs.statSync(logo).size < 120 * 1024, 'light enough');
  assert.match(read('assets/internship-fieldnotes.js'), /im\.src='media\/internship\/field-notes\/pfa-logo-white\.webp'/);
  assert.match(html, /<canvas id="pfa-official-dark" aria-label="People For Animals™ official logo" role="img" width="600" height="403"><\/canvas>/);
  assert.doesNotMatch(html, /data:image\/(webp|png|jpe?g)/, 'no photograph inlined in the page');
  /* "no part of the photo can be clipped or messed with": the card and the
     reader show each photograph whole */
  assert.match(html, /\.lane-card img\{height:auto;aspect-ratio:16\/9;object-fit:contain;/);
  assert.match(html, /#v-reader \.v-readimg img\{position:static;width:100%;height:auto;object-fit:contain;/);
});

test('the certificate, as the portal issues it: the owner\'s design (11 Nov 2026), marked SAMPLE when a sample', () => {
  const js = read('assets/certificate.js');
  assert.match(js, /if \(d\.sample\) \{/);
  assert.match(js, /spaced\(ctx, 'SAMPLE', 0, 9, gap, 'center'\);/);
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

test('the sample certificate: under step 04, opened when asked, drawn SAMPLE with the reader\'s name as they type', () => {
  const step = [...doc.querySelectorAll('#internship-process .process-steps li')][3];
  const peek = step.querySelector('button.cert-peek');
  assert.ok(peek, 'a "See a sample certificate" control on Earn your certificate');
  assert.equal(peek.textContent, 'See a sample certificate');
  assert.equal(peek.getAttribute('aria-controls'), 'cert-sample');
  assert.equal(peek.getAttribute('aria-expanded'), 'false');
  const box = doc.querySelector('#internship-process #cert-sample');
  assert.ok(box && box.hasAttribute('hidden'), 'hidden until asked for');
  assert.ok(box.querySelector('canvas.vi-cert__canvas[width="1120"][height="792"]'), 'the certificate PFA issues, at its own shape (11 Nov 2026)');
  assert.ok(box.querySelector('label.cert-try input.vi-try[maxlength="48"]'));
  assert.match(box.querySelector('figcaption').textContent, /^A sample, as it would read if you began today\./);
  const scripts = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
  assert.ok(scripts.indexOf('assets/certificate.js') > -1 && scripts.indexOf('assets/certificate.js') < scripts.indexOf('assets/internship-fieldnotes.js'), 'certificate.js loads first');
  assert.match(fnJs, /sample: true/);
  assert.match(fnJs, /input\.addEventListener\('input', paint\)/);
  assert.match(html, /\.cert-try input:focus,\.cert-try input:focus-visible\{outline:none;border-bottom-color:#fff\}/, 'the field shows focus by its own edge');
});

/* Owner, 2 Nov 2026, of the opening: "this doesnt look properly aligned..and
   use animatiosn to move up and down hte page", with a picture of a fader. */
test('the opening: the line, then Apply and Discover side by side on one line', () => {
  const html = read('internship.html');
  const foot = /<div class="vi-open__foot">([\s\S]*?)<\/div>/.exec(html)[1];
  assert.ok(foot.indexOf('vi-open__apply') < foot.indexOf('vi-open__go'), 'Apply leads');
  assert.match(html, /\.vi-open__foot\{display:grid;grid-template-columns:auto auto;justify-content:start;align-items:center;/);
  assert.match(html, /\.vi-open__foot p\{grid-column:1\/-1\}/);
  assert.match(html, /@media \(prefers-reduced-motion:no-preference\)\{html\{scroll-behavior:smooth\}\}/);
});

test('the page fader: marks from the page’s own sections; a slider; glides; hidden on phones', () => {
  const html = read('internship.html');
  assert.match(html, /<script src="assets\/page-fader\.js" defer><\/script>/);
  assert.deepEqual([...html.matchAll(/data-fader-label="([^"]+)"/g)].map((m) => m[1]), ['Start', 'The internship', 'Apply', 'Send proof', 'Questions']);
  const js = read('assets/page-fader.js');
  assert.match(js, /setAttribute\('role', 'slider'\)/);
  assert.match(js, /if \(!el\.offsetHeight \|\| el\.closest\('\[hidden\]'\)\) return;/, 'a form not yet opened has no mark');
  assert.match(js, /if \(reduce\.matches\) return jump\(to\);/, 'reduced motion jumps');
  assert.match(js, /@media \(max-width:900px\),\(pointer:coarse\)\{\.pf-fader\{display:none\}\}/);
  assert.doesNotMatch(js, /[–—]/);
});
