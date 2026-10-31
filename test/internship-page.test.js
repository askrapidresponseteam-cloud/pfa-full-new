'use strict';

/* The virtual internship on the site (owner, 31 Oct 2026: "add internship
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
  assert.equal(doc.querySelector('title').textContent, 'Virtual internship | People for Animals');
  assert.ok(doc.querySelector('header.site a[aria-current="page"][data-nav="internship.html"]'), 'marked in the Get Involved menu');
  assert.match(read('assets/chrome-header.html'), /\{\{CURRENT:internship\.html\|Virtual internship\}\}/);
  assert.match(read('assets/chrome-footer.html'), /<li><a href="internship\.html">Virtual internship<\/a><\/li>/);
});

test('twelve tasks, each with a target and its detail under a plus; eight weeks', () => {
  const tasks = [...doc.querySelectorAll('#viTasks > li.m-card')];
  assert.equal(tasks.length, 12);
  for (const t of tasks) {
    assert.ok(t.querySelector(".vi-goal b") && t.querySelector(".vi-goal small"), "a target and its unit");
    assert.ok(t.querySelector('details.vi-how > summary'), 'how it works, under a plus');
  }
  assert.equal(doc.querySelectorAll('.vi-weeks > li').length, 8);
  /* owner, 31 Oct 2026: "submit videos to the wall should be 1 of the task.
     find a lawyer can be 1 task. find a home isnt good because peep can fake
     and animal will end up in trouble, same with feeding ... the tasks cannot
     have anything that can leave the animal in trouble whatsoever" */
  const titles = tasks.map((t) => t.querySelector('h3').textContent);
  assert.ok(titles.includes('Send films to The Wall') && titles.includes('Find a lawyer'));
  assert.ok(tasks.some((t) => t.querySelector('a[href="wall.html#submit"]')), 'the task leads to The Wall');
  const work = [...tasks].map((t) => t.textContent).join(' ') + doc.querySelector('.vi-weeks').textContent;
  assert.doesNotMatch(work, /feeding circle|feeding rota|feeding spot|find homes|adopt|foster|catch, transport/i, 'no task an animal could come to depend on');
  assert.match(doc.querySelector('#tasks .m-head').textContent, /no animal is ever worse off when the eight weeks end/);
  /* owner, 31 Oct 2026: "report cruelty - remove from the item.. u dont
     people to create cruelty.. cound the dogs- u can remove, it will be
     hard to validate. give some other realistic task instead that will have
     no scope for faking or animal trouble" */
  assert.ok(!titles.some((x) => /cruelty|count the dogs/i.test(x)), 'neither task is set');
  assert.ok(titles.includes('Ask your town about its dogs') && titles.includes('Put a PFA guide in your language'));
  assert.match(work, /acknowledgement number/, 'the RTI is proved by its acknowledgement');
  assert.match(work, /Checked line by line by a PFA reviewer/, 'the guide is checked by a person');
  assert.match(doc.querySelector('#more').textContent, /Why are feeding and adoption not tasks\?/);
  assert.match(doc.querySelector('#more').textContent, /no feeding spots, fostering or adoptions as part of the internship/);
});

test('the photographs are on the site, shown whole at their own shapes', () => {
  for (const img of doc.querySelectorAll('main img')) {
    const src = img.getAttribute('src');
    assert.ok(fs.existsSync(path.join(ROOT, src)), src);
    assert.ok(img.getAttribute('alt'), `${src} has words for a screen reader`);
  }
  assert.match(html, /\.m-hero__media \.m-duo\.vi-duo \.m-ph:first-child\{aspect-ratio:1100\/1763/);
  assert.match(html, /\.vi-wide \.m-ph\{aspect-ratio:2000\/1335/);
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
  assert.equal(S.KIND_LABELS['PFA-VI'], 'Virtual internship application');
  const F = require('../lib/submission-fields');
  assert.equal(F.specFor('PFA-VI').page, 'internship.html');
  assert.ok(require('../lib/confirmations.js'));
  assert.ok(!/[–—]/.test(html.replace(/<script id="pfa-vis">[\s\S]*?<\/script>/, '')), 'no dashes');
});
