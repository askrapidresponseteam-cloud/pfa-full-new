'use strict';

/* The Academy is a teaching page about medicine, which makes two promises
   the rest of the site does not: that every lesson rests on a named source,
   and that nothing on the page hands a dose to someone who should be asking a
   vet. This pins the structure those promises live in, so that a later edit
   that drops a citation, breaks a quiz or teaches the checker a drug name is
   caught here rather than by a reader. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'academy.html'), 'utf8');
const markup = html.replace(/<script[\s\S]*?<\/script>/gi, '');
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || ['', ''])[1];

test('the Academy is wired into the site like every other public page', () => {
  const sync = fs.readFileSync(path.join(ROOT, 'scripts', 'sync-chrome.js'), 'utf8');
  assert.match(sync, /'academy\.html':\s*\{ current: 'academy\.html'/, 'not in the PAGES table');
  assert.match(html, /aria-current="page"[^>]*>Academy</, 'the stamped header does not mark it current');
  const footer = fs.readFileSync(path.join(ROOT, 'assets', 'chrome-footer.html'), 'utf8');
  assert.match(footer, /href="academy\.html">Academy</, 'missing from the footer Explore list');
  const index = fs.readFileSync(path.join(ROOT, 'search-index.json'), 'utf8');
  assert.ok(index.includes('academy.html'), 'not in the search index');
  const search = fs.readFileSync(path.join(ROOT, 'pfa-search.js'), 'utf8');
  assert.ok((search.match(/u: 'academy\.html/g) || []).length >= 5, 'fewer than five curated search rows');
});

test('the page says what it is before it teaches anything', () => {
  const note = markup.match(/<div class="note">([\s\S]*?)<\/div>\s*<\/div>/);
  assert.ok(note, 'the standing note is gone');
  assert.match(note[1], /information, not treatment/);
  assert.match(note[1], /registered veterinary practitioner/);
  const heroEnd = markup.indexOf('</section>');
  assert.ok(markup.indexOf('<div class="note">') > heroEnd, 'the note must follow the hero, not sit inside it');
});

test('fourteen modules, each a lettered part the filter bar can reach', () => {
  const parts = [...markup.matchAll(/<section class="part" id="part-([a-n])" data-part="([A-N])">/g)];
  assert.equal(parts.length, 14);
  parts.forEach(([, id, letter]) => assert.equal(letter, id.toUpperCase(), `part-${id} carries data-part ${letter}`));
  for (const [, , letter] of parts) {
    assert.match(markup, new RegExp(`data-filter="${letter}"`), `no filter chip for ${letter}`);
  }
  const cards = [...markup.matchAll(/class="mod" href="#part-([a-n])"/g)].map((m) => m[1]);
  assert.deepEqual(cards, parts.map((m) => m[1]), 'the syllabus cards and the modules disagree');
});

test('every lesson names its sources, and every source chip is one of them', () => {
  const lessons = [...markup.matchAll(/<details class="qa" id="([a-n]\d+)" data-part="([A-N])" data-cites="([^"]*)">([\s\S]*?)<\/details>/g)];
  assert.ok(lessons.length >= 70, `only ${lessons.length} lessons`);
  const bad = [];
  for (const [, id, part, cites, body] of lessons) {
    if (part !== id[0].toUpperCase()) bad.push(`${id}: data-part ${part}`);
    const listed = cites.split('|').map((c) => c.trim()).filter(Boolean);
    if (!listed.length) bad.push(`${id}: no data-cites`);
    const chips = [...body.matchAll(/class="cite" data-cite="([^"]+)"/g)].map((m) => m[1]);
    if (!chips.length) bad.push(`${id}: no source chip`);
    for (const chip of chips) if (!listed.includes(chip)) bad.push(`${id}: chip "${chip}" not in data-cites`);
    if (!/<p class="qa__lead">/.test(body)) bad.push(`${id}: no lead sentence`);
  }
  assert.deepEqual(bad, []);
});

test('each self-check question has one right answer and an explanation', () => {
  const questions = [...markup.matchAll(/<fieldset class="qz">([\s\S]*?)<\/fieldset>/g)];
  assert.ok(questions.length >= 20, `only ${questions.length} questions`);
  const bad = [];
  questions.forEach(([, q], i) => {
    const opts = (q.match(/class="qz__opt"/g) || []).length;
    const right = (q.match(/data-correct="1"/g) || []).length;
    if (opts < 2) bad.push(`question ${i + 1}: ${opts} options`);
    if (right !== 1) bad.push(`question ${i + 1}: ${right} correct answers`);
    if (!/<p class="qz__exp" hidden>/.test(q)) bad.push(`question ${i + 1}: no explanation`);
  });
  assert.deepEqual(bad, []);
  assert.equal((markup.match(/<div class="quiz" data-quiz="[A-N]">/g) || []).length, 14, 'one self-check per module');
});

test('the checker does arithmetic and knows no medicine', () => {
  assert.match(script, /w \* d/, 'weight times dose is the whole method');
  const drugs = ['meloxicam', 'doxycycline', 'amoxicillin', 'ivermectin', 'paracetamol', 'enrofloxacin', 'prednisolone'];
  for (const d of drugs) assert.ok(!script.toLowerCase().includes(d), `the script mentions ${d}: it must hold no dose ranges`);
  assert.match(markup, /holds no dose ranges/, 'the page must say so beside the checker');
});

test('the four banned NSAIDs and the colistin ban are stated with their years', () => {
  for (const claim of ['diclofenac', 'ketoprofen', 'aceclofenac', 'nimesulide', 'colistin']) {
    assert.ok(markup.toLowerCase().includes(claim), `${claim} is not on the page`);
  }
  assert.match(markup, /31 July 2023/);
  assert.match(markup, /19 July 2019/);
  assert.match(markup, /January 2025/);
});

/* v1.555: four modules from four textbooks (owner, 10 Nov 2026: "enrich the
   info on the website/academy based on this. 100% stick to facts, and always
   give verifiable citations", and "have images so as to make the
   university/academy content interesting"). Each new lesson names the book or
   paper as a chip, gives the page to check, and the sources list links every
   one; the pictures are diagrams drawn for the page, not copied figures. */
test('Modules 11 to 14: every lesson says where to check it, and the sources link the books', () => {
  const doc = new (require('jsdom').JSDOM)(html).window.document;
  const want = { K: 5, L: 6, M: 4, N: 5 };
  for (const [letter, n] of Object.entries(want)) {
    const part = doc.getElementById(`part-${letter.toLowerCase()}`);
    assert.ok(part, `part ${letter}`);
    const lessons = part.querySelectorAll('details.qa');
    assert.equal(lessons.length, n, `module ${letter} lessons`);
    for (const l of lessons) {
      const pg = l.querySelector('.pg');
      assert.ok(pg && /Where to check\./.test(pg.textContent) && /pp?\. \d|\d{4}/.test(pg.textContent), `${l.id}: no page reference`);
    }
    assert.ok(part.querySelector('figure.academy-photo img[alt]'), `module ${letter} has its photograph`);
  }
  const figs = doc.querySelectorAll('.qas figure.fig svg[role="img"][aria-label]');
  assert.ok(figs.length >= 9, `only ${figs.length} diagrams`);
  for (const f of doc.querySelectorAll('figure.fig')) assert.ok(f.querySelector('figcaption').textContent.trim().length > 20, 'a diagram without a caption');
  const srcs = doc.querySelector('.srcs').textContent;
  for (const book of ['One Health: Veterinary, Ethical, and Environmental Perspectives', 'Introduction to Animal Behavior and Veterinary Behavioral Medicine', 'Veterinary Nursing of Exotic Pets and Wildlife', 'Introduction to Animal and Veterinary Anatomy and Physiology']) {
    assert.ok(srcs.includes(book), `${book} is not in the sources`);
  }
  for (const doi of ['10.1201/9781003569787', '10.1038/s41598-020-75828-6', '10.1079/9781800624061.0000']) {
    assert.ok(html.includes(`https://doi.org/${doi}`), `no link to ${doi}`);
  }
  assert.match(html, /96 lessons · Every claim cited/);
  assert.match(html, /var part = \/\^part-\(\[a-n\]\)\$\/\.exec\(id\);/, 'a link to #part-k to #part-n must open its module');
  assert.doesNotMatch(markup, /[–—]/, 'no long dashes');
});
